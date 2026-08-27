-- Restore the staff-management policies that 003 replaced while tightening reads.
-- Run this after 007 in the Supabase SQL Editor.

alter table public.organization_members enable row level security;

drop policy if exists "members: admins update" on public.organization_members;
drop policy if exists "members: admins delete" on public.organization_members;
drop policy if exists "members: owners bootstrap or admins manage" on public.organization_members;

create policy "members: owners bootstrap or admins manage"
on public.organization_members
for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and role::text = 'owner'
    and exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.created_by = (select auth.uid())
    )
  )
  or (select private.is_org_admin(organization_id))
);

create policy "members: admins update"
on public.organization_members
for update to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "members: admins delete"
on public.organization_members
for delete to authenticated
using ((select private.is_org_admin(organization_id)));
