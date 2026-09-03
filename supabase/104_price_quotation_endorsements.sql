-- Run after 103_company_announcements.sql and before deploying the matching app update.
-- Creates immutable, private PDF copies of approved direct Price Quotations.
-- Safe to re-run and additive.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('price-quotation-endorsements', 'price-quotation-endorsements', false, 15728640, array['application/pdf']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.price_quotation_endorsements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  quotation_no text not null,
  client_name text,
  project_name text,
  total_amount numeric(14,2),
  note text,
  snapshot_path text not null unique,
  status text not null default 'processing' check (status in ('processing', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (sender_user_id <> recipient_user_id)
);
create unique index if not exists price_quotation_endorsements_active_unique
  on public.price_quotation_endorsements (quotation_id, sender_user_id, recipient_user_id)
  where status in ('processing', 'active');
create index if not exists price_quotation_endorsements_recipient_idx on public.price_quotation_endorsements (recipient_user_id, created_at desc);
alter table public.price_quotation_endorsements enable row level security;

drop policy if exists "endorsements: participants read" on public.price_quotation_endorsements;
create policy "endorsements: participants read" on public.price_quotation_endorsements for select to authenticated using (
  sender_user_id = (select auth.uid()) or recipient_user_id = (select auth.uid()) or private.has_text_role(organization_id, array['admin'])
);

create or replace function public.create_price_quotation_endorsement(p_quotation_id uuid, p_recipient_user_id uuid, p_note text default null)
returns table(id uuid, snapshot_path text) language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype; v_id uuid := gen_random_uuid(); v_path text;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null or v_quote.status::text <> 'approved' then raise exception 'Only an approved Price Quotation can be endorsed'; end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) or (v_quote.created_by is distinct from (select auth.uid()) and v_quote.prepared_by_user_id is distinct from (select auth.uid())) then raise exception 'Only the preparing Sales Project Officer can endorse this Price Quotation'; end if;
  if not exists (select 1 from public.organization_members where organization_id = v_quote.organization_id and user_id = p_recipient_user_id and role::text = 'project_manager') then raise exception 'Choose an active Sales Project Officer in this organization'; end if;
  delete from public.price_quotation_endorsements where quotation_id = v_quote.id and sender_user_id = (select auth.uid()) and recipient_user_id = p_recipient_user_id and status = 'processing';
  v_path := v_quote.organization_id::text || '/price-quotation-endorsements/' || v_id::text || '.pdf';
  insert into public.price_quotation_endorsements (id, organization_id, quotation_id, sender_user_id, recipient_user_id, quotation_no, client_name, project_name, total_amount, note, snapshot_path)
  values (v_id, v_quote.organization_id, v_quote.id, (select auth.uid()), p_recipient_user_id, coalesce(v_quote.quotation_no, 'Price Quotation'), v_quote.client_name, v_quote.project_name, v_quote.total_amount, nullif(btrim(coalesce(p_note, '')), ''), v_path);
  insert into public.activity_log (organization_id, actor_id, resource_type, resource_id, action, after_data, note) values (v_quote.organization_id, (select auth.uid()), 'price_quotation_endorsement', v_id, 'created', jsonb_build_object('quotation_id', v_quote.id, 'recipient_user_id', p_recipient_user_id), nullif(btrim(coalesce(p_note, '')), ''));
  return query select v_id, v_path;
end; $$;

create or replace function public.activate_price_quotation_endorsement(p_endorsement_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_endorsement public.price_quotation_endorsements%rowtype;
begin
  select * into v_endorsement from public.price_quotation_endorsements where id = p_endorsement_id for update;
  if not found or v_endorsement.sender_user_id <> (select auth.uid()) or v_endorsement.status <> 'processing' then raise exception 'Endorsement cannot be activated'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'price-quotation-endorsements' and name = v_endorsement.snapshot_path) then raise exception 'The PDF snapshot was not uploaded'; end if;
  update public.price_quotation_endorsements set status = 'active', activated_at = now() where id = p_endorsement_id;
end; $$;

create or replace function public.revoke_price_quotation_endorsement(p_endorsement_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_endorsement public.price_quotation_endorsements%rowtype;
begin
  select * into v_endorsement from public.price_quotation_endorsements where id = p_endorsement_id for update;
  if not found or v_endorsement.status <> 'active' then raise exception 'Active endorsement not found'; end if;
  if v_endorsement.sender_user_id <> (select auth.uid()) and not private.has_text_role(v_endorsement.organization_id, array['admin']) then raise exception 'Only the sender or General Manager can revoke this endorsement'; end if;
  update public.price_quotation_endorsements set status = 'revoked', revoked_at = now(), revoked_by = (select auth.uid()) where id = p_endorsement_id;
  insert into public.activity_log (organization_id, actor_id, resource_type, resource_id, action) values (v_endorsement.organization_id, (select auth.uid()), 'price_quotation_endorsement', v_endorsement.id, 'revoked');
end; $$;

revoke all on function public.create_price_quotation_endorsement(uuid, uuid, text) from public;
grant execute on function public.create_price_quotation_endorsement(uuid, uuid, text) to authenticated;
revoke all on function public.activate_price_quotation_endorsement(uuid) from public;
grant execute on function public.activate_price_quotation_endorsement(uuid) to authenticated;
revoke all on function public.revoke_price_quotation_endorsement(uuid) from public;
grant execute on function public.revoke_price_quotation_endorsement(uuid) to authenticated;

drop policy if exists "endorsement snapshots: participants read" on storage.objects;
drop policy if exists "endorsement snapshots: sender upload" on storage.objects;
create policy "endorsement snapshots: participants read" on storage.objects for select to authenticated using (
  bucket_id = 'price-quotation-endorsements' and exists (select 1 from public.price_quotation_endorsements e where e.snapshot_path = name and e.status = 'active' and (e.sender_user_id = (select auth.uid()) or e.recipient_user_id = (select auth.uid()) or private.has_text_role(e.organization_id, array['admin'])))
);
create policy "endorsement snapshots: sender upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'price-quotation-endorsements' and exists (select 1 from public.price_quotation_endorsements e where e.snapshot_path = name and e.status = 'processing' and e.sender_user_id = (select auth.uid()))
);

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'price_quotation_endorsements') then alter publication supabase_realtime add table public.price_quotation_endorsements; end if;
end $$;
commit;

-- Rollback before the feature is used:
-- begin;
-- alter publication supabase_realtime drop table public.price_quotation_endorsements;
-- drop table public.price_quotation_endorsements;
-- drop function if exists public.create_price_quotation_endorsement(uuid, uuid, text);
-- drop function if exists public.activate_price_quotation_endorsement(uuid);
-- drop function if exists public.revoke_price_quotation_endorsement(uuid);
-- delete from storage.buckets where id = 'price-quotation-endorsements';
-- commit;
