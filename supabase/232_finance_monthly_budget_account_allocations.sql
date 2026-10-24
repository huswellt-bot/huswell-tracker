-- Replace the old personal External Finance budget pool with a monthly
-- General Manager spending-limit pool distributed by Internal Finance.
-- Budget allocations are limits only; actual account cash remains in the
-- existing finance_account_funding_entries / finance_account_balances flow.
-- Run after 231_finance_project_expense_limits.sql and before the matching
-- Finance workspace update. Safe to re-run.

begin;

create table if not exists public.finance_budget_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists finance_budget_periods_org_start_idx
  on public.finance_budget_periods(organization_id, period_start);

create table if not exists public.finance_budget_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.finance_budget_periods(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  grant_type text not null default 'top_up' check (grant_type in ('initial', 'top_up')),
  note text,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists finance_budget_grants_period_idx
  on public.finance_budget_grants(organization_id, period_id, granted_at desc);

create table if not exists public.finance_account_budget_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.finance_budget_periods(id) on delete restrict,
  account_id uuid not null references public.finance_accounts(id) on delete restrict,
  allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0),
  returned_amount numeric(14,2) not null default 0 check (returned_amount >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, account_id)
);
create index if not exists finance_account_budget_allocations_org_period_idx
  on public.finance_account_budget_allocations(organization_id, period_id, account_id);

create table if not exists public.finance_account_funding_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.finance_budget_periods(id) on delete restrict,
  account_id uuid not null references public.finance_accounts(id) on delete restrict,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  approved_amount numeric(14,2) check (approved_amount is null or approved_amount > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revision_requested', 'cancelled')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or approved_amount <= requested_amount)
);
create index if not exists finance_account_funding_requests_org_status_idx
  on public.finance_account_funding_requests(organization_id, period_id, status, requested_at desc);

create table if not exists public.finance_account_budget_allocation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.finance_budget_periods(id) on delete restrict,
  allocation_id uuid not null references public.finance_account_budget_allocations(id) on delete restrict,
  funding_request_id uuid references public.finance_account_funding_requests(id) on delete set null,
  event_type text not null check (event_type in ('allocation', 'reallocation_out', 'reallocation_in', 'month_end_return', 'funding_request_approval')),
  amount numeric(14,2) not null check (amount > 0),
  previous_amount numeric(14,2) not null check (previous_amount >= 0),
  new_amount numeric(14,2) not null check (new_amount >= 0),
  from_account_id uuid references public.finance_accounts(id) on delete set null,
  to_account_id uuid references public.finance_accounts(id) on delete set null,
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists finance_account_budget_allocation_events_period_idx
  on public.finance_account_budget_allocation_events(organization_id, period_id, created_at desc);

alter table public.finance_transactions
  add column if not exists budget_period_id uuid references public.finance_budget_periods(id) on delete restrict,
  add column if not exists account_budget_allocation_id uuid references public.finance_account_budget_allocations(id) on delete restrict;
create index if not exists finance_transactions_budget_period_account_idx
  on public.finance_transactions(organization_id, budget_period_id, account_id)
  where budget_period_id is not null;
create index if not exists finance_transactions_account_budget_allocation_idx
  on public.finance_transactions(account_budget_allocation_id)
  where account_budget_allocation_id is not null;

drop trigger if exists finance_budget_periods_updated_at on public.finance_budget_periods;
create trigger finance_budget_periods_updated_at
before update on public.finance_budget_periods
for each row execute function public.set_updated_at();
drop trigger if exists finance_account_budget_allocations_updated_at on public.finance_account_budget_allocations;
create trigger finance_account_budget_allocations_updated_at
before update on public.finance_account_budget_allocations
for each row execute function public.set_updated_at();
drop trigger if exists finance_account_funding_requests_updated_at on public.finance_account_funding_requests;
create trigger finance_account_funding_requests_updated_at
before update on public.finance_account_funding_requests
for each row execute function public.set_updated_at();

alter table public.finance_budget_periods enable row level security;
alter table public.finance_budget_grants enable row level security;
alter table public.finance_account_budget_allocations enable row level security;
alter table public.finance_account_funding_requests enable row level security;
alter table public.finance_account_budget_allocation_events enable row level security;

revoke all on public.finance_budget_periods,
  public.finance_budget_grants,
  public.finance_account_budget_allocations,
  public.finance_account_funding_requests,
  public.finance_account_budget_allocation_events
from anon, authenticated;
grant select on public.finance_budget_periods,
  public.finance_budget_grants,
  public.finance_account_budget_allocations,
  public.finance_account_funding_requests,
  public.finance_account_budget_allocation_events
to authenticated;

drop policy if exists "finance budget periods: internal read" on public.finance_budget_periods;
create policy "finance budget periods: internal read"
on public.finance_budget_periods for select to authenticated
using (private.finance_is_internal(organization_id));

drop policy if exists "finance budget grants: internal read" on public.finance_budget_grants;
create policy "finance budget grants: internal read"
on public.finance_budget_grants for select to authenticated
using (private.finance_is_internal(organization_id));

drop policy if exists "finance account allocations: internal read" on public.finance_account_budget_allocations;
create policy "finance account allocations: internal read"
on public.finance_account_budget_allocations for select to authenticated
using (private.finance_is_internal(organization_id));

drop policy if exists "finance account funding requests: requester or internal read"
  on public.finance_account_funding_requests;
create policy "finance account funding requests: requester or internal read"
on public.finance_account_funding_requests for select to authenticated
using (
  requested_by = (select auth.uid())
  or private.finance_is_internal(organization_id)
);

drop policy if exists "finance allocation events: internal read" on public.finance_account_budget_allocation_events;
create policy "finance allocation events: internal read"
on public.finance_account_budget_allocation_events for select to authenticated
using (private.finance_is_internal(organization_id));

create or replace view public.finance_account_budget_summary
with (security_invoker = true)
as
select
  allocation.organization_id,
  allocation.id,
  allocation.period_id,
  period.period_start,
  period.period_end,
  period.status as period_status,
  allocation.account_id,
  account.account_name,
  account.is_active,
  allocation.allocated_amount,
  allocation.returned_amount,
  round(coalesce(sum(
    case
      when transaction.id is not null
        and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and transaction.payment_status = 'paid'
        and transaction.approval_status = 'approved'
        then transaction.amount
      else 0
    end
  ), 0), 2) as used_amount,
  round(coalesce(sum(
    case
      when transaction.id is not null
        and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')
        then transaction.amount
      else 0
    end
  ), 0), 2) as committed_amount,
  round(greatest(
    allocation.allocated_amount - coalesce(sum(
      case
        when transaction.id is not null
          and not transaction.is_voided
          and transaction.transaction_type = 'expense'
          and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          then transaction.amount
        else 0
      end
    ), 0),
    0
  ), 2) as available_amount
from public.finance_account_budget_allocations allocation
join public.finance_budget_periods period on period.id = allocation.period_id
join public.finance_accounts account on account.id = allocation.account_id
left join public.finance_transactions transaction
  on transaction.account_budget_allocation_id = allocation.id
group by allocation.organization_id, allocation.id, allocation.period_id,
  period.period_start, period.period_end, period.status, allocation.account_id,
  account.account_name, account.is_active, allocation.allocated_amount,
  allocation.returned_amount;
revoke all on public.finance_account_budget_summary from anon, authenticated;
grant select on public.finance_account_budget_summary to authenticated;

create or replace function private.finance_budget_period_start()
returns date
language sql
stable
set search_path = public, private
as $$
  select date_trunc('month', timezone('Asia/Manila', now()))::date;
$$;

create or replace function private.finance_budget_period_end(p_period_start date)
returns date
language sql
immutable
set search_path = public, private
as $$
  select (p_period_start + interval '1 month - 1 day')::date;
$$;

create or replace function private.finance_budget_consumed_amount(
  p_organization_id uuid,
  p_period_id uuid,
  p_account_id uuid,
  p_exclude_transaction_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select round(coalesce(sum(transaction.amount), 0), 2)
  from public.finance_transactions transaction
  where transaction.organization_id = p_organization_id
    and transaction.budget_period_id = p_period_id
    and transaction.account_id = p_account_id
    and transaction.id is distinct from p_exclude_transaction_id
    and not transaction.is_voided
    and transaction.transaction_type = 'expense'
    and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled');
$$;

create or replace function private.close_finance_budget_period(
  p_period_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_period public.finance_budget_periods%rowtype;
  v_allocation public.finance_account_budget_allocations%rowtype;
  v_consumed numeric;
  v_return numeric;
begin
  select * into v_period
  from public.finance_budget_periods
  where id = p_period_id
  for update;
  if not found or v_period.status = 'closed' then
    return;
  end if;

  for v_allocation in
    select *
    from public.finance_account_budget_allocations
    where period_id = v_period.id
    order by id
    for update
  loop
    v_consumed := private.finance_budget_consumed_amount(
      v_allocation.organization_id,
      v_allocation.period_id,
      v_allocation.account_id
    );
    v_return := round(greatest(v_allocation.allocated_amount - v_consumed, 0), 2);
    if v_return > 0 then
      update public.finance_account_budget_allocations
      set allocated_amount = allocated_amount - v_return,
          returned_amount = returned_amount + v_return,
          updated_by = p_actor_id
      where id = v_allocation.id;

      insert into public.finance_account_budget_allocation_events (
        organization_id, period_id, allocation_id, event_type, amount,
        previous_amount, new_amount, note, created_by
      ) values (
        v_allocation.organization_id, v_allocation.period_id, v_allocation.id,
        'month_end_return', v_return, v_allocation.allocated_amount,
        v_allocation.allocated_amount - v_return,
        'Unused account allocation: return to the undistributed pool at month end.',
        p_actor_id
      );
    end if;
  end loop;

  update public.finance_budget_periods
  set status = 'closed', closed_by = p_actor_id, closed_at = now()
  where id = v_period.id;
end;
$$;

create or replace function private.ensure_finance_budget_period(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_period_start date := private.finance_budget_period_start();
  v_period public.finance_budget_periods%rowtype;
  v_period_id uuid;
begin
  if p_organization_id is null then
    raise exception 'Finance organization is required';
  end if;

  for v_period in
    select *
    from public.finance_budget_periods
    where organization_id = p_organization_id
      and status = 'open'
      and period_end < v_period_start
    order by period_start
    for update
  loop
    perform private.close_finance_budget_period(v_period.id, coalesce((select auth.uid()), v_period.created_by));
  end loop;

  insert into public.finance_budget_periods (
    organization_id, period_start, period_end, created_by
  ) values (
    p_organization_id, v_period_start, private.finance_budget_period_end(v_period_start),
    coalesce((select auth.uid()), (select created_by from public.finance_budget_periods where organization_id = p_organization_id order by created_at limit 1))
  )
  on conflict (organization_id, period_start) do nothing
  returning id into v_period_id;

  if v_period_id is null then
    select id into v_period_id
    from public.finance_budget_periods
    where organization_id = p_organization_id and period_start = v_period_start;
  end if;
  select * into v_period from public.finance_budget_periods where id = v_period_id;
  if v_period.status <> 'open' then
    raise exception 'The current Finance budget period is closed';
  end if;
  return v_period_id;
end;
$$;

revoke all on function private.finance_budget_period_start(),
  private.finance_budget_period_end(date),
  private.finance_budget_consumed_amount(uuid, uuid, uuid, uuid),
  private.close_finance_budget_period(uuid, uuid),
  private.ensure_finance_budget_period(uuid)
from public, authenticated;

create or replace function private.finance_is_budget_operator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array[
    'accountant', 'internal_finance'
  ]);
$$;

revoke all on function private.finance_is_budget_operator(uuid) from public, anon, authenticated;

create or replace function public.get_finance_budget_snapshot(
  p_organization_id uuid
)
returns table (
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
  if p_organization_id is null or not private.finance_is_internal(p_organization_id) then
    raise exception 'Only Internal Finance can view the budget pool';
  end if;
  v_period_id := private.ensure_finance_budget_period(p_organization_id);
  return query
  select
    period.id,
    period.period_start,
    period.period_end,
    period.status,
    round(coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0), 2),
    round(coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0), 2),
    round(greatest(
      coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0)
      - coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0),
      0
    ), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and transaction.payment_status = 'paid' and transaction.approval_status = 'approved'), 0), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')), 0), 2),
    round(greatest(
      coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0)
      - coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')), 0),
      0
    ), 2)
  from public.finance_budget_periods period
  where period.id = v_period_id;
end;
$$;
revoke all on function public.get_finance_budget_snapshot(uuid) from public;
grant execute on function public.get_finance_budget_snapshot(uuid) to authenticated;

create or replace function public.list_finance_funding_request_accounts(
  p_organization_id uuid
)
returns table (id uuid, account_name text, is_active boolean)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array[
      'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
    ]) then
    raise exception 'You are not authorized to view Finance accounts';
  end if;
  return query
  select account.id, account.account_name, account.is_active
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;
revoke all on function public.list_finance_funding_request_accounts(uuid) from public;
grant execute on function public.list_finance_funding_request_accounts(uuid) to authenticated;

create or replace function public.list_finance_expense_accounts(
  p_organization_id uuid
)
returns table (id uuid, account_name text, is_active boolean)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_period_id uuid;
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array['external_finance'])
    or private.finance_is_internal(p_organization_id) then
    raise exception 'Only External Finance can view available Cash Out accounts';
  end if;
  v_period_id := private.ensure_finance_budget_period(p_organization_id);
  return query
  select account.id, account.account_name, account.is_active
  from public.finance_accounts account
  join public.finance_account_budget_allocations allocation
    on allocation.account_id = account.id
   and allocation.period_id = v_period_id
  where account.organization_id = p_organization_id
    and account.is_active
    and allocation.allocated_amount - private.finance_budget_consumed_amount(
      p_organization_id, v_period_id, account.id
    ) > 0
  order by account.account_name, account.id;
end;
$$;
revoke all on function public.list_finance_expense_accounts(uuid) from public;
grant execute on function public.list_finance_expense_accounts(uuid) to authenticated;

drop function if exists public.create_finance_budget_grant(numeric, text, text);
create or replace function public.create_finance_budget_grant(
  p_amount numeric,
  p_grant_type text default 'top_up',
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
  v_id uuid;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null
    or not private.has_text_role(v_organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can add an approved budget';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Budget amount must be greater than zero';
  end if;
  if p_grant_type not in ('initial', 'top_up') then
    raise exception 'Choose an initial budget or a top-up';
  end if;
  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  insert into public.finance_budget_grants (
    organization_id, period_id, amount, grant_type, note, granted_by
  ) values (
    v_organization_id, v_period_id, round(p_amount, 2), p_grant_type,
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_finance_budget_grant(numeric, text, text, uuid) from public;
grant execute on function public.create_finance_budget_grant(numeric, text, text, uuid) to authenticated;

drop function if exists public.allocate_finance_account_budget(uuid, numeric, text);
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
  from public.finance_budget_grants
  where period_id = v_period_id;
  select coalesce(sum(allocated_amount), 0) into v_distributed
  from public.finance_account_budget_allocations
  where period_id = v_period_id;
  if round(v_distributed + v_amount, 2) > round(v_granted, 2) then
    raise exception 'The allocation exceeds the undistributed GM budget of %', round(greatest(v_granted - v_distributed, 0), 2);
  end if;

  select * into v_allocation
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_account_id
  for update;
  if found then
    v_previous_amount := v_allocation.allocated_amount;
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
    v_previous_amount,
    v_previous_amount + v_amount,
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  );
  return v_allocation.id;
end;
$$;
revoke all on function public.allocate_finance_account_budget(uuid, numeric, text, uuid) from public;
grant execute on function public.allocate_finance_account_budget(uuid, numeric, text, uuid) to authenticated;

drop function if exists public.reallocate_finance_account_budget(uuid, uuid, numeric, text);
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
  select * into v_source
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_from_account_id
  for update;
  if not found then
    raise exception 'The source account has no allocation in this budget period';
  end if;
  v_source_available := v_source.allocated_amount - private.finance_budget_consumed_amount(
    v_organization_id, v_period_id, p_from_account_id
  );
  if v_amount > v_source_available then
    raise exception 'Only % of unused budget can be reallocated from the source account', round(greatest(v_source_available, 0), 2);
  end if;

  select * into v_target
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_to_account_id
  for update;
  v_target_previous := coalesce(v_target.allocated_amount, 0);
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
    v_source.allocated_amount, v_source.allocated_amount - v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ), (
    v_organization_id, v_period_id, v_target.id, 'reallocation_in', v_amount,
    v_target_previous, v_target_previous + v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  );
  return v_target.id;
end;
$$;
revoke all on function public.reallocate_finance_account_budget(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.reallocate_finance_account_budget(uuid, uuid, numeric, text, uuid) to authenticated;

drop function if exists public.create_finance_account_funding_request(uuid, numeric, text);
create or replace function public.create_finance_account_funding_request(
  p_account_id uuid,
  p_requested_amount numeric,
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
  v_id uuid;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null
    or not private.has_text_role(v_organization_id, array['external_finance'])
    or private.finance_is_internal(v_organization_id) then
    raise exception 'Only External Finance can request account funding';
  end if;
  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'Funding request amount must be greater than zero';
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
  insert into public.finance_account_funding_requests (
    organization_id, period_id, account_id, requested_amount, note, requested_by
  ) values (
    v_organization_id, v_period_id, p_account_id, round(p_requested_amount, 2),
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_finance_account_funding_request(uuid, numeric, text, uuid) from public;
grant execute on function public.create_finance_account_funding_request(uuid, numeric, text, uuid) to authenticated;

drop function if exists public.resubmit_finance_account_funding_request(uuid, uuid, numeric, text);
create or replace function public.resubmit_finance_account_funding_request(
  p_request_id uuid,
  p_account_id uuid,
  p_requested_amount numeric,
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
  v_request public.finance_account_funding_requests%rowtype;
  v_period_id uuid;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null
    or not private.has_text_role(v_organization_id, array['external_finance'])
    or private.finance_is_internal(v_organization_id) then
    raise exception 'Only External Finance can resubmit account funding requests';
  end if;
  select * into v_request
  from public.finance_account_funding_requests
  where id = p_request_id
    and organization_id = v_organization_id
    and requested_by = (select auth.uid())
  for update;
  if not found or v_request.status <> 'revision_requested' then
    raise exception 'Only a returned account funding request can be resubmitted';
  end if;
  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'Funding request amount must be greater than zero';
  end if;
  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  if v_request.period_id <> v_period_id then
    raise exception 'This returned request belongs to a closed budget period';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance account';
  end if;
  update public.finance_account_funding_requests
  set account_id = p_account_id,
      requested_amount = round(p_requested_amount, 2),
      approved_amount = null,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      status = 'pending',
      decided_by = null,
      decided_at = null,
      decision_note = null
  where id = v_request.id;
  return v_request.id;
end;
$$;
revoke all on function public.resubmit_finance_account_funding_request(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.resubmit_finance_account_funding_request(uuid, uuid, numeric, text, uuid) to authenticated;

create or replace function public.review_finance_account_funding_request(
  p_request_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.finance_account_funding_requests%rowtype;
  v_amount numeric := round(coalesce(p_approved_amount, 0), 2);
  v_period_id uuid;
begin
  select * into v_request
  from public.finance_account_funding_requests
  where id = p_request_id
  for update;
  if not found or not private.finance_is_budget_operator(v_request.organization_id) then
    raise exception 'Account funding request not found';
  end if;
  if v_request.status not in ('pending', 'revision_requested') then
    raise exception 'Only pending or returned account funding requests can be reviewed';
  end if;
  if p_decision not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Choose Approved, Rejected, or Return for revision';
  end if;
  if p_decision = 'approved' then
    if v_amount <= 0 or v_amount > v_request.requested_amount then
      raise exception 'Approved amount must be greater than zero and no higher than the requested amount';
    end if;
    v_period_id := private.ensure_finance_budget_period(v_request.organization_id);
    if v_request.period_id <> v_period_id then
      raise exception 'This request belongs to a closed budget period';
    end if;
    perform public.allocate_finance_account_budget(
      v_request.account_id,
      v_amount,
      format('Approved account funding request %s', v_request.id),
      v_request.organization_id
    );
  elsif p_decision in ('rejected', 'revision_requested')
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'Add a decision note before rejecting or returning this request';
  end if;

  update public.finance_account_funding_requests
  set status = p_decision,
      approved_amount = case when p_decision = 'approved' then v_amount else null end,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;

  insert into public.finance_account_budget_allocation_events (
    organization_id, period_id, allocation_id, funding_request_id,
    event_type, amount, previous_amount, new_amount, note, created_by
  )
  select
    v_request.organization_id,
    allocation.period_id,
    allocation.id,
    v_request.id,
    'funding_request_approval',
    v_amount,
    greatest(allocation.allocated_amount - v_amount, 0),
    allocation.allocated_amount,
    nullif(btrim(coalesce(p_decision_note, '')), ''),
    (select auth.uid())
  from public.finance_account_budget_allocations allocation
  where p_decision = 'approved'
    and allocation.period_id = v_request.period_id
    and allocation.account_id = v_request.account_id;
  return v_request.id;
end;
$$;
revoke all on function public.review_finance_account_funding_request(uuid, text, numeric, text) from public;
grant execute on function public.review_finance_account_funding_request(uuid, text, numeric, text) to authenticated;

-- External Finance now selects the account when submitting Cash Out. Keep the
-- manual-income and controlled-resubmission guards from the prior migration;
-- the budget guard below verifies that the selected Cash Out account has capacity.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
  v_resubmission_context boolean := coalesce(current_setting('huswell.allow_finance_transaction_resubmission', true), '') = 'on';
  v_manual_income_insert_context boolean := coalesce(current_setting('huswell.allow_manual_income_insert', true), '') = 'on';
  v_manual_income_resubmission_context boolean := coalesce(current_setting('huswell.allow_manual_income_resubmission', true), '') = 'on';
begin
  if tg_op = 'INSERT'
    and private.finance_is_internal(new.organization_id)
    and new.source_payment_id is null
    and new.commission_allocation_id is null
    and not v_commission_context
    and not v_manual_income_insert_context then
    raise exception 'Internal Finance cannot create generic Money In or Money Out. Use payment verification, expense approval, or the commission payout workflow';
  end if;

  if private.finance_is_internal(new.organization_id)
    and (v_manual_income_insert_context or v_manual_income_resubmission_context) then
    raise exception 'Manual Money In is an External Finance submission workflow';
  end if;

  if private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id) then
    if v_manual_income_insert_context or v_manual_income_resubmission_context then
      if new.transaction_type <> 'income'
        or new.income_source <> 'manual'
        or new.income_review_status <> 'pending'
        or new.payment_status <> 'unpaid'
        or new.approval_status <> 'not_required'
        or new.source_payment_id is not null
        or new.lead_id is not null
        or new.customer_id is not null
        or new.quotation_id is not null
        or new.supplier_payable_id is not null
        or new.commission_summary_id is not null
        or new.commission_allocation_id is not null
        or new.budget_request_id is not null then
        raise exception 'Manual Money In must remain an unverified standalone income record';
      end if;
      if new.account_id is null or not exists (
        select 1
        from public.finance_accounts account
        where account.id = new.account_id
          and account.organization_id = new.organization_id
          and account.is_active
      ) then
        raise exception 'Choose an active Finance receiving account';
      end if;
      if tg_op = 'UPDATE' then
        if not v_manual_income_resubmission_context
          or old.income_source <> 'manual'
          or old.income_review_status <> 'revision_requested'
          or new.income_review_status <> 'pending'
          or old.payment_status <> 'unpaid'
          or new.payment_status <> 'unpaid'
          or old.source_payment_id is distinct from new.source_payment_id
          or old.quotation_id is distinct from new.quotation_id
          or old.supplier_payable_id is distinct from new.supplier_payable_id
          or old.commission_summary_id is distinct from new.commission_summary_id
          or old.commission_allocation_id is distinct from new.commission_allocation_id
          or old.budget_request_id is distinct from new.budget_request_id then
          raise exception 'This Money In is not in a valid correction state';
        end if;
      elsif not v_manual_income_insert_context then
        raise exception 'Only the controlled Money In submission workflow can create this record';
      end if;
    else
      if new.transaction_type <> 'expense' then
        raise exception 'External Finance can submit Money Out or use the manual Money In workflow';
      end if;
      if new.payment_status <> 'unpaid' then
        raise exception 'External Finance cannot confirm a payment as paid';
      end if;
      if new.approval_status <> 'pending' then
        raise exception 'External Finance submissions must remain pending approval';
      end if;
      if new.income_source is not null or new.income_review_status <> 'none' then
        raise exception 'Only the manual Money In workflow can set income review fields';
      end if;
      if new.account_id is not null and not exists (
        select 1
        from public.finance_accounts account
        where account.id = new.account_id
          and account.organization_id = new.organization_id
          and account.is_active
      ) then
        raise exception 'Choose an active Finance payment account';
      end if;
      if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id and not v_resubmission_context then
        raise exception 'Only Internal Finance or the controlled resubmission workflow can change the Money Out payment account';
      end if;
      if v_resubmission_context and (
        old.approval_status <> 'revision_requested'
        or new.approval_status <> 'pending'
        or old.payment_status <> 'unpaid'
        or new.payment_status <> 'unpaid'
        or old.source_payment_id is distinct from new.source_payment_id
        or old.commission_summary_id is distinct from new.commission_summary_id
        or old.commission_allocation_id is distinct from new.commission_allocation_id
      ) then
        raise exception 'This transaction is not in a valid revision state';
      end if;
      if new.commission_summary_id is not null
        or new.commission_allocation_id is not null then
        raise exception 'External Finance cannot submit commission payouts';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- New External Finance Cash Out rows must select the active account that owns
-- the allocation. The database, not the account list, remains authoritative.
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
  v_consumed numeric;
  v_amount numeric;
begin
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
  if round(v_consumed + v_amount, 2) > round(v_allocation.allocated_amount, 2) then
    raise exception 'This account has no available budget for this expense';
  end if;
  new.budget_period_id := v_period_id;
  new.account_budget_allocation_id := v_allocation.id;
  return new;
end;
$$;

drop trigger if exists finance_transactions_budget_guard on public.finance_transactions;
create trigger finance_transactions_budget_guard
before insert or update of amount, transaction_type, approval_status, payment_status,
  account_id, budget_request_id, budget_period_id, account_budget_allocation_id, is_voided
on public.finance_transactions
for each row execute function private.finance_budget_allocation_guard();

-- Keep the existing sidebar queue totals, but replace the legacy budget-request
-- count with the account-funding request count for the Finance workspace.
create or replace function public.finance_sidebar_queue_counts(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_counts jsonb;
  v_legacy_pending bigint := 0;
  v_new_pending bigint := 0;
  v_legacy_revision bigint := 0;
  v_new_revision bigint := 0;
  v_finance bigint;
begin
  v_counts := public.sidebar_queue_counts(p_organization_id);
  v_finance := coalesce((v_counts ->> 'finance')::bigint, 0);

  if private.finance_is_internal(p_organization_id) then
    select count(*) into v_legacy_pending
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    if private.finance_is_budget_operator(p_organization_id) then
      select count(*) into v_new_pending
      from public.finance_account_funding_requests request
      where request.organization_id = p_organization_id
        and request.status::text = 'pending';
    end if;

    v_finance := v_finance - v_legacy_pending + v_new_pending;
  elsif private.has_text_role(p_organization_id, array['external_finance']) then
    select count(*) into v_legacy_revision
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    select count(*) into v_new_revision
    from public.finance_account_funding_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    v_finance := v_finance - v_legacy_revision + v_new_revision;
  end if;

  return jsonb_set(
    v_counts,
    '{finance}',
    to_jsonb(greatest(v_finance, 0)),
    true
  );
end;
$$;

revoke all on function public.finance_sidebar_queue_counts(uuid) from public, anon, authenticated;
grant execute on function public.finance_sidebar_queue_counts(uuid) to authenticated;

commit;
