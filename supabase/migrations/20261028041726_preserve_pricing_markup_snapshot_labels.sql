begin;

-- Preserve the markup label already captured in a quotation costing snapshot.
-- GM approval may normalize the stable calculation key, but it must not rename
-- an existing quotation row back to the built-in Settings label.
create or replace function private.refresh_gm_pricing_defaults_before_va_scope(
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
  v_merged_markups jsonb;
  v_refreshed_costings jsonb := '[]'::jsonb;
  v_defaults jsonb;
  v_entry jsonb;
  v_markup_key text;
  v_pricing_model text;
  v_item_id uuid;
  v_existing_costing_id uuid;
  v_seen_markup_keys text[];
  v_has_markup_payload boolean;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select pricing_markup_defaults
  into v_defaults
  from public.business_settings
  where organization_id = p_organization_id;

  if coalesce(jsonb_typeof(v_defaults), '') <> 'object' then
    v_defaults := jsonb_build_object(
      'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
      'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
      'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
      'sales_commission', jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', 0),
      'va_commission', jsonb_build_object('label', 'VA Commission', 'calculation_type', 'percentage', 'value', 0),
      'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
      'discounts', jsonb_build_object('label', 'Discounts', 'calculation_type', 'percentage', 'value', 0),
      'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15)
    );
  end if;

  for v_costing in select value from jsonb_array_elements(p_costings) loop
    v_pricing_model := coalesce(nullif(btrim(v_costing ->> 'pricing_model'), ''), 'target_margin');

    if v_pricing_model = 'legacy_markup' then
      v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
      continue;
    end if;

    v_has_markup_payload := v_costing ? 'markups';
    v_merged_markups := '[]'::jsonb;

    if v_has_markup_payload then
      if coalesce(jsonb_typeof(v_costing -> 'markups'), '') <> 'array' then
        raise exception 'Costing markups must be a list';
      end if;
      v_seen_markup_keys := array[]::text[];

      for v_markup in select value from jsonb_array_elements(v_costing -> 'markups') loop
        v_markup_key := private.canonical_pricing_markup_key(
          coalesce(nullif(v_markup ->> 'markup_key', ''), nullif(v_markup ->> 'label', ''), '')
        );

        -- VAT is stored in internal_vat_rate and quotation VAT fields, never
        -- as an item-level markup row.
        if v_markup_key = 'vat' then
          continue;
        end if;
        if v_markup_key = '' then
          raise exception 'Each pricing adjustment needs a category';
        end if;
        if v_markup_key = any(v_seen_markup_keys) then
          if v_markup_key = 'discounts' then
            raise exception 'Each costing table can have only one Discount markup';
          end if;
          raise exception 'Each costing table can have only one % markup', v_markup_key;
        end if;
        v_seen_markup_keys := array_append(v_seen_markup_keys, v_markup_key);
        v_markup := jsonb_set(v_markup, '{markup_key}', to_jsonb(v_markup_key), true);
        v_markup := jsonb_set(
          v_markup,
          '{label}',
          to_jsonb(coalesce(
            nullif(btrim(v_markup ->> 'label'), ''),
            initcap(replace(v_markup_key, '_', ' '))
          )),
          true
        );
        v_merged_markups := v_merged_markups || jsonb_build_array(v_markup);
      end loop;
    else
      -- Older clients did not send item-level markup rows. Preserve an
      -- existing quotation snapshot; only seed Settings rows when none exist.
      v_existing_costing_id := null;
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
      end if;

      if v_existing_costing_id is not null and exists (
        select 1
        from public.price_quotation_costing_markups cm
        where cm.product_costing_id = v_existing_costing_id
      ) then
        select coalesce(jsonb_agg(jsonb_build_object(
          'markup_key', cm.markup_key,
          'label', cm.label,
          'calculation_type', cm.calculation_type,
          'value', case when cm.calculation_type = 'fixed_amount' then cm.amount else cm.rate end,
          'rate', cm.rate,
          'amount', cm.amount
        ) order by cm.sort_order, cm.created_at, cm.id), '[]'::jsonb)
        into v_merged_markups
        from public.price_quotation_costing_markups cm
        where cm.product_costing_id = v_existing_costing_id;
      else
        for v_default in
          select entries.key, entries.value
          from jsonb_each(v_defaults) as entries(key, value)
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
          v_entry := v_default.value;
          v_merged_markups := v_merged_markups || jsonb_build_array(jsonb_build_object(
            'markup_key', v_default.key,
            'label', coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_default.key, '_', ' '))),
            'calculation_type', 'percentage',
            'value', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
            'rate', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
            'amount', 0
          ));
        end loop;
      end if;
    end if;

    v_costing := jsonb_set(v_costing, '{markups}', v_merged_markups, true);
    v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
  end loop;

  return v_refreshed_costings;
end;
$$;

commit;
