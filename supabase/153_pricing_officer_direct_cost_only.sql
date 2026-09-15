-- Pricing Officers submit direct-cost lines only. Internal pricing adjustments,
-- including Discount, remain server-owned values for the General Manager.
-- Existing costing markups are preserved when a quotation is reviewed again;
-- new costing rows receive the canonical organization defaults through
-- apply_product_costings(). Submitted markup values are intentionally ignored.
-- Run after 150_pricing_submission_notes.sql and before deploying the matching
-- workspace update. Safe to re-run.

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
  v_apply_costing jsonb;
  v_normalized_costings jsonb := '[]'::jsonb;
  v_existing_costing_id uuid;
  v_existing_pricing_model text;
  v_existing_markups jsonb;
  v_item_id uuid;
  v_result jsonb;
  v_item_quantity numeric;
  v_seen_item_ids uuid[] := array[]::uuid[];
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

  -- Rebuild the submission with only the editable direct-cost payload. For an
  -- existing product, carry forward every saved internal adjustment exactly as
  -- it was stored, including Discount. For a new product, do not accept any
  -- client-supplied markup or pricing model; apply_product_costings() will use
  -- organization defaults when this is the first costing submission.
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;
    if v_item_id is null then
      raise exception 'Each costing table must be linked to a quotation product';
    end if;
    if v_item_id = any(v_seen_item_ids) then
      raise exception 'A quotation product can have only one costing table';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);

    select pc.id, pc.pricing_model
    into v_existing_costing_id, v_existing_pricing_model
    from public.price_quotation_product_costings pc
    where pc.quotation_id = p_quotation_id
      and pc.quotation_item_id = v_item_id;

    v_apply_costing := v_costing;
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

      v_apply_costing := jsonb_set(v_apply_costing, '{markups}', v_existing_markups, true);
      v_apply_costing := jsonb_set(
        v_apply_costing,
        '{pricing_model}',
        to_jsonb(coalesce(v_existing_pricing_model, 'target_margin')),
        true
      );
    else
      v_apply_costing := jsonb_set(v_apply_costing, '{markups}', '[]'::jsonb, true);
      v_apply_costing := jsonb_set(
        v_apply_costing,
        '{pricing_model}',
        to_jsonb('target_margin'::text),
        true
      );
    end if;

    v_normalized_costings := v_normalized_costings || jsonb_build_array(v_apply_costing);
  end loop;

  if exists (
    select 1
    from public.quotation_items item
    where item.quotation_id = p_quotation_id
      and not (item.id = any(v_seen_item_ids))
  ) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  perform private.apply_product_costings(
    p_organization_id,
    p_quotation_id,
    v_normalized_costings,
    p_actor
  );

  -- Recalculate the saved per-piece direct price from the canonical costing
  -- rows. This keeps the quotation totals in sync without exposing or accepting
  -- a Pricing Officer-authored selling price.
  for v_costing in select value from jsonb_array_elements(v_normalized_costings) loop
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;

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
    )
    into v_result
    from public.price_quotation_product_costings pc
    where pc.quotation_id = p_quotation_id
      and pc.quotation_item_id = v_item_id;

    if v_result is null then
      raise exception 'Each costing table must be linked to a quotation product';
    end if;
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

commit;
