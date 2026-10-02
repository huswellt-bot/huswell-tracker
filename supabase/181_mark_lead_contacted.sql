-- Run after 180_scope_va_commission_to_valid_lead_endorsements.sql and before
-- deploying the matching Leads workspace update. This allows the authorized
-- lead owner or active endorsed Sales & Pricing Officer to record contact
-- without opening direct update access to any other Lead fields.

begin;

create or replace function public.mark_lead_contacted(
  p_lead_id uuid,
  p_date_contacted date
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  if p_date_contacted is null then
    raise exception 'Select a contact date';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;

  if coalesce(v_lead.evaluation_number, 0) = 7 then
    raise exception 'Only Leads can be marked as contacted';
  end if;

  if not (
    private.has_text_role(
      v_lead.organization_id,
      array['super_admin', 'owner', 'admin']
    )
    or (
      coalesce(v_lead.assigned_to, v_lead.created_by) = (select auth.uid())
      and private.has_text_role(
        v_lead.organization_id,
        array['project_manager', 'sales_pricing_officer']
      )
    )
    or (
      v_lead.endorsed_to = (select auth.uid())
      and private.has_text_role(
        v_lead.organization_id,
        array['sales_pricing_officer']
      )
    )
  ) then
    raise exception 'You are not authorized to mark this Lead as contacted';
  end if;

  if v_lead.date_contacted is not null then
    raise exception 'This Lead is already marked as contacted';
  end if;

  update public.leads
  set date_contacted = p_date_contacted
  where id = v_lead.id;
end;
$$;

revoke all on function public.mark_lead_contacted(uuid, date) from public;
grant execute on function public.mark_lead_contacted(uuid, date) to authenticated;

commit;
