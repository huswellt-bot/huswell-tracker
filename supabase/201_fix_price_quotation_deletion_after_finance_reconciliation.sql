-- Keep the guarded Price Quotation deletion workflow compatible with the
-- Finance payment reconciliation foreign key introduced after the original
-- deletion function. Source-generated Money In rows are removed before their
-- source quotation payment records, while manually entered Finance history is
-- not touched.
--
-- Run after 200_lead_change_history_and_active_endorsements.sql and before
-- deploying the matching quotation workspace update.

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
  perform pg_advisory_xact_lock(hashtextextended(p_quotation_id::text, 0));

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
    perform set_config('huswell.allow_historical_costing_cascade', 'on', true);
  end if;

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

  select coalesce(array_agg(mockup.id), '{}'::uuid[])
    into v_mockup_quotation_ids
  from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.source_price_quotation_id = any(v_price_quotation_ids);

  v_all_quotation_ids := v_workflow_quotation_ids || v_mockup_quotation_ids;

  if exists (
    select 1
    from public.commission_summaries summary
    where summary.quotation_id = any(v_price_quotation_ids)
  ) then
    raise exception 'This Price Quotation cannot be deleted because it has a Commission Summary';
  end if;

  delete from public.project_schedules schedule
  where schedule.quotation_id = any(v_all_quotation_ids)
     or schedule.mockup_quotation_id = any(v_mockup_quotation_ids);

  delete from public.approval_requests approval
  where approval.resource_type = 'quotation'
    and approval.resource_id = any(v_all_quotation_ids);

  delete from public.payments payment
  where payment.invoice_id in (
    select invoice.id
    from public.invoices invoice
    where invoice.quotation_id = any(v_all_quotation_ids)
  );
  delete from public.invoices invoice
  where invoice.quotation_id = any(v_all_quotation_ids);

  -- Finance rows created by the quotation-payment reconciliation trigger keep
  -- a restrictive source_payment_id link. Remove only those source-generated
  -- rows before the quotation payment records cascade with the quotation.
  delete from public.finance_transactions transaction
  where transaction.source_payment_id in (
    select payment.id
    from public.quotation_payment_records payment
    where payment.quotation_id = any(v_all_quotation_ids)
  );
  delete from public.quotation_payment_records payment
  where payment.quotation_id = any(v_all_quotation_ids);

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

  delete from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.id = any(v_mockup_quotation_ids);
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

-- This legacy trigger attempted to delete Storage metadata from SQL. Storage
-- objects must be removed through the Storage API after the database delete.
drop trigger if exists quotation_payment_records_cleanup_receipt
  on public.quotation_payment_records;
drop function if exists public.cleanup_quotation_payment_receipt();

-- General Managers may remove receipts as part of an authorized quotation
-- deletion. The app captures paths before deleting relational rows, then
-- removes the objects through the Storage API. The orphan branch permits a
-- retry after the database transaction succeeds.
drop policy if exists "quotation payment receipts: submitter cleanup" on storage.objects;
create policy "quotation payment receipts: submitter cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and (
    exists (
      select 1
      from public.quotation_payment_records payment
      where payment.receipt_storage_path = storage.objects.name
        and (
          (
            payment.submitted_by = (select auth.uid())
            and payment.status in ('pending', 'rejected')
            and private.can_submit_quotation_payment(payment.quotation_id)
          )
          or private.has_text_role(
            payment.organization_id,
            array['super_admin', 'owner', 'admin']
          )
        )
    )
    or (
      not exists (
        select 1
        from public.quotation_payment_records payment
        where payment.receipt_storage_path = storage.objects.name
      )
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin')
      )
    )
  )
);

commit;
