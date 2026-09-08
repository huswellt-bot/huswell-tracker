-- Allow the General Manager to approve direct Price Quotations in bulk.
-- The function uses only the quotation's persisted prices, VAT, terms, bank
-- details, and costing rows. It does not accept editable approval payloads.
-- Run after 131_internal_pricing_defaults_and_mixed_markups.sql and before
-- deploying the matching Approval Center update.

begin;

create or replace function public.final_approve_price_quotation_from_saved_state(
  p_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_item_count bigint;
  v_costing_count bigint;
  v_costing public.price_quotation_product_costings%rowtype;
  v_saved_costing jsonb;
  v_vat_type text;
begin
  select *
  into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve a Price Quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This Price Quotation is not awaiting General Manager approval';
  end if;
  v_vat_type := coalesce(nullif(btrim(v_quote.vat_calculation_type), ''), 'percentage');
  if v_vat_type not in ('percentage', 'fixed_amount') then
    raise exception 'Saved VAT needs a percentage or amount basis';
  end if;
  if v_vat_type = 'percentage'
    and (coalesce(v_quote.vat_rate, 0) < 0 or coalesce(v_quote.vat_rate, 0) > 100) then
    raise exception 'Saved VAT percentage must be between 0 and 100';
  end if;
  if v_vat_type = 'fixed_amount' and coalesce(v_quote.vat_fixed_amount, 0) < 0 then
    raise exception 'Saved VAT amount cannot be negative';
  end if;

  select count(*)
  into v_item_count
  from public.quotation_items
  where quotation_id = v_quote.id;

  select count(*)
  into v_costing_count
  from public.price_quotation_product_costings
  where quotation_id = v_quote.id;

  -- Legacy quotations without saved costing rows remain compatible with the
  -- existing final approval path. If costing rows exist, validate every
  -- persisted row before changing the quotation status.
  if v_costing_count > 0 then
    if v_costing_count <> v_item_count then
      raise exception 'Saved costing data is incomplete; review this quotation individually';
    end if;
    if exists (
      select 1
      from public.quotation_items item
      where item.quotation_id = v_quote.id
        and not exists (
          select 1
          from public.price_quotation_product_costings costing
          where costing.quotation_id = v_quote.id
            and costing.quotation_item_id = item.id
        )
    ) then
      raise exception 'Saved costing data is incomplete; review this quotation individually';
    end if;
    if exists (
      select 1
      from public.price_quotation_product_costings costing
      where costing.quotation_id = v_quote.id
        and (
          costing.organization_id is distinct from v_quote.organization_id
          or not exists (
            select 1
            from public.quotation_items item
            where item.id = costing.quotation_item_id
              and item.quotation_id = v_quote.id
          )
        )
    ) then
      raise exception 'Saved costing data is not linked to this quotation';
    end if;

    for v_costing in
      select costing.*
      from public.price_quotation_product_costings costing
      where costing.quotation_id = v_quote.id
      order by costing.quotation_item_id
    loop
      if exists (
        select 1
        from public.price_quotation_costing_lines cost_line
        where cost_line.product_costing_id = v_costing.id
          and cost_line.organization_id is distinct from v_quote.organization_id
      ) or exists (
        select 1
        from public.price_quotation_costing_markups cost_markup
        where cost_markup.product_costing_id = v_costing.id
          and cost_markup.organization_id is distinct from v_quote.organization_id
      ) then
        raise exception 'Saved costing data is not linked to this quotation';
      end if;

      select jsonb_build_object(
        'pricing_model', costing.pricing_model,
        'cost_lines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'description', cost_line.description,
              'calculation_type', cost_line.calculation_type,
              'quantity', cost_line.quantity,
              'unit_cost', cost_line.unit_cost,
              'amount', cost_line.unit_cost
            )
            order by cost_line.sort_order, cost_line.id
          )
          from public.price_quotation_costing_lines cost_line
          where cost_line.product_costing_id = costing.id
        ), '[]'::jsonb),
        'markups', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'markup_key', cost_markup.markup_key,
              'label', cost_markup.label,
              'calculation_type', cost_markup.calculation_type,
              'value', case
                when cost_markup.calculation_type = 'fixed_amount' then cost_markup.amount
                else cost_markup.rate
              end,
              'rate', cost_markup.rate,
              'amount', cost_markup.amount
            )
            order by cost_markup.sort_order, cost_markup.id
          )
          from public.price_quotation_costing_markups cost_markup
          where cost_markup.product_costing_id = costing.id
        ), '[]'::jsonb)
      )
      into v_saved_costing
      from public.price_quotation_product_costings costing
      where costing.id = v_costing.id;

      -- Re-run the canonical calculator as validation only. The saved item
      -- price remains authoritative, so bulk approval cannot silently edit a
      -- quotation or rewrite historical costing rows.
      perform private.calculate_product_costing(v_saved_costing);
    end loop;
  end if;

  perform private.persist_product_quotation_totals(
    v_quote.id,
    'approved',
    v_vat_type,
    v_quote.vat_rate,
    v_quote.vat_fixed_amount,
    v_quote.terms_conditions,
    v_quote.bank_details,
    (select auth.uid())
  );
end;
$$;

revoke all on function public.final_approve_price_quotation_from_saved_state(uuid) from public;
grant execute on function public.final_approve_price_quotation_from_saved_state(uuid) to authenticated;

commit;
