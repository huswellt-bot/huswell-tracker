-- Reopen the linked Price Quotation before its Costing Breakdown. The Price
-- Quotation workflow validates that its source Costing Breakdown is approved,
-- so this order keeps the revision transaction valid and atomic.
-- Run after 057_approve_price_quotations_with_costings.sql.

create or replace function public.review_quotation_revision(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.quotation_revision_requests%rowtype;
  v_costing public.quotations%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported quotation revision decision';
  end if;

  select * into v_request
  from public.quotation_revision_requests
  where id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Quotation revision request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review quotation revisions';
  end if;

  select * into v_costing
  from public.quotations
  where id = v_request.costing_id
  for update;
  if not found
    or v_costing.document_type <> 'costing_breakdown'
    or v_costing.status::text <> 'approved' then
    raise exception 'This Costing Breakdown is no longer available for revision';
  end if;

  if p_decision = 'approved' then
    -- The source is still approved at this point, satisfying the linked Price
    -- Quotation's validation trigger before the Costing Breakdown is reopened.
    update public.quotations
    set status = 'needs_revision'
    where costing_source_id = v_costing.id
      and document_type = 'price_quotation';

    update public.quotations
    set status = 'needs_revision',
        revision_note = 'Revision approved. Update the Costing Breakdown and submit it for review.',
        revision_requested_by = (select auth.uid()),
        revision_requested_at = now(),
        approved_by = null,
        approved_at = null
    where id = v_costing.id;
  end if;

  update public.quotation_revision_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = v_request.id;

  return v_costing.id;
end;
$$;

revoke all on function public.review_quotation_revision(uuid, text) from public;
grant execute on function public.review_quotation_revision(uuid, text) to authenticated;
