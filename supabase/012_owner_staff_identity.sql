-- Allow an Owner / General Manager to identify the staff assigned to the
-- same workspace without exposing profiles from other organizations.

alter table public.profiles enable row level security;
drop policy if exists "profiles: workspace owners read staff" on public.profiles;
create policy "profiles: workspace owners read staff"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1 from public.organization_members target_member
    where target_member.user_id = profiles.id
      and (select private.is_org_admin(target_member.organization_id))
  )
);
