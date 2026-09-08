-- Internal pricing defaults with percentage or fixed-amount calculations.
-- Existing quotation costing rows remain legacy cost-based markups. New rows
-- use the target-margin model and are recalculated only when explicitly saved
-- through a review or final approval action.

begin;

alter table public.business_settings
  add column if not exists pricing_markup_defaults jsonb;

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
    'value', coalesce(production_commission, 0)
  ),
  'incentives', jsonb_build_object(
    'label', 'Incentives',
    'calculation_type', 'percentage',
    'value', 0
  ),
  'discounts', jsonb_build_object(
    'label', 'Discounts',
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
)
where pricing_markup_defaults is null;

alter table public.business_settings
  alter column pricing_markup_defaults set default '{
    "target_profit_margin": {"label": "Target Profit Margin", "calculation_type": "percentage", "value": 75},
    "overhead_allocation": {"label": "Overhead Allocation", "calculation_type": "percentage", "value": 0},
    "contingency_allowance": {"label": "Contingency Allowance", "calculation_type": "percentage", "value": 20},
    "sales_commission": {"label": "Sales Commission", "calculation_type": "percentage", "value": 0},
    "incentives": {"label": "Incentives", "calculation_type": "percentage", "value": 0},
    "discounts": {"label": "Discounts", "calculation_type": "percentage", "value": 0},
    "third_party_markup": {"label": "Third Party Mark Up", "calculation_type": "percentage", "value": 15},
    "vat": {"label": "VAT", "calculation_type": "percentage", "value": 12}
  }'::jsonb,
  alter column pricing_markup_defaults set not null;

alter table public.price_quotation_product_costings
  add column if not exists pricing_model text not null default 'legacy_markup';
alter table public.price_quotation_product_costings
  drop constraint if exists price_quotation_product_costings_pricing_model_check;
alter table public.price_quotation_product_costings
  add constraint price_quotation_product_costings_pricing_model_check
  check (pricing_model in ('legacy_markup', 'target_margin'));

alter table public.price_quotation_costing_markups
  add column if not exists markup_key text,
  add column if not exists calculation_type text not null default 'percentage',
  add column if not exists amount numeric(14,2) not null default 0;
alter table public.price_quotation_costing_markups
  drop constraint if exists price_quotation_costing_markups_calculation_type_check;
alter table public.price_quotation_costing_markups
  add constraint price_quotation_costing_markups_calculation_type_check
  check (calculation_type in ('percentage', 'fixed_amount'));
alter table public.price_quotation_costing_markups
  drop constraint if exists price_quotation_costing_markups_amount_check;
alter table public.price_quotation_costing_markups
  add constraint price_quotation_costing_markups_amount_check
  check (amount >= 0);

alter table public.quotations
  add column if not exists vat_calculation_type text not null default 'percentage',
  add column if not exists vat_fixed_amount numeric(14,2) not null default 0;
alter table public.quotations
  drop constraint if exists quotations_vat_calculation_type_check;
alter table public.quotations
  add constraint quotations_vat_calculation_type_check
  check (vat_calculation_type in ('percentage', 'fixed_amount'));
alter table public.quotations
  drop constraint if exists quotations_vat_fixed_amount_check;
alter table public.quotations
  add constraint quotations_vat_fixed_amount_check
  check (vat_fixed_amount >= 0);

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
      'sales_commission', 'incentives', 'discounts', 'third_party_markup', 'vat'
    )
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'incentives', 'discounts', 'third_party_markup', 'vat'
  ] loop
    if not (p_defaults ? v_key) then
      raise exception 'Missing pricing default: %', v_key;
    end if;
    v_entry := p_defaults -> v_key;
    if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
      raise exception 'Pricing default % must be an object', v_key;
    end if;
    v_type := v_entry ->> 'calculation_type';
    if v_type is null or v_type not in ('percentage', 'fixed_amount') then
      raise exception 'Pricing default % needs a percentage or amount basis', v_key;
    end if;
    begin
      if v_entry ->> 'value' is null then
        raise exception 'Pricing default % needs a valid numeric value', v_key;
      end if;
      v_value := (v_entry ->> 'value')::numeric;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value < 0 then
      raise exception 'Pricing default % cannot be negative', v_key;
    end if;
    if v_type = 'percentage' and v_value > 100 then
      raise exception 'Pricing default % cannot exceed 100%%', v_key;
    end if;
    if v_type = 'percentage' and v_key in ('target_profit_margin', 'discounts') and v_value >= 100 then
      raise exception 'Pricing default % must be below 100%%', v_key;
    end if;
  end loop;
end;
$$;

create or replace function private.validate_business_pricing_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.validate_pricing_markup_defaults(new.pricing_markup_defaults);
  return new;
end;
$$;

drop trigger if exists business_pricing_defaults_guard on public.business_settings;
create trigger business_pricing_defaults_guard
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.validate_business_pricing_defaults();

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
  perform private.validate_pricing_markup_defaults(p_defaults);

  -- Keep the old numeric columns usable by the retired costing workflow. A
  -- fixed internal default has no legacy numeric equivalent, so preserve the
  -- existing value on update and use the historical fallback on first insert.
  v_profit := case when p_defaults -> 'target_profit_margin' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'target_profit_margin' ->> 'value')::numeric else 75 end;
  v_overhead := case when p_defaults -> 'overhead_allocation' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'overhead_allocation' ->> 'value')::numeric else 0 end;
  v_contingency := case when p_defaults -> 'contingency_allowance' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'contingency_allowance' ->> 'value')::numeric else 20 end;
  v_commission := case when p_defaults -> 'sales_commission' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'sales_commission' ->> 'value')::numeric else 5 end;
  v_third_party := case when p_defaults -> 'third_party_markup' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'third_party_markup' ->> 'value')::numeric else 15 end;
  v_vat := case when p_defaults -> 'vat' ->> 'calculation_type' = 'percentage' then (p_defaults -> 'vat' ->> 'value')::numeric else 12 end;

  insert into public.business_settings (
    organization_id, pricing_markup_defaults, default_profit_margin,
    default_overhead_rate, default_buffer_margin, production_commission,
    default_additional_markup, vat_rate
  ) values (
    p_organization_id, p_defaults, v_profit, v_overhead, v_contingency,
    v_commission, v_third_party, v_vat
  )
  on conflict (organization_id) do update
  set pricing_markup_defaults = excluded.pricing_markup_defaults,
      default_profit_margin = case when p_defaults -> 'target_profit_margin' ->> 'calculation_type' = 'percentage' then excluded.default_profit_margin else business_settings.default_profit_margin end,
      default_overhead_rate = case when p_defaults -> 'overhead_allocation' ->> 'calculation_type' = 'percentage' then excluded.default_overhead_rate else business_settings.default_overhead_rate end,
      default_buffer_margin = case when p_defaults -> 'contingency_allowance' ->> 'calculation_type' = 'percentage' then excluded.default_buffer_margin else business_settings.default_buffer_margin end,
      production_commission = case when p_defaults -> 'sales_commission' ->> 'calculation_type' = 'percentage' then excluded.production_commission else business_settings.production_commission end,
      default_additional_markup = case when p_defaults -> 'third_party_markup' ->> 'calculation_type' = 'percentage' then excluded.default_additional_markup else business_settings.default_additional_markup end,
      vat_rate = case when p_defaults -> 'vat' ->> 'calculation_type' = 'percentage' then excluded.vat_rate else business_settings.vat_rate end;

  return p_defaults;
end;
$$;

create or replace function private.enforce_pricing_default_markup()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_settings public.business_settings%rowtype;
  v_key text;
  v_entry jsonb;
  v_type text;
  v_value numeric;
begin
  if not private.has_text_role(new.organization_id, array['pricing_officer']) then
    return new;
  end if;

  select * into v_settings
  from public.business_settings
  where organization_id = new.organization_id;

  v_key := nullif(btrim(coalesce(new.markup_key, '')), '');
  if v_key is null then
    v_key := case lower(btrim(coalesce(new.label, '')))
      when 'profit margin' then 'target_profit_margin'
      when 'target profit margin' then 'target_profit_margin'
      when 'overhead expense' then 'overhead_allocation'
      when 'overhead allocation' then 'overhead_allocation'
      when 'buffer margin' then 'contingency_allowance'
      when 'contingency allowance' then 'contingency_allowance'
      when 'commission' then 'sales_commission'
      when 'production commission' then 'sales_commission'
      when 'sales commission' then 'sales_commission'
      when 'incentives' then 'incentives'
      when 'discounts' then 'discounts'
      when 'additional markup' then 'third_party_markup'
      when 'third party markup' then 'third_party_markup'
      when 'third party mark up' then 'third_party_markup'
      else null
    end;
  end if;
  if v_key is null or v_key not in ('target_profit_margin', 'overhead_allocation', 'contingency_allowance', 'sales_commission', 'incentives', 'discounts', 'third_party_markup') then
    return new;
  end if;

  v_entry := v_settings.pricing_markup_defaults -> v_key;
  if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
    return new;
  end if;
  v_type := coalesce(v_entry ->> 'calculation_type', 'percentage');
  v_value := (v_entry ->> 'value')::numeric;
  new.markup_key := v_key;
  new.label := coalesce(nullif(v_entry ->> 'label', ''), new.label);
  new.calculation_type := v_type;
  if v_type = 'fixed_amount' then
    new.rate := 0;
    new.amount := v_value;
  else
    new.rate := v_value;
    new.amount := 0;
  end if;
  return new;
end;
$$;

-- Defaults are canonicalized inside apply_product_costings() for a new
-- Pricing Officer review. Do not use a row trigger here: the apply function
-- intentionally replaces costing rows atomically, and a trigger would also
-- overwrite saved GM edits when a quotation is reviewed again.
drop trigger if exists pricing_default_markup_guard on public.price_quotation_costing_markups;

create or replace function private.calculate_product_costing(p_costing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_pricing_model text := coalesce(nullif(p_costing ->> 'pricing_model', ''), 'target_margin');
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
  v_positive_adjustments numeric := 0;
  v_cost_base numeric := 0;
  v_target_value numeric := 0;
  v_target_type text := 'percentage';
  v_target_seen boolean := false;
  v_discount_value numeric := 0;
  v_discount_type text := 'percentage';
  v_discount_seen boolean := false;
  v_profit numeric := 0;
  v_required_net numeric := 0;
  v_discount_amount numeric := 0;
  v_list_price numeric := 0;
  v_selling_ex_vat numeric := 0;
begin
  if v_pricing_model not in ('legacy_markup', 'target_margin') then
    raise exception 'Unsupported internal pricing model';
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
      if v_calculation_type = 'fixed_amount' then
        raise exception 'Each fixed expense needs a description and non-negative amount';
      end if;
      raise exception 'Each internal cost line needs a description, quantity, and non-negative unit cost';
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
    v_markup_key := nullif(btrim(coalesce(v_markup ->> 'markup_key', '')), '');
    if v_markup_key is null then
      v_markup_key := case lower(v_description)
        when 'profit margin' then 'target_profit_margin'
        when 'target profit margin' then 'target_profit_margin'
        when 'overhead expense' then 'overhead_allocation'
        when 'overhead allocation' then 'overhead_allocation'
        when 'buffer margin' then 'contingency_allowance'
        when 'contingency allowance' then 'contingency_allowance'
        when 'commission' then 'sales_commission'
        when 'production commission' then 'sales_commission'
        when 'sales commission' then 'sales_commission'
        when 'incentives' then 'incentives'
        when 'discounts' then 'discounts'
        when 'additional markup' then 'third_party_markup'
        when 'third party markup' then 'third_party_markup'
        when 'third party mark up' then 'third_party_markup'
        else ''
      end;
    end if;
    if v_pricing_model = 'target_margin'
      and coalesce(v_markup_key, '') not in (
        'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
        'sales_commission', 'incentives', 'discounts', 'third_party_markup'
      ) then
      raise exception 'Target-margin pricing adjustments must use a supported category';
    end if;
    v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
    if v_markup_type not in ('percentage', 'fixed_amount') then
      raise exception 'Each pricing adjustment needs a percentage or amount basis';
    end if;
    begin
      if v_markup_type = 'fixed_amount' then
        v_value := coalesce((v_markup ->> 'amount')::numeric, (v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1);
      else
        v_value := coalesce((v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1);
      end if;
    exception when invalid_text_representation then
      raise exception 'Pricing adjustment values must be valid numbers';
    end;
    if v_value < 0 then
      raise exception 'Pricing adjustment values cannot be negative';
    end if;
    if v_markup_type = 'percentage' and v_value > 100 then
      raise exception 'Pricing adjustment percentages cannot exceed 100%%';
    end if;

    if v_pricing_model = 'legacy_markup' then
      v_markup_total := v_markup_total + case when v_markup_type = 'fixed_amount' then round(v_value, 2) else round(v_cogs * v_value / 100, 2) end;
    elsif v_markup_key = 'target_profit_margin' then
      if v_target_seen then raise exception 'Target Profit Margin may be entered only once'; end if;
      if v_markup_type = 'percentage' and v_value >= 100 then raise exception 'Target Profit Margin must be below 100%%'; end if;
      v_target_seen := true;
      v_target_type := v_markup_type;
      v_target_value := v_value;
    elsif v_markup_key = 'discounts' then
      if v_discount_seen then raise exception 'Discounts may be entered only once'; end if;
      if v_markup_type = 'percentage' and v_value >= 100 then raise exception 'Discounts must be below 100%%'; end if;
      v_discount_seen := true;
      v_discount_type := v_markup_type;
      v_discount_value := v_value;
    elsif v_markup_key <> 'vat' then
      v_positive_adjustments := v_positive_adjustments + case when v_markup_type = 'fixed_amount' then round(v_value, 2) else round(v_cogs * v_value / 100, 2) end;
    end if;
  end loop;

  if v_pricing_model = 'legacy_markup' then
    v_cost_base := v_cogs;
    v_selling_ex_vat := round(v_cogs + v_markup_total, 2);
    return jsonb_build_object(
      'pricing_model', v_pricing_model,
      'cogs', v_cogs,
      'cost_base', v_cost_base,
      'profit_amount', 0,
      'discount_amount', 0,
      'list_selling_ex_vat', v_selling_ex_vat,
      'selling_ex_vat', v_selling_ex_vat
    );
  end if;

  if not v_target_seen then
    raise exception 'Target Profit Margin is required for the target-margin pricing model';
  end if;
  v_cost_base := round(v_cogs + v_positive_adjustments, 2);
  if v_target_type = 'fixed_amount' then
    v_profit := round(v_target_value, 2);
  else
    v_profit := round(v_cost_base * v_target_value / nullif(100 - v_target_value, 0), 2);
  end if;
  v_required_net := round(v_cost_base + v_profit, 2);
  if v_discount_seen then
    if v_discount_type = 'fixed_amount' then
      v_discount_amount := round(v_discount_value, 2);
    else
      v_discount_amount := round(v_required_net / (1 - v_discount_value / 100) - v_required_net, 2);
    end if;
  end if;
  v_list_price := round(v_required_net + v_discount_amount, 2);
  v_selling_ex_vat := round(v_list_price - v_discount_amount, 2);
  return jsonb_build_object(
    'pricing_model', v_pricing_model,
    'cogs', v_cogs,
    'cost_base', v_cost_base,
    'profit_amount', v_profit,
    'discount_amount', v_discount_amount,
    'list_selling_ex_vat', v_list_price,
    'selling_ex_vat', v_selling_ex_vat
  );
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
  v_line jsonb;
  v_markup jsonb;
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
    foreach v_markup_key in array array[
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'incentives', 'discounts', 'third_party_markup'
    ] loop
      v_entry := v_settings.pricing_markup_defaults -> v_markup_key;
      v_markup_type := coalesce(nullif(btrim(coalesce(v_entry ->> 'calculation_type', '')), ''), 'percentage');
      v_value := coalesce((v_entry ->> 'value')::numeric, 0);
      v_markup_label := coalesce(
        nullif(v_entry ->> 'label', ''),
        case v_markup_key
          when 'target_profit_margin' then 'Target Profit Margin'
          when 'overhead_allocation' then 'Overhead Allocation'
          when 'contingency_allowance' then 'Contingency Allowance'
          when 'sales_commission' then 'Sales Commission'
          when 'incentives' then 'Incentives'
          when 'discounts' then 'Discounts'
          else 'Third Party Mark Up'
        end
      );
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', v_markup_type,
        'value', v_value,
        'rate', case when v_markup_type = 'percentage' then v_value else 0 end,
        'amount', case when v_markup_type = 'fixed_amount' then v_value else 0 end
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
      organization_id, quotation_id, quotation_item_id, created_by, pricing_model, updated_at
    ) values (
      p_organization_id, p_quotation_id, v_item_id, p_actor, v_pricing_model, now()
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
      ) , '[]'::jsonb)
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

create or replace function private.persist_product_quotation_totals(
  p_quotation_id uuid,
  p_status text,
  p_vat_calculation_type text,
  p_vat_rate numeric,
  p_vat_fixed_amount numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_subtotal numeric;
  v_vat_amount numeric;
begin
  select coalesce(round(sum(quantity * unit_cost), 2), 0)
  into v_subtotal
  from public.quotation_items
  where quotation_id = p_quotation_id;
  v_vat_amount := case when p_vat_calculation_type = 'fixed_amount'
    then round(greatest(coalesce(p_vat_fixed_amount, 0), 0), 2)
    else round(v_subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2)
  end;

  update public.quotations q
  set vat_rate = case when p_vat_calculation_type = 'percentage' then greatest(coalesce(p_vat_rate, 0), 0) else 0 end,
      vat_calculation_type = p_vat_calculation_type,
      vat_fixed_amount = case when p_vat_calculation_type = 'fixed_amount' then greatest(coalesce(p_vat_fixed_amount, 0), 0) else 0 end,
      shipping_handling = 0,
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
      bank_details = coalesce(p_bank_details, q.bank_details),
      status = p_status::public.quotation_status,
      pricing_reviewed_by = case when p_status = 'pending_gm_approval' then p_actor else q.pricing_reviewed_by end,
      pricing_reviewed_at = case when p_status = 'pending_gm_approval' then now() else q.pricing_reviewed_at end,
      approved_by = case when p_status = 'approved' then p_actor else null end,
      approved_at = case when p_status = 'approved' then now() else null end,
      issue_date = case when p_status = 'approved' then current_date else q.issue_date end,
      revision_note = null,
      subtotal = v_subtotal,
      total_cost = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = round(v_subtotal + v_vat_amount, 2)
  where q.id = p_quotation_id;

  update public.approval_requests
  set status = (case when p_status = 'pending_gm_approval' then 'pending' else p_status end)::public.approval_status,
      decided_by = case when p_status = 'approved' then p_actor else null end,
      decided_at = case when p_status = 'approved' then now() else null end,
      decision_note = null
  where resource_type = 'quotation' and resource_id = p_quotation_id;
end;
$$;

create or replace function public.pricing_review_price_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
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
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
  v_vat_type text := coalesce(nullif(btrim(coalesce(p_vat_calculation_type, '')), ''), 'percentage');
begin
  if p_decision is null or p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
  end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types)
    or v_quote.created_by is not distinct from (select auth.uid())
    or v_quote.prepared_by_user_id is not distinct from (select auth.uid()) then
    raise exception 'Only the assigned Sales & Pricing Officer can review this Price Quotation';
  end if;
  if p_decision = 'needs_revision' then
    if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
    update public.quotations
    set status = 'needs_revision', revision_note = v_note,
        revision_requested_by = (select auth.uid()), revision_requested_at = now(),
        approved_by = null, approved_at = null
    where id = v_quote.id;
    update public.approval_requests
    set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then raise exception 'VAT needs a percentage or amount basis'; end if;
  if v_vat_type = 'percentage' and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then raise exception 'VAT percentage must be between 0 and 100'; end if;
  if v_vat_type = 'fixed_amount' and coalesce(p_vat_fixed_amount, 0) < 0 then raise exception 'VAT amount cannot be negative'; end if;
  perform private.apply_product_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', v_vat_type, p_vat_rate, p_vat_fixed_amount, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

create or replace function public.pricing_review_mockup_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
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
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
  v_vat_type text := coalesce(nullif(btrim(coalesce(p_vat_calculation_type, '')), ''), 'percentage');
begin
  if p_decision is null or p_decision not in ('approved', 'needs_revision') then raise exception 'Unsupported Mockup Quotation decision'; end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then raise exception 'Mockup Quotation not found'; end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types) then
    raise exception 'Only the Sales & Pricing Officer assigned to this project type can review this Mockup Quotation';
  end if;
  if v_quote.status::text <> 'pending' then raise exception 'Only submitted Mockup Quotations can be reviewed'; end if;
  if p_decision = 'needs_revision' then
    if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
    update public.quotations
    set status = 'needs_revision', revision_note = v_note,
        revision_requested_by = (select auth.uid()), revision_requested_at = now(),
        approved_by = null, approved_at = null
    where id = v_quote.id;
    update public.approval_requests
    set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then raise exception 'VAT needs a percentage or amount basis'; end if;
  if v_vat_type = 'percentage' and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then raise exception 'VAT percentage must be between 0 and 100'; end if;
  if v_vat_type = 'fixed_amount' and coalesce(p_vat_fixed_amount, 0) < 0 then raise exception 'VAT amount cannot be negative'; end if;
  perform private.apply_product_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', v_vat_type, p_vat_rate, p_vat_fixed_amount, p_terms_conditions, p_bank_details, (select auth.uid()));
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
    perform private.apply_product_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then raise exception 'VAT needs a percentage or amount basis'; end if;
  if v_vat_type = 'percentage' and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then raise exception 'VAT percentage must be between 0 and 100'; end if;
  if v_vat_type = 'fixed_amount' and coalesce(p_vat_fixed_amount, 0) < 0 then raise exception 'VAT amount cannot be negative'; end if;
  perform private.persist_product_quotation_totals(v_quote.id, 'approved', v_vat_type, p_vat_rate, p_vat_fixed_amount, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

revoke all on function public.save_pricing_defaults(uuid, jsonb) from public;
grant execute on function public.save_pricing_defaults(uuid, jsonb) to authenticated;
revoke all on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;
revoke all on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;
revoke all on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb, text, numeric) from public;
grant execute on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb, text, numeric) to authenticated;

commit;
