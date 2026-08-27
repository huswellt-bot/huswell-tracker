-- Let workspace members read the names of Project Managers so they can be
-- selected as the Outbound Caller on a lead. Other staff profiles remain private.

alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "profiles: workspace owners read staff" on public.profiles;
drop policy if exists "profiles: workspace read project managers" on public.profiles;
drop policy if exists "members: admins read" on public.organization_members;
drop policy if exists "members: admins and project managers read" on public.organization_members;

create policy "profiles: workspace read project managers"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1
    from public.organization_members target_member
    where target_member.user_id = profiles.id
      and target_member.role::text = 'project_manager'
      and (select private.is_org_member(target_member.organization_id))
  )
  or exists (
    select 1
    from public.organization_members target_member
    where target_member.user_id = profiles.id
      and (select private.is_org_admin(target_member.organization_id))
  )
);

create policy "members: admins and project managers read"
on public.organization_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_org_admin(organization_id))
  or (
    role::text = 'project_manager'
    and (select private.is_org_member(organization_id))
  )
);
