begin;

-- Markup names are presentation only. This role is the stable calculation
-- contract used when defaults are copied into new quotation costings.
create or replace function private.pricing_markup_purpose(
  p_key text,
  p_entry jsonb
)
returns text
language sql
immutable
set search_path = public, private
as $$
  select case lower(btrim(coalesce(
    nullif(p_entry ->> 'system_role', ''),
    nullif(p_entry ->> 'purpose', ''),
    case lower(btrim(coalesce(p_key, '')))
      when 'vat' then 'vat'
      when 'sales_commission' then 'sales_commission'
      else 'regular'
    end
  )))
    when 'vat' then 'vat'
    when 'sales_commission' then 'sales_commission'
    when 'sales executive commission' then 'sales_commission'
    else 'regular'
  end;
$$;

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
  v_purpose text;
  v_vat_count integer;
  v_commission_count integer;
begin
  if coalesce(jsonb_typeof(p_defaults), '') <> 'object' then
    raise exception 'Pricing defaults must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_defaults) as supplied(key)
    where supplied.key not in (
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'incentives', 'discounts', 'third_party_markup',
      'vat'
    )
    and supplied.key !~ '^custom_[0-9a-f-]{36}$'
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  select count(*) into v_vat_count
  from jsonb_each(p_defaults) as entries(key, value)
  where private.pricing_markup_purpose(entries.key, entries.value) = 'vat';
  if v_vat_count > 1 then
    raise exception 'Only one pricing default can be assigned as VAT';
  end if;

  select count(*) into v_commission_count
  from jsonb_each(p_defaults) as entries(key, value)
  where private.pricing_markup_purpose(entries.key, entries.value) = 'sales_commission';
  if v_commission_count > 1 then
    raise exception 'Only one pricing default can be assigned as Sales Executive Commission';
  end if;

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
    if (v_entry ? 'locked') and jsonb_typeof(v_entry -> 'locked') <> 'boolean' then
      raise exception 'Pricing default % lock state must be true or false', v_key;
    end if;
    if (v_entry ? 'system_role') and lower(btrim(coalesce(v_entry ->> 'system_role', ''))) not in ('regular', 'vat', 'sales_commission') then
      raise exception 'Pricing default % has an invalid purpose', v_key;
    end if;
    if (v_entry ? 'purpose') and lower(btrim(coalesce(v_entry ->> 'purpose', ''))) not in ('regular', 'vat', 'sales_commission') then
      raise exception 'Pricing default % has an invalid purpose', v_key;
    end if;
    v_purpose := private.pricing_markup_purpose(v_key, v_entry);
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

-- Normalize assigned roles to the canonical keys consumed by the existing
-- costing and commission functions. A former VAT/commission key that becomes
-- a regular markup receives a custom key so it cannot be interpreted as a
-- special calculation by legacy code.
create or replace function public.save_pricing_defaults(
  p_organization_id uuid,
  p_defaults jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_input jsonb := coalesce(p_defaults, '{}'::jsonb) - 'va_commission';
  v_defaults jsonb := '{}'::jsonb;
  v_entry jsonb;
  v_key text;
  v_output_key text;
  v_purpose text;
  v_profit numeric;
  v_overhead numeric;
  v_contingency numeric;
  v_commission numeric;
  v_third_party numeric;
  v_vat numeric;
begin
  if not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can change internal pricing defaults';
  end if;
  perform private.validate_pricing_markup_defaults(v_input);

  for v_key, v_entry in
    select key, value from jsonb_each(v_input)
  loop
    v_purpose := private.pricing_markup_purpose(v_key, v_entry);
    v_output_key := case
      when v_purpose = 'vat' then 'vat'
      when v_purpose = 'sales_commission' then 'sales_commission'
      when v_key in ('vat', 'sales_commission') then 'custom_' || gen_random_uuid()::text
      else v_key
    end;
    if v_defaults ? v_output_key then
      raise exception 'Only one pricing default can be assigned as %', v_purpose;
    end if;
    v_defaults := v_defaults || jsonb_build_object(
      v_output_key,
      v_entry || jsonb_build_object('system_role', v_purpose)
    );
  end loop;

  v_profit := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where private.pricing_markup_purpose(entry.key, entry.value) = 'regular'
      and entry.key = 'target_profit_margin'
  ), 75);
  v_overhead := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where entry.key = 'overhead_allocation'
  ), 0);
  v_contingency := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where entry.key = 'contingency_allowance'
  ), 20);
  v_commission := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where private.pricing_markup_purpose(entry.key, entry.value) = 'sales_commission'
  ), 0);
  v_third_party := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where entry.key = 'third_party_markup'
  ), 15);
  v_vat := coalesce((
    select (entry.value ->> 'value')::numeric
    from jsonb_each(v_defaults) entry(key, value)
    where private.pricing_markup_purpose(entry.key, entry.value) = 'vat'
  ), 0);

  insert into public.business_settings (
    organization_id, pricing_markup_defaults, default_profit_margin,
    default_overhead_rate, default_buffer_margin, production_commission,
    default_additional_markup, vat_rate
  ) values (
    p_organization_id, v_defaults, v_profit, v_overhead, v_contingency,
    v_commission, v_third_party, v_vat
  )
  on conflict (organization_id) do update
  set pricing_markup_defaults = excluded.pricing_markup_defaults,
      default_profit_margin = excluded.default_profit_margin,
      default_overhead_rate = excluded.default_overhead_rate,
      default_buffer_margin = excluded.default_buffer_margin,
      production_commission = excluded.production_commission,
      default_additional_markup = excluded.default_additional_markup,
      vat_rate = excluded.vat_rate;

  return v_defaults;
end;
$$;

revoke all on function public.save_pricing_defaults(uuid, jsonb) from public;
grant execute on function public.save_pricing_defaults(uuid, jsonb) to authenticated;

create or replace function private.sync_commission_summary_defaults_from_pricing_markups()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_sales_rate numeric;
begin
  if coalesce(jsonb_typeof(new.pricing_markup_defaults), '') = 'object' then
    begin
      select coalesce((entry.value ->> 'value')::numeric, (entry.value ->> 'rate')::numeric, 0)
      into v_sales_rate
      from jsonb_each(new.pricing_markup_defaults) entry(key, value)
      where private.pricing_markup_purpose(entry.key, entry.value) = 'sales_commission'
      limit 1;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Commission pricing defaults need valid numeric values';
    end;
    new.commission_default_rate := round(coalesce(v_sales_rate, 0), 2);
  end if;
  new.va_commission_default_rate := 0;
  return new;
end;
$$;

drop trigger if exists business_commission_summary_defaults_sync
  on public.business_settings;
create trigger business_commission_summary_defaults_sync
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.sync_commission_summary_defaults_from_pricing_markups();

-- Add explicit role metadata to existing settings without changing their
-- current behavior. Missing VAT remains valid and means 0% for new quotes.
update public.business_settings settings
set pricing_markup_defaults = coalesce((
  select jsonb_object_agg(
    entries.key,
    entries.value || jsonb_build_object(
      'system_role', private.pricing_markup_purpose(entries.key, entries.value)
    )
  ) as defaults
  from jsonb_each(coalesce(settings.pricing_markup_defaults, '{}'::jsonb)) entries(key, value)
) , '{}'::jsonb)
where jsonb_typeof(settings.pricing_markup_defaults) = 'object';

commit;
