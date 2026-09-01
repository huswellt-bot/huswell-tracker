-- Provides one guarded deletion path for direct Price Quotations. Historical
-- quotations backed by Costing Breakdowns remain protected, and quotes that
-- are already used by finance or project workflows cannot be removed.
--
-- Run after 080_allow_lead_unlink_for_historical_costings.sql. Safe to re-run.

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

  if exists (
    select 1 from public.invoices
    where quotation_id = v_quotation.id
  ) then
    raise exception 'This Price Quotation cannot be deleted because it is linked to an invoice';
  end if;
  if exists (
    select 1 from public.production_jobs
    where quotation_id = v_quotation.id
  ) then
    raise exception 'This Price Quotation cannot be deleted because it is linked to a production job';
  end if;
  if exists (
    select 1 from public.project_schedules
    where quotation_id = v_quotation.id
  ) then
    raise exception 'This Price Quotation cannot be deleted because it is linked to a project schedule';
  end if;

  delete from public.quotations
  where id = v_quotation.id;
end;
$$;

revoke all on function public.delete_price_quotation(uuid) from public;
grant execute on function public.delete_price_quotation(uuid) to authenticated;

commit;
