-- Repair the Production Operations permission audit trigger.
-- The permission table uses a composite key (organization_id, user_id), so
-- it cannot use the generic activity trigger that expects NEW.id.

begin;

create or replace function public.log_production_operations_permission_activity()
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

revoke all on function public.log_production_operations_permission_activity()
  from public, anon, authenticated;

drop trigger if exists production_operations_permissions_activity_log
  on public.production_operations_permissions;
create trigger production_operations_permissions_activity_log
after insert or update or delete on public.production_operations_permissions
for each row execute function public.log_production_operations_permission_activity();

commit;
