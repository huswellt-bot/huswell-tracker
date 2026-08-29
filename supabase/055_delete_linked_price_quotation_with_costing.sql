-- Deletes a Costing Breakdown and its linked Price Quotation atomically.
-- Related invoices, production jobs, and project schedules are intentionally
-- protected because removing their quotation reference would lose workflow or
-- financial traceability. Run after 054. Safe to re-run.

create or replace function public.delete_costing_breakdown(p_costing_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_price_quotation_id uuid;
begin
  select * into v_costing
  from public.quotations
  where id = p_costing_id
  for update;

  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;

  if not private.has_text_role(v_costing.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can delete a Costing Breakdown';
  end if;

  select id into v_price_quotation_id
  from public.quotations
  where costing_source_id = v_costing.id
    and document_type = 'price_quotation'
  for update;

  if v_price_quotation_id is not null then
    if exists (
      select 1 from public.invoices
      where quotation_id = v_price_quotation_id
    ) then
      raise exception 'This Costing Breakdown cannot be deleted because its Price Quotation is linked to an invoice';
    end if;

    if exists (
      select 1 from public.production_jobs
      where quotation_id = v_price_quotation_id
    ) then
      raise exception 'This Costing Breakdown cannot be deleted because its Price Quotation is linked to a production job';
    end if;

    if exists (
      select 1 from public.project_schedules
      where quotation_id = v_price_quotation_id
    ) then
      raise exception 'This Costing Breakdown cannot be deleted because its Price Quotation is linked to a project schedule';
    end if;

    delete from public.quotations
    where id = v_price_quotation_id;
  end if;

  delete from public.quotations
  where id = v_costing.id;
end;
$$;

revoke all on function public.delete_costing_breakdown(uuid) from public;
grant execute on function public.delete_costing_breakdown(uuid) to authenticated;
