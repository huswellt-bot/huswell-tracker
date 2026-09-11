-- Refresh Settings-driven pricing defaults when a pending quotation reaches
-- final GM approval. Legacy markup quotations remain historical snapshots.

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
  v_default_markups jsonb := '[]'::jsonb;
  v_discount_markups jsonb;
  v_refreshed_costings jsonb := '[]'::jsonb;
  v_defaults jsonb;
  v_entry jsonb;
  v_markup_key text;
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

  -- The visibility flag controls presentation only. Every configured default,
  -- including custom Settings markups, participates in the calculation.
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
    v_entry := v_default.value;
    v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
      'markup_key', v_default.key,
      'label', coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_default.key, '_', ' '))),
      'calculation_type', 'percentage',
      'value', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
      'rate', coalesce((v_entry ->> 'value')::numeric, (v_entry ->> 'rate')::numeric, 0),
      'amount', 0
    ));
  end loop;

  for v_costing in select value from jsonb_array_elements(p_costings) loop
    v_pricing_model := coalesce(nullif(btrim(v_costing ->> 'pricing_model'), ''), 'target_margin');

    -- Legacy quotations use their saved markup formula and are intentionally
    -- excluded from the Settings refresh.
    if v_pricing_model = 'legacy_markup' then
      v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
      continue;
    end if;

    v_discount_markups := '[]'::jsonb;
    v_discount_count := 0;

    for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
      v_markup_key := lower(btrim(coalesce(v_markup ->> 'markup_key', '')));
      if v_markup_key = 'discounts'
        or lower(btrim(coalesce(v_markup ->> 'label', ''))) in ('discount', 'discounts') then
        v_discount_count := v_discount_count + 1;
        if v_discount_count > 1 then
          raise exception 'Each costing table can have only one Discount markup';
        end if;
        v_markup := jsonb_set(v_markup, '{markup_key}', to_jsonb('discounts'::text), true);
        v_markup := jsonb_set(v_markup, '{label}', to_jsonb('Discounts'::text), true);
        v_discount_markups := v_discount_markups || jsonb_build_array(v_markup);
      end if;
    end loop;

    -- If an older client omits the Discount row, carry it forward from the
    -- saved quotation. A submitted Discount still remains editable and wins.
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
                lower(btrim(coalesce(cm.markup_key, ''))) = 'discounts'
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

    v_costing := jsonb_set(
      v_costing,
      '{markups}',
      v_default_markups || v_discount_markups,
      true
    );
    v_refreshed_costings := v_refreshed_costings || jsonb_build_array(v_costing);
  end loop;

  return v_refreshed_costings;
end;
$$;

create or replace function public.final_approve_price_quotation_with_edits(
  p_quotation_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_existing_costing_count bigint;
  v_item_count bigint;
  v_vat_type text := coalesce(nullif(btrim(coalesce(p_vat_calculation_type, '')), ''), 'percentage');
  v_costings jsonb := p_costings;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or (v_quote.document_type = 'price_quotation' and v_quote.costing_source_id is not null) then
    raise exception 'Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve this quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then raise exception 'This quotation is not awaiting General Manager approval'; end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then raise exception 'Quotation costing data must be an array'; end if;
  select count(*) into v_item_count from public.quotation_items where quotation_id = v_quote.id;
  select count(*) into v_existing_costing_count from public.price_quotation_product_costings where quotation_id = v_quote.id;
  if jsonb_array_length(p_costings) = 0 and v_existing_costing_count > 0 then raise exception 'Add one costing table for every quotation product'; end if;
  if jsonb_array_length(p_costings) > 0 and jsonb_array_length(p_costings) <> v_item_count then raise exception 'Add one costing table for every quotation product'; end if;
  if jsonb_array_length(p_costings) > 0 then
    -- Re-read Settings inside the same transaction immediately before the
    -- costing write, so a stale browser cannot approve stale default rates.
    v_costings := private.refresh_gm_pricing_defaults(v_quote.organization_id, v_quote.id, p_costings);
    perform private.apply_product_costings(v_quote.organization_id, v_quote.id, v_costings, (select auth.uid()));
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then raise exception 'VAT needs a percentage or amount basis'; end if;
  if v_vat_type = 'percentage' and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then raise exception 'VAT percentage must be between 0 and 100'; end if;
  if v_vat_type = 'fixed_amount' and coalesce(p_vat_fixed_amount, 0) < 0 then raise exception 'VAT amount cannot be negative'; end if;
  perform private.persist_product_quotation_totals(v_quote.id, 'approved', v_vat_type, p_vat_rate, p_vat_fixed_amount, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

revoke all on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb, text, numeric) from public;
grant execute on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb, text, numeric) to authenticated;

commit;
