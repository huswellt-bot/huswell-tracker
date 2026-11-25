-- New Box Maker payment requests use the shared Daily Fund.
-- Existing requests with a Project Fund link remain historical/legacy rows.

begin;

alter table public.production_cash_advance_requests
  alter column project_fund_id drop not null,
  add column if not exists daily_fund_transaction_id uuid
    references public.finance_revised_transactions(id) on delete restrict;

alter table public.production_cash_advance_requests
  drop constraint if exists production_cash_advance_requests_status_check;
alter table public.production_cash_advance_requests
  add constraint production_cash_advance_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'needs_revision', 'cancelled'));

alter table public.finance_revised_transactions
  add column if not exists source_production_cash_advance_id uuid
    references public.production_cash_advance_requests(id) on delete restrict;

create unique index if not exists finance_revised_transactions_production_cash_advance_key
  on public.finance_revised_transactions (source_production_cash_advance_id)
  where source_production_cash_advance_id is not null;

create index if not exists production_cash_advance_daily_fund_transaction_idx
  on public.production_cash_advance_requests (daily_fund_transaction_id)
  where daily_fund_transaction_id is not null;

-- Posted Daily Fund balance minus all pending reservations. The optional
-- request ID is excluded while its approval is being posted.
create or replace function private.production_daily_fund_available(
  p_organization_id uuid,
  p_exclude_request_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when not private.is_org_member(p_organization_id) then 0
    else greatest(round(
      coalesce(private.finance_revised_balance(p_organization_id, 'daily'), 0)
      - coalesce((
        select sum(request.requested_amount)
        from public.production_cash_advance_requests request
        where request.organization_id = p_organization_id
          and request.status = 'pending'
          and request.project_fund_id is null
          and (p_exclude_request_id is null or request.id <> p_exclude_request_id)
      ), 0)
      - coalesce((
        select sum(transaction_row.amount)
        from public.finance_revised_transactions transaction_row
        where transaction_row.organization_id = p_organization_id
          and transaction_row.transaction_kind = 'operating_cash_out'
          and transaction_row.status = 'pending'
      ), 0),
      2
    ), 0)
  end;
$$;

revoke all on function private.production_daily_fund_available(uuid, uuid) from public, anon;
grant execute on function private.production_daily_fund_available(uuid, uuid) to authenticated;

-- New Production payments cannot be reversed through the generic Finance
-- reversal RPC. A trigger also protects against a direct insert bypass.
create or replace function private.prevent_production_payment_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.reversal_of_transaction_id is not null
    and exists (
      select 1
      from public.finance_revised_transactions original
      where original.id = new.reversal_of_transaction_id
        and original.source_production_cash_advance_id is not null
    ) then
    raise exception 'Approved Box Maker payments cannot be reversed';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_production_payment_reversal() from public, anon, authenticated;
drop trigger if exists finance_revised_transactions_block_production_payment_reversal
  on public.finance_revised_transactions;
create trigger finance_revised_transactions_block_production_payment_reversal
before insert or update on public.finance_revised_transactions
for each row execute function private.prevent_production_payment_reversal();

create or replace function public.request_production_cash_advance(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_requested_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_assignment public.production_box_maker_assignments%rowtype;
  v_job public.production_jobs%rowtype;
  v_amount numeric(14,2) := round(coalesce(p_requested_amount, 0), 2);
  v_remaining numeric(14,2);
  v_daily_available numeric(14,2);
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_amount <= 0 then
    raise exception 'Payment request must be greater than zero';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null
    or length(btrim(p_note)) > 2000 then
    raise exception 'A payment remark between 1 and 2000 characters is required';
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));

  select * into v_job
  from public.production_jobs job
  where job.id = v_assignment.production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;

  if exists (
    select 1
    from public.production_cash_advance_requests request
    where request.assignment_id = v_assignment.id
      and request.status = 'pending'
  ) then
    raise exception 'This Box Maker already has a payment request awaiting approval';
  end if;

  v_remaining := round(v_assignment.labor_cost - v_assignment.cash_advance, 2);
  if v_amount > v_remaining + 0.001 then
    raise exception 'Payment cannot exceed the Box Maker balance';
  end if;

  v_daily_available := private.production_daily_fund_available(p_organization_id);
  if v_daily_available + 0.001 < v_amount then
    raise exception 'Daily Fund has insufficient available balance for this payment';
  end if;

  insert into public.production_cash_advance_requests (
    organization_id, production_job_id, assignment_id, project_fund_id,
    requested_amount, request_note, requested_by
  )
  values (
    p_organization_id, v_job.id, v_assignment.id, null,
    v_amount, btrim(p_note), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
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
  v_assignment public.production_box_maker_assignments%rowtype;
  v_fund public.project_funds%rowtype;
  v_amount numeric(14,2) := round(coalesce(p_requested_amount, 0), 2);
  v_new_request_id uuid;
begin
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Payment request not found';
  end if;
  if not private.has_production_operations(v_request.organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_request.requested_by <> (select auth.uid()) then
    raise exception 'Only the original requester can resubmit this payment request';
  end if;
  if v_request.status <> 'needs_revision' then
    raise exception 'Only a payment request marked for revision can be resubmitted';
  end if;
  if exists (
    select 1
    from public.production_cash_advance_requests newer
    where newer.assignment_id = v_request.assignment_id
      and (
        newer.requested_at > v_request.requested_at
        or (newer.requested_at = v_request.requested_at and newer.id > v_request.id)
      )
  ) then
    raise exception 'A newer payment request already exists for this Box Maker';
  end if;

  if v_request.project_fund_id is null then
    return public.request_production_cash_advance(
      v_request.organization_id,
      v_request.assignment_id,
      v_amount,
      p_note
    );
  end if;

  -- Preserve the legacy Project Fund path for historical revision requests.
  if v_amount <= 0 then
    raise exception 'Payment request must be greater than zero';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null
    or length(btrim(p_note)) > 2000 then
    raise exception 'A payment remark between 1 and 2000 characters is required';
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = v_request.assignment_id
    and assignment.organization_id = v_request.organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'needs_revision' then
    raise exception 'Only a payment request marked for revision can be resubmitted';
  end if;
  if exists (
    select 1
    from public.production_cash_advance_requests request
    where request.assignment_id = v_request.assignment_id
      and request.status = 'pending'
  ) then
    raise exception 'This Box Maker already has a payment request awaiting approval';
  end if;
  if v_amount > round(v_assignment.labor_cost - v_assignment.cash_advance, 2) + 0.001 then
    raise exception 'Payment cannot exceed the Box Maker balance';
  end if;

  select * into v_fund
  from public.project_funds fund
  where fund.id = v_request.project_fund_id
    and fund.organization_id = v_request.organization_id
    and fund.status = 'open'
  for update;
  if not found then
    raise exception 'The historical Project Fund is not open';
  end if;

  insert into public.production_cash_advance_requests (
    organization_id, production_job_id, assignment_id, project_fund_id,
    requested_amount, request_note, requested_by
  )
  values (
    v_request.organization_id, v_request.production_job_id, v_request.assignment_id,
    v_request.project_fund_id, v_amount, btrim(p_note), (select auth.uid())
  )
  returning id into v_new_request_id;
  return v_new_request_id;
end;
$$;

drop function if exists public.list_production_cash_advance_requests(uuid);
create function public.list_production_cash_advance_requests(
  p_organization_id uuid
)
returns table (
  id uuid,
  production_job_id uuid,
  assignment_id uuid,
  project_fund_id uuid,
  quotation_no text,
  project_name text,
  project_type text,
  box_maker_name text,
  labor_cost numeric,
  approved_cash_advance numeric,
  box_maker_balance numeric,
  requested_amount numeric,
  approved_amount numeric,
  status text,
  project_fund_available numeric,
  daily_fund_available numeric,
  request_note text,
  decision_note text,
  requested_by uuid,
  requester_name text,
  requested_at timestamptz,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Box Maker payments';
  end if;

  return query
  select
    request.id,
    request.production_job_id,
    request.assignment_id,
    request.project_fund_id,
    quotation.quotation_no,
    coalesce(nullif(btrim(quotation.project_name), ''), quotation.quotation_no),
    quotation.project_types,
    maker.name,
    assignment.labor_cost,
    assignment.cash_advance,
    round(assignment.labor_cost - assignment.cash_advance, 2),
    request.requested_amount,
    request.approved_amount,
    request.status,
    coalesce(fund_totals.available_balance, 0)::numeric(14,2),
    private.production_daily_fund_available(p_organization_id),
    request.request_note,
    request.decision_note,
    request.requested_by,
    coalesce(nullif(btrim(profile.full_name), ''), 'Team member'),
    request.requested_at,
    request.decided_at
  from public.production_cash_advance_requests request
  join public.production_box_maker_assignments assignment
    on assignment.id = request.assignment_id
   and assignment.organization_id = p_organization_id
  join public.production_box_makers maker
    on maker.id = assignment.box_maker_id
   and maker.organization_id = p_organization_id
  join public.production_jobs job
    on job.id = request.production_job_id
   and job.organization_id = p_organization_id
  join public.quotations quotation
    on quotation.id = job.quotation_id
   and quotation.organization_id = p_organization_id
  left join public.profiles profile on profile.id = request.requested_by
  left join lateral (
    select round(coalesce(sum(
      case when entry.direction = 'credit' then entry.amount else -entry.amount end
    ) filter (where not entry.is_voided), 0), 2) as available_balance
    from public.project_fund_entries entry
    where entry.project_fund_id = request.project_fund_id
  ) fund_totals on true
  where request.organization_id = p_organization_id
  order by case when request.status = 'pending' then 0 else 1 end,
    request.requested_at desc,
    request.id desc;
end;
$$;

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
  v_transaction_id uuid;
begin
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Box Maker payment request not found';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Box Maker payments';
  end if;
  if p_decision is null
    or p_decision not in ('approved', 'rejected', 'needs_revision')
    or v_request.status <> 'pending' then
    raise exception 'This payment request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot review your own payment request';
  end if;
  if length(btrim(coalesce(p_decision_note, ''))) > 2000 then
    raise exception 'The decision remark cannot exceed 2000 characters';
  end if;
  if p_decision in ('rejected', 'needs_revision')
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'A decision remark is required';
  end if;

  if p_decision in ('rejected', 'needs_revision') then
    select * into v_request
    from public.production_cash_advance_requests request
    where request.id = p_request_id
    for update;
    if not found or v_request.status <> 'pending' then
      raise exception 'This payment request is no longer awaiting approval';
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

  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'This payment request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot approve your own payment request';
  end if;

  v_amount := round(v_request.requested_amount, 2);
  if v_assignment.cash_advance + v_amount > v_assignment.labor_cost + 0.001 then
    raise exception 'Payment cannot exceed the Box Maker balance';
  end if;

  if v_request.project_fund_id is not null then
    -- Historical requests remain on their original Project Fund.
    select * into v_fund
    from public.project_funds fund
    where fund.id = v_request.project_fund_id
      and fund.organization_id = v_request.organization_id
    for update;
    if not found or v_fund.status <> 'open' then
      raise exception 'The historical Project Fund is not open';
    end if;
    perform pg_advisory_xact_lock(hashtext(v_fund.id::text));
    select round(coalesce(sum(
      case when entry.direction = 'credit' then entry.amount else -entry.amount end
    ) filter (where not entry.is_voided), 0), 2)
    into v_available
    from public.project_fund_entries entry
    where entry.project_fund_id = v_fund.id;
    if v_amount > greatest(v_available, 0) + 0.001 then
      raise exception 'The historical Project Fund has insufficient available balance for this payment';
    end if;
    if exists (
      select 1 from public.project_fund_entries entry
      where entry.source_production_cash_advance_id = v_request.id
        and not entry.is_voided
    ) then
      raise exception 'This historical payment has already been deducted from the Project Fund';
    end if;

    insert into public.project_fund_entries (
      organization_id, project_fund_id, entry_type, direction, amount,
      entry_date, note, source_production_cash_advance_id, created_by
    ) values (
      v_request.organization_id, v_fund.id, 'project_expense', 'debit', v_amount,
      current_date, 'Historical Production Box Maker payment', v_request.id,
      (select auth.uid())
    );
  else
    -- New requests reserve Daily Fund at submission and are checked again at
    -- approval under the organization lock to prevent concurrent overspend.
    perform pg_advisory_xact_lock(hashtext(v_request.organization_id::text));
    v_available := private.production_daily_fund_available(
      v_request.organization_id,
      v_request.id
    );
    if v_available + 0.001 < v_amount then
      raise exception 'Daily Fund has insufficient available balance for this payment';
    end if;
    if exists (
      select 1
      from public.finance_revised_transactions transaction_row
      where transaction_row.source_production_cash_advance_id = v_request.id
    ) then
      raise exception 'This payment has already been posted to the Daily Fund';
    end if;

    insert into public.finance_revised_transactions (
      organization_id,
      transaction_kind,
      amount,
      transaction_date,
      category,
      note,
      source_production_cash_advance_id,
      submitted_by
    )
    values (
      v_request.organization_id,
      'operating_cash_out',
      v_amount,
      current_date,
      'Box Maker Payment - Daily Fund Cash Out',
      v_request.request_note,
      v_request.id,
      v_request.requested_by
    )
    returning id into v_transaction_id;

    perform private.post_finance_revised_transaction_pool_v2(
      v_transaction_id,
      (select auth.uid()),
      nullif(btrim(p_decision_note), '')
    );
  end if;

  update public.production_box_maker_assignments assignment
  set cash_advance = round(assignment.cash_advance + v_amount, 2),
      updated_by = (select auth.uid())
  where assignment.id = v_assignment.id;

  update public.production_cash_advance_requests request
  set status = 'approved',
      approved_amount = v_amount,
      daily_fund_transaction_id = coalesce(v_transaction_id, request.daily_fund_transaction_id),
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(p_decision_note), ''),
      updated_at = now()
  where request.id = v_request.id;
end;
$$;

create or replace function public.get_production_operator_details(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;

  return jsonb_build_object(
    'daily_fund_available', private.production_daily_fund_available(p_organization_id),
    'daily_fund_reserved', coalesce((
      select sum(request.requested_amount)
      from public.production_cash_advance_requests request
      where request.organization_id = p_organization_id
        and request.status = 'pending'
        and request.project_fund_id is null
    ), 0)::numeric(14,2),
    'tiers', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', tier.id, 'tier_number', tier.display_number, 'percentage', tier.percentage)
        order by tier.display_number
      )
      from (
        select tier.id, tier.percentage,
          row_number() over (order by tier.tier_number, tier.created_at, tier.id) as display_number
        from public.production_project_tiers tier
        where tier.organization_id = p_organization_id
          and tier.production_job_id = p_production_job_id
          and tier.is_active
      ) tier
    ), '[]'::jsonb),
    'box_makers', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', maker.id, 'name', maker.name, 'is_active', maker.is_active)
        order by maker.name
      )
      from public.production_box_makers maker
      where maker.organization_id = p_organization_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', assignment.id,
          'box_maker_id', assignment.box_maker_id,
          'box_maker_name', maker.name,
          'tiers', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', assignment_tier.id,
                'tier_number', assignment_tier.tier_number,
                'percentage', assignment_tier.percentage
              ) order by assignment_tier.tier_number
            )
            from public.production_box_maker_assignment_tiers assignment_tier
            where assignment_tier.organization_id = p_organization_id
              and assignment_tier.production_job_id = p_production_job_id
              and assignment_tier.assignment_id = assignment.id
              and assignment_tier.is_active
          ), '[]'::jsonb),
          'labor_cost', assignment.labor_cost,
          'cash_advance', assignment.cash_advance,
          'pending_cash_advance', coalesce((
            select sum(request.requested_amount)
            from public.production_cash_advance_requests request
            where request.assignment_id = assignment.id
              and request.status = 'pending'
          ), 0)::numeric(14,2),
          'balance', round(assignment.labor_cost - assignment.cash_advance, 2),
          'due_date', assignment.due_date
        )
        order by maker.name, assignment.created_at, assignment.id
      )
      from public.production_box_maker_assignments assignment
      join public.production_box_makers maker
        on maker.id = assignment.box_maker_id
       and maker.organization_id = p_organization_id
      where assignment.organization_id = p_organization_id
        and assignment.production_job_id = p_production_job_id
        and assignment.is_active
    ), '[]'::jsonb),
    'cash_advance_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', request.id,
          'assignment_id', request.assignment_id,
          'requested_amount', request.requested_amount,
          'approved_amount', request.approved_amount,
          'status', request.status,
          'request_note', request.request_note,
          'decision_note', request.decision_note,
          'requester_name', coalesce(nullif(btrim(profile.full_name), ''), 'Team member'),
          'requested_at', request.requested_at,
          'decided_at', request.decided_at,
          'payment_date', case when request.status = 'approved' then request.decided_at end,
          'balance_after_payment', case
            when request.status = 'approved' then round(
              assignment.labor_cost - coalesce((
                select sum(coalesce(previous_request.approved_amount, previous_request.requested_amount))
                from public.production_cash_advance_requests previous_request
                where previous_request.assignment_id = request.assignment_id
                  and previous_request.status = 'approved'
                  and (
                    previous_request.decided_at < request.decided_at
                    or (previous_request.decided_at = request.decided_at and previous_request.id <= request.id)
                  )
              ), 0), 2)
            else null
          end
        )
        order by request.requested_at desc, request.id desc
      )
      from public.production_cash_advance_requests request
      join public.production_box_maker_assignments assignment
        on assignment.id = request.assignment_id
      left join public.profiles profile on profile.id = request.requested_by
      where request.organization_id = p_organization_id
        and request.production_job_id = p_production_job_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.request_production_cash_advance(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.request_production_cash_advance(uuid, uuid, numeric, text) to authenticated;
revoke all on function public.resubmit_production_cash_advance(uuid, numeric, text) from public, anon;
grant execute on function public.resubmit_production_cash_advance(uuid, numeric, text) to authenticated;
revoke all on function public.list_production_cash_advance_requests(uuid) from public, anon;
grant execute on function public.list_production_cash_advance_requests(uuid) to authenticated;
revoke all on function public.review_production_cash_advance(uuid, text, text) from public, anon;
grant execute on function public.review_production_cash_advance(uuid, text, text) to authenticated;
revoke all on function public.get_production_operator_details(uuid, uuid) from public, anon;
grant execute on function public.get_production_operator_details(uuid, uuid) to authenticated;

commit;
