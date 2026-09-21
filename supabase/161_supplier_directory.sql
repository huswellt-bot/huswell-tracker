-- Supplier's List directory fields and multi-value contact support.
-- Run after migration 160 and before deploying the matching workspace update.

alter table public.suppliers
  add column if not exists project_type text,
  add column if not exists whatsapp text,
  add column if not exists viber text,
  add column if not exists instagram_link text,
  add column if not exists facebook_link text,
  add column if not exists website_link text,
  add column if not exists emails text[] not null default '{}'::text[],
  add column if not exists contact_numbers text[] not null default '{}'::text[];

-- Preserve existing single-value supplier contacts as the first value in the
-- new repeatable fields. The legacy email/phone columns remain populated for
-- compatibility with older clients and exports.
update public.suppliers
set emails = array[nullif(btrim(email), '')]::text[]
where coalesce(cardinality(emails), 0) = 0
  and nullif(btrim(email), '') is not null;

update public.suppliers
set contact_numbers = array[nullif(btrim(phone), '')]::text[]
where coalesce(cardinality(contact_numbers), 0) = 0
  and nullif(btrim(phone), '') is not null;

-- Sales & Pricing Officers may add directory records. Supplier master-data
-- editing, availability changes, and deletion remain General Manager actions;
-- Project Managers retain read access for existing supplier references.
drop policy if exists "suppliers: members read" on public.suppliers;
create policy "suppliers: members read"
on public.suppliers for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin', 'project_manager', 'sales_pricing_officer']
  ))
);

drop policy if exists "suppliers: general manager insert" on public.suppliers;
drop policy if exists "suppliers: authorized insert" on public.suppliers;
create policy "suppliers: authorized insert"
on public.suppliers for insert to authenticated
with check (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin', 'sales_pricing_officer']
  ))
);

drop policy if exists "suppliers: general manager update" on public.suppliers;
create policy "suppliers: general manager update"
on public.suppliers for update to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin']
  ))
)
with check (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin']
  ))
);
