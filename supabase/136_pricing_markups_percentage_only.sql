-- Make all new and edited internal pricing markups percentage-only.
-- Existing fixed-amount quotation rows remain untouched as historical pricing
-- snapshots. Any quotation returned for review must be updated with the
-- appropriate percentage values before it is submitted again.
-- Run after 135_vat_percentage_only.sql and before deploying the matching UI.

begin;

create or replace function private.enforce_percentage_pricing_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if exists (
    select 1
    from jsonb_each(new.pricing_markup_defaults) as pricing_default(key, value)
    where coalesce(pricing_default.value ->> 'calculation_type', 'percentage') <> 'percentage'
  ) then
    raise exception 'Pricing defaults must use percentage basis';
  end if;
  return new;
end;
$$;

drop trigger if exists pricing_defaults_percentage_markup_guard on public.business_settings;
create trigger pricing_defaults_percentage_markup_guard
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.enforce_percentage_pricing_defaults();

create or replace function private.enforce_percentage_costing_markup()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(nullif(btrim(new.calculation_type), ''), 'percentage') <> 'percentage' then
    raise exception 'Pricing adjustments must use percentage basis';
  end if;
  new.calculation_type := 'percentage';
  new.amount := 0;
  return new;
end;
$$;

drop trigger if exists price_quotation_costing_markups_percentage_guard on public.price_quotation_costing_markups;
create trigger price_quotation_costing_markups_percentage_guard
before insert or update on public.price_quotation_costing_markups
for each row execute function private.enforce_percentage_costing_markup();

commit;
