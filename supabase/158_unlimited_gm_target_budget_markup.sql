-- Allow General Manager Target Budget calculations to use percentage markups
-- above 100%. Customer VAT, Discount, and organization pricing defaults retain
-- their existing validation rules.
-- Run after 157_lead_excel_import.sql and before deploying the matching
-- workspace update. Safe to re-run.

begin;

-- The original rate precision was inherited from the 100%-bounded workflow.
-- Widen it so a valid GM override is not rejected by the column itself.
alter table public.price_quotation_costing_markups
  alter column rate type numeric(14,3)
  using rate::numeric(14,3);

-- Keep the calculator's direct-cost, Internal VAT, Discount, and customer VAT
-- rules intact, but remove the generic 100% ceiling from non-discount pricing
-- adjustments. The final-approval RPC remains General Manager-only.
create or replace function private.calculate_product_costing(p_costing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_line jsonb;
  v_markup jsonb;
  v_description text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_markup_key text;
  v_markup_type text;
  v_value numeric;
  v_cogs numeric := 0;
  v_markup_total numeric := 0;
  v_internal_vat_rate numeric := 12;
  v_internal_vat_amount numeric := 0;
  v_profit numeric := 0;
  v_discount_value numeric := 0;
  v_discount_type text := 'percentage';
  v_discount_seen boolean := false;
  v_discount_amount numeric := 0;
  v_pre_discount_total numeric := 0;
  v_selling_ex_vat numeric := 0;
begin
  begin
    v_internal_vat_rate := coalesce((p_costing ->> 'internal_vat_rate')::numeric, 12);
  exception when invalid_text_representation then
    raise exception 'Internal VAT must be a valid percentage';
  end;
  if v_internal_vat_rate < 0 or v_internal_vat_rate > 100 then
    raise exception 'Internal VAT must be between 0 and 100';
  end if;
  if coalesce(jsonb_typeof(p_costing -> 'cost_lines'), '') <> 'array'
    or coalesce(jsonb_array_length(p_costing -> 'cost_lines'), 0) = 0 then
    raise exception 'Add at least one internal cost line for every quotation product';
  end if;

  for v_line in select value from jsonb_array_elements(p_costing -> 'cost_lines') loop
    v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
    v_calculation_type := coalesce(nullif(btrim(coalesce(v_line ->> 'calculation_type', '')), ''), 'quantity_unit_cost');
    if v_calculation_type not in ('quantity_unit_cost', 'fixed_amount') then
      raise exception 'Each internal cost line needs a valid calculation type';
    end if;
    begin
      if v_calculation_type = 'fixed_amount' then
        v_quantity := 1;
        v_unit_cost := coalesce((v_line ->> 'amount')::numeric, (v_line ->> 'unit_cost')::numeric, -1);
      else
        v_quantity := coalesce((v_line ->> 'quantity')::numeric, 0);
        v_unit_cost := coalesce((v_line ->> 'unit_cost')::numeric, -1);
      end if;
    exception when invalid_text_representation then
      raise exception 'Cost line quantities, unit costs, and fixed amounts must be valid numbers';
    end;
    if v_description is null or v_quantity <= 0 or v_unit_cost < 0 then
      raise exception 'Each internal cost line needs a description and non-negative amount';
    end if;
    v_cogs := v_cogs + round(v_quantity * v_unit_cost, 2);
  end loop;

  if coalesce(jsonb_typeof(p_costing -> 'markups'), 'array') <> 'array' then
    raise exception 'Costing markups must be a list';
  end if;
  for v_markup in select value from jsonb_array_elements(coalesce(p_costing -> 'markups', '[]'::jsonb)) loop
    v_description := nullif(btrim(coalesce(v_markup ->> 'label', '')), '');
    if v_description is null then
      raise exception 'Each pricing adjustment needs a name';
    end if;
    v_markup_key := lower(coalesce(nullif(btrim(v_markup ->> 'markup_key'), ''), v_description));
    v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
    if v_markup_type not in ('percentage', 'fixed_amount') then
      raise exception 'Each pricing adjustment needs a valid basis';
    end if;
    if v_markup_key not in ('discount', 'discounts') and v_markup_type <> 'percentage' then
      raise exception 'Only Discount may use an amount basis';
    end if;
    begin
      v_value := case when v_markup_type = 'fixed_amount'
        then coalesce((v_markup ->> 'amount')::numeric, (v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1)
        else coalesce((v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1)
      end;
    exception when invalid_text_representation then
      raise exception 'Pricing adjustment values must be valid numbers';
    end;
    if v_value < 0 then
      raise exception 'Pricing adjustment values cannot be negative';
    end if;
    if v_markup_key in ('discount', 'discounts') then
      if v_discount_seen then
        raise exception 'Discount may be entered only once';
      end if;
      if v_markup_type = 'percentage' and v_value >= 100 then
        raise exception 'Discount must be below 100%%';
      end if;
      v_discount_seen := true;
      v_discount_type := v_markup_type;
      v_discount_value := v_value;
    elsif v_markup_key <> 'vat' then
      v_value := round(v_cogs * v_value / 100, 2);
      v_markup_total := v_markup_total + v_value;
      if v_markup_key = 'target_profit_margin' then
        v_profit := v_value;
      end if;
    end if;
  end loop;

  v_cogs := round(v_cogs, 2);
  v_internal_vat_amount := round(v_cogs * v_internal_vat_rate / 100, 2);
  v_markup_total := round(v_markup_total + v_internal_vat_amount, 2);
  v_pre_discount_total := round(v_cogs + v_markup_total, 2);
  if v_discount_seen then
    v_discount_amount := case when v_discount_type = 'fixed_amount'
      then round(v_discount_value, 2)
      else round(v_pre_discount_total * v_discount_value / 100, 2)
    end;
  end if;
  if v_discount_amount > v_pre_discount_total then
    raise exception 'Discount cannot exceed the total before discount';
  end if;
  v_selling_ex_vat := round(v_pre_discount_total - v_discount_amount, 2);
  return jsonb_build_object(
    'pricing_model', coalesce(nullif(p_costing ->> 'pricing_model', ''), 'target_margin'),
    'cogs', v_cogs,
    'cost_base', v_cogs,
    'markup_total', v_markup_total,
    'internal_vat_rate', v_internal_vat_rate,
    'internal_vat_amount', v_internal_vat_amount,
    'profit_amount', v_profit,
    'discount_amount', v_discount_amount,
    'list_selling_ex_vat', v_pre_discount_total,
    'selling_ex_vat', v_selling_ex_vat
  );
end;
$$;

commit;
