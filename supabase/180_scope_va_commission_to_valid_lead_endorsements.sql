-- Prevent the configurable VA Commission default from being seeded into a
-- new direct Price Quotation unless the quotation has a valid Lead
-- endorsement to its Sales & Pricing Officer preparator.
--
-- Explicitly submitted quotation markup rows remain authoritative. The
-- approved-quotation Commission Summary guard remains unchanged, so existing
-- invalid saved rows must still be corrected or endorsed before approval.
-- Run after 179_manage_all_pricing_markups.sql and before deploying the
-- matching workspace update. Safe to re-run.

begin;

create or replace function private.valid_va_endorser_for_quotation(
  p_quotation_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $function$
  select lead_row.endorsed_by
  from public.quotations quotation
  join public.leads lead_row
    on lead_row.id = quotation.lead_id
   and lead_row.organization_id = quotation.organization_id
  where quotation.id = p_quotation_id
    and quotation.document_type::text = 'price_quotation'
    and quotation.costing_source_id is null
    and lead_row.endorsed_to = coalesce(quotation.prepared_by_user_id, quotation.created_by)
    and lead_row.endorsed_by is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = quotation.organization_id
        and member.user_id = lead_row.endorsed_by
        and member.role::text = 'sales_pricing_officer'
    )
  limit 1;
$function$;

do $$
begin
  if to_regprocedure('private.refresh_gm_pricing_defaults(uuid,uuid,jsonb)') is not null
    and to_regprocedure('private.refresh_gm_pricing_defaults_before_va_scope(uuid,uuid,jsonb)') is null then
    alter function private.refresh_gm_pricing_defaults(uuid, uuid, jsonb)
      rename to refresh_gm_pricing_defaults_before_va_scope;
  end if;
end;
$$;

create or replace function private.refresh_gm_pricing_defaults(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_costings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_costing jsonb;
  v_refreshed_costing jsonb;
  v_markup jsonb;
  v_filtered_markups jsonb;
  v_item_id uuid;
  v_index integer;
  v_is_direct_price_quotation boolean := false;
  v_va_commission_allowed boolean := true;
  v_refreshed_costings jsonb;
begin
  v_refreshed_costings := private.refresh_gm_pricing_defaults_before_va_scope(
    p_organization_id,
    p_quotation_id,
    p_costings
  );

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

  if v_va_commission_allowed
    or coalesce(jsonb_array_length(v_refreshed_costings), 0) = 0 then
    return v_refreshed_costings;
  end if;

  v_index := 0;
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    v_refreshed_costing := v_refreshed_costings -> v_index;
    if not (v_costing ? 'markups')
      and coalesce(v_costing ->> 'pricing_model', 'target_margin') <> 'legacy_markup'
      and coalesce(jsonb_typeof(v_refreshed_costing -> 'markups'), '') = 'array' then
      begin
        v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
      exception when invalid_text_representation then
        v_item_id := null;
      end;

      -- If the old refresh function had to seed defaults because there was
      -- no saved markup snapshot, remove only its unallocated VA default.
      -- Existing saved rows remain authoritative, including invalid rows that
      -- the approval guard will require the user to correct.
      if v_item_id is null or not exists (
        select 1
        from public.price_quotation_product_costings costing
        join public.price_quotation_costing_markups markup
          on markup.product_costing_id = costing.id
        where costing.quotation_id = p_quotation_id
          and costing.quotation_item_id = v_item_id
      ) then
        v_filtered_markups := '[]'::jsonb;
        for v_markup in select value from jsonb_array_elements(v_refreshed_costing -> 'markups') loop
          if private.canonical_pricing_markup_key(
            coalesce(nullif(v_markup ->> 'markup_key', ''), nullif(v_markup ->> 'label', ''), '')
          ) <> 'va_commission' then
            v_filtered_markups := v_filtered_markups || jsonb_build_array(v_markup);
          end if;
        end loop;
        v_refreshed_costings := jsonb_set(
          v_refreshed_costings,
          array[v_index::text, 'markups'],
          v_filtered_markups,
          true
        );
      end if;
    end if;
    v_index := v_index + 1;
  end loop;

  return v_refreshed_costings;
end;
$function$;

do $$
begin
  if to_regprocedure('private.apply_product_costings(uuid,uuid,jsonb,uuid)') is not null
    and to_regprocedure('private.apply_product_costings_before_va_scope(uuid,uuid,jsonb,uuid)') is null then
    alter function private.apply_product_costings(uuid, uuid, jsonb, uuid)
      rename to apply_product_costings_before_va_scope;
  end if;
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
as $function$
declare
  v_costing jsonb;
  v_default record;
  v_entry jsonb;
  v_markup_key text;
  v_markup_label text;
  v_value numeric;
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
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', 'percentage',
        'value', v_value,
        'rate', v_value,
        'amount', 0
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

  -- The renamed implementation performs the complete costing validation,
  -- replacement, calculation, and quotation-item price update. Passing NULL
  -- for the actor only when defaults were prepared here prevents the legacy
  -- implementation from restoring the unscoped VA default.
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
$function$;

revoke all on function private.valid_va_endorser_for_quotation(uuid)
  from public, anon, authenticated;
revoke all on function private.refresh_gm_pricing_defaults(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.refresh_gm_pricing_defaults_before_va_scope(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.apply_product_costings(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.apply_product_costings_before_va_scope(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;

commit;
