begin;

alter table public.finance_account_budget_allocation_events
  drop constraint if exists finance_account_budget_allocation_events_event_type_check;
alter table public.finance_account_budget_allocation_events
  add constraint finance_account_budget_allocation_events_event_type_check
  check (event_type = any (array[
    'allocation'::text,
    'reallocation_out'::text,
    'reallocation_in'::text,
    'month_end_return'::text,
    'funding_request_approval'::text,
    'return_to_pool'::text
  ]));

-- Finance activity is read through one server-authorized result set so GM and
-- Internal Finance see the same columns without exposing the underlying
-- finance tables directly to the browser.
create or replace function private.finance_is_budget_returner(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'internal_finance']
  )
  or private.has_member_capability(p_organization_id, 'internal_finance');
$$;

revoke all on function private.finance_is_budget_returner(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_budget_returner(uuid)
to authenticated;

create or replace function public.return_finance_account_budget(
  p_account_id uuid,
  p_amount numeric,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_period_id uuid;
  v_period public.finance_budget_periods%rowtype;
  v_allocation public.finance_account_budget_allocations%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_consumed numeric;
  v_available numeric;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_budget_returner(v_organization_id) then
    raise exception 'Only the General Manager or Internal Finance can return budget to the pool';
  end if;
  if v_amount <= 0 then
    raise exception 'Return amount must be greater than zero';
  end if;
  if not exists (
    select 1
    from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance account';
  end if;

  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  select * into v_period
  from public.finance_budget_periods
  where id = v_period_id
  for update;

  select * into v_allocation
  from public.finance_account_budget_allocations
  where organization_id = v_organization_id
    and period_id = v_period_id
    and account_id = p_account_id
  for update;
  if not found then
    raise exception 'The selected account has no allocation in this budget period';
  end if;

  v_consumed := private.finance_budget_consumed_amount(
    v_organization_id,
    v_period_id,
    p_account_id
  );
  v_available := round(
    v_allocation.allocated_amount
      - coalesce(v_allocation.returned_amount, 0)
      - v_consumed,
    2
  );
  if v_amount > v_available then
    raise exception 'Only % of unused and uncommitted budget can be returned', greatest(v_available, 0);
  end if;

  update public.finance_account_budget_allocations
  set returned_amount = coalesce(returned_amount, 0) + v_amount,
      updated_by = (select auth.uid())
  where id = v_allocation.id;

  insert into public.finance_account_budget_allocation_events (
    organization_id,
    period_id,
    allocation_id,
    event_type,
    amount,
    previous_amount,
    new_amount,
    from_account_id,
    note,
    created_by
  ) values (
    v_organization_id,
    v_period_id,
    v_allocation.id,
    'return_to_pool',
    v_amount,
    round(v_allocation.allocated_amount - coalesce(v_allocation.returned_amount, 0), 2),
    round(v_allocation.allocated_amount - coalesce(v_allocation.returned_amount, 0) - v_amount, 2),
    p_account_id,
    null,
    (select auth.uid())
  );

  return v_allocation.id;
end;
$$;

revoke all on function public.return_finance_account_budget(uuid, numeric, uuid)
from public, anon;
grant execute on function public.return_finance_account_budget(uuid, numeric, uuid)
to authenticated;

-- Returned funds reduce the effective allocation while preserving the original
-- allocation and its immutable event history.
create or replace function private.finance_budget_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_external boolean := private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id);
  v_budgeted boolean;
  v_period_id uuid;
  v_allocation public.finance_account_budget_allocations%rowtype;
  v_legacy_budget public.finance_budget_requests%rowtype;
  v_consumed numeric;
  v_legacy_committed numeric;
  v_amount numeric;
  v_available numeric;
begin
  if tg_op = 'UPDATE'
    and old.budget_request_id is not null
    and old.organization_id = new.organization_id
    and old.transaction_type = 'expense'
    and new.transaction_type = 'expense'
    and old.budget_period_id is null
    and old.account_budget_allocation_id is null
    and new.budget_period_id is null
    and new.account_budget_allocation_id is null then
    select * into v_legacy_budget
    from public.finance_budget_requests request
    where request.id = old.budget_request_id
    for update;
    if not found or v_legacy_budget.organization_id is distinct from new.organization_id then
      raise exception 'The selected legacy budget request does not belong to this workspace';
    end if;
    if v_legacy_budget.status <> 'approved' then
      raise exception 'Only an approved legacy budget request can be used for Money Out';
    end if;
    select coalesce(sum(transaction.amount), 0)
    into v_legacy_committed
    from public.finance_transactions transaction
    where transaction.organization_id = new.organization_id
      and transaction.budget_request_id = new.budget_request_id
      and transaction.id is distinct from new.id
      and transaction.transaction_type = 'expense'
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'cancelled');
    v_amount := case when coalesce(new.is_voided, false) then 0 else round(coalesce(new.amount, 0), 2) end;
    if round(v_legacy_committed + v_amount, 2) > round(v_legacy_budget.amount, 2) then
      raise exception 'This expense exceeds the remaining approved legacy budget of %',
        round(greatest(v_legacy_budget.amount - v_legacy_committed, 0), 2);
    end if;
    return new;
  end if;

  v_budgeted := v_external or new.budget_period_id is not null;
  if tg_op = 'UPDATE' then
    v_budgeted := v_budgeted
      or old.budget_period_id is not null
      or old.account_budget_allocation_id is not null;
  end if;
  if not v_budgeted or new.transaction_type <> 'expense' then
    return new;
  end if;
  if new.account_id is null then
    raise exception 'Choose an active Finance account with available budget';
  end if;
  if tg_op = 'UPDATE' and old.budget_period_id is not null then
    v_period_id := old.budget_period_id;
  else
    v_period_id := private.ensure_finance_budget_period(new.organization_id);
  end if;
  select allocation.* into v_allocation
  from public.finance_account_budget_allocations allocation
  join public.finance_accounts account
    on account.id = allocation.account_id
   and account.organization_id = allocation.organization_id
   and account.is_active
  where allocation.organization_id = new.organization_id
    and allocation.period_id = v_period_id
    and allocation.account_id = new.account_id
  for update;
  if not found then
    raise exception 'This account has no available budget';
  end if;
  v_consumed := private.finance_budget_consumed_amount(
    new.organization_id, v_period_id, new.account_id, new.id
  );
  v_amount := case
    when new.is_voided
      or new.approval_status in ('rejected', 'revision_requested', 'cancelled')
      then 0
    else round(coalesce(new.amount, 0), 2)
  end;
  v_available := round(
    v_allocation.allocated_amount
      - coalesce(v_allocation.returned_amount, 0)
      - v_consumed,
    2
  );
  if round(v_amount, 2) > v_available then
    raise exception 'This account has no available budget for this expense';
  end if;
  new.budget_period_id := v_period_id;
  new.account_budget_allocation_id := v_allocation.id;
  return new;
end;
$$;

-- Existing allocation and reallocation operations must use net allocations so
-- returned funds become available in the pool again.
create or replace function public.allocate_finance_account_budget(
  p_account_id uuid,
  p_amount numeric,
  p_note text default null,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_period_id uuid;
  v_period public.finance_budget_periods%rowtype;
  v_allocation public.finance_account_budget_allocations%rowtype;
  v_granted numeric;
  v_distributed numeric;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_previous_amount numeric := 0;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_budget_operator(v_organization_id) then
    raise exception 'Only Internal Finance can distribute the approved budget';
  end if;
  if v_amount <= 0 then
    raise exception 'Allocation amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance account';
  end if;
  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  select * into v_period from public.finance_budget_periods where id = v_period_id for update;
  select coalesce(sum(amount), 0) into v_granted
  from public.finance_budget_grants where period_id = v_period_id;
  select coalesce(sum(allocated_amount - coalesce(returned_amount, 0)), 0) into v_distributed
  from public.finance_account_budget_allocations where period_id = v_period_id;
  if round(v_distributed + v_amount, 2) > round(v_granted, 2) then
    raise exception 'The allocation exceeds the undistributed GM budget of %', round(greatest(v_granted - v_distributed, 0), 2);
  end if;

  select * into v_allocation
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_account_id
  for update;
  if found then
    v_previous_amount := v_allocation.allocated_amount - coalesce(v_allocation.returned_amount, 0);
    update public.finance_account_budget_allocations
    set allocated_amount = allocated_amount + v_amount,
        updated_by = (select auth.uid())
    where id = v_allocation.id;
  else
    insert into public.finance_account_budget_allocations (
      organization_id, period_id, account_id, allocated_amount,
      created_by, updated_by
    ) values (
      v_organization_id, v_period_id, p_account_id, v_amount,
      (select auth.uid()), (select auth.uid())
    ) returning * into v_allocation;
  end if;
  insert into public.finance_account_budget_allocation_events (
    organization_id, period_id, allocation_id, event_type, amount,
    previous_amount, new_amount, note, created_by
  ) values (
    v_organization_id, v_period_id, v_allocation.id, 'allocation', v_amount,
    v_previous_amount, v_previous_amount + v_amount,
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  );
  return v_allocation.id;
end;
$$;

create or replace function public.reallocate_finance_account_budget(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_note text default null,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_period_id uuid;
  v_source public.finance_account_budget_allocations%rowtype;
  v_target public.finance_account_budget_allocations%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_source_available numeric;
  v_target_previous numeric;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_budget_operator(v_organization_id) then
    raise exception 'Only Internal Finance can reallocate the budget';
  end if;
  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    raise exception 'Choose two different Finance accounts';
  end if;
  if v_amount <= 0 then
    raise exception 'Reallocation amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_to_account_id
      and account.organization_id = v_organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active destination Finance account';
  end if;
  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  perform 1 from public.finance_budget_periods where id = v_period_id for update;
  select * into v_source
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_from_account_id
  for update;
  if not found then
    raise exception 'The source account has no allocation in this budget period';
  end if;
  v_source_available := v_source.allocated_amount
    - coalesce(v_source.returned_amount, 0)
    - private.finance_budget_consumed_amount(v_organization_id, v_period_id, p_from_account_id);
  if v_amount > v_source_available then
    raise exception 'Only % of unused budget can be reallocated from the source account', round(greatest(v_source_available, 0), 2);
  end if;

  select * into v_target
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_to_account_id
  for update;
  v_target_previous := coalesce(v_target.allocated_amount, 0) - coalesce(v_target.returned_amount, 0);
  if found then
    update public.finance_account_budget_allocations
    set allocated_amount = allocated_amount + v_amount,
        updated_by = (select auth.uid())
    where id = v_target.id;
  else
    insert into public.finance_account_budget_allocations (
      organization_id, period_id, account_id, allocated_amount,
      created_by, updated_by
    ) values (
      v_organization_id, v_period_id, p_to_account_id, v_amount,
      (select auth.uid()), (select auth.uid())
    ) returning * into v_target;
  end if;
  update public.finance_account_budget_allocations
  set allocated_amount = allocated_amount - v_amount,
      updated_by = (select auth.uid())
  where id = v_source.id;

  insert into public.finance_account_budget_allocation_events (
    organization_id, period_id, allocation_id, event_type, amount,
    previous_amount, new_amount, from_account_id, to_account_id, note, created_by
  ) values (
    v_organization_id, v_period_id, v_source.id, 'reallocation_out', v_amount,
    v_source.allocated_amount - coalesce(v_source.returned_amount, 0),
    v_source.allocated_amount - coalesce(v_source.returned_amount, 0) - v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ), (
    v_organization_id, v_period_id, v_target.id, 'reallocation_in', v_amount,
    v_target_previous, v_target_previous + v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  );
  return v_target.id;
end;
$$;

create or replace function private.finance_account_budget_summary_rows()
returns table (
  organization_id uuid,
  id uuid,
  period_id uuid,
  period_start date,
  period_end date,
  period_status text,
  account_id uuid,
  account_name text,
  is_active boolean,
  allocated_amount numeric(14,2),
  returned_amount numeric(14,2),
  used_amount numeric,
  committed_amount numeric,
  available_amount numeric
)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select
    allocation.organization_id,
    allocation.id,
    allocation.period_id,
    period.period_start,
    period.period_end,
    period.status::text,
    allocation.account_id,
    account.account_name,
    account.is_active,
    allocation.allocated_amount,
    allocation.returned_amount,
    round(coalesce(sum(case
      when transaction.id is not null and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and transaction.payment_status = 'paid'
        and transaction.approval_status = 'approved'
      then transaction.amount else 0 end), 0), 2),
    round(coalesce(sum(case
      when transaction.id is not null and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')
      then transaction.amount else 0 end), 0), 2),
    round(greatest(
      allocation.allocated_amount - coalesce(allocation.returned_amount, 0)
      - coalesce(sum(case
          when transaction.id is not null and not transaction.is_voided
            and transaction.transaction_type = 'expense'
            and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          then transaction.amount else 0 end), 0),
      0
    ), 2)
  from public.finance_account_budget_allocations as allocation
  join public.finance_budget_periods as period on period.id = allocation.period_id
  join public.finance_accounts as account on account.id = allocation.account_id
  left join public.finance_transactions as transaction
    on transaction.account_budget_allocation_id = allocation.id
  where private.finance_is_budget_viewer(allocation.organization_id)
  group by allocation.organization_id, allocation.id, allocation.period_id,
    period.period_start, period.period_end, period.status, allocation.account_id,
    account.account_name, account.is_active, allocation.allocated_amount,
    allocation.returned_amount;
$$;

create or replace function public.get_finance_budget_snapshot(
  p_organization_id uuid
)
returns table(
  period_id uuid,
  period_start date,
  period_end date,
  period_status text,
  total_granted numeric,
  total_allocated numeric,
  undistributed numeric,
  used_amount numeric,
  committed_amount numeric,
  remaining_amount numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_period_id uuid;
begin
  if p_organization_id is null or not private.finance_is_budget_viewer(p_organization_id) then
    raise exception 'Only the General Manager or Internal Finance can view the budget pool';
  end if;
  v_period_id := private.ensure_finance_budget_period(p_organization_id);
  return query
  select
    period.id,
    period.period_start,
    period.period_end,
    period.status,
    round(coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0), 2),
    round(coalesce((select sum(allocation.allocated_amount - coalesce(allocation.returned_amount, 0)) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0), 2),
    round(greatest(
      coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0)
      - coalesce((select sum(allocation.allocated_amount - coalesce(allocation.returned_amount, 0)) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0),
      0
    ), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and transaction.payment_status = 'paid' and transaction.approval_status = 'approved'), 0), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')), 0), 2),
    round(greatest(
      coalesce((select sum(allocation.allocated_amount - coalesce(allocation.returned_amount, 0)) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0)
      - coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')), 0),
      0
    ), 2)
  from public.finance_budget_periods period
  where period.id = v_period_id;
end;
$$;

create or replace function public.get_finance_activity_history(
  p_organization_id uuid
)
returns table(
  id uuid,
  activity_at timestamptz,
  activity text,
  status text,
  amount numeric,
  source_account text,
  destination_account text,
  performed_by text
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null or not private.finance_is_budget_viewer(p_organization_id) then
    raise exception 'Only the General Manager or Internal Finance can view Finance activity history';
  end if;

  return query
  select grant_row.id, grant_row.granted_at,
    case when grant_row.grant_type = 'initial' then 'Budget top-up' else 'Budget top-up' end,
    grant_row.grant_type, grant_row.amount, null::text, null::text,
    coalesce(profile.full_name, '—')
  from public.finance_budget_grants grant_row
  left join public.profiles profile on profile.id = grant_row.granted_by
  where grant_row.organization_id = p_organization_id

  union all

  select event.id, event.created_at,
    case event.event_type
      when 'allocation' then 'Budget allocation'
      when 'reallocation_out' then 'Budget reallocation out'
      when 'reallocation_in' then 'Budget reallocation in'
      when 'return_to_pool' then 'Budget returned to pool'
      else 'Budget allocation activity'
    end,
    'completed', event.amount,
    from_account.account_name, to_account.account_name,
    coalesce(profile.full_name, '—')
  from public.finance_account_budget_allocation_events event
  left join public.finance_accounts from_account on from_account.id = event.from_account_id
  left join public.finance_accounts to_account on to_account.id = event.to_account_id
  left join public.profiles profile on profile.id = event.created_by
  where event.organization_id = p_organization_id

  union all

  select transaction.id, transaction.updated_at,
    case when transaction.transaction_type = 'income' then 'Cash In' else 'Cash Out' end,
    case
      when transaction.is_voided then 'voided'
      when transaction.transaction_type = 'income' then coalesce(nullif(transaction.income_review_status, 'none'), transaction.payment_status)
      when transaction.payment_status = 'paid' and transaction.approval_status = 'approved' then 'paid'
      else transaction.approval_status
    end,
    transaction.amount, account.account_name, null::text,
    coalesce(paid_profile.full_name, approved_profile.full_name, submitted_profile.full_name, '—')
  from public.finance_transactions transaction
  left join public.finance_accounts account on account.id = transaction.account_id
  left join public.profiles paid_profile on paid_profile.id = transaction.paid_by
  left join public.profiles approved_profile on approved_profile.id = transaction.approved_by
  left join public.profiles submitted_profile on submitted_profile.id = transaction.submitted_by
  where transaction.organization_id = p_organization_id

  union all

  select request.id, coalesce(request.decided_at, request.requested_at),
    'Account funding request', request.status,
    coalesce(request.approved_amount, request.requested_amount),
    account.account_name, null::text,
    coalesce(decider.full_name, requester.full_name, '—')
  from public.finance_account_funding_requests request
  left join public.finance_accounts account on account.id = request.account_id
  left join public.profiles decider on decider.id = request.decided_by
  left join public.profiles requester on requester.id = request.requested_by
  where request.organization_id = p_organization_id

  union all

  select log.id, log.created_at, 'Commission activity', log.action,
    coalesce(nullif(log.after_data->>'sales_commission_markup_amount', '')::numeric, 0)
      + coalesce(nullif(log.after_data->>'va_commission_markup_amount', '')::numeric, 0),
    null::text, null::text, coalesce(profile.full_name, '—')
  from public.activity_log log
  left join public.profiles profile on profile.id = log.actor_id
  where log.organization_id = p_organization_id
    and log.resource_type = 'commission_summary';
end;
$$;

revoke all on function public.get_finance_activity_history(uuid) from public, anon;
grant execute on function public.get_finance_activity_history(uuid) to authenticated;

-- The GM dashboard reads the shared KPI function rather than the Finance page
-- snapshot. Wrap its existing result so returned allocations also reduce the
-- displayed distributed amount, available cash, and account balances.
alter function public.shared_kpi_finance_dashboard(uuid, date)
  rename to shared_kpi_finance_dashboard_legacy;

revoke all on function public.shared_kpi_finance_dashboard_legacy(uuid, date)
from public, anon, authenticated;

create or replace function public.shared_kpi_finance_dashboard(
  p_organization_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_result jsonb;
  v_returned numeric := 0;
  v_account_balances jsonb := '[]'::jsonb;
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Not authorized for GM Finance dashboard';
  end if;

  v_result := public.shared_kpi_finance_dashboard_legacy(p_organization_id, p_month);

  select coalesce(sum(allocation.returned_amount), 0)
  into v_returned
  from public.finance_account_budget_allocations allocation
  join public.finance_budget_periods period on period.id = allocation.period_id
  where allocation.organization_id = p_organization_id
    and period.period_start = v_month_start
    and period.status = 'open';

  v_result := jsonb_set(
    v_result,
    '{budget_allocated}',
    to_jsonb(round(greatest(coalesce((v_result->>'budget_allocated')::numeric, 0) - v_returned, 0), 2)),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{budget_remaining}',
    to_jsonb(round(greatest(coalesce((v_result->>'budget_granted')::numeric, 0) - coalesce((v_result->>'budget_allocated')::numeric, 0), 0), 2)),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{available_cash}',
    to_jsonb(round(greatest(coalesce((v_result->>'available_cash')::numeric, 0) - v_returned, 0), 2)),
    true
  );

  with account_balances as (
    select
      account.account_name,
      round(
        account.opening_balance
        + coalesce((
          select sum(funding.amount)
          from public.finance_account_funding_entries funding
          where funding.organization_id = account.organization_id
            and funding.account_id = account.id
            and not funding.is_voided
        ), 0)
        + coalesce((
          select sum(allocation.allocated_amount - coalesce(allocation.returned_amount, 0))
          from public.finance_account_budget_allocations allocation
          join public.finance_budget_periods period on period.id = allocation.period_id
          where allocation.organization_id = account.organization_id
            and allocation.account_id = account.id
            and period.status = 'open'
            and period.period_start = v_month_start
        ), 0)
        + coalesce((
          select sum(
            case
              when entry.transaction_type = 'income'
                and entry.payment_status = 'paid'
                and entry.approval_status = 'not_required'
                then entry.amount
              when entry.transaction_type = 'expense'
                and entry.payment_status = 'paid'
                and entry.approval_status = 'approved'
                then -entry.amount
              else 0
            end
          )
          from public.finance_transactions entry
          where entry.organization_id = account.organization_id
            and entry.account_id = account.id
            and not entry.is_voided
        ), 0),
        2
      ) as current_balance
    from public.finance_accounts account
    where account.organization_id = p_organization_id
      and account.is_active
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'account_name', account_name,
      'current_balance', current_balance
    ) order by current_balance desc, account_name
  ), '[]'::jsonb)
  into v_account_balances
  from account_balances;

  return jsonb_set(v_result, '{account_balances}', v_account_balances, true);
end;
$$;

revoke all on function public.shared_kpi_finance_dashboard(uuid, date)
from public, anon;
grant execute on function public.shared_kpi_finance_dashboard(uuid, date)
to authenticated;

commit;
