-- Repair the production-approval permission audit trigger.
-- Migration 163 attached the generic activity trigger to a table whose
-- composite key is (organization_id, user_id), so it has no NEW.id field.
-- Run after 163_production_approval_permissions.sql. Safe to re-run.

begin;

create or replace function public.log_production_approval_permission_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  target_user_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
    target_user_id := old.user_id;
  else
    target_organization_id := new.organization_id;
    target_user_id := new.user_id;
  end if;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  )
  values (
    target_organization_id,
    auth.uid(),
    tg_table_name,
    target_user_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists production_approval_permissions_activity_log
  on public.production_approval_permissions;
create trigger production_approval_permissions_activity_log
after insert or update or delete on public.production_approval_permissions
for each row execute function public.log_production_approval_permission_activity();

commit;
