-- Run after 100_revert_pricing_officer_revise.sql.
-- Adds company policy PDF documents. All organization members may view them;
-- only the General Manager (admin role) may upload or delete policies.
-- PDF bytes live in a dedicated storage bucket; metadata lives in a new
-- policies table with read-only RLS for members and writes via RPCs.

begin;

-- ---------------------------------------------------------------------------
-- 1) Storage bucket for policy PDFs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policy-documents',
  'policy-documents',
  true,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "policy documents: workspace upload" on storage.objects;
drop policy if exists "policy documents: workspace update" on storage.objects;
drop policy if exists "policy documents: workspace delete" on storage.objects;

create policy "policy documents: workspace upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "policy documents: workspace update"
on storage.objects for update to authenticated
using (
  bucket_id = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "policy documents: workspace delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

-- ---------------------------------------------------------------------------
-- 2) Policies table.
-- ---------------------------------------------------------------------------
create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  file_url text not null check (btrim(file_url) <> ''),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists policies_org_created_idx
  on public.policies (organization_id, created_at desc);

alter table public.policies enable row level security;

-- All organization members may view policies.
drop policy if exists "policies: members read" on public.policies;
create policy "policies: members read"
on public.policies for select to authenticated using (
  (select private.is_org_member(organization_id))
);

-- No direct inserts/updates/deletes; writes go through the RPCs below.
drop policy if exists "policies: no direct insert" on public.policies;
create policy "policies: no direct insert"
on public.policies for insert to authenticated with check (false);

drop policy if exists "policies: no direct update" on public.policies;
create policy "policies: no direct update"
on public.policies for update to authenticated using (false) with check (false);

drop policy if exists "policies: no direct delete" on public.policies;
create policy "policies: no direct delete"
on public.policies for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- 3) RPCs. Only the General Manager (admin) may upload or delete.
-- ---------------------------------------------------------------------------
create or replace function public.insert_policy(
  p_title text,
  p_file_url text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_org_id uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_file_url text := nullif(btrim(coalesce(p_file_url, '')), '');
begin
  if v_title is null then
    raise exception 'Enter a policy title';
  end if;
  if v_file_url is null then
    raise exception 'Upload a policy document';
  end if;

  select member.organization_id into v_org_id
  from public.organization_members member
  where member.user_id = (select auth.uid())
    and member.role::text = 'admin'
  limit 1;

  if v_org_id is null then
    raise exception 'Only the General Manager can upload policies';
  end if;

  insert into public.policies (organization_id, title, file_url, uploaded_by)
  values (v_org_id, v_title, v_file_url, (select auth.uid()));
end;
$$;

create or replace function public.delete_policy(
  p_policy_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_org_id uuid;
begin
  select member.organization_id into v_org_id
  from public.organization_members member
  where member.user_id = (select auth.uid())
    and member.role::text = 'admin'
  limit 1;

  if v_org_id is null then
    raise exception 'Only the General Manager can delete policies';
  end if;

  delete from public.policies
  where id = p_policy_id and organization_id = v_org_id;

  if not found then
    raise exception 'Policy not found';
  end if;
end;
$$;

revoke all on function public.insert_policy(text, text) from public;
grant execute on function public.insert_policy(text, text) to authenticated;
revoke all on function public.delete_policy(uuid) from public;
grant execute on function public.delete_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Realtime so a newly uploaded policy is visible to all roles immediately.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'policies'
  ) then
    alter publication supabase_realtime add table public.policies;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually if needed):
--   drop policy if exists "policies: members read" on public.policies;
--   drop policy if exists "policies: no direct insert" on public.policies;
--   drop policy if exists "policies: no direct update" on public.policies;
--   drop policy if exists "policies: no direct delete" on public.policies;
--   drop function public.insert_policy(text, text);
--   drop function public.delete_policy(uuid);
--   drop table public.policies;
--   delete from storage.buckets where id = 'policy-documents';
--   -- Also remove public.policies from the supabase_realtime publication.
-- ---------------------------------------------------------------------------