-- Preserve General Manager pricing overrides when a target-margin quotation is
-- finally approved. Settings remain the starting values and fallbacks for
-- missing rows; submitted markup, Discount, and internal VAT values win.

begin;

create or replace function private.refresh_gm_pricing_defaults(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_costings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing jsonb;
  v_markup jsonb;
  v_default record;
  v_existing_markup record;
  v_submitted_markups jsonb;
  v_discount_markups jsonb;
  v_merged_markups jsonb;
  v_refreshed_costings jsonb := '[]'::jsonb;
  v_defaults jsonb;
  v_entry jsonb;
  v_markup_key text;
  v_default_key text;
  v_pricing_model text;
  v_item_id uuid;
  v_existing_costing_id uuid;
  v_discount_count integer;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select pricing_markup_defaults
  into v_defaults
  from public.business_settings
  where organization_id = p_organization_id;

  v_defaults := jsonb_build_object(
    'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
    'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
    'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
    'sales_commission', jsonb_build_object('label', 'Sales Commission', 'calculation_type', 'percentage', 'value', 0),
    'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
    'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15)
  ) || coalesce(v_defaults, '{}'::jsonb);

  for v_costing in select value from jsonb_array_elements(p_costings) loop
    v_pricing_model := coalesce(nullif(btrim(v_costing ->> 'pricing_model'), ''), 'target_margin');

    -- Legacy quotations use their saved markup formula and are intentionally
    -- excluded from the Settings/default merge.
    if v_pricing_model = 'legacy_markup' then
      v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
      continue;
    end if;

    v_submitted_markups := '[]'::jsonb;
    v_discount_markups := '[]'::jsonb;
    v_discount_count := 0;

    for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
      v_markup_key := lower(btrim(coalesce(nullif(v_markup ->> 'markup_key', ''), nullif(v_markup ->> 'label', ''), '')));
      v_markup_key := case v_markup_key
        when 'target profit margin' then 'target_profit_margin'
        when 'overhead expense' then 'overhead_allocation'
        when 'overhead allocation' then 'overhead_allocation'
        when 'buffer margin' then 'contingency_allowance'
        when 'contingency allowance' then 'contingency_allowance'
        when 'commission' then 'sales_commission'
        when 'production commission' then 'sales_commission'
        when 'sales commission' then 'sales_commission'
        when 'third party markup' then 'third_party_markup'
        when 'third party mark up' then 'third_party_markup'
        when 'additional markup' then 'third_party_markup'
        when 'discount' then 'discounts'
        else v_markup_key
      end;

      -- VAT is carried by internal_vat_rate or the quotation VAT arguments,
      -- not as an item in the costing markups array.
      if v_markup_key = 'vat' then
        continue;
      end if;

      v_markup := jsonb_set(v_markup, '{markup_key}', to_jsonb(v_markup_key), true);
      if v_markup_key = 'discounts' then
        v_discount_count := v_discount_count + 1;
        if v_discount_count > 1 then
          raise exception 'Each costing table can have only one Discount markup';
        end if;
        v_markup := jsonb_set(v_markup, '{label}', to_jsonb('Discounts'::text), true);
        v_discount_markups := v_discount_markups || jsonb_build_array(v_markup);
      else
        v_submitted_markups := v_submitted_markups || jsonb_build_array(v_markup);
      end if;
    end loop;

    -- If an older client omits the Discount row, carry it forward from the
    -- saved quotation. A submitted Discount remains editable and wins.
    if jsonb_array_length(v_discount_markups) = 0 then
      begin
        v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
      exception when invalid_text_representation then
        v_item_id := null;
      end;

      if v_item_id is not null then
        select pc.id
        into v_existing_costing_id
        from public.price_quotation_product_costings pc
        where pc.quotation_id = p_quotation_id
          and pc.quotation_item_id = v_item_id;

        if v_existing_costing_id is not null then
          for v_existing_markup in
            select cm.markup_key, cm.label, cm.calculation_type, cm.rate, cm.amount
            from public.price_quotation_costing_markups cm
            where cm.product_costing_id = v_existing_costing_id
              and (
                lower(btrim(coalesce(cm.markup_key, ''))) in ('discount', 'discounts')
                or lower(btrim(coalesce(cm.label, ''))) in ('discount', 'discounts')
              )
            order by cm.sort_order
          loop
            v_discount_count := v_discount_count + 1;
            if v_discount_count > 1 then
              raise exception 'Each costing table can have only one Discount markup';
            end if;
            v_discount_markups := v_discount_markups || jsonb_build_array(jsonb_build_object(
              'markup_key', 'discounts',
              'label', 'Discounts',
              'calculation_type', case when v_existing_markup.calculation_type = 'fixed_amount' then 'fixed_amount' else 'percentage' end,
              'value', case when v_existing_markup.calculation_type = 'fixed_amount' then v_existing_markup.amount else v_existing_markup.rate end,
              'rate', v_existing_markup.rate,
              'amount', v_existing_markup.amount
            ));
          end loop;
        end if;
      end if;
    end if;

    -- Current Settings rows provide fallback values only. A submitted value
    -- for the same category is authoritative, and submitted historical/custom
    -- rows are retained even if that custom row is no longer in Settings.
    v_merged_markups := '[]'::jsonb;
    for v_default in
      select entries.key, entries.value
      from jsonb_each(v_defaults) as entries(key, value)
      where entries.key not in ('vat', 'discounts')
      order by case entries.key
        when 'target_profit_margin' then 1
        when 'overhead_allocation' then 2
        when 'contingency_allowance' then 3
        when 'sales_commission' then 4
        when 'incentives' then 5
        when 'third_party_markup' then 6
        else 100
      end, entries.key
    loop
      v_default_key := v_default.key;
      v_entry := v_default.value;
      v_markup := null;
      select submitted.value
      into v_markup
      from jsonb_array_elements(v_submitted_markups) as submitted(value)
      where lower(btrim(coalesce(nullif(submitted.value ->> 'markup_key', ''), nullif(submitted.value ->> 'label', ''), ''))) = v_default_key
      limit 1;

      if v_markup is null then
        v_merged_markups := v_merged_markups || jsonb_build_array(jsonb_build_object(
          'markup_key', v_default_key,
          'label', coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_default_key, '_', ' '))),
          'calculation_type', 'percentage',
          'value', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
          'rate', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
          'amount', 0
        ));
      else
        v_markup := jsonb_set(v_markup, '{markup_key}', to_jsonb(v_default_key), true);
        v_markup := jsonb_set(v_markup, '{label}', to_jsonb(coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_default_key, '_', ' ')))), true);
        v_merged_markups := v_merged_markups || jsonb_build_array(v_markup);
      end if;
    end loop;

    for v_markup in select value from jsonb_array_elements(v_submitted_markups) loop
      v_markup_key := lower(btrim(coalesce(nullif(v_markup ->> 'markup_key', ''), nullif(v_markup ->> 'label', ''), '')));
      if not exists (
        select 1
        from jsonb_each(v_defaults) as entries(key, value)
        where entries.key not in ('vat', 'discounts')
          and entries.key = v_markup_key
      ) then
        v_merged_markups := v_merged_markups || jsonb_build_array(v_markup);
      end if;
    end loop;

    v_costing := jsonb_set(
      v_costing,
      '{markups}',
      v_merged_markups || v_discount_markups,
      true
    );
    v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
  end loop;

  return v_refreshed_costings;
end;
$$;

-- Keep the current apply_product_costings workflow, but persist the submitted
-- internal VAT rate instead of always recreating the costing at the 12% column
-- default. The existing calculator remains the validation/calculation source.
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
      'sales_commission', jsonb_build_object('label', 'Sales Commission', 'calculation_type', 'percentage', 'value', 0),
      'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
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
      where entries.key not in ('vat', 'discounts')
      order by case entries.key
        when 'target_profit_margin' then 1
        when 'overhead_allocation' then 2
        when 'contingency_allowance' then 3
        when 'sales_commission' then 4
        when 'incentives' then 5
        when 'third_party_markup' then 6
        else 100
      end, entries.key
    loop
      v_markup_key := v_default.key;
      v_entry := v_default.value;
      v_markup_type := 'percentage';
      v_value := coalesce((v_entry ->> 'value')::numeric, 0);
      v_markup_label := coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_markup_key, '_', ' ')));
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', v_markup_type,
        'value', v_value,
        'rate', v_value,
        'amount', 0
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
      insert into public.price_quotation_costing_markups (
        organization_id, product_costing_id, markup_key, label,
        calculation_type, rate, amount, sort_order
      ) values (
        p_organization_id, v_costing_id,
        nullif(btrim(coalesce(v_markup ->> 'markup_key', '')), ''),
        btrim(v_markup ->> 'label'), v_markup_type,
        case when v_markup_type = 'percentage' then v_value else 0 end,
        case when v_markup_type = 'fixed_amount' then v_value else 0 end,
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
          'amount', cm.amount
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

commit;
