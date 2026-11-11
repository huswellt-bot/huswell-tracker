-- Harden the revised Finance cutover.
--
-- Revised Finance has one operational role (accountant) plus management/GM
-- roles. The old internal_finance capability and account-based queue must not
-- grant or contribute to the revised project-ledger workflow.

begin;

create or replace function private.finance_revised_can_operate(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin', 'accountant']
    );
$$;

create or replace function private.finance_revised_business_date()
returns date
language sql
stable
security definer
set search_path = public, private
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- Keep legacy helper callers aligned with the unified role model. These
-- helpers no longer treat internal_finance capability rows as an access path.
create or replace function private.finance_is_internal(
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
    array['super_admin', 'owner', 'admin', 'accountant']
  );
$$;

create or replace function private.finance_is_external_or_internal(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.finance_is_internal(p_organization_id);
$$;

create or replace function private.finance_is_budget_operator(
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
    array['super_admin', 'owner', 'admin', 'accountant']
  );
$$;

revoke all on function private.finance_revised_business_date() from public, anon, authenticated;
grant execute on function private.finance_revised_business_date() to authenticated;
revoke all on function private.finance_is_internal(uuid) from public, anon, authenticated;
grant execute on function private.finance_is_internal(uuid) to authenticated;
revoke all on function private.finance_is_external_or_internal(uuid) from public, anon, authenticated;
grant execute on function private.finance_is_external_or_internal(uuid) to authenticated;
revoke all on function private.finance_is_budget_operator(uuid) from public, anon, authenticated;
grant execute on function private.finance_is_budget_operator(uuid) to authenticated;

-- The Finance approval badge must match the revised GM Approvals table. Keep
-- unrelated workspace queue counts, but replace only the Finance count.
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
  v_finance bigint := 0;
begin
  v_counts := public.sidebar_queue_counts(p_organization_id);

  if private.finance_revised_can_operate(p_organization_id) then
    select
      coalesce((
        select count(*)
        from public.finance_revised_transactions transaction
        where transaction.organization_id = p_organization_id
          and transaction.status = 'pending'
      ), 0)
      + coalesce((
        select count(*)
        from public.finance_working_fund_requests request
        where request.organization_id = p_organization_id
          and request.status = 'pending'
      ), 0)
      + coalesce((
        select count(*)
        from public.finance_daily_fund_requests request
        where request.organization_id = p_organization_id
          and request.status = 'pending'
      ), 0)
    into v_finance;
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

-- Direct reads are allowed; all writes must continue through guarded RPCs.
-- Revoke inherited DML grants left by the old account-based Finance release.
revoke all on table
  public.finance_categories,
  public.finance_working_fund_requests,
  public.finance_working_fund_request_lines,
  public.finance_revised_transactions,
  public.finance_revised_ledger_entries,
  public.finance_daily_fund_requests,
  public.finance_revised_transaction_feed,
  public.finance_revised_working_fund_request_feed,
  public.finance_revised_daily_fund_request_feed
from authenticated;

grant select on table
  public.finance_categories,
  public.finance_working_fund_requests,
  public.finance_working_fund_request_lines,
  public.finance_revised_transactions,
  public.finance_revised_ledger_entries,
  public.finance_daily_fund_requests,
  public.finance_revised_transaction_feed,
  public.finance_revised_working_fund_request_feed,
  public.finance_revised_daily_fund_request_feed
to authenticated;

drop policy if exists "finance categories: finance read" on public.finance_categories;
create policy "finance categories: finance read"
on public.finance_categories
for select to authenticated
using ((select private.finance_revised_can_operate(organization_id)));

create or replace function public.get_finance_revised_current_balances(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_capital numeric;
  v_working numeric;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view current Finance balances';
  end if;

  select round(coalesce(sum(
    case when entry.direction = 'in' then entry.amount else -entry.amount end
  ), 0), 2)
  into v_capital
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.ledger_type = 'capital';

  select round(coalesce(sum(
    case when entry.direction = 'in' then entry.amount else -entry.amount end
  ), 0), 2)
  into v_working
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.ledger_type = 'working';

  return jsonb_build_object(
    'capital_funds', coalesce(v_capital, 0),
    'working_funds', coalesce(v_working, 0),
    'as_of_date', private.finance_revised_business_date()
  );
end;
$$;

revoke all on function public.get_finance_revised_current_balances(uuid) from public, anon;
grant execute on function public.get_finance_revised_current_balances(uuid) to authenticated;

-- Capital and Capital -> Working entries are automatic-date actions. Use the
-- business timezone instead of the database server's UTC date.
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
    private.finance_revised_business_date(),
    null,
    'Owner investment',
    null,
    null,
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
    private.finance_revised_business_date(),
    'Capital to Working Funds',
    null,
    null,
    (select auth.uid())
  )
  returning id into v_id;

  perform private.post_finance_revised_transaction(v_id, (select auth.uid()), 'GM Working Fund transfer');
  return v_id;
end;
$$;

revoke all on function public.create_finance_revised_capital_contribution(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.create_finance_revised_capital_contribution(uuid, numeric, text, date, text, text) to authenticated;
revoke all on function public.create_finance_revised_capital_to_working(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.create_finance_revised_capital_to_working(uuid, numeric, date, text, text) to authenticated;

-- Approval-created support and audited reversal entries are also automatic
-- postings. Keep their ledger dates in the business timezone.
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
      private.finance_revised_business_date(),
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

revoke all on function public.review_finance_revised_working_fund_request(uuid, text, numeric, text) from public, anon;
grant execute on function public.review_finance_revised_working_fund_request(uuid, text, numeric, text) to authenticated;

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
  v_business_date date := private.finance_revised_business_date();
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
    set status = 'cancelled', updated_at = now()
    where id = v_transaction.daily_fund_request_id
      and organization_id = v_transaction.organization_id;
  elsif v_transaction.transaction_kind = 'daily_fund_return' then
    select * into v_daily_request
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
    select * into v_request
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
    set support_transaction_id = null, status = 'approved', updated_at = now()
    where id = v_request.id;
  elsif v_transaction.transaction_kind = 'working_fund_repayment' then
    select * into v_request
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
    select allocation.commission_summary_id into v_summary_id
    from public.commission_summary_allocations allocation
    where allocation.id = v_transaction.commission_allocation_id
      and allocation.organization_id = v_transaction.organization_id
    for update;
    if v_summary_id is null then
      raise exception 'Commission allocation not found for this reversal';
    end if;
    update public.commission_summary_allocations
    set status = 'not_yet_paid', eligible_at = coalesce(eligible_at, now()), paid_at = null, paid_by = null
    where id = v_transaction.commission_allocation_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summaries summary
    set status = 'not_yet_paid', paid_at = null, paid_by = null
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
    case when v_transaction.transaction_kind in ('working_fund_support', 'working_fund_repayment') then v_transaction.working_fund_request_id else null end,
    case when v_transaction.transaction_kind in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out') then v_transaction.daily_fund_request_id else null end,
    v_transaction.amount,
    v_business_date,
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
      v_business_date,
      'Reversal of ' || v_transaction.id::text,
      v_actor
    );
  end loop;

  update public.finance_revised_transactions
  set status = 'voided', decision_note = 'Reversed: ' || btrim(p_reason), updated_at = now()
  where id = v_transaction.id;

  return v_adjustment_id;
end;
$$;

revoke all on function public.void_finance_revised_transaction(uuid, text) from public, anon;
grant execute on function public.void_finance_revised_transaction(uuid, text) to authenticated;

commit;
