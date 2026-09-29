-- Run after 176_lead_remarks.sql and before deploying the matching Leads
-- workspace update. This preserves the existing remark field and owner path.

begin;

create or replace function private.can_edit_lead_remark(
  target_organization_id uuid,
  target_assigned_to uuid,
  target_created_by uuid,
  target_endorsed_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select (
    (
      private.has_text_role(
        target_organization_id,
        array['project_manager', 'sales_pricing_officer']
      )
      and coalesce(target_assigned_to, target_created_by) is not distinct from (select auth.uid())
    )
    or (
      target_endorsed_to = (select auth.uid())
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id = target_organization_id
          and member.user_id = (select auth.uid())
          and member.role::text = 'sales_pricing_officer'
      )
    )
  );
$$;

revoke all on function private.can_edit_lead_remark(uuid, uuid, uuid, uuid) from public;

create or replace function public.save_lead_remark(
  p_lead_id uuid,
  p_lead_remark text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_remark text := nullif(btrim(coalesce(p_lead_remark, '')), '');
begin
  if char_length(coalesce(v_remark, '')) > 1000 then
    raise exception 'Lead remark must be 1,000 characters or fewer';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;

  if not private.can_edit_lead_remark(
    v_lead.organization_id,
    v_lead.assigned_to,
    v_lead.created_by,
    v_lead.endorsed_to
  ) then
    raise exception 'Only the owner or active endorsed officer can save this lead remark';
  end if;

  update public.leads
  set lead_remark = v_remark
  where id = v_lead.id;
end;
$$;

revoke all on function public.save_lead_remark(uuid, text) from public;
grant execute on function public.save_lead_remark(uuid, text) to authenticated;

create or replace function private.guard_lead_remark_update()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.lead_remark is distinct from old.lead_remark
    and not private.can_edit_lead_remark(
      old.organization_id,
      old.assigned_to,
      old.created_by,
      old.endorsed_to
    ) then
    raise exception 'Only the owner or active endorsed officer can save this lead remark';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_lead_remark_update() from public;

drop trigger if exists leads_guard_lead_remark_update on public.leads;
create trigger leads_guard_lead_remark_update
before update on public.leads
for each row execute function private.guard_lead_remark_update();

commit;
