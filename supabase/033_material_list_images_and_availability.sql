-- Materials List image support. Run after migration 032.
-- Existing `inventory_items.is_active` is used as the Available / Unavailable flag.

alter table public.inventory_items
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'material-images',
  'material-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Only General Managers (owner/admin) may maintain master material images.
drop policy if exists "material images: general manager upload" on storage.objects;
drop policy if exists "material images: general manager update" on storage.objects;
drop policy if exists "material images: general manager delete" on storage.objects;

create policy "material images: general manager upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'material-images'
  and exists (
    select 1 from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('owner', 'admin')
  )
);

create policy "material images: general manager update"
on storage.objects for update to authenticated
using (
  bucket_id = 'material-images'
  and exists (
    select 1 from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('owner', 'admin')
  )
)
with check (
  bucket_id = 'material-images'
  and exists (
    select 1 from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('owner', 'admin')
  )
);

create policy "material images: general manager delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'material-images'
  and exists (
    select 1 from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('owner', 'admin')
  )
);
