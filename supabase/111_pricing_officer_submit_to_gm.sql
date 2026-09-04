-- Restore the Pricing Officer review path without granting final approval.
-- Run after 110_allow_officer_revision_drafts.sql.

begin;

create or replace function public.pricing_review_price_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb default '[]'::jsonb,
  p_revision_note text default null
)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_quote public.quotations%rowtype;
  v_costing jsonb;
  v_line jsonb;
  v_markup jsonb;
  v_costing_id uuid;
  v_item_id uuid;
  v_cogs numeric;
  v_markup_total numeric;
  v_price numeric;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
  end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer']) then
    raise exception 'Only a Pricing Officer can review this Price Quotation';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;

  if p_decision = 'needs_revision' then
    if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
    update public.quotations set status = 'needs_revision', revision_note = v_note,
      revision_requested_by = (select auth.uid()), revision_requested_at = now(),
      approved_by = null, approved_at = null
    where id = v_quote.id;
    update public.approval_requests set status = 'needs_revision', decided_by = (select auth.uid()),
      decided_at = now(), decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;

  if jsonb_typeof(p_costings) <> 'array' or jsonb_array_length(p_costings) <> (
    select count(*) from public.quotation_items where quotation_id = v_quote.id
  ) then raise exception 'Add one costing table for every quotation product'; end if;

  delete from public.price_quotation_product_costings where quotation_id = v_quote.id;
  for v_costing in select value from jsonb_array_elements(p_costings) loop
    begin v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then raise exception 'Each costing table must be linked to a quotation product'; end;
    if not exists (select 1 from public.quotation_items where id = v_item_id and quotation_id = v_quote.id) then
      raise exception 'Each costing table must be linked to a quotation product';
    end if;
    if jsonb_typeof(v_costing -> 'cost_lines') <> 'array' or jsonb_array_length(v_costing -> 'cost_lines') = 0 then
      raise exception 'Add at least one internal cost line for every quotation product';
    end if;
    insert into public.price_quotation_product_costings (organization_id, quotation_id, quotation_item_id, created_by, updated_at)
    values (v_quote.organization_id, v_quote.id, v_item_id, (select auth.uid()), now()) returning id into v_costing_id;
    for v_line in select value from jsonb_array_elements(v_costing -> 'cost_lines') loop
      if nullif(btrim(coalesce(v_line ->> 'description', '')), '') is null then raise exception 'Each internal cost line needs a description'; end if;
      insert into public.price_quotation_costing_lines (organization_id, product_costing_id, description, calculation_type, quantity, unit_cost, sort_order)
      values (v_quote.organization_id, v_costing_id, btrim(v_line ->> 'description'),
        case when coalesce(v_line ->> 'calculation_type', 'quantity_unit_cost') = 'fixed_amount' then 'fixed_amount' else 'quantity_unit_cost' end,
        case when coalesce(v_line ->> 'calculation_type', 'quantity_unit_cost') = 'fixed_amount' then 1 else greatest(coalesce((v_line ->> 'quantity')::numeric, 0), 0) end,
        greatest(coalesce((v_line ->> 'amount')::numeric, (v_line ->> 'unit_cost')::numeric, 0), 0), coalesce((v_line ->> 'sort_order')::integer, 0));
    end loop;
    for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
      if nullif(btrim(coalesce(v_markup ->> 'label', '')), '') is null then raise exception 'Each markup needs a name'; end if;
      insert into public.price_quotation_costing_markups (organization_id, product_costing_id, label, rate, sort_order)
      values (v_quote.organization_id, v_costing_id, btrim(v_markup ->> 'label'), greatest(coalesce((v_markup ->> 'rate')::numeric, 0), 0), coalesce((v_markup ->> 'sort_order')::integer, 0));
    end loop;
    select coalesce(sum(quantity * unit_cost), 0) into v_cogs from public.price_quotation_costing_lines where product_costing_id = v_costing_id;
    select coalesce(sum(v_cogs * rate / 100), 0) into v_markup_total from public.price_quotation_costing_markups where product_costing_id = v_costing_id;
    select (v_cogs + v_markup_total) / quantity into v_price from public.quotation_items where id = v_item_id;
    update public.quotation_items set unit_cost = round(v_price, 2) where id = v_item_id;
  end loop;

  update public.quotations q set vat_rate = greatest(coalesce(p_vat_rate, 0), 0),
    shipping_handling = 0, terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
    bank_details = coalesce(p_bank_details, q.bank_details), status = 'pending_gm_approval',
    pricing_reviewed_by = (select auth.uid()), pricing_reviewed_at = now(), approved_by = null, approved_at = null,
    subtotal = totals.subtotal, total_cost = totals.subtotal, vat_amount = round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2),
    total_amount = totals.subtotal + round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2)
  from (select coalesce(round(sum(quantity * unit_cost), 2), 0) subtotal from public.quotation_items where quotation_id = v_quote.id) totals
  where q.id = v_quote.id;
  update public.approval_requests set status = 'pending', decided_by = null, decided_at = null, decision_note = null
  where resource_type = 'quotation' and resource_id = v_quote.id;
end; $$;

revoke all on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text) from public;
grant execute on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text) to authenticated;

drop policy if exists "price quotation product costings: GM only" on public.price_quotation_product_costings;
create policy "price quotation product costings: GM only" on public.price_quotation_product_costings for select to authenticated using ((select private.has_text_role(organization_id, array['super_admin','owner','admin','pricing_officer'])));
drop policy if exists "price quotation costing lines: GM only" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: GM only" on public.price_quotation_costing_lines for select to authenticated using ((select private.has_text_role(organization_id, array['super_admin','owner','admin','pricing_officer'])));
drop policy if exists "price quotation costing markups: GM only" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: GM only" on public.price_quotation_costing_markups for select to authenticated using ((select private.has_text_role(organization_id, array['super_admin','owner','admin','pricing_officer'])));

commit;
