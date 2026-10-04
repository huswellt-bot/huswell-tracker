-- Allow modern Word documents as Print Costing source files.
-- Run after 185_hide_price_quotation_drafts_from_management.sql and before
-- deploying the matching application update.

begin;

alter table public.costing_requests
  drop constraint if exists costing_requests_source_mime_type_check;

alter table public.costing_requests
  add constraint costing_requests_source_mime_type_check
  check (
    source_mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'costing-source-documents',
  'costing-source-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
