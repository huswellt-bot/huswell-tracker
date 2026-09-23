-- Supplier country options and searchable product/service details.
-- Run after 161_supplier_directory.sql and before the matching workspace update.

begin;

alter table public.suppliers
  add column if not exists country text,
  add column if not exists products_services text;

alter table public.business_settings
  add column if not exists supplier_countries text[] not null default '{}'::text[];

-- Supplier Project Type no longer supports Mock Up. Preserve the supplier row
-- and clear only the obsolete value; quotation project types are unchanged.
update public.suppliers
set project_type = null
where lower(regexp_replace(btrim(project_type), '\s+', ' ', 'g')) in ('mockup', 'mock up');

-- Keep the GM-managed option list clean and deterministic without changing the
-- order in which the GM entered the countries.
create or replace function private.normalize_supplier_country_options(options text[])
returns text[]
language sql
immutable
set search_path = public, private
as $$
  select coalesce(
    array_agg(country order by first_position),
    '{}'::text[]
  )
  from (
    select distinct on (lower(btrim(raw_country)))
      btrim(raw_country) as country,
      ordinality as first_position
    from unnest(coalesce(options, '{}'::text[])) with ordinality as option(raw_country, ordinality)
    where nullif(btrim(raw_country), '') is not null
    order by lower(btrim(raw_country)), ordinality
  ) normalized;
$$;

update public.business_settings
set supplier_countries = private.normalize_supplier_country_options(supplier_countries)
where supplier_countries is distinct from private.normalize_supplier_country_options(supplier_countries);

-- Country options are a GM-controlled setting. The existing broad settings
-- policies remain unchanged for legacy settings behavior, but this trigger
-- protects this new column specifically and also prevents removing an option
-- that is already assigned to a supplier.
create or replace function private.validate_supplier_country_options()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  old_options text[] := '{}'::text[];
  next_options text[] := private.normalize_supplier_country_options(new.supplier_countries);
  assigned_country text;
begin
  if tg_op = 'UPDATE' then
    old_options := private.normalize_supplier_country_options(old.supplier_countries);
  end if;

  if not private.has_text_role(new.organization_id, array['owner', 'admin', 'super_admin']) then
    raise exception 'Only General Managers can change supplier country options.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old_options is distinct from next_options then
    select s.country
    into assigned_country
    from public.suppliers s
    where s.organization_id = new.organization_id
      and nullif(btrim(s.country), '') is not null
      and not exists (
        select 1
        from unnest(next_options) as configured(country_name)
        where lower(btrim(configured.country_name)) = lower(btrim(s.country))
      )
    limit 1;

    if assigned_country is not null then
      raise exception 'Cannot remove country "%" while it is assigned to a supplier.', assigned_country
        using errcode = 'check_violation';
    end if;
  end if;

  new.supplier_countries := next_options;
  return new;
end;
$$;

drop trigger if exists supplier_country_options_guard on public.business_settings;
create trigger supplier_country_options_guard
before insert or update of supplier_countries on public.business_settings
for each row execute function private.validate_supplier_country_options();

-- Enforce the new supplier rules at the database boundary as well as in the
-- UI. Legacy records with blank country/product details remain readable. A
-- non-directory update, such as toggling availability, can still proceed for
-- those legacy rows; any supplier data edit must provide the new fields.
create or replace function private.validate_supplier_directory_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  canonical_country text;
  directory_fields_changed boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    directory_fields_changed :=
      new.company_name is distinct from old.company_name or
      new.contact_name is distinct from old.contact_name or
      new.address is distinct from old.address or
      new.email is distinct from old.email or
      new.phone is distinct from old.phone or
      new.payment_terms is distinct from old.payment_terms or
      new.notes is distinct from old.notes or
      new.project_type is distinct from old.project_type or
      new.whatsapp is distinct from old.whatsapp or
      new.viber is distinct from old.viber or
      new.instagram_link is distinct from old.instagram_link or
      new.facebook_link is distinct from old.facebook_link or
      new.website_link is distinct from old.website_link or
      new.emails is distinct from old.emails or
      new.contact_numbers is distinct from old.contact_numbers or
      new.country is distinct from old.country or
      new.products_services is distinct from old.products_services;
  end if;

  if new.project_type is not null
     and lower(regexp_replace(btrim(new.project_type), '\s+', ' ', 'g')) in ('mockup', 'mock up') then
    raise exception 'Mock Up is not available for suppliers.'
      using errcode = 'check_violation';
  end if;

  if directory_fields_changed then
    if nullif(btrim(new.country), '') is null then
      raise exception 'Select a supplier country.'
        using errcode = 'check_violation';
    end if;

    if nullif(btrim(new.products_services), '') is null then
      raise exception 'Enter the supplier products or services.'
        using errcode = 'check_violation';
    end if;

    select btrim(configured.country_name)
    into canonical_country
    from public.business_settings settings
    cross join lateral unnest(coalesce(settings.supplier_countries, '{}'::text[])) as configured(country_name)
    where settings.organization_id = new.organization_id
      and lower(btrim(configured.country_name)) = lower(btrim(new.country))
    limit 1;

    if canonical_country is null then
      raise exception 'Select a country configured by the General Manager.'
        using errcode = 'check_violation';
    end if;
    new.country := canonical_country;
  elsif nullif(btrim(new.country), '') is not null then
    select btrim(configured.country_name)
    into canonical_country
    from public.business_settings settings
    cross join lateral unnest(coalesce(settings.supplier_countries, '{}'::text[])) as configured(country_name)
    where settings.organization_id = new.organization_id
      and lower(btrim(configured.country_name)) = lower(btrim(new.country))
    limit 1;

    if canonical_country is null then
      raise exception 'Select a country configured by the General Manager.'
        using errcode = 'check_violation';
    end if;
    new.country := canonical_country;
  end if;

  if new.products_services is not null then
    new.products_services := btrim(new.products_services);
  end if;
  if new.project_type is not null then
    new.project_type := btrim(new.project_type);
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_directory_fields_guard on public.suppliers;
create trigger supplier_directory_fields_guard
before insert or update on public.suppliers
for each row execute function private.validate_supplier_directory_fields();

commit;
