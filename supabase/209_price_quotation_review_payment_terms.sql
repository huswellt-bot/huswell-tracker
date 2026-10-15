-- Wire the structured payment-term options into the direct Price Quotation
-- Review Queue. The older Costing Breakdown approval workflow remains intact.
-- Run after 208_quotation_payment_receiving_accounts.sql and before the
-- matching application update. The existing RPC signatures remain available
-- for older clients during a rolling deployment.

begin;

create or replace function public.pricing_review_price_quotation(
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
  p_pdc_term_days integer
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_option text := coalesce(nullif(btrim(coalesce(p_payment_terms_option, '')), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
begin
  if p_decision is null or p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
  end if;
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
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

  -- The existing ten-argument workflow remains the authority for costing,
  -- terms, bank details, status, and approval-request transitions. Save the
  -- structured option for both outcomes so the text terms and the PDF-facing
  -- fields cannot diverge when the officer requests another revision.
  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);
  update public.quotations
  set payment_terms_option = v_option,
      pdc_term_days = v_days
  where id = v_quote.id;

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
    p_submission_note
  );
end;
$$;

create or replace function public.final_approve_price_quotation_with_edits(
  p_quotation_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_payment_terms_option text,
  p_pdc_term_days integer
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_option text := coalesce(nullif(btrim(coalesce(p_payment_terms_option, '')), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
begin
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or (v_quote.document_type = 'price_quotation' and v_quote.costing_source_id is not null) then
    raise exception 'Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve this quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This quotation is not awaiting General Manager approval';
  end if;

  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);
  update public.quotations
  set payment_terms_option = v_option,
      pdc_term_days = v_days
  where id = v_quote.id;

  -- Reuse the current final-approval implementation so its costing, VAT,
  -- totals, audit, and approval-request behavior stays unchanged.
  perform public.final_approve_price_quotation_with_edits(
    p_quotation_id,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_vat_calculation_type,
    p_vat_fixed_amount
  );
end;
$$;

-- Preserve GM edits to payment terms and client-facing terms when returning a
-- quotation for Pricing Officer revision. The older two-argument return RPC
-- remains available for clients that do not send editable terms.
create or replace function public.return_price_quotation_from_gm_with_edits(
  p_quotation_id uuid,
  p_note text,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_payment_terms_option text,
  p_pdc_term_days integer
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_option text := coalesce(nullif(btrim(coalesce(p_payment_terms_option, '')), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can return this quotation';
  end if;

  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);
  update public.quotations
  set terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      payment_terms_option = v_option,
      pdc_term_days = v_days,
      status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now(),
      approved_by = null,
      approved_at = null
  where id = v_quote.id;

  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

revoke all on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer
) from public;
grant execute on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer
) to authenticated;

revoke all on function public.final_approve_price_quotation_with_edits(
  uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer
) from public;
grant execute on function public.final_approve_price_quotation_with_edits(
  uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer
) to authenticated;

revoke all on function public.return_price_quotation_from_gm_with_edits(
  uuid, text, text, jsonb, text, integer
) from public;
grant execute on function public.return_price_quotation_from_gm_with_edits(
  uuid, text, text, jsonb, text, integer
) to authenticated;

commit;
