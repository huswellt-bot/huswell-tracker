begin;

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
as $function$
declare
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_vat_amount numeric := 0;
  v_item record;
  v_item_grand_total numeric;
  v_vat_inclusive boolean := false;
  v_vat_rate numeric := 0;
  v_vat_snapshot_rate numeric := 0;
begin
  select coalesce(q.vat_inclusive, false),
         greatest(least(coalesce(q.vat_rate_snapshot, 0), 100), 0)
  into v_vat_inclusive, v_vat_snapshot_rate
  from public.quotations q
  where q.id = p_quotation_id
  for update;

  if p_status = 'pending_gm_approval' then
    v_vat_rate := case when v_vat_inclusive then v_vat_snapshot_rate else 0 end;
  else
    v_vat_rate := case when v_vat_inclusive
      then greatest(least(coalesce(p_vat_rate, 0), 100), 0)
      else 0
    end;
    v_vat_snapshot_rate := case when v_vat_inclusive
      then greatest(least(coalesce(p_vat_rate, 0), 100), 0)
      else v_vat_snapshot_rate
    end;
  end if;

  select coalesce(round(sum(line_total), 2), 0) into v_subtotal
  from public.quotation_items where quotation_id = p_quotation_id;

  if p_vat_calculation_type = 'percentage' and v_vat_rate > 0 then
    for v_item in select id, quantity, line_total from public.quotation_items where quotation_id = p_quotation_id loop
      v_item_grand_total := round(v_item.line_total * (1 + v_vat_rate / 100), 2);
      update public.quotation_items
      set unit_cost = round(v_item_grand_total / nullif(v_item.quantity, 0), 2)
      where id = v_item.id;
    end loop;
  end if;

  select coalesce(round(sum(line_total), 2), 0) into v_total
  from public.quotation_items where quotation_id = p_quotation_id;
  v_vat_amount := round(v_total - v_subtotal, 2);

  update public.quotations q
  set vat_inclusive = v_vat_inclusive,
      vat_rate_snapshot = v_vat_snapshot_rate,
      vat_rate = v_vat_rate,
      vat_calculation_type = 'percentage',
      vat_fixed_amount = 0,
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
      revision_requested_to = null,
      subtotal = v_subtotal,
      total_cost = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = v_total
  where q.id = p_quotation_id;

  update public.approval_requests
  set status = (case when p_status = 'pending_gm_approval' then 'pending' else p_status end)::public.approval_status,
      submitted_by = case when p_status = 'pending_gm_approval' then p_actor else submitted_by end,
      submitted_at = case when p_status = 'pending_gm_approval' then now() else submitted_at end,
      decided_by = case when p_status = 'approved' then p_actor else null end,
      decided_at = case when p_status = 'approved' then now() else null end,
      decision_note = null
  where resource_type = 'quotation' and resource_id = p_quotation_id;
end;
$function$;

commit;
