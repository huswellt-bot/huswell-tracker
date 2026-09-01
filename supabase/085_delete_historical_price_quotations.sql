-- Allow the General Manager to permanently delete a historical Price
-- Quotation together with its retired Costing Breakdown source and every
-- record derived from either quotation. Project Officers remain limited to
-- deleting their own direct draft or returned Price Quotations.
--
-- Run after 084_cascade_lead_deletion.sql. Safe to re-run.

begin;

create or replace function public.prevent_costing_breakdown_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' and new.document_type = 'costing_breakdown' then
    raise exception 'Costing Breakdowns are no longer available. Create a direct Price Quotation instead.';
  end if;

  if tg_op = 'UPDATE' and old.document_type = 'costing_breakdown'
    and not (
      new.lead_id is null
      and old.lead_id is not null
      and coalesce(
        current_setting('huswell.allow_price_quotation_lead_unlink', true),
        'off'
      ) = 'on'
    ) then
    raise exception 'Historical Costing Breakdowns are read-only.';
  end if;

  if tg_op = 'DELETE' and old.document_type = 'costing_breakdown'
    and coalesce(current_setting('huswell.allow_lead_cascade', true), 'off') <> 'on'
    and coalesce(current_setting('huswell.allow_historical_costing_cascade', true), 'off') <> 'on' then
    raise exception 'Historical Costing Breakdowns cannot be deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.delete_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_costing_id uuid;
  v_is_general_manager boolean;
  v_is_own_editable_quotation boolean;
begin
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
  -- Quotation. Remove all of them so its source can be deleted safely.
  -- Include the source quotation too in case legacy operational records were
  -- attached directly to it.
  delete from public.project_schedules
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.id = v_quotation.id
       or quote.id = v_costing_id
       or quote.costing_source_id = v_costing_id
  );

  delete from public.payments
  where invoice_id in (
    select invoice.id
    from public.invoices invoice
    where invoice.quotation_id in (
      select quote.id
      from public.quotations quote
      where quote.id = v_quotation.id
         or quote.id = v_costing_id
         or quote.costing_source_id = v_costing_id
    )
  );
  delete from public.invoices
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.id = v_quotation.id
       or quote.id = v_costing_id
       or quote.costing_source_id = v_costing_id
  );

  delete from public.finished_product_stock_ins
  where production_job_id in (
    select job.id
    from public.production_jobs job
    where job.quotation_id in (
      select quote.id
      from public.quotations quote
      where quote.id = v_quotation.id
         or quote.id = v_costing_id
         or quote.costing_source_id = v_costing_id
    )
  );
  delete from public.production_jobs
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.id = v_quotation.id
       or quote.id = v_costing_id
       or quote.costing_source_id = v_costing_id
  );

  -- Delete dependent Price Quotations before the historical source. Existing
  -- foreign keys remove their items, revision requests, and price history.
  delete from public.quotations price
  where price.document_type = 'price_quotation'
    and (
      price.id = v_quotation.id
      or price.costing_source_id = v_costing_id
    );

  if v_costing_id is not null then
    delete from public.quotations
    where id = v_costing_id
      and document_type = 'costing_breakdown';
  end if;
end;
$$;

revoke all on function public.prevent_costing_breakdown_workflow() from public;
revoke all on function public.delete_price_quotation(uuid) from public;
grant execute on function public.delete_price_quotation(uuid) to authenticated;

commit;
