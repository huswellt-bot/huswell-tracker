begin;

create or replace function public.refresh_gm_price_quotation_markups(
  p_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_defaults jsonb := '{}'::jsonb;
  v_costings jsonb := '[]'::jsonb;
begin
  select *
  into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can refresh quotation markups';
  end if;

  select coalesce(settings.pricing_markup_defaults, '{}'::jsonb)
  into v_defaults
  from public.business_settings settings
  where settings.organization_id = v_quote.organization_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'quotation_item_id', costing.quotation_item_id,
      'pricing_model', coalesce(costing.pricing_model, 'target_margin'),
      'internal_vat_rate', costing.internal_vat_rate,
      'vat_locked', costing.vat_locked,
      'cost_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'description', line.description,
          'calculation_type', line.calculation_type,
          'quantity', line.quantity,
          'unit_cost', line.unit_cost,
          'amount', line.unit_cost,
          'sort_order', line.sort_order
        ) order by line.sort_order, line.id)
        from public.price_quotation_costing_lines line
        where line.product_costing_id = costing.id
      ), '[]'::jsonb),
      'markups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'markup_key', entry.key,
          'label', coalesce(nullif(entry.value ->> 'label', ''), initcap(replace(entry.key, '_', ' '))),
          'calculation_type', 'percentage',
          'value', coalesce((entry.value ->> 'value')::numeric, (entry.value ->> 'rate')::numeric, 0),
          'rate', coalesce((entry.value ->> 'value')::numeric, (entry.value ->> 'rate')::numeric, 0),
          'amount', 0,
          'locked', coalesce((entry.value ->> 'locked')::boolean, false)
        ) order by case entry.key
          when 'target_profit_margin' then 1
          when 'overhead_allocation' then 2
          when 'contingency_allowance' then 3
          when 'sales_commission' then 4
          when 'incentives' then 5
          when 'discounts' then 6
          when 'third_party_markup' then 7
          else 100
        end, entry.key)
        from jsonb_each(v_defaults) entry(key, value)
        where private.pricing_markup_purpose(entry.key, entry.value) <> 'vat'
      ), '[]'::jsonb)
    ) order by costing.quotation_item_id
  ), '[]'::jsonb)
  into v_costings
  from public.price_quotation_product_costings costing
  where costing.quotation_id = v_quote.id;

  if jsonb_array_length(v_costings) <> (
    select count(*) from public.quotation_items where quotation_id = v_quote.id
  ) then
    raise exception 'Saved costing data is incomplete; review this quotation individually';
  end if;

  perform private.apply_product_costings(
    v_quote.organization_id,
    v_quote.id,
    v_costings,
    (select auth.uid())
  );
end;
$$;

revoke all on function public.refresh_gm_price_quotation_markups(uuid) from public, anon;
grant execute on function public.refresh_gm_price_quotation_markups(uuid) to authenticated;

commit;
