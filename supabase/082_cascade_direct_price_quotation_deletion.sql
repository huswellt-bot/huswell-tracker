-- Permanently delete the operational and finance records derived from a
-- direct Price Quotation when an authorized user deletes that quotation.
-- This intentionally removes invoices (including their items and payments),
-- production jobs (including usage, activity, and stock-ins), and project
-- schedules (including revision and completion requests).
--
-- Run after 081_delete_direct_price_quotations.sql. Safe to re-run.

begin;

create or replace function public.delete_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
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
  if v_quotation.costing_source_id is not null then
    raise exception 'Historical Price Quotations linked to a Costing Breakdown cannot be deleted';
  end if;

  v_is_general_manager := private.has_text_role(
    v_quotation.organization_id,
    array['super_admin', 'owner', 'admin']
  );
  v_is_own_editable_quotation := coalesce(
    v_quotation.created_by = (select auth.uid())
    and v_quotation.status::text in ('draft', 'needs_revision')
    and private.has_text_role(v_quotation.organization_id, array['project_manager']),
    false
  );

  if not coalesce(v_is_general_manager, false)
    and not v_is_own_editable_quotation then
    raise exception 'Only the General Manager can delete this Price Quotation. Project Officers can delete only their own draft or returned quotations';
  end if;

  -- Project schedules block quotation deletion, so remove them first. Their
  -- revision and completion requests are deleted by their foreign keys.
  delete from public.project_schedules
  where quotation_id = v_quotation.id;

  -- Remove invoices and payments together; invoice items are removed by the
  -- invoice foreign key instead of leaving payment records without an invoice.
  delete from public.payments
  where invoice_id in (
    select id from public.invoices where quotation_id = v_quotation.id
  );
  delete from public.invoices
  where quotation_id = v_quotation.id;

  -- Remove the job's operational records rather than leaving stock-ins or
  -- material use attached to a no-longer-existing quotation.
  delete from public.finished_product_stock_ins
  where production_job_id in (
    select id from public.production_jobs where quotation_id = v_quotation.id
  );
  delete from public.production_jobs
  where quotation_id = v_quotation.id;

  -- This cascades quotation items, quotation revision requests, and preserved
  -- price data through their existing foreign keys.
  delete from public.quotations
  where id = v_quotation.id;
end;
$$;

revoke all on function public.delete_price_quotation(uuid) from public;
grant execute on function public.delete_price_quotation(uuid) to authenticated;

commit;
