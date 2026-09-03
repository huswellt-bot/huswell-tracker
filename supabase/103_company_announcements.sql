-- Run after 102_secure_company_policy_storage.sql and before deploying the
-- Announcements & Policy application update. This migration is additive and
-- safe to re-run. It gives General Managers (admin) write access while every
-- organization member can view announcements.

begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  message text not null check (btrim(message) <> ''),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_organization_created_at_idx
  on public.announcements (organization_id, created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "announcements: organization members can read" on public.announcements;
create policy "announcements: organization members can read"
  on public.announcements for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "announcements: general managers can insert" on public.announcements;
create policy "announcements: general managers can insert"
  on public.announcements for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_text_role(organization_id, array['admin'])
  );

drop policy if exists "announcements: general managers can update" on public.announcements;
create policy "announcements: general managers can update"
  on public.announcements for update to authenticated
  using (private.has_text_role(organization_id, array['admin']))
  with check (private.has_text_role(organization_id, array['admin']));

drop policy if exists "announcements: general managers can delete" on public.announcements;
create policy "announcements: general managers can delete"
  on public.announcements for delete to authenticated
  using (private.has_text_role(organization_id, array['admin']));

create or replace function public.guard_announcement_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Announcement organization and author cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_announcement_identity() from public;

drop trigger if exists announcements_guard_identity on public.announcements;
create trigger announcements_guard_identity
  before update on public.announcements
  for each row execute function public.guard_announcement_identity();

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end;
$$;

commit;

-- Rollback (only if this feature must be removed before it is used):
-- begin;
-- alter publication supabase_realtime drop table public.announcements;
-- drop table public.announcements;
-- drop function if exists public.guard_announcement_identity();
-- commit;
