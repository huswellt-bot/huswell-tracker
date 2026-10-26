-- Store the client-approved unit price separately from the GM's internal target
-- selling price. Existing quotation rows remain valid and are intentionally not
-- backfilled from free-text pricing submission notes.

begin;

alter table public.quotation_items
  add column if not exists approved_selling_price numeric(14,2);

alter table public.quotation_items
  drop constraint if exists quotation_items_approved_selling_price_check;

alter table public.quotation_items
  add constraint quotation_items_approved_selling_price_check
  check (approved_selling_price is null or approved_selling_price >= 0);

create index if not exists quotation_items_approved_selling_price_idx
  on public.quotation_items (quotation_id);

create or replace function private.save_approved_selling_prices(
  p_quotation_id uuid,
  p_approved_selling_prices jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_item_count bigint;
  v_payload_count bigint;
  v_distinct_item_count bigint;
begin
  if coalesce(jsonb_typeof(p_approved_selling_prices), '') <> 'array' then
    raise exception 'Approved selling prices must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items
  where quotation_id = p_quotation_id;

  select count(*) into v_payload_count
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  );

  select count(distinct price.quotation_item_id) into v_distinct_item_count
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  );

  if v_payload_count <> v_item_count
    or v_distinct_item_count <> v_item_count then
    raise exception 'Enter one approved selling price for every quotation product';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_approved_selling_prices) as price(
      quotation_item_id uuid,
      approved_selling_price numeric
    )
    where price.approved_selling_price is null
      or price.approved_selling_price < 0
  ) then
    raise exception 'Approved selling prices must be non-negative numbers';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_approved_selling_prices) as price(
      quotation_item_id uuid,
      approved_selling_price numeric
    )
    where not exists (
      select 1
      from public.quotation_items item
      where item.id = price.quotation_item_id
        and item.quotation_id = p_quotation_id
    )
  ) then
    raise exception 'Approved selling price item does not belong to this quotation';
  end if;

  update public.quotation_items item
  set approved_selling_price = price.approved_selling_price
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  )
  where item.id = price.quotation_item_id
    and item.quotation_id = p_quotation_id;
end;
$$;

create or replace function public.pricing_review_price_quotation_with_approved_prices(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_submission_note text,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_approved_selling_prices jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the assigned Sales & Pricing Officer can review this Price Quotation';
  end if;

  perform private.save_approved_selling_prices(
    p_quotation_id,
    p_approved_selling_prices
  );

  perform public.pricing_review_price_quotation(
    p_quotation_id,
    p_decision,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_revision_note,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_submission_note,
    p_payment_terms_option,
    p_pdc_term_days
  );
end;
$$;

revoke all on function public.pricing_review_price_quotation_with_approved_prices(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, jsonb
) from public, anon;
grant execute on function public.pricing_review_price_quotation_with_approved_prices(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, jsonb
) to authenticated;

create or replace function public.pricing_review_price_quotation_with_commission_and_approved_prices(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_submission_note text,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_split_option text,
  p_approved_selling_prices jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer']) then
    raise exception 'Only a Sales & Pricing Officer can review this quotation';
  end if;
  if v_quote.commission_handling_mode is not null
    and (
      v_quote.assigned_pricing_officer_user_id is distinct from (select auth.uid())
      or not private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
    ) then
    raise exception 'Only the selected Pricing Officer can review this quotation';
  end if;

  if v_quote.commission_handling_mode is not null then
    perform private.validate_quotation_commission_assignment_pre_gm(
      v_quote.organization_id,
      v_quote.project_types,
      v_quote.se_origin_user_id,
      v_quote.commission_handling_mode,
      v_quote.commission_co_worker_user_id
    );
    perform set_config('huswell.commission_assignment_rpc', 'on', true);
    update public.quotations
    set commission_split_option = null
    where id = p_quotation_id;
  end if;

  perform public.pricing_review_price_quotation_with_approved_prices(
    p_quotation_id,
    p_decision,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_revision_note,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_submission_note,
    p_payment_terms_option,
    p_pdc_term_days,
    p_approved_selling_prices
  );

end;
$$;

revoke all on function public.pricing_review_price_quotation_with_commission_and_approved_prices(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text, jsonb
) from public, anon;
grant execute on function public.pricing_review_price_quotation_with_commission_and_approved_prices(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text, jsonb
) to authenticated;

commit;
