-- Move Production status maintenance into the project status picker.
-- Custom statuses can be archived and restored; built-in statuses remain protected.

begin;

create or replace function public.set_production_status_type_active(
  p_organization_id uuid,
  p_status_type_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_status public.production_status_types%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if p_is_active is null then
    raise exception 'Choose whether the Production status should be active';
  end if;

  select * into v_status
  from public.production_status_types
  where id = p_status_type_id
    and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Production status type not found';
  end if;

  if v_status.is_system and not p_is_active then
    raise exception 'Built-in Production statuses cannot be archived';
  end if;

  if not p_is_active and exists (
    select 1
    from public.production_jobs job
    where job.organization_id = p_organization_id
      and job.production_status_type_id = p_status_type_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'This status is used by an active Production project and cannot be archived';
  end if;

  update public.production_status_types
  set is_active = p_is_active,
      updated_by = (select auth.uid())
  where id = v_status.id;
end;
$$;

revoke all on function public.set_production_status_type_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_production_status_type_active(uuid, uuid, boolean) to authenticated;

commit;
