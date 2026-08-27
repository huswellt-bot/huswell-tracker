-- Run after 026_add_super_admin_role.sql and 027_enable_super_admin_access.sql.
--
-- 1. First create the separate login in Supabase Dashboard > Authentication > Users.
-- 2. Replace the two placeholder email addresses below, then run this file.
-- This assigns that separate login to the Super Admin user type for the same workspace.

do $$
declare
  owner_email text := 'huswellt@gmail.com';
  super_admin_email text := 'admin121@gmail.com';
  workspace_id uuid;
  super_admin_user_id uuid;
begin
  select membership.organization_id
    into workspace_id
    from auth.users owner_user
    join public.organization_members membership on membership.user_id = owner_user.id
   where lower(owner_user.email) = lower(owner_email)
     and membership.role::text in ('owner', 'admin')
   order by membership.created_at
   limit 1;
  if workspace_id is null then
    raise exception 'No Owner or Administrator workspace membership was found for %.', owner_email;
  end if;

  select id into super_admin_user_id
    from auth.users
   where lower(email) = lower(super_admin_email)
   limit 1;
  if super_admin_user_id is null then
    raise exception 'Create the separate Authentication user for % first.', super_admin_email;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (workspace_id, super_admin_user_id, 'super_admin')
  on conflict (organization_id, user_id)
  do update set role = excluded.role;
end;
$$;

-- Verify the separate Super Admin account:
select user_id, role, created_at
from public.organization_members
where role::text = 'super_admin'
order by created_at desc;
