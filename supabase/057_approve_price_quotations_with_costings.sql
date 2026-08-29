-- A General Manager-approved Costing Breakdown produces an approved Price
-- Quotation. This keeps the quotation eligible for Project scheduling.
-- Run after 056_general_manager_costing_revisions.sql.

begin;

create or replace function public.review_costing_breakdown(
  p_costing_id uuid,
  p_decision text,
  p_profit_margin_rate numeric,
  p_overhead_rate numeric,
  p_buffer_margin_rate numeric,
  p_commission_rate numeric,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_revision_note text default null
)
returns table (costing_id uuid, price_quotation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_price_id uuid;
  v_price_no text;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Costing Breakdown decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter revision notes before returning this Costing Breakdown';
  end if;

  select * into v_costing from public.quotations where id = p_costing_id for update;
  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;
  if not private.has_text_role(v_costing.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Costing Breakdowns';
  end if;
  if v_costing.status::text <> 'pending' then
    raise exception 'Only submitted Costing Breakdowns can be reviewed';
  end if;

  update public.quotations
  set profit_margin_rate = coalesce(p_profit_margin_rate, profit_margin_rate),
      overhead_rate = coalesce(p_overhead_rate, overhead_rate),
      buffer_margin_rate = coalesce(p_buffer_margin_rate, buffer_margin_rate),
      commission_rate = coalesce(p_commission_rate, commission_rate),
      vat_rate = coalesce(p_vat_rate, vat_rate),
      terms_conditions = coalesce(p_terms_conditions, terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      status = p_decision::public.quotation_status,
      revision_note = case when p_decision = 'needs_revision' then v_note else null end,
      revision_requested_by = case when p_decision = 'needs_revision' then (select auth.uid()) else null end,
      revision_requested_at = case when p_decision = 'needs_revision' then now() else null end,
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end
  where id = v_costing.id returning * into v_costing;

  perform private.refresh_quotation_totals(v_costing.id);
  select * into v_costing from public.quotations where id = v_costing.id;

  update public.approval_requests
  set status = (case when p_decision = 'approved' then 'approved' else 'needs_revision' end)::public.approval_status,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where organization_id = v_costing.organization_id and resource_type = 'quotation'
    and resource_id = v_costing.id;

  if p_decision = 'needs_revision' then
    return query select v_costing.id, null::uuid;
    return;
  end if;

  select id into v_price_id from public.quotations
  where costing_source_id = v_costing.id and document_type = 'price_quotation'
  for update;
  if v_price_id is null then
    v_price_no := format('QT-%s-%s', to_char(current_date, 'YYYY'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    insert into public.quotations (
      organization_id, quotation_no, document_type, costing_source_id, customer_id,
      lead_id, client_name, client_contact_name, client_phone, size_details,
      project_quantity, delivery_date, project_types, project_name, representative,
      prepared_by_user_id, prepared_by_signature_url,
      profit_margin_rate, overhead_rate, buffer_margin_rate, commission_rate, vat_rate,
      terms_conditions, bank_details, issue_date, valid_until, notes, status, created_by,
      approved_by, approved_at
    ) values (
      v_costing.organization_id, v_price_no, 'price_quotation', v_costing.id,
      v_costing.customer_id, v_costing.lead_id, v_costing.client_name,
      v_costing.client_contact_name, v_costing.client_phone, v_costing.size_details,
      v_costing.project_quantity, v_costing.delivery_date, v_costing.project_types,
      v_costing.project_name, v_costing.representative,
      v_costing.prepared_by_user_id, v_costing.prepared_by_signature_url,
      v_costing.profit_margin_rate, v_costing.overhead_rate, v_costing.buffer_margin_rate,
      v_costing.commission_rate, v_costing.vat_rate, v_costing.terms_conditions,
      v_costing.bank_details, current_date, v_costing.valid_until, v_costing.notes,
      'approved', (select auth.uid()), v_costing.approved_by, v_costing.approved_at
    ) returning id into v_price_id;
  else
    update public.quotations
    set customer_id = v_costing.customer_id,
        lead_id = v_costing.lead_id,
        client_name = v_costing.client_name,
        client_contact_name = v_costing.client_contact_name,
        client_phone = v_costing.client_phone,
        size_details = v_costing.size_details,
        project_quantity = v_costing.project_quantity,
        delivery_date = v_costing.delivery_date,
        project_types = v_costing.project_types,
        project_name = v_costing.project_name,
        representative = v_costing.representative,
        prepared_by_user_id = v_costing.prepared_by_user_id,
        prepared_by_signature_url = v_costing.prepared_by_signature_url,
        profit_margin_rate = v_costing.profit_margin_rate,
        overhead_rate = v_costing.overhead_rate,
        buffer_margin_rate = v_costing.buffer_margin_rate,
        commission_rate = v_costing.commission_rate,
        vat_rate = v_costing.vat_rate,
        terms_conditions = v_costing.terms_conditions,
        bank_details = v_costing.bank_details,
        issue_date = current_date,
        valid_until = v_costing.valid_until,
        notes = v_costing.notes,
        status = 'approved',
        approved_by = v_costing.approved_by,
        approved_at = v_costing.approved_at
    where id = v_price_id;

    delete from public.quotation_items where quotation_id = v_price_id;
  end if;

  insert into public.quotation_items (
    quotation_id, inventory_item_id, description, details, image_url, quantity, unit_cost, sort_order
  ) select v_price_id, item.inventory_item_id, item.description, item.details,
      item.image_url, item.quantity, item.unit_cost, item.sort_order
  from public.quotation_items item where item.quotation_id = v_costing.id
  order by item.sort_order, item.created_at;

  perform private.refresh_quotation_totals(v_price_id);
  return query select v_costing.id, v_price_id;
end;
$$;

revoke all on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text) from public;
grant execute on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text) to authenticated;

-- Bring existing generated quotations into line only when their linked
-- Costing Breakdown has already been approved. This includes the quotation
-- that was unavailable for Project scheduling.
-- The status-protection trigger is disabled only for this controlled,
-- source-validated historical backfill; it is re-enabled before commit.
alter table public.quotations disable trigger role_sensitive_transition;
update public.quotations as price
set status = 'approved',
    approved_by = costing.approved_by,
    approved_at = costing.approved_at
from public.quotations as costing
where price.document_type = 'price_quotation'
  and price.status::text = 'sent'
  and price.costing_source_id = costing.id
  and costing.document_type = 'costing_breakdown'
  and costing.status::text = 'approved';
alter table public.quotations enable trigger role_sensitive_transition;

commit;
