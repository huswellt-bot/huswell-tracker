-- Let the General Manager activate, remove, and add every internal markup
-- category while keeping VAT as a separate quotation-level field.
--
-- Settings rows are defaults for new costings only. For a pending quotation,
-- an explicitly submitted markups array is the complete authoritative snapshot:
-- a missing row is intentionally removed, including a standard category.
-- Existing quotation and Commission Summary snapshots are not rewritten.
-- Run after 178_production_agreement_and_box_maker.sql and before deploying the
-- matching workspace update. Safe to re-run.

begin;

create or replace function private.canonical_pricing_markup_key(p_key text)
returns text
language sql
immutable
as $function$
  select case lower(btrim(coalesce(p_key, '')))
    when 'profit margin' then 'target_profit_margin'
    when 'target profit margin' then 'target_profit_margin'
    when 'default_profit_margin' then 'target_profit_margin'
    when 'overhead expense' then 'overhead_allocation'
    when 'overhead allocation' then 'overhead_allocation'
    when 'default_overhead_rate' then 'overhead_allocation'
    when 'buffer margin' then 'contingency_allowance'
    when 'contingency allowance' then 'contingency_allowance'
    when 'default_buffer_margin' then 'contingency_allowance'
    when 'commission' then 'sales_commission'
    when 'production commission' then 'sales_commission'
    when 'sales commission' then 'sales_commission'
    when 'sales executive commission' then 'sales_commission'
    when 'sales_executive_commission' then 'sales_commission'
    when 'commission_default_rate' then 'sales_commission'
    when 'va commission' then 'va_commission'
    when 'va commission markup' then 'va_commission'
    when 'va_commission_default_rate' then 'va_commission'
    when 'va_commission_rate' then 'va_commission'
    when 'discount' then 'discounts'
    when 'discounts' then 'discounts'
    when 'third party markup' then 'third_party_markup'
    when 'third party mark up' then 'third_party_markup'
    when 'additional markup' then 'third_party_markup'
    when 'default_additional_markup' then 'third_party_markup'
    else lower(btrim(coalesce(p_key, '')))
  end
$function$;

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

  if not (p_defaults ? 'vat') then
    raise exception 'Pricing defaults must include the separate VAT setting';
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

    v_type := coalesce(nullif(btrim(coalesce(v_entry ->> 'calculation_type', '')), ''), 'percentage');
    if v_type <> 'percentage' then
      raise exception 'Pricing default % must use percentage basis', v_key;
    end if;

    begin
      v_value := coalesce(
        nullif(v_entry ->> 'value', '')::numeric,
        nullif(v_entry ->> 'rate', '')::numeric
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value is null then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end if;
    if v_value < 0 or v_value > 100 then
      raise exception 'Pricing default % must be between 0%% and 100%%', v_key;
    end if;
    if v_key in ('target_profit_margin', 'discounts') and v_value >= 100 then
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

    -- A removed commission category must not reappear through a legacy mirror
    -- column used by compatibility reports or older RPCs.
    new.commission_default_rate := round(coalesce(v_sales_rate, 0), 2);
    new.va_commission_default_rate := round(coalesce(v_va_rate, 0), 2);
  end if;
  return new;
end;
$$;

drop trigger if exists business_commission_summary_defaults_sync
  on public.business_settings;
create trigger business_commission_summary_defaults_sync
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.sync_commission_summary_defaults_from_pricing_markups();

-- Keep the compatibility RPC from resurrecting every standard category after
-- a General Manager intentionally removed one through the new Settings UI.
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
  if coalesce(jsonb_typeof(v_defaults), '') <> 'object' then
    v_defaults := '{}'::jsonb;
  end if;
  if not (v_defaults ? 'vat') then
    v_defaults := jsonb_set(
      v_defaults,
      '{vat}',
      jsonb_build_object('label', 'VAT', 'calculation_type', 'percentage', 'value', 12),
      true
    );
  end if;
  v_defaults := jsonb_set(
    v_defaults,
    '{sales_commission}',
    jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', round(p_commission_rate, 2)),
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

alter table public.business_settings
  alter column pricing_markup_defaults set default '{
    "target_profit_margin": {"label": "Target Profit Margin", "calculation_type": "percentage", "value": 75},
    "overhead_allocation": {"label": "Overhead Allocation", "calculation_type": "percentage", "value": 0},
    "contingency_allowance": {"label": "Contingency Allowance", "calculation_type": "percentage", "value": 20},
    "sales_commission": {"label": "Sales Executive Commission", "calculation_type": "percentage", "value": 0},
    "va_commission": {"label": "VA Commission", "calculation_type": "percentage", "value": 0},
    "incentives": {"label": "Incentives", "calculation_type": "percentage", "value": 0},
    "discounts": {"label": "Discounts", "calculation_type": "percentage", "value": 0},
    "third_party_markup": {"label": "Third Party Mark Up", "calculation_type": "percentage", "value": 15},
    "vat": {"label": "VAT", "calculation_type": "percentage", "value": 12}
  }'::jsonb;

-- Migration 137 removed Discount from the Settings object. Restore it as an
-- explicitly configured zero row so existing quotations keep their values,
-- while the new UI can remove it later like every other internal markup.
update public.business_settings
set pricing_markup_defaults = jsonb_build_object(
  'discounts', jsonb_build_object(
    'label', 'Discounts',
    'calculation_type', 'percentage',
    'value', 0,
    'visible', true
  )
) || coalesce(pricing_markup_defaults, '{}'::jsonb)
where coalesce(jsonb_typeof(pricing_markup_defaults), '') = 'object'
  and not (pricing_markup_defaults ? 'discounts');

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

    -- Legacy quotations use their saved markup formula and remain historical.
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

        -- VAT is stored in internal_vat_rate and in the quotation VAT fields,
        -- never as an item-level markup row.
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
        v_markup := jsonb_set(v_markup, '{label}', to_jsonb(case v_markup_key
          when 'target_profit_margin' then 'Target Profit Margin'
          when 'overhead_allocation' then 'Overhead Allocation'
          when 'contingency_allowance' then 'Contingency Allowance'
          when 'sales_commission' then 'Sales Executive Commission'
          when 'va_commission' then 'VA Commission'
          when 'incentives' then 'Incentives'
          when 'discounts' then 'Discounts'
          when 'third_party_markup' then 'Third Party Mark Up'
          else coalesce(nullif(btrim(v_markup ->> 'label'), ''), initcap(replace(v_markup_key, '_', ' ')))
        end), true);
        v_merged_markups := v_merged_markups || jsonb_build_array(v_markup);
      end loop;
    else
      -- Older clients did not send an item-level markups key. Preserve the
      -- saved snapshot when one exists; only seed active Settings rows when a
      -- costing has no saved markup rows yet.
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
  v_seen_markup_keys text[] := array[]::text[];
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
    v_markup_key := private.canonical_pricing_markup_key(
      coalesce(nullif(v_markup ->> 'markup_key', ''), v_description)
    );
    if v_markup_key = '' then
      raise exception 'Each pricing adjustment needs a category';
    end if;
    -- VAT is intentionally not an item-level markup. It is calculated from
    -- internal_vat_rate and the separate customer quotation VAT field.
    if v_markup_key = 'vat' then
      continue;
    end if;
    if v_markup_key = 'discounts' and v_discount_seen then
      raise exception 'Discount may be entered only once';
    end if;
    -- Keep legacy markup quotations tolerant of their historical rows. New
    -- target-margin costings cannot contain the same category twice.
    if coalesce(p_costing ->> 'pricing_model', 'target_margin') <> 'legacy_markup'
      and v_markup_key = any(v_seen_markup_keys) then
      raise exception 'Each costing table can have only one % markup', v_markup_key;
    end if;
    if coalesce(p_costing ->> 'pricing_model', 'target_margin') <> 'legacy_markup' then
      v_seen_markup_keys := array_append(v_seen_markup_keys, v_markup_key);
    end if;
    v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
    if v_markup_type not in ('percentage', 'fixed_amount') then
      raise exception 'Each pricing adjustment needs a valid basis';
    end if;
    if v_markup_key <> 'discounts' and v_markup_type <> 'percentage' then
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
    if v_markup_key = 'discounts' then
      if v_markup_type = 'percentage' and v_value >= 100 then
        raise exception 'Discount must be below 100%%';
      end if;
      v_discount_seen := true;
      v_discount_type := v_markup_type;
      v_discount_value := v_value;
    else
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
