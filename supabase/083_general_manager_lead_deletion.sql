-- The General Manager's direct Lead delete action must use the same scoped
-- unlink permission as an approved Lead-deletion request. Without this, an
-- automatic lead_id -> NULL update on linked quotations is treated as an
-- unauthorized quotation edit.
--
-- Run after 082_cascade_direct_price_quotation_deletion.sql. Safe to re-run.

begin;

create or replace function public.delete_lead_as_general_manager(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.has_text_role(v_lead.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can delete a Lead';
  end if;

  -- Permits only the database's automatic lead unlink on linked quotations.
  perform set_config('huswell.allow_price_quotation_lead_unlink', 'on', true);
  delete from public.leads where id = v_lead.id;

  return v_lead.id;
end;
$$;

revoke all on function public.delete_lead_as_general_manager(uuid) from public;
grant execute on function public.delete_lead_as_general_manager(uuid) to authenticated;

commit;
