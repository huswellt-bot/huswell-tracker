-- Permanently remove the retired signed-proof uploads and quotation-PDF
-- endorsement data from the active system.
--
-- The user approved permanent deletion of existing signed-proof files/rows and
-- quotation-PDF endorsement files/rows. Storage objects and buckets must be
-- removed with the Supabase Storage API before this SQL migration is run;
-- direct SQL deletion from storage tables is blocked by Supabase. The two
-- legacy tables and nullable production-reference columns remain empty so
-- historical migration functions and already-deployed clients do not fail on
-- a missing relation; all old upload/endorsement RPCs are replaced with
-- disabled stubs and their execute grants are revoked. No new proof or
-- quotation-PDF endorsement can be made.
-- Run after 149_price_quotation_only_production.sql and before deploying the
-- matching application update. Run
-- npm.cmd run cleanup:retired-quotation-storage first, then run this SQL.
-- Safe to re-run after the first execution.

begin;

-- Do not silently leave retired objects behind if the Storage API cleanup was
-- skipped or incomplete. SELECT is allowed here; DELETE from storage tables is
-- intentionally blocked by the storage protection trigger.
do $$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id in ('price-quotation-endorsements', 'quotation-signed-proofs')
  ) or exists (
    select 1
    from storage.buckets
    where id in ('price-quotation-endorsements', 'quotation-signed-proofs')
  ) then
    raise exception
      'Run npm.cmd run cleanup:retired-quotation-storage with the Storage API before this migration';
  end if;
end;
$$;

delete from public.price_quotation_endorsements;
revoke all on public.price_quotation_endorsements from public, anon, authenticated;

drop policy if exists "endorsement snapshots: participants read" on storage.objects;
drop policy if exists "endorsement snapshots: sender upload" on storage.objects;

-- Keep the historical relation loadable for old deletion functions, but make
-- every legacy entry point fail closed.
create or replace function public.create_price_quotation_endorsement(
  p_quotation_id uuid,
  p_recipient_user_id uuid,
  p_note text default null
)
returns table(id uuid, snapshot_path text)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'Quotation PDF endorsement has been removed; endorse the lead instead';
end;
$$;

create or replace function public.activate_price_quotation_endorsement(
  p_endorsement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'Quotation PDF endorsement has been removed; endorse the lead instead';
end;
$$;

create or replace function public.revoke_price_quotation_endorsement(
  p_endorsement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'Quotation PDF endorsement has been removed; endorse the lead instead';
end;
$$;

revoke all on function public.create_price_quotation_endorsement(uuid, uuid, text)
  from public, authenticated;
revoke all on function public.activate_price_quotation_endorsement(uuid)
  from public, authenticated;
revoke all on function public.revoke_price_quotation_endorsement(uuid)
  from public, authenticated;

-- Remove every signed proof reference before deleting the proof metadata so
-- the legacy RESTRICT foreign keys cannot preserve or block old proof rows.
update public.project_schedules
set price_signed_proof_id = null,
    mockup_signed_proof_id = null
where price_signed_proof_id is not null
   or mockup_signed_proof_id is not null;

update public.production_jobs
set price_signed_proof_id = null,
    mockup_signed_proof_id = null
where price_signed_proof_id is not null
   or mockup_signed_proof_id is not null;

delete from public.quotation_signed_proofs;
revoke all on public.quotation_signed_proofs from public, anon, authenticated;

drop policy if exists "quotation signed proofs: workspace read" on storage.objects;
drop policy if exists "quotation signed proofs: preparer upload" on storage.objects;
drop policy if exists "quotation signed proofs: authorized delete" on storage.objects;

create or replace function public.register_quotation_signed_proof(
  p_quotation_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'Signed proof upload has been removed; no signed proof is required';
end;
$$;

create or replace function public.delete_quotation_signed_proof(
  p_proof_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'Signed proof upload has been removed; no signed proof is required';
end;
$$;

revoke all on function public.register_quotation_signed_proof(uuid, text, text, text, bigint)
  from public, authenticated;
revoke all on function public.delete_quotation_signed_proof(uuid)
  from public, authenticated;

commit;
