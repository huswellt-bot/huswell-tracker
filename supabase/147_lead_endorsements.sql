-- Sales Executive lead endorsements.
-- Run after 146_refresh_pending_gm_pricing_defaults.sql and before deploying
-- the matching Leads workspace update. This is additive and preserves leads.

begin;

alter table public.leads
  add column if not exists endorsed_by uuid references auth.users(id) on delete set null,
  add column if not exists endorsed_to uuid references auth.users(id) on delete set null,
  add column if not exists endorsed_at timestamptz;

create index if not exists leads_org_endorsed_to_idx
  on public.leads (organization_id, endorsed_to, endorsed_at desc)
  where endorsed_to is not null;

-- General Managers retain full visibility. A Sales Executive sees their own
-- leads; the selected Sales & Pricing Officer sees only leads endorsed to
-- that account. The recipient is intentionally not granted edit access.
drop policy if exists "leads: workflow read" on public.leads;
create policy "leads: workflow read"
on public.leads for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or (
    coalesce(assigned_to, created_by) = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
  or (
    endorsed_to = (select auth.uid())
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = leads.organization_id
        and member.user_id = (select auth.uid())
        and member.role::text = 'sales_pricing_officer'
    )
  )
);

-- One-time endorsement. The database validates the original owner, the exact
-- Sales Executive role, and the selected Sales & Pricing Officer so the UI
-- cannot widen visibility or transfer lead ownership by itself.
create or replace function public.endorse_lead(
  p_lead_id uuid,
  p_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_endorsed_at timestamptz := now();
begin
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select a Sales & Pricing Officer recipient';
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
    raise exception 'Only Leads can be endorsed';
  end if;

  if coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid())
    or not exists (
      select 1
      from public.organization_members member
      where member.organization_id = v_lead.organization_id
        and member.user_id = (select auth.uid())
        and member.role::text = 'project_manager'
    ) then
    raise exception 'Only the owning Sales Executive can endorse this lead';
  end if;

  if v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead has already been endorsed';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;

  update public.leads
  set endorsed_by = (select auth.uid()),
      endorsed_to = p_recipient_user_id,
      endorsed_at = v_endorsed_at
  where id = v_lead.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'endorsed',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at
    ),
    jsonb_build_object(
      'endorsed_by', (select auth.uid()),
      'endorsed_to', p_recipient_user_id,
      'endorsed_at', v_endorsed_at
    )
  );

  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead(uuid, uuid) from public;
grant execute on function public.endorse_lead(uuid, uuid) to authenticated;

commit;
