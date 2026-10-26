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
      'sales_commission', 'incentives', 'discounts', 'third_party_markup',
      'vat'
    )
    and supplied.key !~ '^custom_[0-9a-f-]{36}$'
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  -- VAT is the only required row. All other standard and custom markups may
  -- be intentionally removed from new quotation defaults by the GM.
  if not (p_defaults ? 'vat') then
    raise exception 'Missing pricing default: vat';
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
