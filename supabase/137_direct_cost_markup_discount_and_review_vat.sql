-- Price quotations use direct-cost markup percentages, a separately deducted
-- Discount, and a General Manager-only customer VAT review.
-- Run after 136_pricing_markups_percentage_only.sql and before deploying the
-- matching application update.

begin;

-- Internal VAT is an organization-internal, per-costing 12% default. It is
-- stored independently from quotations.vat_rate, which is reserved for the
-- GM's second, customer-facing review VAT.
alter table public.price_quotation_product_costings
  add column if not exists internal_vat_rate numeric(5,2) not null default 12;
alter table public.price_quotation_product_costings
  drop constraint if exists price_quotation_product_costings_internal_vat_rate_check;
alter table public.price_quotation_product_costings
  add constraint price_quotation_product_costings_internal_vat_rate_check
  check (internal_vat_rate between 0 and 100);

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
    select 1 from jsonb_object_keys(p_defaults) as supplied(key)
    where supplied.key not in (
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'incentives', 'third_party_markup', 'vat'
    )
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;
  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'incentives', 'third_party_markup', 'vat'
  ] loop
    if not (p_defaults ? v_key) then
      raise exception 'Missing pricing default: %', v_key;
    end if;
    v_entry := p_defaults -> v_key;
    if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
      raise exception 'Pricing default % must be an object', v_key;
    end if;
    v_type := v_entry ->> 'calculation_type';
    if v_type <> 'percentage' then
      raise exception 'Pricing default % must use percentage basis', v_key;
    end if;
    begin
      v_value := (v_entry ->> 'value')::numeric;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value < 0 or v_value > 100 then
      raise exception 'Pricing default % must be between 0%% and 100%%', v_key;
    end if;
    if v_key = 'target_profit_margin' and v_value >= 100 then
      raise exception 'Pricing default % must be below 100%%', v_key;
    end if;
  end loop;
end;
$$;

-- Discount is entered per quotation by the Sales & Pricing Officer. Remove
-- the obsolete organization-level default while preserving every quotation's
-- saved discount row. This runs after the validator no longer requires it.
update public.business_settings
set pricing_markup_defaults = pricing_markup_defaults - 'discounts'
where pricing_markup_defaults ? 'discounts';

-- Keep every internal adjustment percentage-only except Discount, which may
-- be a customer percentage or a peso amount.
create or replace function private.enforce_percentage_costing_markup()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text := lower(coalesce(nullif(btrim(new.markup_key), ''), nullif(btrim(new.label), ''), ''));
begin
  if v_key in ('discount', 'discounts') then
    new.markup_key := 'discounts';
    new.label := 'Discounts';
    if coalesce(nullif(btrim(new.calculation_type), ''), 'percentage') = 'fixed_amount' then
      new.calculation_type := 'fixed_amount';
      new.rate := 0;
      return new;
    end if;
  elsif coalesce(nullif(btrim(new.calculation_type), ''), 'percentage') <> 'percentage' then
    raise exception 'Only Discount may use an amount basis';
  end if;

  new.calculation_type := 'percentage';
  new.amount := 0;
  return new;
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
    if v_calculation_type not in ('quantity_unit_cost', 'fixed_amount') then raise exception 'Each internal cost line needs a valid calculation type'; end if;
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

  if coalesce(jsonb_typeof(p_costing -> 'markups'), 'array') <> 'array' then raise exception 'Costing markups must be a list'; end if;
  for v_markup in select value from jsonb_array_elements(coalesce(p_costing -> 'markups', '[]'::jsonb)) loop
    v_description := nullif(btrim(coalesce(v_markup ->> 'label', '')), '');
    if v_description is null then raise exception 'Each pricing adjustment needs a name'; end if;
    v_markup_key := lower(coalesce(nullif(btrim(v_markup ->> 'markup_key'), ''), v_description));
    v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
    if v_markup_type not in ('percentage', 'fixed_amount') then raise exception 'Each pricing adjustment needs a valid basis'; end if;
    if v_markup_key not in ('discount', 'discounts') and v_markup_type <> 'percentage' then raise exception 'Only Discount may use an amount basis'; end if;
    begin
      v_value := case when v_markup_type = 'fixed_amount'
        then coalesce((v_markup ->> 'amount')::numeric, (v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1)
        else coalesce((v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, -1)
      end;
    exception when invalid_text_representation then
      raise exception 'Pricing adjustment values must be valid numbers';
    end;
    if v_value < 0 then raise exception 'Pricing adjustment values cannot be negative'; end if;
    if v_markup_type = 'percentage' and v_value > 100 then raise exception 'Pricing adjustment percentages cannot exceed 100%%'; end if;
    if v_markup_key in ('discount', 'discounts') then
      if v_discount_seen then raise exception 'Discount may be entered only once'; end if;
      if v_markup_type = 'percentage' and v_value >= 100 then raise exception 'Discount must be below 100%%'; end if;
      v_discount_seen := true;
      v_discount_type := v_markup_type;
      v_discount_value := v_value;
    elsif v_markup_key <> 'vat' then
      v_value := round(v_cogs * v_value / 100, 2);
      v_markup_total := v_markup_total + v_value;
      if v_markup_key = 'target_profit_margin' then v_profit := v_value; end if;
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
  if v_discount_amount > v_pre_discount_total then raise exception 'Discount cannot exceed the total before discount'; end if;
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

-- apply_product_costings() writes the net pre-VAT price first. This function
-- applies the GM review VAT to every product grand total, then derives the
-- saved per-piece price from that grand total so the customer PDF agrees.
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
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_vat_amount numeric := 0;
  v_item record;
  v_item_grand_total numeric;
begin
  select coalesce(round(sum(line_total), 2), 0) into v_subtotal
  from public.quotation_items where quotation_id = p_quotation_id;

  if p_vat_calculation_type = 'percentage' and greatest(coalesce(p_vat_rate, 0), 0) > 0 then
    for v_item in select id, quantity, line_total from public.quotation_items where quotation_id = p_quotation_id loop
      v_item_grand_total := round(v_item.line_total * (1 + greatest(coalesce(p_vat_rate, 0), 0) / 100), 2);
      update public.quotation_items
      set unit_cost = round(v_item_grand_total / nullif(v_item.quantity, 0), 2)
      where id = v_item.id;
    end loop;
  end if;

  select coalesce(round(sum(line_total), 2), 0) into v_total
  from public.quotation_items where quotation_id = p_quotation_id;
  v_vat_amount := round(v_total - v_subtotal, 2);

  update public.quotations q
  set vat_rate = case when p_vat_calculation_type = 'percentage' then greatest(coalesce(p_vat_rate, 0), 0) else 0 end,
      vat_calculation_type = 'percentage', vat_fixed_amount = 0,
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
      subtotal = v_subtotal, total_cost = v_subtotal,
      vat_amount = v_vat_amount, total_amount = v_total
  where q.id = p_quotation_id;

  update public.approval_requests
  set status = (case when p_status = 'pending_gm_approval' then 'pending' else p_status end)::public.approval_status,
      decided_by = case when p_status = 'approved' then p_actor else null end,
      decided_at = case when p_status = 'approved' then now() else null end,
      decision_note = null
  where resource_type = 'quotation' and resource_id = p_quotation_id;
end;
$$;

-- A Sales & Pricing Officer cannot set customer VAT. Their submitted internal
-- VAT/default remains confidential; pending-GM totals are intentionally VAT 0.
create or replace function public.pricing_review_price_quotation(
  p_quotation_id uuid, p_decision text, p_vat_rate numeric, p_terms_conditions text,
  p_bank_details jsonb, p_costings jsonb, p_revision_note text,
  p_vat_calculation_type text, p_vat_fixed_amount numeric
)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype; v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then raise exception 'Unsupported Price Quotation decision'; end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then raise exception 'Price Quotation not found'; end if;
  if v_quote.status::text <> 'pending' then raise exception 'Only submitted Price Quotations can be reviewed'; end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types)
    or v_quote.created_by is not distinct from (select auth.uid())
    or v_quote.prepared_by_user_id is not distinct from (select auth.uid()) then
    raise exception 'Only the assigned Sales & Pricing Officer can review this Price Quotation';
  end if;
  if p_decision = 'needs_revision' then
    if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
    update public.quotations set status = 'needs_revision', revision_note = v_note, revision_requested_by = (select auth.uid()), revision_requested_at = now(), approved_by = null, approved_at = null where id = v_quote.id;
    update public.approval_requests set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', 'percentage', 0, 0, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

create or replace function public.pricing_review_mockup_quotation(
  p_quotation_id uuid, p_decision text, p_vat_rate numeric, p_terms_conditions text,
  p_bank_details jsonb, p_costings jsonb, p_revision_note text,
  p_vat_calculation_type text, p_vat_fixed_amount numeric
)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype; v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then raise exception 'Unsupported Mockup Quotation decision'; end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then raise exception 'Mockup Quotation not found'; end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types) then
    raise exception 'Only the Sales & Pricing Officer assigned to this project type can review this Mockup Quotation';
  end if;
  if v_quote.status::text <> 'pending' then raise exception 'Only submitted Mockup Quotations can be reviewed'; end if;
  if p_decision = 'needs_revision' then
    if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
    update public.quotations set status = 'needs_revision', revision_note = v_note, revision_requested_by = (select auth.uid()), revision_requested_at = now(), approved_by = null, approved_at = null where id = v_quote.id;
    update public.approval_requests set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', 'percentage', 0, 0, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

commit;
