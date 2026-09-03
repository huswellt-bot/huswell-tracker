-- Run after 101_company_policies.sql.
-- Keeps company policy PDFs private. All organization members can obtain a
-- short-lived viewing link, while only the General Manager (admin role) can
-- upload, replace, or delete the underlying storage objects.
-- Safe to re-run.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policy-documents',
  'policy-documents',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "policy documents: workspace read" on storage.objects;
drop policy if exists "policy documents: workspace upload" on storage.objects;
drop policy if exists "policy documents: workspace update" on storage.objects;
drop policy if exists "policy documents: workspace delete" on storage.objects;
drop policy if exists "policy documents: General Manager upload" on storage.objects;
drop policy if exists "policy documents: General Manager update" on storage.objects;
drop policy if exists "policy documents: General Manager delete" on storage.objects;

create policy "policy documents: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'policy-documents'
  and split_part(name, '/', 2) = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "policy documents: General Manager upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'policy-documents'
  and split_part(name, '/', 2) = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'admin'
  )
);

create policy "policy documents: General Manager update"
on storage.objects for update to authenticated
using (
  bucket_id = 'policy-documents'
  and split_part(name, '/', 2) = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'admin'
  )
)
with check (
  bucket_id = 'policy-documents'
  and split_part(name, '/', 2) = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'admin'
  )
);

create policy "policy documents: General Manager delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'policy-documents'
  and split_part(name, '/', 2) = 'policy-documents'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'admin'
  )
);

commit;
