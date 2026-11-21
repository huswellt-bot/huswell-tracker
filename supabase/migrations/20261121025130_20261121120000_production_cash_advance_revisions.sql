-- Add General Manager revision requests to the Production cash-advance flow.
-- A revision keeps the original request for history; resubmission creates a
-- new pending request and never deducts the Project Fund by itself.

begin;

alter table public.production_cash_advance_requests
  drop constraint if exists production_cash_advance_requests_status_check;
alter table public.production_cash_advance_requests
  add constraint production_cash_advance_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'needs_revision', 'cancelled'));

create or replace function public.review_production_cash_advance(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.production_cash_advance_requests%rowtype;
  v_assignment public.production_box_maker_assignments%rowtype;
  v_fund public.project_funds%rowtype;
  v_amount numeric(14,2);
  v_available numeric(14,2);
begin
  -- Read the request first only to discover the assignment. The approval
  -- path must lock the assignment before the request so it follows the same
  -- order used by assignment archival and cannot deadlock with it.
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Production cash advance request not found';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Production cash advances';
  end if;
  if p_decision is null
    or p_decision not in ('approved', 'rejected', 'needs_revision')
    or v_request.status <> 'pending' then
    raise exception 'This cash advance request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot review your own cash advance request';
  end if;
  if length(btrim(coalesce(p_decision_note, ''))) > 2000 then
    raise exception 'The decision remark cannot exceed 2000 characters';
  end if;
  if p_decision = 'rejected'
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'A rejection remark is required';
  end if;
  if p_decision = 'needs_revision'
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'A revision remark is required';
  end if;

  -- Rejection and revision do not touch the assignment or Project Fund.
  -- They only record the GM decision and note on the request.
  if p_decision in ('rejected', 'needs_revision') then
    select * into v_request
    from public.production_cash_advance_requests request
    where request.id = p_request_id
    for update;
    if not found then
      raise exception 'Production cash advance request not found';
    end if;
    if v_request.status <> 'pending' then
      raise exception 'This cash advance request is no longer awaiting approval';
    end if;
    if v_request.requested_by = (select auth.uid()) then
      raise exception 'You cannot review your own cash advance request';
    end if;
    update public.production_cash_advance_requests request
    set status = p_decision,
        decided_by = (select auth.uid()),
        decided_at = now(),
        decision_note = nullif(btrim(p_decision_note), ''),
        updated_at = now()
    where request.id = v_request.id;
    return;
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = v_request.assignment_id
    and assignment.organization_id = v_request.organization_id
    and assignment.production_job_id = v_request.production_job_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'The Box Maker assignment is no longer active';
  end if;

  -- Re-read and lock the request after the assignment lock. Assignment
  -- archival uses this same assignment-then-request order.
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Production cash advance request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This cash advance request is no longer awaiting approval';
  end if;
  if v_request.assignment_id <> v_assignment.id
    or v_request.organization_id <> v_assignment.organization_id
    or v_request.production_job_id <> v_assignment.production_job_id then
    raise exception 'The cash advance request is no longer linked to this Box Maker assignment';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot approve your own cash advance request';
  end if;

  select * into v_fund
  from public.project_funds fund
  where fund.id = v_request.project_fund_id
    and fund.organization_id = v_request.organization_id
  for update;
  if not found or v_fund.status <> 'open' then
    raise exception 'The Project Fund is not open';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = v_request.production_job_id
      and job.organization_id = v_request.organization_id
      and (v_fund.production_job_id = job.id or v_fund.quotation_id = job.quotation_id)
  ) then
    raise exception 'The cash advance is not linked to the selected project fund';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_fund.id::text));
  select round(coalesce(sum(
    case when entry.direction = 'credit' then entry.amount else -entry.amount end
  ) filter (where not entry.is_voided), 0), 2)
  into v_available
  from public.project_fund_entries entry
  where entry.project_fund_id = v_fund.id;

  v_amount := round(v_request.requested_amount, 2);
  if v_amount > greatest(v_available, 0) + 0.001 then
    raise exception 'The Project Fund has insufficient available balance for this request';
  end if;
  if v_assignment.cash_advance + v_amount > v_assignment.labor_cost + 0.001 then
    raise exception 'Cash advance cannot exceed the Box Maker balance';
  end if;
  if exists (
    select 1
    from public.project_fund_entries entry
    where entry.source_production_cash_advance_id = v_request.id
      and not entry.is_voided
  ) then
    raise exception 'This cash advance has already been deducted from the Project Fund';
  end if;

  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount,
    entry_date, note, source_production_cash_advance_id, created_by
  ) values (
    v_request.organization_id, v_fund.id, 'project_expense', 'debit', v_amount,
    current_date, 'Production cash advance for Box Maker', v_request.id, (select auth.uid())
  );

  update public.production_box_maker_assignments assignment
  set cash_advance = round(assignment.cash_advance + v_amount, 2),
      updated_by = (select auth.uid())
  where assignment.id = v_assignment.id;

  update public.production_cash_advance_requests request
  set status = 'approved',
      approved_amount = v_amount,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(p_decision_note), ''),
      updated_at = now()
  where request.id = v_request.id;
end;
$$;

create or replace function public.resubmit_production_cash_advance(
  p_request_id uuid,
  p_requested_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.production_cash_advance_requests%rowtype;
  v_new_request_id uuid;
begin
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Production cash advance request not found';
  end if;
  if not private.has_production_operations(v_request.organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_request.requested_by <> (select auth.uid()) then
    raise exception 'Only the original requester can resubmit this cash advance';
  end if;
  if v_request.status <> 'needs_revision' then
    raise exception 'Only a cash advance request marked for revision can be resubmitted';
  end if;
  if exists (
    select 1
    from public.production_cash_advance_requests newer
    where newer.assignment_id = v_request.assignment_id
      and (
        newer.requested_at > v_request.requested_at
        or (
          newer.requested_at = v_request.requested_at
          and newer.id > v_request.id
        )
      )
  ) then
    raise exception 'A newer cash advance request already exists for this Box Maker';
  end if;

  v_new_request_id := public.request_production_cash_advance(
    v_request.organization_id,
    v_request.assignment_id,
    p_requested_amount,
    p_note
  );
  return v_new_request_id;
end;
$$;

revoke all on function public.review_production_cash_advance(uuid, text, text)
  from public, anon;
grant execute on function public.review_production_cash_advance(uuid, text, text)
  to authenticated;
revoke all on function public.resubmit_production_cash_advance(uuid, numeric, text)
  from public, anon;
grant execute on function public.resubmit_production_cash_advance(uuid, numeric, text)
  to authenticated;

commit;
