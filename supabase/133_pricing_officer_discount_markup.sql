-- Allow the assigned Sales & Pricing Officer to set only the customer
-- Discount during quotation review. VAT remains a quotation-level input;
-- every other internal pricing adjustment remains General Manager-controlled.
-- Run after 132_general_manager_bulk_price_quotation_approval.sql and before
-- deploying the matching quotation-review UI.

begin;

create or replace function private.apply_pricing_officer_costings(
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
  v_normalized_costings jsonb := '[]'::jsonb;
  v_existing_costing_id uuid;
  v_existing_pricing_model text;
  v_existing_markups jsonb;
  v_markups jsonb;
  v_discount jsonb;
  v_discount_count bigint;
  v_item_id uuid;
  v_markup_type text;
  v_value numeric;
  v_result jsonb;
  v_item_quantity numeric;
begin
  if p_actor is null or p_actor is distinct from (select auth.uid()) then
    raise exception 'The pricing review actor could not be verified';
  end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array'
    or coalesce(jsonb_array_length(p_costings), 0) = 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) <> (
    select count(*) from public.quotation_items where quotation_id = p_quotation_id
  ) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  -- Preserve every existing internal adjustment except Discount. This keeps
  -- GM-approved values stable if a quotation is sent back and reviewed again.
  -- New quotations are canonicalized by apply_product_costings() from the
  -- organization defaults; the submitted Discount is applied below after
  -- that canonicalization.
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    if coalesce(jsonb_typeof(v_costing -> 'markups'), 'array') <> 'array' then
      raise exception 'Costing markups must be a list';
    end if;
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;

    select pc.id, pc.pricing_model
    into v_existing_costing_id, v_existing_pricing_model
    from public.price_quotation_product_costings pc
    where pc.quotation_id = p_quotation_id
      and pc.quotation_item_id = v_item_id;

    v_discount := null;
    v_discount_count := 0;
    select count(*)
    into v_discount_count
    from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) submitted(value)
    where lower(coalesce(
      nullif(btrim(submitted.value ->> 'markup_key'), ''),
      nullif(btrim(submitted.value ->> 'label'), ''),
      ''
    )) = 'discounts';
    if v_discount_count > 1 then
      raise exception 'Discounts may be entered only once';
    end if;
    if v_discount_count = 1 then
      select submitted.value
      into v_discount
      from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) submitted(value)
      where lower(coalesce(
        nullif(btrim(submitted.value ->> 'markup_key'), ''),
        nullif(btrim(submitted.value ->> 'label'), ''),
        ''
      )) = 'discounts'
      limit 1;
    end if;

    if v_existing_costing_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'markup_key', cm.markup_key,
        'label', cm.label,
        'calculation_type', cm.calculation_type,
        'value', case when cm.calculation_type = 'fixed_amount' then cm.amount else cm.rate end,
        'rate', cm.rate,
        'amount', cm.amount
      ) order by cm.sort_order), '[]'::jsonb)
      into v_existing_markups
      from public.price_quotation_costing_markups cm
      where cm.product_costing_id = v_existing_costing_id;

      if v_discount is not null then
        select coalesce(
          jsonb_agg(saved.value order by saved.ordinal) filter (
            where lower(coalesce(
              nullif(btrim(saved.value ->> 'markup_key'), ''),
              nullif(btrim(saved.value ->> 'label'), ''),
              ''
            )) <> 'discounts'
          ),
          '[]'::jsonb
        )
        into v_markups
        from jsonb_array_elements(v_existing_markups) with ordinality saved(value, ordinal);
        v_markups := v_markups || jsonb_build_array(v_discount);
      else
        v_markups := v_existing_markups;
      end if;
      v_costing := jsonb_set(v_costing, '{markups}', v_markups, true);
      v_costing := jsonb_set(
        v_costing,
        '{pricing_model}',
        to_jsonb(coalesce(v_existing_pricing_model, 'target_margin')),
        true
      );
    end if;

    v_normalized_costings := v_normalized_costings || jsonb_build_array(v_costing);
  end loop;

  perform private.apply_product_costings(
    p_organization_id,
    p_quotation_id,
    v_normalized_costings,
    p_actor
  );

  -- apply_product_costings() deliberately applies organization defaults to a
  -- brand-new Pricing Officer costing. Replace only the submitted Discount,
  -- then recalculate the product selling price and quotation totals from the
  -- saved costing rows.
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;
    v_discount := null;
    select submitted.value
    into v_discount
    from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) submitted(value)
    where lower(coalesce(
      nullif(btrim(submitted.value ->> 'markup_key'), ''),
      nullif(btrim(submitted.value ->> 'label'), ''),
      ''
    )) = 'discounts'
    limit 1;
    if v_discount is null then
      continue;
    end if;

    v_markup_type := coalesce(
      nullif(btrim(coalesce(v_discount ->> 'calculation_type', '')), ''),
      'percentage'
    );
    if v_markup_type not in ('percentage', 'fixed_amount') then
      raise exception 'Discount needs a percentage or amount basis';
    end if;
    begin
      if v_markup_type = 'fixed_amount' then
        v_value := coalesce(
          (v_discount ->> 'amount')::numeric,
          (v_discount ->> 'value')::numeric,
          (v_discount ->> 'rate')::numeric,
          -1
        );
      else
        v_value := coalesce(
          (v_discount ->> 'value')::numeric,
          (v_discount ->> 'rate')::numeric,
          -1
        );
      end if;
    exception when invalid_text_representation then
      raise exception 'Discount values must be valid numbers';
    end;
    if v_value < 0 then
      raise exception 'Discount values cannot be negative';
    end if;
    if v_markup_type = 'percentage' and v_value >= 100 then
      raise exception 'Discounts must be below 100%%';
    end if;

    select pc.id
    into v_existing_costing_id
    from public.price_quotation_product_costings pc
    where pc.quotation_id = p_quotation_id
      and pc.quotation_item_id = v_item_id;
    if v_existing_costing_id is null then
      raise exception 'Each costing table must be linked to a quotation product';
    end if;

    update public.price_quotation_costing_markups
    set markup_key = 'discounts',
        label = 'Discounts',
        calculation_type = v_markup_type,
        rate = case when v_markup_type = 'percentage' then v_value else 0 end,
        amount = case when v_markup_type = 'fixed_amount' then v_value else 0 end
    where product_costing_id = v_existing_costing_id
      and markup_key = 'discounts';

    if not found then
      insert into public.price_quotation_costing_markups (
        organization_id,
        product_costing_id,
        markup_key,
        label,
        calculation_type,
        rate,
        amount,
        sort_order
      )
      values (
        p_organization_id,
        v_existing_costing_id,
        'discounts',
        'Discounts',
        v_markup_type,
        case when v_markup_type = 'percentage' then v_value else 0 end,
        case when v_markup_type = 'fixed_amount' then v_value else 0 end,
        coalesce((select max(sort_order) + 1 from public.price_quotation_costing_markups where product_costing_id = v_existing_costing_id), 0)
      );
    end if;

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
      ), '[]'::jsonb)
    )
    into v_result
    from public.price_quotation_product_costings pc
    where pc.id = v_existing_costing_id;
    v_result := private.calculate_product_costing(v_result);

    select quantity
    into v_item_quantity
    from public.quotation_items
    where id = v_item_id;
    update public.quotation_items
    set unit_cost = round((v_result ->> 'selling_ex_vat')::numeric / nullif(v_item_quantity, 0), 2)
    where id = v_item_id;
  end loop;
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
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
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
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', v_vat_type, p_vat_rate, p_vat_fixed_amount, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

revoke all on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;
revoke all on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;

commit;
