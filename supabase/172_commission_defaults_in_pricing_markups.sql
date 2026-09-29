-- Keep Commission Summary Sales Commission and VA Commission defaults in the
-- General Manager's internal pricing-markup settings.
--
-- The existing commission_default_rate and va_commission_default_rate columns
-- remain as synchronized rollout-compatible mirrors for older RPCs and clients.
-- Existing quotation costings and Commission Summary snapshots are preserved.
-- Run after 171_automatic_commission_receivable_balance.sql and before the
-- matching workspace update.

begin;

create or replace function private.validate_pricing_markup_defaults(p_defaults jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_entry jsonb;
  v_type text;
  v_value numeric;
begin
  if coalesce(jsonb_typeof(p_defaults), '') <> 'object' then
    raise exception 'Pricing defaults must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_defaults) as supplied(key)
    where supplied.key not in (
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'va_commission', 'incentives', 'discounts',
      'third_party_markup', 'vat'
    )
    and supplied.key !~ '^custom_[0-9a-f-]{36}$'
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'va_commission', 'incentives', 'third_party_markup', 'vat'
  ] loop
    if not (p_defaults ? v_key) then
      raise exception 'Missing pricing default: %', v_key;
    end if;
  end loop;

  for v_key, v_entry in
    select key, value from jsonb_each(p_defaults)
  loop
    if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
      raise exception 'Pricing default % must be an object', v_key;
    end if;
    if v_key ~ '^custom_' and nullif(btrim(coalesce(v_entry ->> 'label', '')), '') is null then
      raise exception 'Custom pricing defaults need a name';
    end if;
    if (v_entry ? 'visible') and jsonb_typeof(v_entry -> 'visible') <> 'boolean' then
      raise exception 'Pricing default % visibility must be true or false', v_key;
    end if;
    v_type := coalesce(v_entry ->> 'calculation_type', 'percentage');
    if v_type <> 'percentage' then
      raise exception 'Pricing default % must use percentage basis', v_key;
    end if;
    begin
      if v_entry ->> 'value' is null then
        raise exception 'Pricing default % needs a valid numeric value', v_key;
      end if;
      v_value := (v_entry ->> 'value')::numeric;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value < 0 or v_value > 100 then
      raise exception 'Pricing default % must be between 0%% and 100%%', v_key;
    end if;
    if v_key = 'target_profit_margin' and v_value >= 100 then
      raise exception 'Pricing default % must be below 100%%', v_key;
    end if;
  end loop;
end;
$$;

create or replace function private.sync_commission_summary_defaults_from_pricing_markups()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_sales_rate numeric;
  v_va_rate numeric;
begin
  if coalesce(jsonb_typeof(new.pricing_markup_defaults), '') = 'object' then
    begin
      v_sales_rate := coalesce(
        nullif(new.pricing_markup_defaults -> 'sales_commission' ->> 'value', '')::numeric,
        nullif(new.pricing_markup_defaults -> 'sales_commission' ->> 'rate', '')::numeric
      );
      v_va_rate := coalesce(
        nullif(new.pricing_markup_defaults -> 'va_commission' ->> 'value', '')::numeric,
        nullif(new.pricing_markup_defaults -> 'va_commission' ->> 'rate', '')::numeric
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Commission pricing defaults need valid numeric values';
    end;

    if v_sales_rate is not null then
      new.commission_default_rate := round(v_sales_rate, 2);
    end if;
    if v_va_rate is not null then
      new.va_commission_default_rate := round(v_va_rate, 2);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists business_commission_summary_defaults_sync
  on public.business_settings;
create trigger business_commission_summary_defaults_sync
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.sync_commission_summary_defaults_from_pricing_markups();

alter table public.business_settings
  alter column pricing_markup_defaults set default '{
    "target_profit_margin": {"label": "Target Profit Margin", "calculation_type": "percentage", "value": 75},
    "overhead_allocation": {"label": "Overhead Allocation", "calculation_type": "percentage", "value": 0},
    "contingency_allowance": {"label": "Contingency Allowance", "calculation_type": "percentage", "value": 20},
    "sales_commission": {"label": "Sales Commission", "calculation_type": "percentage", "value": 0},
    "va_commission": {"label": "VA Commission", "calculation_type": "percentage", "value": 0},
    "incentives": {"label": "Incentives", "calculation_type": "percentage", "value": 0},
    "third_party_markup": {"label": "Third Party Mark Up", "calculation_type": "percentage", "value": 15},
    "vat": {"label": "VAT", "calculation_type": "percentage", "value": 12}
  }'::jsonb;

-- Add the new key without overwriting an already configured Sales Commission
-- or a previously configured VA Commission pricing value.
update public.business_settings
set pricing_markup_defaults = jsonb_build_object(
  'target_profit_margin', jsonb_build_object(
    'label', 'Target Profit Margin',
    'calculation_type', 'percentage',
    'value', least(coalesce(default_profit_margin, 75), 99.99)
  ),
  'overhead_allocation', jsonb_build_object(
    'label', 'Overhead Allocation',
    'calculation_type', 'percentage',
    'value', coalesce(default_overhead_rate, 0)
  ),
  'contingency_allowance', jsonb_build_object(
    'label', 'Contingency Allowance',
    'calculation_type', 'percentage',
    'value', coalesce(default_buffer_margin, 20)
  ),
  'sales_commission', jsonb_build_object(
    'label', 'Sales Commission',
    'calculation_type', 'percentage',
    'value', coalesce(production_commission, commission_default_rate, 0)
  ),
  'va_commission', jsonb_build_object(
    'label', 'VA Commission',
    'calculation_type', 'percentage',
    'value', coalesce(va_commission_default_rate, 0)
  ),
  'incentives', jsonb_build_object(
    'label', 'Incentives',
    'calculation_type', 'percentage',
    'value', 0
  ),
  'third_party_markup', jsonb_build_object(
    'label', 'Third Party Mark Up',
    'calculation_type', 'percentage',
    'value', least(coalesce(default_additional_markup, 15), 100)
  ),
  'vat', jsonb_build_object(
    'label', 'VAT',
    'calculation_type', 'percentage',
    'value', coalesce(vat_rate, 12)
  )
) || coalesce(pricing_markup_defaults, '{}'::jsonb);

-- Keep the previous RPC usable by older clients, but route its values into the
-- same Pricing defaults object instead of maintaining a second UI setting.
create or replace function public.save_commission_defaults(
  p_organization_id uuid,
  p_commission_rate numeric,
  p_va_commission_rate numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_defaults jsonb;
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Only the General Manager can change commission defaults';
  end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'Commission percentage must be between 0 and 100';
  end if;
  if p_va_commission_rate is null or p_va_commission_rate < 0 or p_va_commission_rate > 100 then
    raise exception 'VA Commission percentage must be between 0 and 100';
  end if;

  select pricing_markup_defaults
  into v_defaults
  from public.business_settings
  where organization_id = p_organization_id;

  v_defaults := jsonb_build_object(
    'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
    'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
    'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
    'sales_commission', jsonb_build_object('label', 'Sales Commission', 'calculation_type', 'percentage', 'value', round(p_commission_rate, 2)),
    'va_commission', jsonb_build_object('label', 'VA Commission', 'calculation_type', 'percentage', 'value', round(p_va_commission_rate, 2)),
    'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
    'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15),
    'vat', jsonb_build_object('label', 'VAT', 'calculation_type', 'percentage', 'value', 12)
  ) || coalesce(v_defaults, '{}'::jsonb);
  v_defaults := jsonb_set(
    v_defaults,
    '{sales_commission}',
    jsonb_build_object('label', 'Sales Commission', 'calculation_type', 'percentage', 'value', round(p_commission_rate, 2)),
    true
  );
  v_defaults := jsonb_set(
    v_defaults,
    '{va_commission}',
    jsonb_build_object('label', 'VA Commission', 'calculation_type', 'percentage', 'value', round(p_va_commission_rate, 2)),
    true
  );
  perform public.save_pricing_defaults(p_organization_id, v_defaults);
end;
$$;

revoke all on function public.save_commission_defaults(uuid, numeric, numeric)
  from public;
grant execute on function public.save_commission_defaults(uuid, numeric, numeric)
  to authenticated;

commit;
