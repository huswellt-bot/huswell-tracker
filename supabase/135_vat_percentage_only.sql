-- Make VAT percentage-only for new and edited application data.
-- Existing fixed-basis quotations remain untouched as historical records and
-- are rendered with an equivalent percentage by the application when possible.
-- Run after 134_align_lost_client_status_reason.sql.

begin;

-- Normalize any legacy fixed VAT default to the organization's existing VAT
-- rate rather than treating the old fixed amount as a percentage.
update public.business_settings
set pricing_markup_defaults = jsonb_set(
  pricing_markup_defaults,
  '{vat}',
  (pricing_markup_defaults -> 'vat') || jsonb_build_object(
    'calculation_type', 'percentage',
    'value', greatest(least(coalesce(vat_rate, 12), 100), 0)
  ),
  true
)
where pricing_markup_defaults ? 'vat'
  and pricing_markup_defaults -> 'vat' ->> 'calculation_type' = 'fixed_amount';

create or replace function private.enforce_percentage_vat_default()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(new.pricing_markup_defaults -> 'vat' ->> 'calculation_type', 'percentage') <> 'percentage' then
    raise exception 'VAT pricing default must use percentage basis';
  end if;
  return new;
end;
$$;

drop trigger if exists pricing_defaults_vat_percentage_guard on public.business_settings;
create trigger pricing_defaults_vat_percentage_guard
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.enforce_percentage_vat_default();

create or replace function private.enforce_percentage_vat()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(nullif(btrim(new.vat_calculation_type), ''), 'percentage') <> 'percentage' then
    -- Preserve unrelated updates to historical fixed-basis quotations, but do
    -- not allow arbitrary fixed-basis VAT changes going forward. The legacy
    -- costing-review path can still convert one when it submits the exact
    -- percentage equivalent of the saved historical VAT amount.
    if tg_op = 'UPDATE' then
      if old.vat_calculation_type = 'fixed_amount'
        and new.vat_rate is distinct from old.vat_rate
        and old.subtotal > 0
        and new.vat_rate is not distinct from round((old.vat_amount / old.subtotal) * 100, 2)
        and new.vat_fixed_amount is not distinct from old.vat_fixed_amount then
        new.vat_calculation_type := 'percentage';
        new.vat_fixed_amount := 0;
        return new;
      end if;
      if old.vat_calculation_type = 'fixed_amount'
        and new.vat_rate is not distinct from old.vat_rate
        and new.vat_fixed_amount is not distinct from old.vat_fixed_amount then
        return new;
      end if;
    end if;
    raise exception 'VAT must use percentage basis';
  end if;

  new.vat_calculation_type := 'percentage';
  new.vat_fixed_amount := 0;
  return new;
end;
$$;

drop trigger if exists quotation_vat_percentage_guard on public.quotations;
create trigger quotation_vat_percentage_guard
before insert or update on public.quotations
for each row execute function private.enforce_percentage_vat();

commit;
