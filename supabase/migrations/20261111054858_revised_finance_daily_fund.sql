-- Add a Daily Fund pool for non-project expenses.
-- Working Funds -> Daily Fund allocation is approved by GM. Non-project Cash
-- Out consumes Daily Fund. Unused Daily Fund can be returned to Working Funds.

begin;

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

create index if not exists finance_daily_fund_requests_org_status_date_idx
  on public.finance_daily_fund_requests(organization_id, status, fund_date desc, requested_at desc);

alter table public.finance_revised_transactions
  add column if not exists daily_fund_request_id uuid
;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_daily_fund_request_fk'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_daily_fund_request_fk
      foreign key (daily_fund_request_id)
      references public.finance_daily_fund_requests(id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_daily_fund_link_check'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_daily_fund_link_check
      check (
        (transaction_kind in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out')
          and daily_fund_request_id is not null)
        or (transaction_kind = 'adjustment')
        or (transaction_kind not in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out', 'adjustment')
          and daily_fund_request_id is null)
      );
  end if;
end;
$$;

create index if not exists finance_revised_transactions_org_daily_fund_idx
  on public.finance_revised_transactions(organization_id, daily_fund_request_id)
  where daily_fund_request_id is not null;

alter table public.finance_daily_fund_requests enable row level security;

drop policy if exists finance_daily_fund_requests_select on public.finance_daily_fund_requests;
create policy finance_daily_fund_requests_select
on public.finance_daily_fund_requests
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

revoke all on table public.finance_daily_fund_requests from anon, public;
grant select on table public.finance_daily_fund_requests to authenticated;

create or replace function private.finance_revised_daily_fund_spent(
  p_organization_id uuid,
  p_request_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public, private
as $$
  select round(coalesce(sum(
    case when entry.direction = 'out' then entry.amount else -entry.amount end
  ), 0), 2)
  from public.finance_revised_ledger_entries entry
  join public.finance_revised_transactions transaction
    on transaction.id = entry.transaction_id
  where entry.organization_id = p_organization_id
    and entry.ledger_type = 'daily'
    and entry.entry_type = 'operating_cash_out'
    and transaction.organization_id = p_organization_id
    and transaction.daily_fund_request_id = p_request_id
    and transaction.status in ('approved', 'voided');
$$;

create or replace view public.finance_revised_daily_fund_request_feed
with (security_invoker = true)
as
select
  request.id,
  request.organization_id,
  request.fund_date,
  request.requested_amount,
  request.approved_amount,
  request.returned_amount,
  request.status,
  request.purpose,
  request.note,
  request.requested_by,
  request.requested_at,
  request.approved_by,
  request.approved_at,
  request.decision_note,
  request.created_at,
  request.updated_at,
  coalesce(spending.spent_amount, 0) as spent_amount,
  coalesce(
    greatest(request.approved_amount - coalesce(spending.spent_amount, 0) - request.returned_amount, 0),
    0
  ) as unused_amount
from public.finance_daily_fund_requests request
left join lateral (
  select private.finance_revised_daily_fund_spent(request.organization_id, request.id) as spent_amount
) spending on true;

revoke all on table public.finance_revised_daily_fund_request_feed from anon, public;
grant select on table public.finance_revised_daily_fund_request_feed to authenticated;

create or replace function public.create_finance_revised_daily_fund_request(
  p_organization_id uuid,
  p_requested_amount numeric,
  p_fund_date date default current_date,
  p_purpose text default null,
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
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can request Daily Funds';
  end if;
  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'Daily Fund request amount must be greater than zero';
  end if;
  if nullif(btrim(coalesce(p_purpose, '')), '') is null then
    raise exception 'Daily Fund request purpose is required';
  end if;

  insert into public.finance_daily_fund_requests (
    organization_id,
    fund_date,
    requested_amount,
    purpose,
    note,
    requested_by
  )
  values (
    p_organization_id,
    coalesce(p_fund_date, current_date),
    round(p_requested_amount, 2),
    btrim(p_purpose),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.review_finance_revised_daily_fund_request(
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
  v_request public.finance_daily_fund_requests%rowtype;
  v_transaction_id uuid;
  v_amount numeric;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  select *
  into v_request
  from public.finance_daily_fund_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Daily Fund request not found';
  end if;
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(v_request.organization_id) then
    raise exception 'Only the GM can review Daily Fund requests';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending Daily Fund requests can be reviewed';
  end if;
  if v_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported Daily Fund request decision';
  end if;

  if v_decision = 'approved' then
    v_amount := round(coalesce(p_approved_amount, v_request.requested_amount), 2);
    if v_amount <= 0 or v_amount > v_request.requested_amount then
      raise exception 'Approved amount must be positive and cannot exceed the request';
    end if;

    update public.finance_daily_fund_requests
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
      daily_fund_request_id,
      amount,
      transaction_date,
      category,
      note,
      submitted_by
    )
    values (
      v_request.organization_id,
      'daily_fund_allocation',
      v_request.id,
      v_amount,
      v_request.fund_date,
      'Daily Fund allocation',
      coalesce(v_request.note, v_request.purpose),
      v_request.requested_by
    )
    returning id into v_transaction_id;

    perform private.post_finance_revised_transaction(
      v_transaction_id,
      (select auth.uid()),
      p_decision_note
    );
  else
    update public.finance_daily_fund_requests
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

create or replace function public.create_finance_revised_daily_fund_return(
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
  v_request public.finance_daily_fund_requests%rowtype;
  v_remaining numeric;
  v_spent numeric;
  v_id uuid;
begin
  select *
  into v_request
  from public.finance_daily_fund_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Daily Fund request not found';
  end if;
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(v_request.organization_id) then
    raise exception 'Only Accounting & Finance can return Daily Funds';
  end if;
  if v_request.status not in ('approved', 'partially_returned') then
    raise exception 'This Daily Fund request has no unused approved balance';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Daily Fund return amount must be greater than zero';
  end if;

  v_spent := private.finance_revised_daily_fund_spent(v_request.organization_id, v_request.id);
  v_remaining := round(
    coalesce(v_request.approved_amount, 0) - coalesce(v_request.returned_amount, 0) - coalesce(v_spent, 0),
    2
  );
  if v_remaining < round(p_amount, 2) then
    raise exception 'Daily Fund return cannot exceed the unused approved amount';
  end if;
  if exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.organization_id = v_request.organization_id
      and transaction.daily_fund_request_id = v_request.id
      and transaction.transaction_kind = 'daily_fund_return'
      and transaction.status = 'pending'
  ) then
    raise exception 'A Daily Fund return is already pending for this request';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    daily_fund_request_id,
    amount,
    transaction_date,
    category,
    note,
    submitted_by
  )
  values (
    v_request.organization_id,
    'daily_fund_return',
    v_request.id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    'Daily Fund return',
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.get_finance_revised_daily_fund_snapshot(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_daily_balance numeric;
  v_working_balance numeric;
  v_allocated numeric;
  v_spent numeric;
  v_returned numeric;
  v_pending integer;
  v_unused numeric;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view the Daily Fund';
  end if;

  v_daily_balance := private.finance_revised_balance(p_organization_id, 'daily');
  v_working_balance := private.finance_revised_balance(p_organization_id, 'working');

  select
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_allocation'
        then case when entry.direction = 'in' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'operating_cash_out'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_return'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2)
  into v_allocated, v_spent, v_returned
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.ledger_type = 'daily';

  select count(*)::integer
  into v_pending
  from public.finance_daily_fund_requests request
  where request.organization_id = p_organization_id
    and request.status = 'pending';

  select round(coalesce(sum(greatest(
    coalesce(request.approved_amount, 0)
      - coalesce(request.returned_amount, 0)
      - coalesce(private.finance_revised_daily_fund_spent(request.organization_id, request.id), 0),
    0
  )), 0), 2)
  into v_unused
  from public.finance_daily_fund_requests request
  where request.organization_id = p_organization_id
    and request.status in ('approved', 'partially_returned');

  return jsonb_build_object(
    'daily_fund_balance', coalesce(v_daily_balance, 0),
    'working_funds_balance', coalesce(v_working_balance, 0),
    'total_allocated', coalesce(v_allocated, 0),
    'total_spent', coalesce(v_spent, 0),
    'total_returned', coalesce(v_returned, 0),
    'unused_by_request', coalesce(v_unused, 0),
    'pending_requests', coalesce(v_pending, 0)
  );
end;
$$;

revoke all on function public.create_finance_revised_daily_fund_request(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.review_finance_revised_daily_fund_request(uuid, text, numeric, text) from public, anon;
revoke all on function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text) from public, anon;
revoke all on function public.get_finance_revised_daily_fund_snapshot(uuid) from public, anon;

grant execute on function public.create_finance_revised_daily_fund_request(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.review_finance_revised_daily_fund_request(uuid, text, numeric, text) to authenticated;
grant execute on function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text) to authenticated;
grant execute on function public.get_finance_revised_daily_fund_snapshot(uuid) to authenticated;

commit;
