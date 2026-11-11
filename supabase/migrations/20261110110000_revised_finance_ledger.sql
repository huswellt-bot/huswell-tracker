-- Revised Accounting & Finance ledger.
--
-- This is an additive cutover path. It intentionally does not reuse the old
-- account-based Finance tables: project cash stays isolated to its project,
-- Working Funds are a separate company pool, and only the GM can approve or
-- post a pending movement.
--
-- Cutover decision: legacy account-based rows are not silently backfilled into
-- this ledger. Before go-live, reconcile the legacy balances outside the
-- application, then have the GM record the opening Capital Funds and the
-- Capital -> Working Funds transfer. New project collections and expenses must
-- start in this ledger so the old account totals are never mixed with the new
-- project budgets.

begin;

create table if not exists public.finance_working_fund_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  approved_amount numeric(14,2),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected',
    'partially_repaid', 'repaid', 'cancelled'
  )),
  purpose text not null check (btrim(purpose) <> ''),
  note text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  decision_note text,
  support_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or (approved_amount > 0 and approved_amount <= requested_amount))
);

create table if not exists public.finance_working_fund_request_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.finance_working_fund_requests(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  category text not null default 'Project expense' check (btrim(category) <> ''),
  amount numeric(14,2) not null check (amount > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

-- The ledger posting and reversal functions below validate Daily Fund links at
-- function-creation time. Define the request table here so the ledger remains
-- deployable before the Daily Fund policy/feed migration runs next.
create table if not exists public.finance_daily_fund_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fund_date date not null default current_date,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  approved_amount numeric(14,2),
  returned_amount numeric(14,2) not null default 0 check (returned_amount >= 0),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected',
    'partially_returned', 'returned', 'cancelled'
  )),
  purpose text not null check (btrim(purpose) <> ''),
  note text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or (approved_amount > 0 and approved_amount <= requested_amount)),
  check (approved_amount is null or returned_amount <= approved_amount)
);

create table if not exists public.finance_revised_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_kind text not null check (transaction_kind in (
    'capital_contribution',
    'capital_to_working',
    'project_cash_in',
    'project_cash_out',
    'working_fund_support',
    'working_fund_repayment',
    'operating_cash_out',
    'daily_fund_allocation',
    'daily_fund_return',
    'commission_payout',
    'adjustment'
  )),
  project_fund_id uuid references public.project_funds(id) on delete restrict,
  working_fund_request_id uuid references public.finance_working_fund_requests(id) on delete restrict,
  daily_fund_request_id uuid,
  commission_allocation_id uuid references public.commission_summary_allocations(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  period_label text,
  category text,
  reference_number text,
  note text,
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'voided'
  )),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_revised_transactions
  add column if not exists reversal_of_transaction_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_reversal_fk'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_reversal_fk
      foreign key (reversal_of_transaction_id)
      references public.finance_revised_transactions(id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_working_fund_requests'::regclass
      and conname = 'finance_working_fund_requests_support_transaction_fk'
  ) then
    alter table public.finance_working_fund_requests
      add constraint finance_working_fund_requests_support_transaction_fk
      foreign key (support_transaction_id)
      references public.finance_revised_transactions(id)
      on delete restrict;
  end if;
end;
$$;

create table if not exists public.finance_revised_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_id uuid not null references public.finance_revised_transactions(id) on delete restrict,
  ledger_type text not null check (ledger_type in ('capital', 'working', 'daily', 'project')),
  project_fund_id uuid references public.project_funds(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'capital_contribution',
    'capital_to_working',
    'project_cash_in',
    'project_cash_out',
    'working_fund_support',
    'working_fund_repayment',
    'operating_cash_out',
    'daily_fund_allocation',
    'daily_fund_return',
    'commission_payout',
    'adjustment'
  )),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  entry_date date not null default current_date,
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (ledger_type = 'project' and project_fund_id is not null)
    or (ledger_type <> 'project' and project_fund_id is null)
  ),
  unique (transaction_id, ledger_type, project_fund_id, entry_type, direction)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_commission_link_check'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_commission_link_check
      check (
        (transaction_kind = 'commission_payout'
          and commission_allocation_id is not null
          and project_fund_id is not null)
        or (transaction_kind <> 'commission_payout'
          and commission_allocation_id is null)
      );
  end if;
end;
$$;

create index if not exists finance_revised_transactions_org_status_date_idx
  on public.finance_revised_transactions(organization_id, status, transaction_date desc, created_at desc);
create index if not exists finance_revised_transactions_org_project_idx
  on public.finance_revised_transactions(organization_id, project_fund_id, transaction_date desc)
  where project_fund_id is not null;
create index if not exists finance_revised_transactions_org_request_idx
  on public.finance_revised_transactions(organization_id, working_fund_request_id)
  where working_fund_request_id is not null;
create index if not exists finance_revised_transactions_reversal_idx
  on public.finance_revised_transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null;
create unique index if not exists finance_revised_transactions_one_active_commission_idx
  on public.finance_revised_transactions(commission_allocation_id)
  where commission_allocation_id is not null
    and status not in ('rejected', 'voided');
create index if not exists finance_revised_ledger_entries_org_ledger_date_idx
  on public.finance_revised_ledger_entries(organization_id, ledger_type, entry_date desc);
create index if not exists finance_revised_ledger_entries_org_project_date_idx
  on public.finance_revised_ledger_entries(organization_id, project_fund_id, entry_date desc)
  where project_fund_id is not null;
create index if not exists finance_working_fund_requests_org_status_date_idx
  on public.finance_working_fund_requests(organization_id, status, requested_at desc);
create index if not exists finance_working_fund_requests_org_project_idx
  on public.finance_working_fund_requests(organization_id, project_fund_id);
create index if not exists finance_working_fund_requests_support_transaction_idx
  on public.finance_working_fund_requests(support_transaction_id)
  where support_transaction_id is not null;
create index if not exists finance_working_fund_request_lines_request_idx
  on public.finance_working_fund_request_lines(organization_id, request_id, sort_order);
create index if not exists finance_working_fund_request_lines_request_id_idx
  on public.finance_working_fund_request_lines(request_id);

create or replace function private.finance_revised_can_operate(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and (
      private.has_text_role(
        p_organization_id,
        array['super_admin', 'owner', 'admin', 'accountant']
      )
      or private.has_member_capability(p_organization_id, 'internal_finance')
    );
$$;

create or replace function private.finance_revised_is_gm(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin']
    );
$$;

create or replace function private.finance_revised_project_completed(p_project_fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.project_funds fund
    left join public.production_jobs job
      on job.id = fund.production_job_id
      or (fund.production_job_id is null and job.id = (
        select schedule.production_job_id
        from public.project_schedules schedule
        where schedule.id = fund.project_schedule_id
        limit 1
      ))
    left join public.project_schedules schedule
      on schedule.id = fund.project_schedule_id
    where fund.id = p_project_fund_id
      and (
        fund.status = 'closed'
        or job.status::text in ('completed', 'delivered')
        or job.completed_at is not null
        or job.delivered_at is not null
        or schedule.completed_at is not null
      )
  );
$$;

create or replace function private.finance_revised_balance(
  p_organization_id uuid,
  p_ledger_type text,
  p_project_fund_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select round(coalesce(sum(
    case when entry.direction = 'in' then entry.amount else -entry.amount end
  ), 0), 2)
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.ledger_type = p_ledger_type
    and (
      (p_ledger_type = 'project' and entry.project_fund_id = p_project_fund_id)
      or (p_ledger_type <> 'project' and entry.project_fund_id is null)
    );
$$;

create or replace function private.finance_revised_client_cash_in(
  p_organization_id uuid,
  p_project_fund_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select round(coalesce(sum(
    case when entry.direction = 'in' then entry.amount else -entry.amount end
  ), 0), 2)
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.project_fund_id = p_project_fund_id
    and entry.ledger_type = 'project'
    and entry.entry_type = 'project_cash_in';
$$;

create or replace function private.finance_revised_client_available_balance(
  p_organization_id uuid,
  p_project_fund_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select round(coalesce(sum(
    case when entry.direction = 'in' then entry.amount else -entry.amount end
  ), 0), 2)
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.project_fund_id = p_project_fund_id
    and entry.ledger_type = 'project'
    and entry.entry_type in (
      'project_cash_in',
      'project_cash_out',
      'commission_payout',
      'working_fund_repayment'
    );
$$;

create or replace function private.finance_revised_add_entry(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_ledger_type text,
  p_project_fund_id uuid,
  p_entry_type text,
  p_direction text,
  p_amount numeric,
  p_entry_date date,
  p_note text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  insert into public.finance_revised_ledger_entries (
    organization_id,
    transaction_id,
    ledger_type,
    project_fund_id,
    entry_type,
    direction,
    amount,
    entry_date,
    note,
    created_by
  )
  values (
    p_organization_id,
    p_transaction_id,
    p_ledger_type,
    p_project_fund_id,
    p_entry_type,
    p_direction,
    round(p_amount, 2),
    p_entry_date,
    p_note,
    p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

alter table public.finance_working_fund_requests enable row level security;
alter table public.finance_working_fund_request_lines enable row level security;
alter table public.finance_revised_transactions enable row level security;
alter table public.finance_revised_ledger_entries enable row level security;

drop policy if exists finance_working_fund_requests_select on public.finance_working_fund_requests;
create policy finance_working_fund_requests_select
on public.finance_working_fund_requests
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

drop policy if exists finance_working_fund_request_lines_select on public.finance_working_fund_request_lines;
create policy finance_working_fund_request_lines_select
on public.finance_working_fund_request_lines
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

drop policy if exists finance_revised_transactions_select on public.finance_revised_transactions;
create policy finance_revised_transactions_select
on public.finance_revised_transactions
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

drop policy if exists finance_revised_ledger_entries_select on public.finance_revised_ledger_entries;
create policy finance_revised_ledger_entries_select
on public.finance_revised_ledger_entries
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

revoke all on table
  public.finance_working_fund_requests,
  public.finance_working_fund_request_lines,
  public.finance_revised_transactions,
  public.finance_revised_ledger_entries
from anon, public;

grant select on table
  public.finance_working_fund_requests,
  public.finance_working_fund_request_lines,
  public.finance_revised_transactions,
  public.finance_revised_ledger_entries
to authenticated;

create or replace function private.post_finance_revised_transaction(
  p_transaction_id uuid,
  p_actor uuid,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_revised_transactions%rowtype;
  v_fund public.project_funds%rowtype;
  v_request public.finance_working_fund_requests%rowtype;
  v_project_balance numeric;
  v_capital_balance numeric;
  v_working_balance numeric;
  v_outstanding numeric;
  v_remaining numeric;
  v_client_cash_in numeric;
  v_quotation_total numeric;
  v_allocation public.commission_summary_allocations%rowtype;
  v_daily_request_status text;
  v_daily_approved_amount numeric;
  v_daily_returned_amount numeric;
  v_daily_spent_amount numeric;
begin
  select *
  into v_transaction
  from public.finance_revised_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.status <> 'pending' then
    raise exception 'Only pending revised Finance transactions can be posted';
  end if;
  if p_actor is null then
    raise exception 'A signed-in GM is required to post this transaction';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));

  if v_transaction.project_fund_id is not null then
    select *
    into v_fund
    from public.project_funds
    where id = v_transaction.project_fund_id
      and organization_id = v_transaction.organization_id
    for update;

    if not found then
      raise exception 'Project fund not found for this organization';
    end if;
  end if;

  case v_transaction.transaction_kind
    when 'capital_contribution' then
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'capital',
        null,
        'capital_contribution',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'capital_to_working' then
      v_capital_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'capital'
      );
      if v_capital_balance < v_transaction.amount then
        raise exception 'Capital Funds balance is not enough for this transfer';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'capital',
        null,
        'capital_to_working',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'working',
        null,
        'capital_to_working',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'project_cash_in' then
      if v_fund.status not in ('open', 'on_hold', 'closed') then
        raise exception 'Cash In can only be recorded for an existing project';
      end if;
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'project',
        v_transaction.project_fund_id,
        'project_cash_in',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'project_cash_out' then
      if v_fund.status not in ('open', 'on_hold') then
        raise exception 'Cash Out can only be recorded for an open project';
      end if;
      v_project_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'project',
        v_transaction.project_fund_id
      );
      if v_project_balance < v_transaction.amount then
        raise exception 'Project balance is not enough. Request Working Funds for this project first';
      end if;
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'project',
        v_transaction.project_fund_id,
        'project_cash_out',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'commission_payout' then
      select *
      into v_allocation
      from public.commission_summary_allocations allocation
      where allocation.id = v_transaction.commission_allocation_id
        and allocation.organization_id = v_transaction.organization_id
      for update;

      if not found then
        raise exception 'Commission allocation not found for this organization';
      end if;
      if v_allocation.status <> 'not_yet_paid' then
        raise exception 'The commission allocation is no longer payable';
      end if;
      if v_allocation.amount <= 0
        or round(v_allocation.amount, 2) <> round(v_transaction.amount, 2) then
        raise exception 'Commission payout amount must equal the approved allocation';
      end if;
      if v_fund.quotation_id is distinct from v_allocation.quotation_id then
        raise exception 'Commission payout does not match the selected project';
      end if;
      if v_fund.status not in ('open', 'on_hold', 'closed') then
        raise exception 'Commission payout requires an active project';
      end if;

      select coalesce(quotation.total_amount, summary.grand_total, v_fund.contract_amount, 0)
      into v_quotation_total
      from public.commission_summaries summary
      left join public.quotations quotation
        on quotation.id = summary.quotation_id
        and quotation.organization_id = summary.organization_id
      where summary.id = v_allocation.commission_summary_id
        and summary.organization_id = v_transaction.organization_id;

      v_client_cash_in := private.finance_revised_client_cash_in(
        v_transaction.organization_id,
        v_transaction.project_fund_id
      );
      if v_client_cash_in + 0.001 < coalesce(v_quotation_total, 0) then
        raise exception 'Commission becomes payable after the project is fully collected';
      end if;

      v_project_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'project',
        v_transaction.project_fund_id
      );
      if v_project_balance < v_transaction.amount then
        raise exception 'Project balance is not enough for this commission payout. Request Working Funds for this project first';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'project',
        v_transaction.project_fund_id,
        'commission_payout',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

      update public.commission_summary_allocations
      set status = 'paid',
          eligible_at = coalesce(eligible_at, now()),
          paid_at = now(),
          paid_by = p_actor
      where id = v_allocation.id
        and status = 'not_yet_paid';

      perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
      update public.commission_summaries summary
      set status = case
            when not exists (
              select 1
              from public.commission_summary_allocations allocation
              where allocation.commission_summary_id = v_allocation.commission_summary_id
                and allocation.status = 'not_yet_paid'
                and allocation.amount > 0
            ) then 'paid'
            else 'not_yet_paid'
          end,
          paid_at = case
            when not exists (
              select 1
              from public.commission_summary_allocations allocation
              where allocation.commission_summary_id = v_allocation.commission_summary_id
                and allocation.status = 'not_yet_paid'
                and allocation.amount > 0
            ) then coalesce(paid_at, now())
            else null
          end,
          paid_by = case
            when not exists (
              select 1
              from public.commission_summary_allocations allocation
              where allocation.commission_summary_id = v_allocation.commission_summary_id
                and allocation.status = 'not_yet_paid'
                and allocation.amount > 0
            ) then coalesce(paid_by, p_actor)
            else null
          end
      where id = v_allocation.commission_summary_id
        and organization_id = v_transaction.organization_id;
      perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);

    when 'operating_cash_out' then
      select request.status, request.approved_amount, request.returned_amount
      into v_daily_request_status, v_daily_approved_amount, v_daily_returned_amount
      from public.finance_daily_fund_requests request
      where request.id = v_transaction.daily_fund_request_id
        and request.organization_id = v_transaction.organization_id
      for update;

      if not found then
        raise exception 'Daily Fund request not found for this Cash Out';
      end if;
      if v_daily_request_status not in ('approved', 'partially_returned') then
        raise exception 'Daily Fund request is not available for this Cash Out';
      end if;

      select round(coalesce(sum(
        case when entry.direction = 'out' then entry.amount else -entry.amount end
      ), 0), 2)
      into v_daily_spent_amount
      from public.finance_revised_ledger_entries entry
      join public.finance_revised_transactions transaction
        on transaction.id = entry.transaction_id
      where entry.organization_id = v_transaction.organization_id
        and entry.ledger_type = 'daily'
        and entry.entry_type = 'operating_cash_out'
        and transaction.daily_fund_request_id = v_transaction.daily_fund_request_id
        and transaction.status in ('approved', 'voided');

      if round(coalesce(v_daily_approved_amount, 0) - coalesce(v_daily_returned_amount, 0) - coalesce(v_daily_spent_amount, 0), 2) < v_transaction.amount then
        raise exception 'Daily Fund request has no remaining approved amount for this Cash Out';
      end if;

      v_working_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'daily'
      );
      if v_working_balance < v_transaction.amount then
        raise exception 'Daily Fund balance is not enough for this non-project Cash Out';
      end if;
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'daily',
        null,
        'operating_cash_out',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'daily_fund_allocation' then
      select request.status, request.approved_amount
      into v_daily_request_status, v_daily_approved_amount
      from public.finance_daily_fund_requests request
      where request.id = v_transaction.daily_fund_request_id
        and request.organization_id = v_transaction.organization_id
      for update;

      if not found then
        raise exception 'Daily Fund request not found for this allocation';
      end if;
      if v_daily_request_status <> 'approved'
        or round(coalesce(v_daily_approved_amount, 0), 2) <> round(v_transaction.amount, 2) then
        raise exception 'Daily Fund request is not approved for this allocation';
      end if;

      v_working_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'working'
      );
      if v_working_balance < v_transaction.amount then
        raise exception 'Working Funds balance is not enough for this Daily Fund allocation';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'working',
        null,
        'daily_fund_allocation',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'daily',
        null,
        'daily_fund_allocation',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'daily_fund_return' then
      select request.status, request.approved_amount, request.returned_amount
      into v_daily_request_status, v_daily_approved_amount, v_daily_returned_amount
      from public.finance_daily_fund_requests request
      where request.id = v_transaction.daily_fund_request_id
        and request.organization_id = v_transaction.organization_id
      for update;

      if not found then
        raise exception 'Daily Fund request not found for this return';
      end if;
      if v_daily_request_status not in ('approved', 'partially_returned') then
        raise exception 'Daily Fund request is not available for return';
      end if;
      select round(coalesce(sum(
        case when entry.direction = 'out' then entry.amount else -entry.amount end
      ), 0), 2)
      into v_daily_spent_amount
      from public.finance_revised_ledger_entries entry
      join public.finance_revised_transactions transaction
        on transaction.id = entry.transaction_id
      where entry.organization_id = v_transaction.organization_id
        and entry.ledger_type = 'daily'
        and entry.entry_type = 'operating_cash_out'
        and transaction.daily_fund_request_id = v_transaction.daily_fund_request_id
        and transaction.status in ('approved', 'voided');
      v_remaining := round(
        coalesce(v_daily_approved_amount, 0)
          - coalesce(v_daily_returned_amount, 0)
          - coalesce(v_daily_spent_amount, 0),
        2
      );
      if v_remaining < v_transaction.amount then
        raise exception 'Daily Fund return cannot exceed the unused approved amount';
      end if;

      v_working_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'daily'
      );
      if v_working_balance < v_transaction.amount then
        raise exception 'Daily Fund balance is not enough for this return';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'daily',
        null,
        'daily_fund_return',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'working',
        null,
        'daily_fund_return',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

      update public.finance_daily_fund_requests
      set returned_amount = round(coalesce(returned_amount, 0) + v_transaction.amount, 2),
          status = case
            when round(coalesce(returned_amount, 0) + v_transaction.amount, 2) >= round(coalesce(approved_amount, 0), 2)
              then 'returned'
            else 'partially_returned'
          end,
          updated_at = now()
      where id = v_transaction.daily_fund_request_id
        and organization_id = v_transaction.organization_id;

    when 'working_fund_support' then
      select *
      into v_request
      from public.finance_working_fund_requests
      where id = v_transaction.working_fund_request_id
        and organization_id = v_transaction.organization_id
      for update;

      if not found or v_request.project_fund_id is distinct from v_transaction.project_fund_id then
        raise exception 'Working Fund request does not match the selected project';
      end if;
      if v_request.status not in ('approved', 'partially_repaid') then
        raise exception 'Working Fund request is not approved for release';
      end if;
      if v_fund.status not in ('open', 'on_hold') then
        raise exception 'Working Funds can only support an open project';
      end if;
      v_working_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        'working'
      );
      if v_working_balance < v_transaction.amount then
        raise exception 'Working Funds balance is not enough for this support transfer';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'working',
        null,
        'working_fund_support',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'project',
        v_transaction.project_fund_id,
        'working_fund_support',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

    when 'working_fund_repayment' then
      select *
      into v_request
      from public.finance_working_fund_requests
      where id = v_transaction.working_fund_request_id
        and organization_id = v_transaction.organization_id
      for update;

      if not found or v_request.project_fund_id is distinct from v_transaction.project_fund_id then
        raise exception 'Working Fund repayment request does not match the selected project';
      end if;
      if not private.finance_revised_project_completed(v_transaction.project_fund_id) then
        raise exception 'Only completed projects can return Working Funds';
      end if;

      select round(coalesce(sum(
        case
          when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
            and entry.direction = 'in' then entry.amount
          when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
            and entry.direction = 'out' then -entry.amount
          else 0
        end
      ), 0), 2)
      into v_outstanding
      from public.finance_revised_ledger_entries entry
      join public.finance_revised_transactions txn
        on txn.id = entry.transaction_id
      where entry.organization_id = v_transaction.organization_id
        and entry.project_fund_id = v_transaction.project_fund_id
        and txn.working_fund_request_id = v_request.id
        and entry.ledger_type = 'project';

      if coalesce(v_outstanding, 0) < v_transaction.amount then
        raise exception 'Repayment cannot exceed the outstanding Working Fund support';
      end if;
      v_project_balance := private.finance_revised_client_available_balance(
        v_transaction.organization_id,
        v_transaction.project_fund_id
      );
      if v_project_balance < v_transaction.amount then
        raise exception 'Collected project balance is not enough to make this repayment';
      end if;

      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'project',
        v_transaction.project_fund_id,
        'working_fund_repayment',
        'out',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );
      perform private.finance_revised_add_entry(
        v_transaction.organization_id,
        v_transaction.id,
        'working',
        null,
        'working_fund_repayment',
        'in',
        v_transaction.amount,
        v_transaction.transaction_date,
        v_transaction.note,
        v_transaction.submitted_by
      );

      select round(coalesce(sum(
        case
          when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
            and entry.direction = 'in' then entry.amount
          when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
            and entry.direction = 'out' then -entry.amount
          else 0
        end
      ), 0), 2)
      into v_remaining
      from public.finance_revised_ledger_entries entry
      join public.finance_revised_transactions txn
        on txn.id = entry.transaction_id
      where entry.organization_id = v_transaction.organization_id
        and entry.project_fund_id = v_transaction.project_fund_id
        and txn.working_fund_request_id = v_request.id
        and entry.ledger_type = 'project';

      update public.finance_working_fund_requests
      set status = case when coalesce(v_remaining, 0) <= 0 then 'repaid' else 'partially_repaid' end,
          updated_at = now()
      where id = v_request.id;

    else
      raise exception 'This revised Finance transaction type cannot be posted manually';
  end case;

  update public.finance_revised_transactions
  set status = 'approved',
      approved_by = p_actor,
      approved_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
      updated_at = now()
  where id = v_transaction.id;

  return v_transaction.id;
end;
$$;

commit;

begin;

create or replace function public.create_finance_revised_cash_in(
  p_organization_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_status text;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can record project Cash In';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash In amount must be greater than zero';
  end if;

  select status
  into v_status
  from public.project_funds
  where id = p_project_fund_id
    and organization_id = p_organization_id;

  if not found or v_status not in ('open', 'on_hold', 'closed') then
    raise exception 'Choose an existing project for Cash In';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    amount,
    transaction_date,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'project_cash_in',
    p_project_fund_id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_finance_revised_cash_out(
  p_organization_id uuid,
  p_project_fund_id uuid default null,
  p_amount numeric default null,
  p_category text default null,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
  p_daily_fund_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_kind text;
  v_status text;
  v_balance numeric;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can record Cash Out';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash Out amount must be greater than zero';
  end if;

  if p_project_fund_id is null then
    v_kind := 'operating_cash_out';
    if p_daily_fund_request_id is null then
      raise exception 'Choose an approved Daily Fund request for a non-project Cash Out';
    end if;
    if not exists (
      select 1
      from public.finance_daily_fund_requests request
      where request.id = p_daily_fund_request_id
        and request.organization_id = p_organization_id
        and request.status in ('approved', 'partially_returned')
    ) then
      raise exception 'Choose an approved Daily Fund request for this non-project Cash Out';
    end if;
    v_balance := private.finance_revised_balance(p_organization_id, 'daily');
    if v_balance < round(p_amount, 2) then
      raise exception 'Daily Fund balance is not enough for this non-project Cash Out';
    end if;
  else
    if p_daily_fund_request_id is not null then
      raise exception 'A project Cash Out cannot use a Daily Fund request';
    end if;
    v_kind := 'project_cash_out';
    select status
    into v_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = p_organization_id;

    if not found or v_status not in ('open', 'on_hold') then
      raise exception 'Choose an open project for project Cash Out';
    end if;
    v_balance := private.finance_revised_balance(
      p_organization_id,
      'project',
      p_project_fund_id
    );
    if v_balance < round(p_amount, 2) then
      raise exception 'Project balance is not enough. Request Working Funds for this project first';
    end if;
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    daily_fund_request_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    v_kind,
    p_project_fund_id,
    p_daily_fund_request_id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_finance_revised_commission_payables(
  p_organization_id uuid
)
returns table (
  allocation_id uuid,
  commission_summary_id uuid,
  quotation_id uuid,
  project_fund_id uuid,
  project_name text,
  client_name text,
  company_name text,
  quotation_number text,
  total_quotation numeric,
  client_cash_in numeric,
  project_balance numeric,
  commission_amount numeric,
  recipient_user_id uuid,
  recipient_name text,
  allocation_role text,
  share_rate numeric,
  allocation_status text,
  payout_status text,
  ready_for_payout boolean,
  eligibility_note text
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view commission payables';
  end if;

  return query
  with project_ledger as (
    select
      entry.project_fund_id,
      round(coalesce(sum(
        case when entry.entry_type = 'project_cash_in'
          then case when entry.direction = 'in' then entry.amount else -entry.amount end
          else 0 end
      ), 0), 2) as client_cash_in,
      round(coalesce(sum(case when entry.direction = 'in' then entry.amount else -entry.amount end), 0), 2) as project_balance
    from public.finance_revised_ledger_entries entry
    where entry.organization_id = p_organization_id
      and entry.ledger_type = 'project'
    group by entry.project_fund_id
  )
  select
    allocation.id,
    allocation.commission_summary_id,
    allocation.quotation_id,
    fund.id,
    fund.project_name,
    coalesce(nullif(fund.client_name, ''), nullif(quotation.client_name, ''), customer.contact_name, ''),
    coalesce(customer.company_name, ''),
    quotation.quotation_no,
    coalesce(quotation.total_amount, summary.grand_total, fund.contract_amount, 0),
    coalesce(ledger.client_cash_in, 0),
    coalesce(ledger.project_balance, 0),
    allocation.amount,
    allocation.recipient_user_id,
    coalesce(profile.full_name, 'Sales & Pricing Officer'),
    allocation.allocation_role,
    allocation.share_rate,
    allocation.status,
    active_payout.status,
    allocation.status = 'not_yet_paid'
      and active_payout.id is null
      and coalesce(ledger.client_cash_in, 0) + 0.001 >= coalesce(quotation.total_amount, summary.grand_total, fund.contract_amount, 0)
      and coalesce(ledger.project_balance, 0) + 0.001 >= allocation.amount,
    case
      when active_payout.id is not null then 'Pending GM approval'
      when coalesce(ledger.client_cash_in, 0) + 0.001 < coalesce(quotation.total_amount, summary.grand_total, fund.contract_amount, 0)
        then 'Waiting for full project collection'
      when coalesce(ledger.project_balance, 0) + 0.001 < allocation.amount
        then 'Project balance is not enough. Request Working Funds first'
      else 'Ready for GM approval'
    end
  from public.commission_summary_allocations allocation
  join public.commission_summaries summary
    on summary.id = allocation.commission_summary_id
    and summary.organization_id = allocation.organization_id
  join public.project_funds fund
    on fund.organization_id = allocation.organization_id
    and fund.quotation_id = allocation.quotation_id
  left join public.quotations quotation
    on quotation.id = fund.quotation_id
    and quotation.organization_id = fund.organization_id
  left join public.customers customer
    on customer.id = quotation.customer_id
    and customer.organization_id = fund.organization_id
  left join public.profiles profile
    on profile.id = allocation.recipient_user_id
  left join project_ledger ledger
    on ledger.project_fund_id = fund.id
  left join lateral (
    select transaction.id, transaction.status
    from public.finance_revised_transactions transaction
    where transaction.organization_id = allocation.organization_id
      and transaction.commission_allocation_id = allocation.id
      and transaction.status not in ('rejected', 'voided')
    order by transaction.created_at desc, transaction.id desc
    limit 1
  ) active_payout on true
  where allocation.organization_id = p_organization_id
    and allocation.status = 'not_yet_paid'
    and allocation.amount > 0
  order by allocation.created_at desc, quotation.quotation_no, allocation.allocation_role;
end;
$$;

create or replace function public.create_finance_revised_commission_payout(
  p_organization_id uuid,
  p_commission_allocation_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_allocation public.commission_summary_allocations%rowtype;
  v_project_fund_id uuid;
  v_project_status text;
  v_quotation_no text;
  v_recipient_name text;
  v_quotation_total numeric;
  v_client_cash_in numeric;
  v_project_balance numeric;
  v_existing uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can submit commission payouts';
  end if;
  if p_commission_allocation_id is null then
    raise exception 'Choose a commission allocation';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));

  select allocation.*
  into v_allocation
  from public.commission_summary_allocations allocation
  where allocation.id = p_commission_allocation_id
    and allocation.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Commission allocation not found';
  end if;
  if v_allocation.status <> 'not_yet_paid' or v_allocation.amount <= 0 then
    raise exception 'The commission allocation is no longer payable';
  end if;

  select
    fund.id,
    fund.status,
    quotation.quotation_no,
    coalesce(quotation.total_amount, summary.grand_total, fund.contract_amount, 0),
    coalesce(profile.full_name, 'Sales & Pricing Officer')
  into
    v_project_fund_id,
    v_project_status,
    v_quotation_no,
    v_quotation_total,
    v_recipient_name
  from public.project_funds fund
  join public.commission_summaries summary
    on summary.organization_id = fund.organization_id
    and summary.quotation_id = fund.quotation_id
    and summary.id = v_allocation.commission_summary_id
  left join public.quotations quotation
    on quotation.id = fund.quotation_id
    and quotation.organization_id = fund.organization_id
  left join public.profiles profile
    on profile.id = v_allocation.recipient_user_id
  where fund.organization_id = p_organization_id
    and fund.quotation_id = v_allocation.quotation_id
  order by fund.created_at, fund.id
  limit 1
  for update;

  if v_project_fund_id is null then
    raise exception 'No project fund is linked to this commission allocation';
  end if;
  if v_project_status not in ('open', 'on_hold', 'closed') then
    raise exception 'Commission payout requires an active project';
  end if;

  select transaction.id
  into v_existing
  from public.finance_revised_transactions transaction
  where transaction.organization_id = p_organization_id
    and transaction.commission_allocation_id = v_allocation.id
    and transaction.status not in ('rejected', 'voided')
  limit 1;
  if v_existing is not null then
    raise exception 'A commission payout is already pending or posted for this allocation';
  end if;

  v_client_cash_in := private.finance_revised_client_cash_in(
    p_organization_id,
    v_project_fund_id
  );
  if v_client_cash_in + 0.001 < coalesce(v_quotation_total, 0) then
    raise exception 'Commission becomes payable after the project is fully collected';
  end if;

  v_project_balance := private.finance_revised_balance(
    p_organization_id,
    'project',
    v_project_fund_id
  );
  if v_project_balance + 0.001 < v_allocation.amount then
    raise exception 'Project balance is not enough for this commission payout. Request Working Funds for this project first';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    commission_allocation_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'commission_payout',
    v_project_fund_id,
    v_allocation.id,
    round(v_allocation.amount, 2),
    coalesce(p_transaction_date, current_date),
    'Commission payout',
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Commission payout - ' || coalesce(v_quotation_no, 'Project') || ' - ' || v_recipient_name),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_finance_revised_capital_contribution(
  p_organization_id uuid,
  p_amount numeric,
  p_period_label text default null,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(p_organization_id) then
    raise exception 'Only the GM can add Capital Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Capital Funds amount must be greater than zero';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    period_label,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'capital_contribution',
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    nullif(btrim(coalesce(p_period_label, '')), ''),
    'Owner investment',
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  perform private.post_finance_revised_transaction(v_id, (select auth.uid()), 'GM capital contribution');
  return v_id;
end;
$$;

create or replace function public.create_finance_revised_capital_to_working(
  p_organization_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(p_organization_id) then
    raise exception 'Only the GM can transfer Capital Funds to Working Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Working Fund transfer amount must be greater than zero';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'capital_to_working',
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    'Capital to Working Funds',
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  perform private.post_finance_revised_transaction(v_id, (select auth.uid()), 'GM Working Fund transfer');
  return v_id;
end;
$$;

create or replace function public.create_finance_working_fund_request(
  p_organization_id uuid,
  p_project_fund_id uuid,
  p_purpose text,
  p_note text default null,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request_id uuid;
  v_status text;
  v_total numeric := 0;
  v_line jsonb;
  v_amount numeric;
  v_description text;
  v_category text;
  v_sort_order integer := 0;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can request Working Funds';
  end if;
  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    raise exception 'Working Fund request purpose is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one Working Fund breakdown line';
  end if;

  select status
  into v_status
  from public.project_funds
  where id = p_project_fund_id
    and organization_id = p_organization_id;
  if not found or v_status not in ('open', 'on_hold') then
    raise exception 'Choose an open project for the Working Fund request';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
    v_category := nullif(btrim(coalesce(v_line ->> 'category', '')), '');
    v_amount := round((v_line ->> 'amount')::numeric, 2);
    if v_description is null or v_amount is null or v_amount <= 0 then
      raise exception 'Every Working Fund line needs a description and positive amount';
    end if;
    v_total := v_total + v_amount;
  end loop;

  insert into public.finance_working_fund_requests (
    organization_id,
    project_fund_id,
    requested_amount,
    purpose,
    note,
    requested_by
  )
  values (
    p_organization_id,
    p_project_fund_id,
    round(v_total, 2),
    btrim(p_purpose),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_request_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_description := btrim(v_line ->> 'description');
    v_category := coalesce(nullif(btrim(v_line ->> 'category'), ''), 'Project expense');
    v_amount := round((v_line ->> 'amount')::numeric, 2);

    insert into public.finance_working_fund_request_lines (
      organization_id,
      request_id,
      description,
      category,
      amount,
      sort_order
    )
    values (
      p_organization_id,
      v_request_id,
      v_description,
      v_category,
      v_amount,
      v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  end loop;

  return v_request_id;
end;
$$;

create or replace function public.review_finance_revised_working_fund_request(
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
  v_request public.finance_working_fund_requests%rowtype;
  v_transaction_id uuid;
  v_amount numeric;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  select *
  into v_request
  from public.finance_working_fund_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Working Fund request not found';
  end if;
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(v_request.organization_id) then
    raise exception 'Only the GM can review Working Fund requests';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending Working Fund requests can be reviewed';
  end if;
  if v_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported Working Fund request decision';
  end if;

  if v_decision = 'approved' then
    v_amount := round(coalesce(p_approved_amount, v_request.requested_amount), 2);
    if v_amount <= 0 or v_amount > v_request.requested_amount then
      raise exception 'Approved amount must be positive and cannot exceed the request';
    end if;

    update public.finance_working_fund_requests
    set status = 'approved',
        approved_amount = v_amount,
        approved_by = (select auth.uid()),
        approved_at = now(),
        decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
        updated_at = now()
    where id = v_request.id;

    insert into public.finance_revised_transactions (
      organization_id,
      transaction_kind,
      project_fund_id,
      working_fund_request_id,
      amount,
      transaction_date,
      category,
      note,
      submitted_by
    )
    values (
      v_request.organization_id,
      'working_fund_support',
      v_request.project_fund_id,
      v_request.id,
      v_amount,
      current_date,
      'Working Fund support',
      coalesce(v_request.note, v_request.purpose),
      v_request.requested_by
    )
    returning id into v_transaction_id;

    update public.finance_working_fund_requests
    set support_transaction_id = v_transaction_id,
        updated_at = now()
    where id = v_request.id;

    perform private.post_finance_revised_transaction(
      v_transaction_id,
      (select auth.uid()),
      p_decision_note
    );
  else
    update public.finance_working_fund_requests
    set status = v_decision,
        approved_amount = null,
        approved_by = (select auth.uid()),
        approved_at = now(),
        decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
        updated_at = now()
    where id = v_request.id;
  end if;

  return v_request.id;
end;
$$;

create or replace function public.create_finance_revised_repayment(
  p_request_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.finance_working_fund_requests%rowtype;
  v_project_balance numeric;
  v_outstanding numeric;
  v_id uuid;
begin
  select *
  into v_request
  from public.finance_working_fund_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Working Fund request not found';
  end if;
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(v_request.organization_id) then
    raise exception 'Only Accounting & Finance can record a repayment';
  end if;
  if v_request.status not in ('approved', 'partially_repaid') then
    raise exception 'This Working Fund request has no outstanding approved support';
  end if;
  if not private.finance_revised_project_completed(v_request.project_fund_id) then
    raise exception 'Only completed projects can return Working Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero';
  end if;

  select round(coalesce(sum(
    case
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'in' then entry.amount
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'out' then -entry.amount
      else 0
    end
  ), 0), 2)
  into v_outstanding
  from public.finance_revised_ledger_entries entry
  join public.finance_revised_transactions txn
    on txn.id = entry.transaction_id
  where entry.organization_id = v_request.organization_id
    and entry.project_fund_id = v_request.project_fund_id
    and txn.working_fund_request_id = v_request.id
    and entry.ledger_type = 'project';

  if coalesce(v_outstanding, 0) < round(p_amount, 2) then
    raise exception 'Repayment cannot exceed the outstanding Working Fund support';
  end if;

  v_project_balance := private.finance_revised_client_available_balance(
    v_request.organization_id,
    v_request.project_fund_id
  );
  if v_project_balance < round(p_amount, 2) then
    raise exception 'Collected project balance is not enough to make this repayment';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    working_fund_request_id,
    amount,
    transaction_date,
    category,
    note,
    submitted_by
  )
  values (
    v_request.organization_id,
    'working_fund_repayment',
    v_request.project_fund_id,
    v_request.id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    'Working Fund repayment',
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.review_finance_revised_transaction(
  p_transaction_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_revised_transactions%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  select *
  into v_transaction
  from public.finance_revised_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Finance transaction not found';
  end if;
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(v_transaction.organization_id) then
    raise exception 'Only the GM can approve Finance transactions';
  end if;
  if v_transaction.status <> 'pending' then
    raise exception 'Only pending Finance transactions can be reviewed';
  end if;
  if v_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported Finance transaction decision';
  end if;

  if v_decision = 'approved' then
    perform private.post_finance_revised_transaction(
      v_transaction.id,
      (select auth.uid()),
      p_decision_note
    );
  else
    update public.finance_revised_transactions
    set status = v_decision,
        decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
        updated_at = now()
    where id = v_transaction.id;
  end if;

  return v_transaction.id;
end;
$$;

create or replace function public.void_finance_revised_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_revised_transactions%rowtype;
  v_request public.finance_working_fund_requests%rowtype;
  v_daily_request public.finance_daily_fund_requests%rowtype;
  v_entry record;
  v_balance numeric;
  v_adjustment_id uuid;
  v_new_returned numeric;
  v_outstanding numeric;
  v_has_repayment boolean;
  v_summary_id uuid;
  v_actor uuid := (select auth.uid());
begin
  select *
  into v_transaction
  from public.finance_revised_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Finance transaction not found';
  end if;
  if v_actor is null
    or not private.finance_revised_is_gm(v_transaction.organization_id) then
    raise exception 'Only the GM can reverse a posted Finance transaction';
  end if;
  if v_transaction.status <> 'approved' then
    raise exception 'Only an approved Finance transaction can be reversed';
  end if;
  if v_transaction.transaction_kind = 'adjustment' then
    raise exception 'A reversal adjustment cannot be reversed again';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reversal reason is required';
  end if;
  if exists (
    select 1
    from public.finance_revised_transactions reversal
    where reversal.reversal_of_transaction_id = v_transaction.id
      and reversal.status = 'approved'
  ) then
    raise exception 'This Finance transaction has already been reversed';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));

  for v_entry in
    select *
    from public.finance_revised_ledger_entries entry
    where entry.transaction_id = v_transaction.id
    order by entry.created_at, entry.id
  loop
    if v_entry.direction = 'in' then
      v_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        v_entry.ledger_type,
        v_entry.project_fund_id
      );
      if v_balance + 0.001 < v_entry.amount then
        raise exception 'This transaction cannot be reversed because its funds have already been used';
      end if;
    end if;
  end loop;

  if v_transaction.transaction_kind = 'daily_fund_allocation' then
    if exists (
      select 1
      from public.finance_revised_transactions dependent
      where dependent.organization_id = v_transaction.organization_id
        and dependent.daily_fund_request_id = v_transaction.daily_fund_request_id
        and dependent.transaction_kind in ('operating_cash_out', 'daily_fund_return')
        and dependent.status not in ('rejected', 'voided')
    ) then
      raise exception 'Daily Fund allocation cannot be reversed after it has been used or returned';
    end if;
    update public.finance_daily_fund_requests
    set status = 'cancelled',
        updated_at = now()
    where id = v_transaction.daily_fund_request_id
      and organization_id = v_transaction.organization_id;
  elsif v_transaction.transaction_kind = 'daily_fund_return' then
    select *
    into v_daily_request
    from public.finance_daily_fund_requests request
    where request.id = v_transaction.daily_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Daily Fund request not found for this reversal';
    end if;
    v_new_returned := round(coalesce(v_daily_request.returned_amount, 0) - v_transaction.amount, 2);
    if v_new_returned < 0 then
      raise exception 'Daily Fund return history is inconsistent';
    end if;
    update public.finance_daily_fund_requests
    set returned_amount = v_new_returned,
        status = case
          when v_new_returned >= round(coalesce(v_daily_request.approved_amount, 0), 2) then 'returned'
          when v_new_returned > 0 then 'partially_returned'
          else 'approved'
        end,
        updated_at = now()
    where id = v_daily_request.id;
  elsif v_transaction.transaction_kind = 'working_fund_support' then
    select *
    into v_request
    from public.finance_working_fund_requests request
    where request.id = v_transaction.working_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Working Fund request not found for this reversal';
    end if;
    if exists (
      select 1
      from public.finance_revised_transactions dependent
      where dependent.organization_id = v_transaction.organization_id
        and dependent.working_fund_request_id = v_request.id
        and dependent.transaction_kind = 'working_fund_repayment'
        and dependent.status not in ('rejected', 'voided')
    ) then
      raise exception 'Working Fund support cannot be reversed after a repayment was submitted';
    end if;
    update public.finance_working_fund_requests
    set support_transaction_id = null,
        status = 'approved',
        updated_at = now()
    where id = v_request.id;
  elsif v_transaction.transaction_kind = 'working_fund_repayment' then
    select *
    into v_request
    from public.finance_working_fund_requests request
    where request.id = v_transaction.working_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Working Fund request not found for this reversal';
    end if;
    select round(coalesce(sum(
      case
        when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
          and entry.direction = 'in' then entry.amount
        when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
          and entry.direction = 'out' then -entry.amount
        else 0
      end
    ), 0), 2)
    into v_outstanding
    from public.finance_revised_ledger_entries entry
    join public.finance_revised_transactions transaction
      on transaction.id = entry.transaction_id
    where entry.organization_id = v_transaction.organization_id
      and entry.project_fund_id = v_transaction.project_fund_id
      and entry.ledger_type = 'project'
      and transaction.working_fund_request_id = v_request.id
      and transaction.id <> v_transaction.id;
    select exists (
      select 1
      from public.finance_revised_transactions repayment
      where repayment.working_fund_request_id = v_request.id
        and repayment.transaction_kind = 'working_fund_repayment'
        and repayment.status = 'approved'
        and repayment.id <> v_transaction.id
    ) into v_has_repayment;
    update public.finance_working_fund_requests
    set status = case
          when coalesce(v_outstanding, 0) <= 0 then 'repaid'
          when v_has_repayment then 'partially_repaid'
          else 'approved'
        end,
        updated_at = now()
    where id = v_request.id;
  elsif v_transaction.transaction_kind = 'commission_payout' then
    select allocation.commission_summary_id
    into v_summary_id
    from public.commission_summary_allocations allocation
    where allocation.id = v_transaction.commission_allocation_id
      and allocation.organization_id = v_transaction.organization_id
    for update;
    if v_summary_id is null then
      raise exception 'Commission allocation not found for this reversal';
    end if;
    update public.commission_summary_allocations
    set status = 'not_yet_paid',
        eligible_at = coalesce(eligible_at, now()),
        paid_at = null,
        paid_by = null
    where id = v_transaction.commission_allocation_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summaries summary
    set status = 'not_yet_paid',
        paid_at = null,
        paid_by = null
    where summary.id = v_summary_id
      and summary.organization_id = v_transaction.organization_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    working_fund_request_id,
    daily_fund_request_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    status,
    submitted_by,
    approved_by,
    approved_at,
    decision_note,
    reversal_of_transaction_id
  )
  values (
    v_transaction.organization_id,
    'adjustment',
    v_transaction.project_fund_id,
    case when v_transaction.transaction_kind in ('working_fund_support', 'working_fund_repayment')
      then v_transaction.working_fund_request_id else null end,
    case when v_transaction.transaction_kind in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out')
      then v_transaction.daily_fund_request_id else null end,
    v_transaction.amount,
    current_date,
    'Reversal / adjustment',
    'Reversal of ' || v_transaction.id::text,
    'Reversal reason: ' || btrim(p_reason),
    'approved',
    v_actor,
    v_actor,
    now(),
    btrim(p_reason),
    v_transaction.id
  )
  returning id into v_adjustment_id;

  for v_entry in
    select *
    from public.finance_revised_ledger_entries entry
    where entry.transaction_id = v_transaction.id
    order by entry.created_at, entry.id
  loop
    perform private.finance_revised_add_entry(
      v_transaction.organization_id,
      v_adjustment_id,
      v_entry.ledger_type,
      v_entry.project_fund_id,
      v_entry.entry_type,
      case when v_entry.direction = 'in' then 'out' else 'in' end,
      v_entry.amount,
      current_date,
      'Reversal of ' || v_transaction.id::text,
      v_actor
    );
  end loop;

  update public.finance_revised_transactions
  set status = 'voided',
      decision_note = 'Reversed: ' || btrim(p_reason),
      updated_at = now()
  where id = v_transaction.id;

  return v_adjustment_id;
end;
$$;

create or replace function public.get_finance_revised_snapshot(
  p_organization_id uuid,
  p_period_start date default date_trunc('month', current_date)::date,
  p_period_end date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_capital numeric;
  v_beginning_working numeric;
  v_ending_working numeric;
  v_period_cash_in numeric;
  v_period_cash_out numeric;
  v_period_support numeric;
  v_period_repayment numeric;
  v_period_commission_paid numeric;
  v_commission_open numeric;
  v_pending integer;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view the revised Finance ledger';
  end if;

  select round(coalesce(sum(case when direction = 'in' then amount else -amount end), 0), 2)
  into v_capital
  from public.finance_revised_ledger_entries
  where organization_id = p_organization_id
    and ledger_type = 'capital'
    and entry_date <= coalesce(p_period_end, current_date);

  select round(coalesce(sum(case when direction = 'in' then amount else -amount end), 0), 2)
  into v_beginning_working
  from public.finance_revised_ledger_entries
  where organization_id = p_organization_id
    and ledger_type = 'working'
    and entry_date < coalesce(p_period_start, date_trunc('month', current_date)::date);

  select round(coalesce(sum(case when direction = 'in' then amount else -amount end), 0), 2)
  into v_ending_working
  from public.finance_revised_ledger_entries
  where organization_id = p_organization_id
    and ledger_type = 'working'
    and entry_date <= coalesce(p_period_end, current_date);

  select
    round(coalesce(sum(
      case when entry.entry_type = 'project_cash_in'
        and entry.ledger_type = 'project'
        then case when entry.direction = 'in' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type in ('project_cash_out', 'commission_payout', 'operating_cash_out')
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'working_fund_support'
        and entry.ledger_type = 'working'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'working_fund_repayment'
        and entry.ledger_type = 'working'
        then case when entry.direction = 'in' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'commission_payout'
        and entry.ledger_type = 'project'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2)
  into v_period_cash_in, v_period_cash_out, v_period_support, v_period_repayment, v_period_commission_paid
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.entry_date between
      coalesce(p_period_start, date_trunc('month', current_date)::date)
      and coalesce(p_period_end, current_date);

  select count(*)::integer
  into v_pending
  from public.finance_revised_transactions
  where organization_id = p_organization_id
    and status = 'pending';

  select round(coalesce(sum(allocation.amount), 0), 2)
  into v_commission_open
  from public.commission_summary_allocations allocation
  where allocation.organization_id = p_organization_id
    and allocation.status = 'not_yet_paid'
    and allocation.amount > 0;

  return jsonb_build_object(
    'capital_funds', coalesce(v_capital, 0),
    'beginning_working_funds', coalesce(v_beginning_working, 0),
    'ending_working_funds', coalesce(v_ending_working, 0),
    'working_funds', coalesce(v_ending_working, 0),
    'period_cash_in', coalesce(v_period_cash_in, 0),
    'period_cash_out', coalesce(v_period_cash_out, 0),
    'period_commission_paid', coalesce(v_period_commission_paid, 0),
    'commission_payables_open', coalesce(v_commission_open, 0),
    'period_working_fund_support', coalesce(v_period_support, 0),
    'period_working_fund_repayment', coalesce(v_period_repayment, 0),
    'pending_approvals', coalesce(v_pending, 0),
    'period_start', coalesce(p_period_start, date_trunc('month', current_date)::date),
    'period_end', coalesce(p_period_end, current_date)
  );
end;
$$;

create or replace function public.list_finance_revised_projects(
  p_organization_id uuid
)
returns table (
  project_fund_id uuid,
  quotation_id uuid,
  project_name text,
  client_name text,
  company_name text,
  quotation_number text,
  project_status text,
  production_status text,
  total_quotation numeric,
  total_direct_cost numeric,
  is_completed boolean,
  completed_at timestamptz,
  client_cash_in numeric,
  working_fund_support numeric,
  cash_out numeric,
  working_fund_repaid numeric,
  available_balance numeric,
  outstanding_working_fund numeric,
  commission_total numeric,
  commission_paid numeric,
  commission_remaining numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view Project Finance Monitoring';
  end if;

  return query
  select
    fund.id,
    fund.quotation_id,
    fund.project_name,
    coalesce(
      nullif(fund.client_name, ''),
      nullif(quotation.client_name, ''),
      customer.contact_name,
      ''
    ),
    coalesce(customer.company_name, ''),
    quotation.quotation_no,
    fund.status,
    job.status::text,
    coalesce(quotation.total_amount, fund.contract_amount, 0),
    coalesce(costing.total_direct_cost, 0),
    private.finance_revised_project_completed(fund.id),
    coalesce(job.completed_at, job.delivered_at, schedule.completed_at, fund.closed_at),
    coalesce(ledger.client_cash_in, 0),
    coalesce(ledger.working_fund_support, 0),
    coalesce(ledger.cash_out, 0),
    coalesce(ledger.working_fund_repaid, 0),
    coalesce(ledger.available_balance, 0),
    round(
      greatest(
        coalesce(ledger.working_fund_support, 0)
        - coalesce(ledger.working_fund_repaid, 0),
        0
      ),
      2
    ),
    coalesce(commission.commission_total, 0),
    coalesce(commission.commission_paid, 0),
    coalesce(commission.commission_remaining, 0)
  from public.project_funds fund
  left join public.quotations quotation
    on quotation.id = fund.quotation_id
    and quotation.organization_id = fund.organization_id
  left join public.customers customer
    on customer.id = quotation.customer_id
    and customer.organization_id = fund.organization_id
  left join public.production_jobs job
    on job.id = fund.production_job_id
    and job.organization_id = fund.organization_id
  left join public.project_schedules schedule
    on schedule.id = fund.project_schedule_id
    and schedule.organization_id = fund.organization_id
  left join lateral (
    select round(coalesce(sum(
      case
        when line.calculation_type = 'fixed_amount'
          then round(line.unit_cost, 2)
        else round(line.quantity * line.unit_cost, 2)
      end
    ), 0), 2) as total_direct_cost
    from public.price_quotation_product_costings product_costing
    join public.price_quotation_costing_lines line
      on line.product_costing_id = product_costing.id
      and line.organization_id = fund.organization_id
    where product_costing.organization_id = fund.organization_id
      and product_costing.quotation_id = fund.quotation_id
  ) costing on true
  left join lateral (
    select
      sum(case when ledger_entry.entry_type = 'project_cash_in'
        then case when ledger_entry.direction = 'in' then ledger_entry.amount else -ledger_entry.amount end
        else 0 end) as client_cash_in,
      sum(case when ledger_entry.entry_type = 'working_fund_support'
        then case when ledger_entry.direction = 'in' then ledger_entry.amount else -ledger_entry.amount end
        else 0 end) as working_fund_support,
      sum(case when ledger_entry.entry_type in ('project_cash_out', 'commission_payout')
        then case when ledger_entry.direction = 'out' then ledger_entry.amount else -ledger_entry.amount end
        else 0 end) as cash_out,
      sum(case when ledger_entry.entry_type = 'working_fund_repayment'
        then case when ledger_entry.direction = 'out' then ledger_entry.amount else -ledger_entry.amount end
        else 0 end) as working_fund_repaid,
      sum(case when ledger_entry.direction = 'in'
        then ledger_entry.amount else -ledger_entry.amount end) as available_balance
    from public.finance_revised_ledger_entries ledger_entry
    where ledger_entry.organization_id = fund.organization_id
      and ledger_entry.project_fund_id = fund.id
  ) ledger on true
  left join lateral (
    select
      round(coalesce(sum(allocation.amount), 0), 2) as commission_total,
      round(coalesce(sum(allocation.amount) filter (where allocation.status = 'paid'), 0), 2) as commission_paid,
      round(coalesce(sum(allocation.amount) filter (where allocation.status = 'not_yet_paid'), 0), 2) as commission_remaining
    from public.commission_summary_allocations allocation
    where allocation.organization_id = fund.organization_id
      and allocation.quotation_id = fund.quotation_id
      and allocation.amount > 0
  ) commission on true
  where fund.organization_id = p_organization_id
  order by fund.status, fund.project_name;
end;
$$;

create or replace function public.list_finance_revised_costing_lines(
  p_organization_id uuid,
  p_project_fund_id uuid
)
returns table (
  line_id uuid,
  quotation_id uuid,
  description text,
  quantity numeric,
  unit_cost numeric,
  calculation_type text,
  line_total numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view costing details';
  end if;

  select quotation_id
  into v_quotation_id
  from public.project_funds
  where id = p_project_fund_id
    and organization_id = p_organization_id;
  if not found then
    raise exception 'Project fund not found';
  end if;

  return query
  select
    line.id,
    v_quotation_id,
    line.description,
    line.quantity,
    line.unit_cost,
    line.calculation_type,
    case
      when line.calculation_type = 'fixed_amount'
        then round(line.unit_cost, 2)
      else round(line.quantity * line.unit_cost, 2)
    end
  from public.price_quotation_product_costings product_costing
  join public.price_quotation_costing_lines line
    on line.product_costing_id = product_costing.id
    and line.organization_id = p_organization_id
  where product_costing.organization_id = p_organization_id
    and product_costing.quotation_id = v_quotation_id
  order by line.sort_order, line.created_at;
end;
$$;

create or replace view public.finance_revised_transaction_feed
with (security_invoker = true)
as
select
  txn.id,
  txn.organization_id,
  txn.transaction_kind,
  txn.project_fund_id,
  txn.working_fund_request_id,
  txn.daily_fund_request_id,
  txn.commission_allocation_id,
  txn.reversal_of_transaction_id,
  txn.amount,
  txn.transaction_date,
  txn.period_label,
  txn.category,
  txn.reference_number,
  txn.note,
  txn.status,
  txn.submitted_by,
  txn.submitted_at,
  txn.approved_by,
  txn.approved_at,
  txn.decision_note,
  txn.created_at,
  txn.updated_at,
  fund.project_name,
  fund.client_name,
  quotation.quotation_no,
  request.purpose as working_fund_purpose,
  allocation.recipient_user_id as commission_recipient_user_id,
  coalesce(profile.full_name, 'Sales & Pricing Officer') as commission_recipient_name,
  allocation.allocation_role as commission_allocation_role,
  allocation.share_rate as commission_share_rate,
  coalesce(submitted_profile.full_name, txn.submitted_by::text) as submitted_by_name,
  coalesce(approved_profile.full_name, txn.approved_by::text) as approved_by_name
from public.finance_revised_transactions txn
left join public.project_funds fund
  on fund.id = txn.project_fund_id
left join public.quotations quotation
  on quotation.id = fund.quotation_id
left join public.finance_working_fund_requests request
  on request.id = txn.working_fund_request_id
left join public.commission_summary_allocations allocation
  on allocation.id = txn.commission_allocation_id
  and allocation.organization_id = txn.organization_id
left join public.profiles profile
  on profile.id = allocation.recipient_user_id
left join public.profiles submitted_profile
  on submitted_profile.id = txn.submitted_by
left join public.profiles approved_profile
  on approved_profile.id = txn.approved_by;

create or replace view public.finance_revised_working_fund_request_feed
with (security_invoker = true)
as
select
  request.id,
  request.organization_id,
  request.project_fund_id,
  request.requested_amount,
  request.approved_amount,
  request.status,
  request.purpose,
  request.note,
  request.requested_by,
  request.requested_at,
  request.approved_by,
  request.approved_at,
  request.decision_note,
  request.support_transaction_id,
  request.created_at,
  request.updated_at,
  fund.project_name,
  fund.client_name,
  quotation.quotation_no,
  coalesce(line_summary.breakdown_total, 0) as breakdown_total,
  coalesce(line_summary.breakdown_line_count, 0)::integer as breakdown_line_count,
  coalesce(support_summary.outstanding_amount, 0) as outstanding_amount
from public.finance_working_fund_requests request
join public.project_funds fund
  on fund.id = request.project_fund_id
left join public.quotations quotation
  on quotation.id = fund.quotation_id
left join lateral (
  select
    sum(line.amount) as breakdown_total,
    count(*) as breakdown_line_count
  from public.finance_working_fund_request_lines line
  where line.request_id = request.id
) line_summary on true
left join lateral (
  select round(coalesce(sum(
    case
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'in' then entry.amount
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'out' then -entry.amount
      else 0
    end
  ), 0), 2) as outstanding_amount
  from public.finance_revised_ledger_entries entry
  join public.finance_revised_transactions transaction
    on transaction.id = entry.transaction_id
  where entry.organization_id = request.organization_id
    and entry.project_fund_id = request.project_fund_id
    and entry.ledger_type = 'project'
    and transaction.working_fund_request_id = request.id
) support_summary on true;

revoke all on table public.finance_revised_transaction_feed,
  public.finance_revised_working_fund_request_feed
from anon, public;
grant select on table public.finance_revised_transaction_feed,
  public.finance_revised_working_fund_request_feed
to authenticated;

revoke all on function public.create_finance_revised_cash_in(uuid, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.create_finance_revised_cash_out(uuid, uuid, numeric, text, date, text, text, uuid) from public, anon;
revoke all on function public.list_finance_revised_commission_payables(uuid) from public, anon;
revoke all on function public.create_finance_revised_commission_payout(uuid, uuid, date, text, text) from public, anon;
revoke all on function public.create_finance_revised_capital_contribution(uuid, numeric, text, date, text, text) from public, anon;
revoke all on function public.create_finance_revised_capital_to_working(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.create_finance_working_fund_request(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.review_finance_revised_working_fund_request(uuid, text, numeric, text) from public, anon;
revoke all on function public.create_finance_revised_repayment(uuid, numeric, date, text) from public, anon;
revoke all on function public.review_finance_revised_transaction(uuid, text, text) from public, anon;
revoke all on function public.void_finance_revised_transaction(uuid, text) from public, anon;
revoke all on function public.get_finance_revised_snapshot(uuid, date, date) from public, anon;
revoke all on function public.list_finance_revised_projects(uuid) from public, anon;
revoke all on function public.list_finance_revised_costing_lines(uuid, uuid) from public, anon;

grant execute on function public.create_finance_revised_cash_in(uuid, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.create_finance_revised_cash_out(uuid, uuid, numeric, text, date, text, text, uuid) to authenticated;
grant execute on function public.list_finance_revised_commission_payables(uuid) to authenticated;
grant execute on function public.create_finance_revised_commission_payout(uuid, uuid, date, text, text) to authenticated;
grant execute on function public.create_finance_revised_capital_contribution(uuid, numeric, text, date, text, text) to authenticated;
grant execute on function public.create_finance_revised_capital_to_working(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.create_finance_working_fund_request(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.review_finance_revised_working_fund_request(uuid, text, numeric, text) to authenticated;
grant execute on function public.create_finance_revised_repayment(uuid, numeric, date, text) to authenticated;
grant execute on function public.review_finance_revised_transaction(uuid, text, text) to authenticated;
grant execute on function public.void_finance_revised_transaction(uuid, text) to authenticated;
grant execute on function public.get_finance_revised_snapshot(uuid, date, date) to authenticated;
grant execute on function public.list_finance_revised_projects(uuid) to authenticated;
grant execute on function public.list_finance_revised_costing_lines(uuid, uuid) to authenticated;

-- Cash In and Cash Out must use the category-aware wrappers. Keeping these
-- lower-level functions callable would allow a client to bypass category
-- validation even though the visible Finance forms require a category.
revoke all on function public.create_finance_revised_cash_in(uuid, uuid, numeric, date, text, text) from authenticated;
revoke all on function public.create_finance_revised_cash_out(uuid, uuid, numeric, text, date, text, text, uuid) from authenticated;

commit;
