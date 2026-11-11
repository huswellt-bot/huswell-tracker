-- Cash In and Cash Out use a revision workflow instead of rejection.
-- The original submission remains visible, and a corrected resubmission is a
-- new pending transaction linked to that original row.

begin;

alter table public.finance_revised_transactions
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists revision_of_transaction_id uuid;

alter table public.finance_revised_transactions
  drop constraint if exists finance_revised_transactions_status_check;

alter table public.finance_revised_transactions
  add constraint finance_revised_transactions_status_check
  check (status in ('pending', 'approved', 'rejected', 'revision_requested', 'voided'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_revision_fk'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_revision_fk
      foreign key (revision_of_transaction_id)
      references public.finance_revised_transactions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_revised_transactions'::regclass
      and conname = 'finance_revised_transactions_revision_not_self_check'
  ) then
    alter table public.finance_revised_transactions
      add constraint finance_revised_transactions_revision_not_self_check
      check (revision_of_transaction_id is null or revision_of_transaction_id <> id);
  end if;
end;
$$;

create index if not exists finance_revised_transactions_org_status_created_idx
  on public.finance_revised_transactions (organization_id, status, created_at desc);

create index if not exists finance_revised_transactions_revision_idx
  on public.finance_revised_transactions (revision_of_transaction_id);

-- A transaction can have only one active correction child. This prevents the
-- original row from being resubmitted again after its first replacement was
-- itself sent back for revision.
create unique index if not exists finance_revised_transactions_one_active_revision_child_idx
  on public.finance_revised_transactions (revision_of_transaction_id)
  where revision_of_transaction_id is not null
    and status not in ('rejected', 'voided');

-- A revision-requested commission row is still part of the audit trail, but
-- it must not block the corrected payout from using the same allocation.
drop index if exists public.finance_revised_transactions_one_active_commission_idx;
create unique index finance_revised_transactions_one_active_commission_idx
  on public.finance_revised_transactions (commission_allocation_id)
  where commission_allocation_id is not null
    and status not in ('rejected', 'voided', 'revision_requested');

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
  v_actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
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
    raise exception 'Only the GM can approve Finance transactions';
  end if;
  if v_transaction.status <> 'pending' then
    raise exception 'Only pending Finance transactions can be reviewed';
  end if;
  if v_decision not in ('approved', 'revision_requested') then
    raise exception 'Use approve or request revision for Finance transactions';
  end if;

  if v_decision = 'revision_requested' then
    if v_transaction.transaction_kind not in ('project_cash_in', 'project_cash_out', 'operating_cash_out', 'commission_payout') then
      raise exception 'Only Cash In and Cash Out transactions can request revision';
    end if;
    if v_note is null then
      raise exception 'A revision note is required';
    end if;

    update public.finance_revised_transactions
    set status = 'revision_requested',
        reviewed_by = v_actor,
        reviewed_at = now(),
        decision_note = v_note,
        updated_at = now()
    where id = v_transaction.id;
  else
    perform private.post_finance_revised_transaction(
      v_transaction.id,
      v_actor,
      v_note
    );

    update public.finance_revised_transactions
    set reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now()
    where id = v_transaction.id;
  end if;

  return v_transaction.id;
end;
$$;

create or replace function public.resubmit_finance_revised_transaction(
  p_original_transaction_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_category_id uuid,
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
  v_original public.finance_revised_transactions%rowtype;
  v_category public.finance_categories%rowtype;
  v_kind text;
  v_project_status text;
  v_daily_status text;
  v_commission_status text;
  v_commission_amount numeric;
  v_category_id uuid;
  v_category_name text;
  v_balance numeric;
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  select *
  into v_original
  from public.finance_revised_transactions transaction
  where transaction.id = p_original_transaction_id
  for update;

  if not found then
    raise exception 'Original Finance transaction not found';
  end if;
  if v_actor is null
    or not private.finance_revised_can_operate(v_original.organization_id) then
    raise exception 'Only Accounting & Finance can resubmit Finance transactions';
  end if;
  if v_original.status <> 'revision_requested' then
    raise exception 'Only a transaction marked for revision can be resubmitted';
  end if;
  if v_original.transaction_kind not in ('project_cash_in', 'project_cash_out', 'operating_cash_out', 'commission_payout') then
    raise exception 'Only Cash In and Cash Out transactions can be resubmitted';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Finance transaction amount must be greater than zero';
  end if;
  if exists (
    select 1
    from public.finance_revised_transactions replacement
    where replacement.revision_of_transaction_id = v_original.id
      and replacement.status not in ('rejected', 'voided')
  ) then
    raise exception 'This Finance transaction already has an active correction';
  end if;

  v_kind := v_original.transaction_kind;
  if v_kind = 'commission_payout' then
    v_category_id := v_original.category_id;
    v_category_name := coalesce(v_original.category, 'Commission payout');
  else
    select *
    into v_category
    from public.finance_categories category
    where category.id = p_category_id
      and category.organization_id = v_original.organization_id
      and category.direction = case when v_kind = 'project_cash_in' then 'income' else 'expense' end
      and category.is_active
    for share;

    if not found then
      raise exception 'Choose an active Finance category for the corrected transaction';
    end if;

    v_category_id := v_category.id;
    v_category_name := v_category.name;
  end if;

  if v_kind = 'project_cash_in' then
    if p_project_fund_id is null or p_daily_fund_request_id is not null then
      raise exception 'Choose the project for a corrected Cash In';
    end if;
    select status
    into v_project_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = v_original.organization_id;
    if not found or v_project_status not in ('open', 'on_hold', 'closed') then
      raise exception 'Choose an existing project for the corrected Cash In';
    end if;
  elsif v_kind = 'project_cash_out' then
    if p_project_fund_id is null or p_daily_fund_request_id is not null then
      raise exception 'Choose the project for a corrected Cash Out';
    end if;
    select status
    into v_project_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = v_original.organization_id;
    if not found or v_project_status not in ('open', 'on_hold') then
      raise exception 'Choose an open project for the corrected Cash Out';
    end if;
    v_balance := private.finance_revised_balance(v_original.organization_id, 'project', p_project_fund_id);
    if v_balance < round(p_amount, 2) then
      raise exception 'Project balance is not enough for the corrected Cash Out';
    end if;
  elsif v_kind = 'operating_cash_out' then
    if p_project_fund_id is not null or p_daily_fund_request_id is null then
      raise exception 'Choose an approved Daily Fund request for the corrected Cash Out';
    end if;
    select status
    into v_daily_status
    from public.finance_daily_fund_requests
    where id = p_daily_fund_request_id
      and organization_id = v_original.organization_id;
    if not found or v_daily_status not in ('approved', 'partially_returned') then
      raise exception 'Choose an approved Daily Fund request for the corrected Cash Out';
    end if;
    v_balance := private.finance_revised_balance(v_original.organization_id, 'daily');
    if v_balance < round(p_amount, 2) then
      raise exception 'Daily Fund balance is not enough for the corrected Cash Out';
    end if;
  else
    if p_project_fund_id is null
      or p_daily_fund_request_id is not null
      or p_project_fund_id is distinct from v_original.project_fund_id then
      raise exception 'The corrected commission payout must stay linked to its original project';
    end if;
    if round(p_amount, 2) <> round(v_original.amount, 2) then
      raise exception 'The commission payout amount is fixed by the approved allocation';
    end if;
    if v_original.commission_allocation_id is null then
      raise exception 'The original commission payout has no allocation';
    end if;

    select allocation.status, allocation.amount
    into v_commission_status, v_commission_amount
    from public.commission_summary_allocations allocation
    where allocation.id = v_original.commission_allocation_id
      and allocation.organization_id = v_original.organization_id
    for share;

    if not found or v_commission_status <> 'not_yet_paid' then
      raise exception 'The commission allocation is no longer payable';
    end if;
    if round(v_commission_amount, 2) <> round(v_original.amount, 2) then
      raise exception 'The commission allocation amount has changed';
    end if;

    select status
    into v_project_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = v_original.organization_id;
    if not found or v_project_status not in ('open', 'on_hold', 'closed') then
      raise exception 'Choose the original active project for the corrected commission payout';
    end if;
    v_balance := private.finance_revised_balance(v_original.organization_id, 'project', p_project_fund_id);
    if v_balance < round(p_amount, 2) then
      raise exception 'Project balance is not enough for the corrected commission payout';
    end if;
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    daily_fund_request_id,
    commission_allocation_id,
    category_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by,
    revision_of_transaction_id
  )
  values (
    v_original.organization_id,
    v_kind,
    p_project_fund_id,
    p_daily_fund_request_id,
    case when v_kind = 'commission_payout' then v_original.commission_allocation_id else null end,
    v_category_id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    v_category_name,
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_actor,
    v_original.id
  )
  returning id into v_id;

  return v_id;
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
    round(coalesce(sum(case when entry.entry_type = 'project_cash_in' and entry.ledger_type = 'project' then case when entry.direction = 'in' then entry.amount else -entry.amount end else 0 end), 0), 2),
    round(coalesce(sum(case when entry.entry_type in ('project_cash_out', 'commission_payout', 'operating_cash_out') then case when entry.direction = 'out' then entry.amount else -entry.amount end else 0 end), 0), 2),
    round(coalesce(sum(case when entry.entry_type = 'working_fund_support' and entry.ledger_type = 'working' then case when entry.direction = 'out' then entry.amount else -entry.amount end else 0 end), 0), 2),
    round(coalesce(sum(case when entry.entry_type = 'working_fund_repayment' and entry.ledger_type = 'working' then case when entry.direction = 'in' then entry.amount else -entry.amount end else 0 end), 0), 2),
    round(coalesce(sum(case when entry.entry_type = 'commission_payout' and entry.ledger_type = 'project' then case when entry.direction = 'out' then entry.amount else -entry.amount end else 0 end), 0), 2)
  into v_period_cash_in, v_period_cash_out, v_period_support, v_period_repayment, v_period_commission_paid
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.entry_date between coalesce(p_period_start, date_trunc('month', current_date)::date) and coalesce(p_period_end, current_date);

  select (
    select count(*) from public.finance_revised_transactions transaction
    where transaction.organization_id = p_organization_id and transaction.status = 'pending'
  ) + (
    select count(*) from public.finance_working_fund_requests request
    where request.organization_id = p_organization_id and request.status = 'pending'
  ) + (
    select count(*) from public.finance_daily_fund_requests request
    where request.organization_id = p_organization_id and request.status = 'pending'
  )
  into v_pending;

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
  coalesce(txn.category, finance_category.name) as category,
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
  coalesce(approved_profile.full_name, txn.approved_by::text) as approved_by_name,
  txn.category_id,
  txn.reviewed_by,
  txn.reviewed_at,
  txn.revision_of_transaction_id,
  coalesce(reviewed_profile.full_name, txn.reviewed_by::text) as reviewed_by_name
from public.finance_revised_transactions txn
left join public.project_funds fund on fund.id = txn.project_fund_id
left join public.quotations quotation on quotation.id = fund.quotation_id
left join public.finance_working_fund_requests request on request.id = txn.working_fund_request_id
left join public.finance_categories finance_category on finance_category.id = txn.category_id and finance_category.organization_id = txn.organization_id
left join public.commission_summary_allocations allocation on allocation.id = txn.commission_allocation_id and allocation.organization_id = txn.organization_id
left join public.profiles profile on profile.id = allocation.recipient_user_id
left join public.profiles submitted_profile on submitted_profile.id = txn.submitted_by
left join public.profiles approved_profile on approved_profile.id = txn.approved_by
left join public.profiles reviewed_profile on reviewed_profile.id = txn.reviewed_by;

revoke all on function public.review_finance_revised_transaction(uuid, text, text) from public, anon;
grant execute on function public.review_finance_revised_transaction(uuid, text, text) to authenticated;
revoke all on function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon;
grant execute on function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid) to authenticated;
revoke all on function public.get_finance_revised_snapshot(uuid, date, date) from public, anon;
grant execute on function public.get_finance_revised_snapshot(uuid, date, date) to authenticated;

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array[
    'finance_revised_transactions',
    'finance_working_fund_requests',
    'finance_daily_fund_requests'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

commit;
