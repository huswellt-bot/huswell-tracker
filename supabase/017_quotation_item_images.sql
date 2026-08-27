-- Optional product images for customer-facing quotation line items.
-- Run after migration 016.

alter table public.quotation_items
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-images',
  'quotation-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quotation images: workspace upload" on storage.objects;
drop policy if exists "quotation images: workspace update" on storage.objects;
drop policy if exists "quotation images: workspace delete" on storage.objects;

create policy "quotation images: workspace upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotation-images'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "quotation images: workspace update"
on storage.objects for update to authenticated
using (
  bucket_id = 'quotation-images'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'quotation-images'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);

create policy "quotation images: workspace delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quotation-images'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
  )
);
