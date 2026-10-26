alter table public.price_quotation_costing_markups
  add column if not exists locked boolean not null default false;

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

  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'incentives', 'third_party_markup', 'vat'
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

create or replace function private.apply_product_costings(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_costings jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing jsonb;
  v_default record;
  v_entry jsonb;
  v_markup_key text;
  v_markup_label text;
  v_value numeric;
  v_locked boolean;
  v_default_markups jsonb := '[]'::jsonb;
  v_normalized_costings jsonb;
  v_settings public.business_settings%rowtype;
  v_had_existing_costings boolean := false;
  v_use_pricing_defaults boolean := false;
  v_is_direct_price_quotation boolean := false;
  v_va_commission_allowed boolean := true;
  v_index integer;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array'
    or coalesce(jsonb_array_length(p_costings), 0) = 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) <> (select count(*) from public.quotation_items where quotation_id = p_quotation_id) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  select exists (
    select 1
    from public.price_quotation_product_costings
    where quotation_id = p_quotation_id
  ) into v_had_existing_costings;

  select coalesce(
    quotation.document_type::text = 'price_quotation'
      and quotation.costing_source_id is null,
    false
  )
  into v_is_direct_price_quotation
  from public.quotations quotation
  where quotation.id = p_quotation_id;

  v_va_commission_allowed := not coalesce(v_is_direct_price_quotation, false)
    or private.valid_va_endorser_for_quotation(p_quotation_id) is not null;

  select * into v_settings
  from public.business_settings
  where organization_id = p_organization_id;

  v_settings.pricing_markup_defaults := coalesce(
    v_settings.pricing_markup_defaults,
    jsonb_build_object(
      'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
      'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
      'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
      'sales_commission', jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', 0),
      'va_commission', jsonb_build_object('label', 'VA Commission', 'calculation_type', 'percentage', 'value', 0),
      'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
      'discounts', jsonb_build_object('label', 'Discounts', 'calculation_type', 'percentage', 'value', 0),
      'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15)
    )
  );

  v_use_pricing_defaults := not v_had_existing_costings
    and p_actor is not null
    and p_actor = (select auth.uid())
    and private.has_text_role(p_organization_id, array['pricing_officer'])
    and not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']);

  if v_use_pricing_defaults then
    for v_default in
      select entries.key, entries.value
      from jsonb_each(v_settings.pricing_markup_defaults) as entries(key, value)
      where entries.key <> 'vat'
        and (
          v_va_commission_allowed
          or private.canonical_pricing_markup_key(entries.key) <> 'va_commission'
        )
      order by case entries.key
        when 'target_profit_margin' then 1
        when 'overhead_allocation' then 2
        when 'contingency_allowance' then 3
        when 'sales_commission' then 4
        when 'va_commission' then 5
        when 'incentives' then 6
        when 'discounts' then 7
        when 'third_party_markup' then 8
        else 100
      end, entries.key
    loop
      v_markup_key := v_default.key;
      v_entry := v_default.value;
      v_value := coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0);
      v_markup_label := coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_markup_key, '_', ' ')));
      v_locked := coalesce((v_entry ->> 'locked')::boolean, false);
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', 'percentage',
        'value', v_value,
        'rate', v_value,
        'amount', 0,
        'locked', v_locked
      ));
    end loop;

    v_normalized_costings := p_costings;
    v_index := 0;
    for v_costing in select value from jsonb_array_elements(p_costings) loop
      if coalesce(v_costing ->> 'pricing_model', 'target_margin') = 'target_margin' then
        v_normalized_costings := jsonb_set(
          v_normalized_costings,
          array[v_index::text, 'markups'],
          v_default_markups,
          true
        );
      end if;
      v_index := v_index + 1;
    end loop;
  else
    v_normalized_costings := p_costings;
  end if;

  perform private.apply_product_costings_before_va_scope(
    p_organization_id,
    p_quotation_id,
    v_normalized_costings,
    case when v_use_pricing_defaults then null else p_actor end
  );

  if v_use_pricing_defaults then
    update public.price_quotation_product_costings
    set created_by = p_actor
    where organization_id = p_organization_id
      and quotation_id = p_quotation_id
      and created_by is null;
  end if;
end;
$$;

create or replace function private.apply_product_costings_before_va_scope(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_costings jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing jsonb;
  v_line jsonb;
  v_markup jsonb;
  v_default record;
  v_item_id uuid;
  v_costing_id uuid;
  v_item_quantity numeric;
  v_pricing_model text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_markup_type text;
  v_value numeric;
  v_markup_key text;
  v_markup_label text;
  v_locked boolean;
  v_entry jsonb;
  v_default_markups jsonb := '[]'::jsonb;
  v_normalized_costings jsonb;
  v_settings public.business_settings%rowtype;
  v_had_existing_costings boolean := false;
  v_use_pricing_defaults boolean := false;
  v_saved_costing jsonb;
  v_result jsonb;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array'
    or coalesce(jsonb_array_length(p_costings), 0) = 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) <> (select count(*) from public.quotation_items where quotation_id = p_quotation_id) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  select exists (
    select 1
    from public.price_quotation_product_costings
    where quotation_id = p_quotation_id
  ) into v_had_existing_costings;
  select * into v_settings
  from public.business_settings
  where organization_id = p_organization_id;
  v_settings.pricing_markup_defaults := coalesce(
    v_settings.pricing_markup_defaults,
    jsonb_build_object(
      'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
      'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
      'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
      'sales_commission', jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', 0),
      'va_commission', jsonb_build_object('label', 'VA Commission', 'calculation_type', 'percentage', 'value', 0),
      'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
      'discounts', jsonb_build_object('label', 'Discounts', 'calculation_type', 'percentage', 'value', 0),
      'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15)
    )
  );
  v_use_pricing_defaults := not v_had_existing_costings
    and p_actor is not null
    and p_actor = (select auth.uid())
    and private.has_text_role(p_organization_id, array['pricing_officer'])
    and not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']);

  if v_use_pricing_defaults then
    for v_default in
      select entries.key, entries.value
      from jsonb_each(v_settings.pricing_markup_defaults) as entries(key, value)
      where entries.key <> 'vat'
      order by case entries.key
        when 'target_profit_margin' then 1
        when 'overhead_allocation' then 2
        when 'contingency_allowance' then 3
        when 'sales_commission' then 4
        when 'va_commission' then 5
        when 'incentives' then 6
        when 'discounts' then 7
        when 'third_party_markup' then 8
        else 100
      end, entries.key
    loop
      v_markup_key := v_default.key;
      v_entry := v_default.value;
      v_markup_type := 'percentage';
      v_value := coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0);
      v_markup_label := coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_markup_key, '_', ' ')));
      v_locked := coalesce((v_entry ->> 'locked')::boolean, false);
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', v_markup_type,
        'value', v_value,
        'rate', v_value,
        'amount', 0,
        'locked', v_locked
      ));
    end loop;
  end if;

  v_normalized_costings := p_costings;
  v_index := 0;
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;
    if v_item_id = any(v_seen_item_ids) then
      raise exception 'A quotation product can have only one costing table';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);
    select quantity into v_item_quantity
    from public.quotation_items
    where id = v_item_id and quotation_id = p_quotation_id
    for update;
    if not found or coalesce(v_item_quantity, 0) <= 0 then
      raise exception 'Each costing table must be linked to a quotation product with a quantity';
    end if;
    if v_use_pricing_defaults
      and coalesce(v_costing ->> 'pricing_model', 'target_margin') = 'target_margin' then
      v_costing := jsonb_set(v_costing, '{markups}', v_default_markups, true);
      v_normalized_costings := jsonb_set(v_normalized_costings, array[v_index::text, 'markups'], v_default_markups, true);
    end if;
    v_result := private.calculate_product_costing(v_costing);
    v_index := v_index + 1;
  end loop;

  if exists (
    select 1 from public.quotation_items item
    where item.quotation_id = p_quotation_id and not (item.id = any(v_seen_item_ids))
  ) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  delete from public.price_quotation_product_costings where quotation_id = p_quotation_id;

  for v_costing in select value from jsonb_array_elements(v_normalized_costings) loop
    v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    v_pricing_model := case when coalesce(v_costing ->> 'pricing_model', 'target_margin') = 'legacy_markup' then 'legacy_markup' else 'target_margin' end;
    insert into public.price_quotation_product_costings (
      organization_id, quotation_id, quotation_item_id, created_by, pricing_model, internal_vat_rate, updated_at
    ) values (
      p_organization_id, p_quotation_id, v_item_id, p_actor, v_pricing_model,
      coalesce((v_costing ->> 'internal_vat_rate')::numeric, 12), now()
    ) returning id into v_costing_id;

    v_index := 0;
    for v_line in select value from jsonb_array_elements(v_costing -> 'cost_lines') loop
      v_calculation_type := coalesce(nullif(btrim(coalesce(v_line ->> 'calculation_type', '')), ''), 'quantity_unit_cost');
      if v_calculation_type = 'fixed_amount' then
        v_quantity := 1;
        v_unit_cost := coalesce((v_line ->> 'amount')::numeric, (v_line ->> 'unit_cost')::numeric);
      else
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_cost := (v_line ->> 'unit_cost')::numeric;
      end if;
      insert into public.price_quotation_costing_lines (
        organization_id, product_costing_id, description, calculation_type,
        quantity, unit_cost, sort_order
      ) values (
        p_organization_id, v_costing_id, btrim(v_line ->> 'description'),
        v_calculation_type, v_quantity, v_unit_cost, v_index
      );
      v_index := v_index + 1;
    end loop;

    v_index := 0;
    for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
      v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
      if v_markup_type = 'fixed_amount' then
        v_value := coalesce((v_markup ->> 'amount')::numeric, (v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, 0);
      else
        v_markup_type := 'percentage';
        v_value := coalesce((v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, 0);
      end if;
      v_locked := coalesce((v_markup ->> 'locked')::boolean, false);
      insert into public.price_quotation_costing_markups (
        organization_id, product_costing_id, markup_key, label,
        calculation_type, rate, amount, locked, sort_order
      ) values (
        p_organization_id, v_costing_id,
        nullif(btrim(coalesce(v_markup ->> 'markup_key', '')), ''),
        btrim(v_markup ->> 'label'), v_markup_type,
        case when v_markup_type = 'percentage' then v_value else 0 end,
        case when v_markup_type = 'fixed_amount' then v_value else 0 end,
        v_locked,
        v_index
      );
      v_index := v_index + 1;
    end loop;

    select jsonb_build_object(
      'pricing_model', pc.pricing_model,
      'internal_vat_rate', pc.internal_vat_rate,
      'cost_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'description', cl.description,
          'calculation_type', cl.calculation_type,
          'quantity', cl.quantity,
          'unit_cost', cl.unit_cost,
          'amount', cl.unit_cost
        ) order by cl.sort_order)
        from public.price_quotation_costing_lines cl
        where cl.product_costing_id = pc.id
      ), '[]'::jsonb),
      'markups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'markup_key', cm.markup_key,
          'label', cm.label,
          'calculation_type', cm.calculation_type,
          'value', case when cm.calculation_type = 'fixed_amount' then cm.amount else cm.rate end,
          'rate', cm.rate,
          'amount', cm.amount,
          'locked', cm.locked
        ) order by cm.sort_order)
        from public.price_quotation_costing_markups cm
        where cm.product_costing_id = pc.id
      ), '[]'::jsonb)
    ) into v_saved_costing
    from public.price_quotation_product_costings pc
    where pc.id = v_costing_id;
    v_result := private.calculate_product_costing(v_saved_costing);

    select quantity into v_item_quantity from public.quotation_items where id = v_item_id;
    update public.quotation_items
    set unit_cost = round((v_result ->> 'selling_ex_vat')::numeric / nullif(v_item_quantity, 0), 2)
    where id = v_item_id;
  end loop;
end;
$$;
