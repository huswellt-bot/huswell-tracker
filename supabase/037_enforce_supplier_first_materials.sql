-- Supplier-first material workflow.
-- Deploy application code before this migration so the UI requires a supplier.
-- Existing materials without a supplier remain editable for remediation; this
-- migration prevents new supplier-less materials and cross-organization links.

-- Audit these results before enforcing a fully non-null supplier_id in a later
-- migration. Do not create placeholder suppliers: assign the real supplier.
-- select id, organization_id, name from public.inventory_items
-- where item_type = 'material' and supplier_id is null;
-- select organization_id, lower(regexp_replace(btrim(company_name), '\s+', ' ', 'g')),
--        array_agg(id order by created_at)
-- from public.suppliers
-- group by 1, 2 having count(*) > 1;

create index if not exists suppliers_org_normalized_name_idx
  on public.suppliers (
    organization_id,
    lower(regexp_replace(btrim(company_name), '\s+', ' ', 'g'))
  );

create or replace function public.prevent_duplicate_supplier_names()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text;
begin
  normalized_name := lower(regexp_replace(btrim(new.company_name), '\s+', ' ', 'g'));

  if normalized_name = '' then
    raise exception 'Supplier name is required';
  end if;

  if exists (
    select 1
    from public.suppliers supplier
    where supplier.organization_id = new.organization_id
      and supplier.id is distinct from new.id
      and lower(regexp_replace(btrim(supplier.company_name), '\s+', ' ', 'g')) = normalized_name
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'suppliers_organization_normalized_name_key',
      message = 'A supplier with this name already exists in this organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists suppliers_prevent_normalized_name_duplicates on public.suppliers;
create trigger suppliers_prevent_normalized_name_duplicates
before insert or update of company_name on public.suppliers
for each row execute function public.prevent_duplicate_supplier_names();

create or replace function public.enforce_material_supplier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  supplier_organization_id uuid;
  supplier_is_active boolean;
begin
  if new.item_type <> 'material' then
    return new;
  end if;

  if new.supplier_id is null then
    raise exception 'A material must have a supplier.';
  end if;

  select organization_id, is_active
    into supplier_organization_id, supplier_is_active
  from public.suppliers
  where id = new.supplier_id;

  if supplier_organization_id is null then
    raise exception 'Select a valid supplier.';
  end if;

  if supplier_organization_id <> new.organization_id then
    raise exception 'A material supplier must belong to the same organization.';
  end if;

  if supplier_is_active is false then
    raise exception 'Select an active supplier for a new material.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_enforce_material_supplier on public.inventory_items;
create trigger inventory_items_enforce_material_supplier
before insert or update of supplier_id, item_type on public.inventory_items
for each row execute function public.enforce_material_supplier();

-- Supplier records are master data: General Managers manage them, while
-- Project Managers retain read access for costing and supplier references.
alter table public.suppliers enable row level security;
drop policy if exists "suppliers: project officers manage" on public.suppliers;
drop policy if exists "suppliers: members read" on public.suppliers;
drop policy if exists "suppliers: general manager manage" on public.suppliers;
drop policy if exists "suppliers: general manager insert" on public.suppliers;
drop policy if exists "suppliers: general manager update" on public.suppliers;

create policy "suppliers: members read"
on public.suppliers for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin', 'project_manager']
  ))
);

create policy "suppliers: general manager insert"
on public.suppliers for insert to authenticated
with check (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin']
  ))
);

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
