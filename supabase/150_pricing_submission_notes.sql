-- Persist the optional note that a Pricing Officer sends with a costing
-- submission to the General Manager. Keep the existing nine-argument RPC for
-- older clients and add the ten-argument overload used by the workspace.
-- Run after 149_price_quotation_only_production.sql and before deploying the
-- matching application update. Safe to re-run.

begin;

alter table public.quotations
  add column if not exists pricing_submission_note text;

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
  p_submission_note text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
  v_submission_note text := nullif(btrim(coalesce(p_submission_note, '')), '');
begin
  if p_decision is null or p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
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

  if p_decision = 'needs_revision' then
    if v_quote.status::text <> 'pending' then
      raise exception 'This GM revision must be resubmitted to the General Manager';
    end if;
    if v_note is null then
      raise exception 'Enter revision notes before returning this quotation';
    end if;

    update public.quotations
    set status = 'needs_revision',
        revision_note = v_note,
        revision_requested_to = 'project_officer',
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
    return;
  end if;

  perform private.apply_pricing_officer_costings(
    v_quote.organization_id,
    v_quote.id,
    p_costings,
    (select auth.uid())
  );
  perform private.persist_product_quotation_totals(
    v_quote.id,
    'pending_gm_approval',
    'percentage',
    0,
    0,
    p_terms_conditions,
    p_bank_details,
    (select auth.uid())
  );

  -- A blank optional note on a later resubmission does not erase the note
  -- already attached to the quotation's approval history.
  update public.quotations
  set pricing_submission_note = coalesce(v_submission_note, pricing_submission_note)
  where id = v_quote.id;
end;
$$;

revoke all on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text
) from public;
grant execute on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text
) to authenticated;

commit;
