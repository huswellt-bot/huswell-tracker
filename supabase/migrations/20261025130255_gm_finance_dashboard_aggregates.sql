-- Provide the GM dashboard with organization-level Finance metrics without
-- exposing the underlying ledger rows to the client. Run after the current
-- Finance and commission migrations, then deploy the matching workspace code.

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
  v_next_month date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  v_year_start date := date_trunc('year', coalesce(p_month, current_date))::date;
  v_next_year date := (date_trunc('year', coalesce(p_month, current_date)) + interval '1 year')::date;
  v_result jsonb;
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Not authorized for GM Finance dashboard';
  end if;

  with
  ledger as (
    select
      transaction.id,
      transaction.category_id,
      transaction.account_id,
      transaction.transaction_type,
      transaction.amount,
      transaction.transaction_date,
      category.name as category_name,
      account.account_name
    from public.finance_transactions transaction
    join public.finance_categories category on category.id = transaction.category_id
    join public.finance_accounts account on account.id = transaction.account_id
    where transaction.organization_id = p_organization_id
      and not transaction.is_voided
  ),
  monthly_flow as (
    select
      months.month_start,
      coalesce(sum(ledger.amount) filter (
        where ledger.transaction_type = 'income'
          and ledger.transaction_date >= months.month_start
          and ledger.transaction_date < (months.month_start + interval '1 month')::date
      ), 0) as cash_in,
      coalesce(sum(ledger.amount) filter (
        where ledger.transaction_type = 'expense'
          and ledger.transaction_date >= months.month_start
          and ledger.transaction_date < (months.month_start + interval '1 month')::date
      ), 0) as cash_out
    from generate_series(
      v_year_start::timestamp,
      (v_year_start + interval '11 months')::timestamp,
      interval '1 month'
    ) as months(month_start)
    left join ledger
      on (
        ledger.transaction_type = 'income'
        and ledger.amount is not null
        and exists (
          select 1
          from public.finance_transactions income_transaction
          where income_transaction.id = ledger.id
            and income_transaction.payment_status = 'paid'
            and income_transaction.approval_status = 'not_required'
        )
      )
      or (
        ledger.transaction_type = 'expense'
        and exists (
          select 1
          from public.finance_transactions expense_transaction
          where expense_transaction.id = ledger.id
            and expense_transaction.payment_status = 'paid'
            and expense_transaction.approval_status = 'approved'
        )
      )
    group by months.month_start
  ),
  account_balances as (
    select
      account.id,
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
          select sum(allocation.allocated_amount)
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
  ),
  source_breakdown as (
    select
      ledger.category_name as label,
      round(sum(ledger.amount), 2) as amount
    from ledger
    where ledger.transaction_type = 'income'
      and ledger.transaction_date >= v_month_start
      and ledger.transaction_date < v_next_month
      and exists (
        select 1
        from public.finance_transactions transaction
        where transaction.id = ledger.id
          and transaction.payment_status = 'paid'
          and transaction.approval_status = 'not_required'
      )
    group by ledger.category_name
    order by amount desc, label
    limit 6
  ),
  expense_breakdown as (
    select
      ledger.category_name as label,
      round(sum(ledger.amount), 2) as amount
    from ledger
    where ledger.transaction_type = 'expense'
      and ledger.transaction_date >= v_month_start
      and ledger.transaction_date < v_next_month
      and exists (
        select 1
        from public.finance_transactions transaction
        where transaction.id = ledger.id
          and transaction.payment_status = 'paid'
          and transaction.approval_status = 'approved'
      )
    group by ledger.category_name
    order by amount desc, label
    limit 6
  ),
  budget_totals as (
    select
      coalesce((
        select sum(grant_row.amount)
        from public.finance_budget_grants grant_row
        join public.finance_budget_periods period on period.id = grant_row.period_id
        where grant_row.organization_id = p_organization_id
          and period.period_start = v_month_start
      ), 0) as granted,
      coalesce((
        select sum(allocation.allocated_amount)
        from public.finance_account_budget_allocations allocation
        join public.finance_budget_periods period on period.id = allocation.period_id
        where allocation.organization_id = p_organization_id
          and period.period_start = v_month_start
          and period.status = 'open'
      ), 0) as allocated
  ),
  supplier_totals as (
    select round(coalesce(sum(greatest(payable.amount - payable.amount_paid, 0)), 0), 2) as amount
    from public.supplier_payables payable
    where payable.organization_id = p_organization_id
      and payable.status not in ('paid', 'cancelled')
  ),
  commission_totals as (
    select round(coalesce(sum(allocation.amount), 0), 2) as amount
    from public.commission_summary_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.status = 'not_yet_paid'
  )
  select jsonb_build_object(
    'kpi_version', 1,
    'reporting_month', v_month_start,
    'cash_in', coalesce((
      select sum(ledger.amount)
      from ledger
      where ledger.transaction_type = 'income'
        and ledger.transaction_date >= v_month_start
        and ledger.transaction_date < v_next_month
        and exists (
          select 1 from public.finance_transactions transaction
          where transaction.id = ledger.id
            and transaction.payment_status = 'paid'
            and transaction.approval_status = 'not_required'
        )
    ), 0),
    'cash_out', coalesce((
      select sum(ledger.amount)
      from ledger
      where ledger.transaction_type = 'expense'
        and ledger.transaction_date >= v_month_start
        and ledger.transaction_date < v_next_month
        and exists (
          select 1 from public.finance_transactions transaction
          where transaction.id = ledger.id
            and transaction.payment_status = 'paid'
            and transaction.approval_status = 'approved'
        )
    ), 0),
    'available_cash', coalesce((select sum(account.current_balance) from account_balances account), 0),
    'supplier_payables_open', (select amount from supplier_totals),
    'commission_payables_open', (select amount from commission_totals),
    'pending_cash_out', (
      select count(*)
      from public.finance_transactions transaction
      where transaction.organization_id = p_organization_id
        and transaction.transaction_type = 'expense'
        and transaction.approval_status in ('pending', 'revision_requested')
        and not transaction.is_voided
    ),
    'pending_budget_requests', (
      select count(*)
      from public.finance_account_funding_requests request
      where request.organization_id = p_organization_id
        and request.status = 'pending'
    ),
    'budget_granted', (select granted from budget_totals),
    'budget_allocated', (select allocated from budget_totals),
    'budget_remaining', round(greatest(
      (select granted from budget_totals) - (select allocated from budget_totals),
      0
    ), 2),
    'monthly_cash_flow', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'label', to_char(monthly.month_start::date, 'Mon'),
          'month', to_char(monthly.month_start::date, 'YYYY-MM'),
          'cash_in', round(monthly.cash_in, 2),
          'cash_out', round(monthly.cash_out, 2),
          'net_cash_flow', round(monthly.cash_in - monthly.cash_out, 2)
        ) order by monthly.month_start
      )
      from monthly_flow monthly
    ), '[]'::jsonb),
    'cash_in_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('label', breakdown.label, 'amount', breakdown.amount) order by breakdown.amount desc)
      from source_breakdown breakdown
    ), '[]'::jsonb),
    'cash_out_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('label', breakdown.label, 'amount', breakdown.amount) order by breakdown.amount desc)
      from expense_breakdown breakdown
    ), '[]'::jsonb),
    'account_balances', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account_name', account.account_name,
          'current_balance', account.current_balance
        ) order by account.current_balance desc, account.account_name
      )
      from account_balances account
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.shared_kpi_finance_dashboard(uuid, date) from public;
grant execute on function public.shared_kpi_finance_dashboard(uuid, date) to authenticated;
