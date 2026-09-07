-- Persist General Manager edits made during direct Price Quotation approval.
-- Run after 120_sales_pricing_officer_self_review.sql. Safe to re-run.

begin;

create or replace function public.final_approve_price_quotation_with_edits(
  p_quotation_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_costing jsonb;
  v_line jsonb;
  v_markup jsonb;
  v_costing_id uuid;
  v_item_id uuid;
  v_item_quantity numeric;
  v_description text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_rate numeric;
  v_cogs numeric;
  v_markup_total numeric;
  v_price numeric;
  v_item_count bigint;
  v_existing_costing_count bigint;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve a Price Quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This Price Quotation is not awaiting General Manager approval';
  end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items
  where quotation_id = v_quote.id;

  select count(*) into v_existing_costing_count
  from public.price_quotation_product_costings
  where quotation_id = v_quote.id;

  -- Current direct quotations must retain one costing per product. The empty
  -- payload remains valid for legacy quotations that never had costings.
  if jsonb_array_length(p_costings) = 0 and v_existing_costing_count > 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) > 0 and jsonb_array_length(p_costings) <> v_item_count then
    raise exception 'Add one costing table for every quotation product';
  end if;

  if jsonb_array_length(p_costings) > 0 then
    delete from public.price_quotation_product_costings
    where quotation_id = v_quote.id;

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

      select quantity
      into v_item_quantity
      from public.quotation_items
      where id = v_item_id and quotation_id = v_quote.id
      for update;
      if not found or coalesce(v_item_quantity, 0) <= 0 then
        raise exception 'Each costing table must be linked to a quotation product with a quantity';
      end if;
      if coalesce(jsonb_typeof(v_costing -> 'cost_lines'), '') <> 'array'
        or coalesce(jsonb_array_length(v_costing -> 'cost_lines'), 0) = 0 then
        raise exception 'Add at least one internal cost line for every quotation product';
      end if;
      if coalesce(jsonb_typeof(v_costing -> 'markups'), '') <> 'array' then
        raise exception 'Costing markups must be a list';
      end if;

      insert into public.price_quotation_product_costings (
        organization_id, quotation_id, quotation_item_id, created_by, updated_at
      )
      values (
        v_quote.organization_id, v_quote.id, v_item_id, (select auth.uid()), now()
      )
      returning id into v_costing_id;

      v_index := 0;
      for v_line in select value from jsonb_array_elements(v_costing -> 'cost_lines') loop
        v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
        v_calculation_type := coalesce(
          nullif(btrim(coalesce(v_line ->> 'calculation_type', '')), ''),
          'quantity_unit_cost'
        );
        if v_calculation_type not in ('quantity_unit_cost', 'fixed_amount') then
          raise exception 'Each internal cost line needs a valid calculation type';
        end if;
        begin
          if v_calculation_type = 'fixed_amount' then
            v_quantity := 1;
            v_unit_cost := coalesce(
              (v_line ->> 'amount')::numeric,
              (v_line ->> 'unit_cost')::numeric,
              -1
            );
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

        insert into public.price_quotation_costing_lines (
          organization_id, product_costing_id, description, calculation_type,
          quantity, unit_cost, sort_order
        )
        values (
          v_quote.organization_id,
          v_costing_id,
          v_description,
          v_calculation_type,
          v_quantity,
          v_unit_cost,
          v_index
        );
        v_index := v_index + 1;
      end loop;

      v_index := 0;
      for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
        v_description := nullif(btrim(coalesce(v_markup ->> 'label', '')), '');
        begin
          v_rate := coalesce((v_markup ->> 'rate')::numeric, -1);
        exception when invalid_text_representation then
          raise exception 'Markup rates must be valid numbers';
        end;
        if v_description is null or v_rate < 0 then
          raise exception 'Each markup needs a name and a non-negative percentage';
        end if;

        insert into public.price_quotation_costing_markups (
          organization_id, product_costing_id, label, rate, sort_order
        )
        values (
          v_quote.organization_id,
          v_costing_id,
          v_description,
          v_rate,
          v_index
        );
        v_index := v_index + 1;
      end loop;

      select coalesce(sum(round(quantity * unit_cost, 2)), 0)
      into v_cogs
      from public.price_quotation_costing_lines
      where product_costing_id = v_costing_id;

      select coalesce(sum(round(v_cogs * rate / 100, 2)), 0)
      into v_markup_total
      from public.price_quotation_costing_markups
      where product_costing_id = v_costing_id;

      select (v_cogs + v_markup_total) / nullif(quantity, 0)
      into v_price
      from public.quotation_items
      where id = v_item_id;

      update public.quotation_items
      set unit_cost = round(v_price, 2)
      where id = v_item_id;
    end loop;
  end if;

  update public.quotations q
  set vat_rate = greatest(coalesce(p_vat_rate, 0), 0),
      shipping_handling = 0,
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
      bank_details = coalesce(p_bank_details, q.bank_details),
      status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now(),
      issue_date = current_date,
      revision_note = null,
      subtotal = totals.subtotal,
      total_cost = totals.subtotal,
      vat_amount = round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2),
      total_amount = totals.subtotal
        + round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2)
  from (
    select coalesce(round(sum(quantity * unit_cost), 2), 0) subtotal
    from public.quotation_items
    where quotation_id = v_quote.id
  ) totals
  where q.id = v_quote.id;

  update public.approval_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = null
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

revoke all on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb) from public;
grant execute on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb) to authenticated;

commit;
