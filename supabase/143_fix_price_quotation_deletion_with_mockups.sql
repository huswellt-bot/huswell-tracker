-- Allow the guarded Price Quotation deletion workflow to remove linked Mockup
-- Quotations before their source Price Quotation. The source relationship is
-- intentionally RESTRICTed, so the operational records and child quotations
-- must be removed in one transaction before the parent rows are deleted.
--
-- Run after 142_general_manager_production_deletion.sql. Safe to re-run.

begin;

create or replace function public.delete_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_costing_id uuid;
  v_workflow_quotation_ids uuid[] := '{}'::uuid[];
  v_price_quotation_ids uuid[] := '{}'::uuid[];
  v_mockup_quotation_ids uuid[] := '{}'::uuid[];
  v_all_quotation_ids uuid[] := '{}'::uuid[];
  v_is_general_manager boolean;
  v_is_own_editable_quotation boolean;
begin
  -- Match the advisory lock used while creating or editing a Mockup
  -- Quotation so a new child cannot appear between the source lookup and the
  -- ordered deletes below.
  perform pg_advisory_xact_lock(
    hashtextextended(p_quotation_id::text, 0)
  );

  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quotation.document_type <> 'price_quotation' then
    raise exception 'Price Quotation not found';
  end if;

  v_is_general_manager := private.has_text_role(
    v_quotation.organization_id,
    array['super_admin', 'owner', 'admin']
  );
  v_is_own_editable_quotation := coalesce(
    v_quotation.costing_source_id is null
    and v_quotation.created_by = (select auth.uid())
    and v_quotation.status::text in ('draft', 'needs_revision')
    and private.has_text_role(v_quotation.organization_id, array['project_manager']),
    false
  );

  if not coalesce(v_is_general_manager, false)
    and not v_is_own_editable_quotation then
    raise exception 'Only the General Manager can delete this Price Quotation. Project Officers can delete only their own direct draft or returned quotations';
  end if;

  v_costing_id := v_quotation.costing_source_id;
  if v_costing_id is not null then
    -- Allow only this transaction to remove the otherwise read-only source.
    perform set_config('huswell.allow_historical_costing_cascade', 'on', true);
  end if;

  -- A historical Costing Breakdown can have more than one derived Price
  -- Quotation. Include the selected quotation, its historical source, and all
  -- derived Price Quotations in the same deletion set.
  select coalesce(array_agg(quote.id), '{}'::uuid[])
    into v_workflow_quotation_ids
  from public.quotations quote
  where quote.id = v_quotation.id
     or (
       v_costing_id is not null
       and (quote.id = v_costing_id or quote.costing_source_id = v_costing_id)
     );

  select coalesce(array_agg(quote.id), '{}'::uuid[])
    into v_price_quotation_ids
  from public.quotations quote
  where quote.document_type = 'price_quotation'
    and quote.id = any(v_workflow_quotation_ids);

  -- Mockup Quotations are self-referencing children of Price Quotations. Find
  -- them before deleting any parent rows so the RESTRICTed source FK is
  -- removed in the correct order.
  select coalesce(array_agg(mockup.id), '{}'::uuid[])
    into v_mockup_quotation_ids
  from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.source_price_quotation_id = any(v_price_quotation_ids);

  v_all_quotation_ids := v_workflow_quotation_ids || v_mockup_quotation_ids;

  -- Preserve immutable endorsements and paid commission history. Return a
  -- useful business error instead of allowing either RESTRICTed FK to leak a
  -- database constraint message after other work has started.
  if exists (
    select 1
    from public.price_quotation_endorsements endorsement
    where endorsement.quotation_id = any(v_price_quotation_ids)
  ) then
    raise exception 'This Price Quotation cannot be deleted because it has an endorsement. Revoke the endorsement first';
  end if;
  if exists (
    select 1
    from public.sales_commission_payouts payout
    where payout.quotation_id = any(v_price_quotation_ids)
  ) then
    raise exception 'This Price Quotation cannot be deleted because it has a commission payout. Resolve the payout first';
  end if;

  -- Schedules restrict both Price and Mockup Quotation deletion. Remove
  -- requests first; their revision/completion children cascade with the
  -- schedule row.
  delete from public.project_schedules schedule
  where schedule.quotation_id = any(v_all_quotation_ids)
     or schedule.mockup_quotation_id = any(v_mockup_quotation_ids);

  -- approval_requests has a polymorphic resource_id rather than a foreign key,
  -- so clean quotation approval rows explicitly instead of leaving orphans.
  delete from public.approval_requests approval
  where approval.resource_type = 'quotation'
    and approval.resource_id = any(v_all_quotation_ids);

  -- Remove invoices and payments together; invoice items are removed by the
  -- invoice foreign key instead of leaving payment records without an invoice.
  delete from public.payments payment
  where payment.invoice_id in (
    select invoice.id
    from public.invoices invoice
    where invoice.quotation_id = any(v_all_quotation_ids)
  );
  delete from public.invoices invoice
  where invoice.quotation_id = any(v_all_quotation_ids);

  -- Remove operational records before their quotation references disappear.
  -- Material usage and job activity cascade from production_jobs; stock-ins
  -- are removed explicitly so their inventory trigger reverses the stock-in.
  delete from public.finished_product_stock_ins stock_in
  where stock_in.production_job_id in (
    select job.id
    from public.production_jobs job
    where job.quotation_id = any(v_all_quotation_ids)
       or job.mockup_quotation_id = any(v_mockup_quotation_ids)
  );
  delete from public.production_jobs job
  where job.quotation_id = any(v_all_quotation_ids)
     or job.mockup_quotation_id = any(v_mockup_quotation_ids);

  -- Delete child Mockup Quotations before their source Price Quotations. Their
  -- existing cascading foreign keys remove items, costings, payment ledgers,
  -- signed proofs, and other quotation-owned records.
  delete from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.id = any(v_mockup_quotation_ids);

  -- Delete dependent Price Quotations before a historical Costing Breakdown.
  delete from public.quotations price
  where price.document_type = 'price_quotation'
    and price.id = any(v_price_quotation_ids);

  if v_costing_id is not null then
    delete from public.quotations
    where id = v_costing_id
      and document_type = 'costing_breakdown';
  end if;
end;
$$;

revoke all on function public.delete_price_quotation(uuid) from public;
grant execute on function public.delete_price_quotation(uuid) to authenticated;

commit;
