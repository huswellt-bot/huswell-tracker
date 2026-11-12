-- Keep the released project-ledger Finance workflow isolated from the older
-- bank/account and capability-based Finance surface.

begin;

-- Existing legacy Finance memberships must remain Accounting & Finance
-- memberships. The check prevents a direct organization_members write from
-- reintroducing either retired role after the application update.
update public.organization_members
set role = 'accountant'::public.member_role
where role::text in ('internal_finance', 'external_finance');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and conname = 'organization_members_no_legacy_finance_roles'
  ) then
    alter table public.organization_members
      add constraint organization_members_no_legacy_finance_roles
      check (role::text not in ('internal_finance', 'external_finance'));
  end if;
end;
$$;

-- The old capability is no longer an authorization path. Remove any stale
-- grants and make the compatibility helper fail closed for legacy callers.
do $$
begin
  if to_regclass('public.organization_member_capabilities') is not null then
    execute 'delete from public.organization_member_capabilities
      where capability = ''internal_finance''';
  end if;
end;
$$;

create or replace function private.has_member_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select false;
$$;

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
    array['super_admin', 'owner', 'admin']
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
    array['super_admin', 'owner', 'admin']
  );
$$;

revoke all on function private.has_member_capability(uuid, text)
from public, anon, authenticated;
grant execute on function private.has_member_capability(uuid, text)
to authenticated;
revoke all on function private.finance_is_internal(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_internal(uuid)
to authenticated;
revoke all on function private.finance_is_external_or_internal(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_external_or_internal(uuid)
to authenticated;
revoke all on function private.finance_is_budget_operator(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_budget_operator(uuid)
to authenticated;

-- Keep the GM performance widgets on the revised project ledger. The old
-- dashboard function calculated cash from bank accounts and legacy Finance
-- transactions, which is no longer the source of truth.
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
  v_month_start date := date_trunc(
    'month',
    coalesce(p_month, private.finance_revised_business_date())
  )::date;
  v_next_month date := (
    date_trunc(
      'month',
      coalesce(p_month, private.finance_revised_business_date())
    ) + interval '1 month'
  )::date;
  v_year_start date := date_trunc(
    'year',
    coalesce(p_month, private.finance_revised_business_date())
  )::date;
  v_result jsonb;
begin
  if (select auth.uid()) is null
    or not private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin']
    ) then
    raise exception 'Not authorized for GM Finance dashboard';
  end if;

  with monthly_flow as (
    select
      months.month_start::date,
      round(coalesce(sum(
        case
          when entry.entry_type = 'project_cash_in'
            and entry.ledger_type = 'project'
            then case when entry.direction = 'in' then entry.amount else -entry.amount end
          else 0
        end
      ), 0), 2) as cash_in,
      round(coalesce(sum(
        case
          when entry.entry_type in ('project_cash_out', 'commission_payout', 'operating_cash_out')
            then case when entry.direction = 'out' then entry.amount else -entry.amount end
          else 0
        end
      ), 0), 2) as cash_out
    from generate_series(
      v_year_start::timestamp,
      (v_year_start + interval '11 months')::timestamp,
      interval '1 month'
    ) as months(month_start)
    left join public.finance_revised_ledger_entries entry
      on entry.organization_id = p_organization_id
      and entry.entry_date >= months.month_start::date
      and entry.entry_date < (months.month_start + interval '1 month')::date
    group by months.month_start
  ),
  cash_position as (
    select round(coalesce(sum(
      case when entry.direction = 'in' then entry.amount else -entry.amount end
    ), 0), 2) as available_cash
    from public.finance_revised_ledger_entries entry
    where entry.organization_id = p_organization_id
      and entry.ledger_type in ('project', 'daily')
  ),
  source_breakdown as (
    select
      coalesce(nullif(transaction.category, ''), transaction.transaction_kind) as label,
      round(sum(
        case when entry.direction = 'in' then entry.amount else -entry.amount end
      ), 2) as amount
    from public.finance_revised_ledger_entries entry
    join public.finance_revised_transactions transaction
      on transaction.id = entry.transaction_id
    where entry.organization_id = p_organization_id
      and entry.entry_date >= v_month_start
      and entry.entry_date < v_next_month
      and entry.entry_type = 'project_cash_in'
      and entry.ledger_type = 'project'
    group by coalesce(nullif(transaction.category, ''), transaction.transaction_kind)
    order by amount desc, label
    limit 6
  ),
  expense_breakdown as (
    select
      coalesce(nullif(transaction.category, ''), transaction.transaction_kind) as label,
      round(sum(
        case when entry.direction = 'out' then entry.amount else -entry.amount end
      ), 2) as amount
    from public.finance_revised_ledger_entries entry
    join public.finance_revised_transactions transaction
      on transaction.id = entry.transaction_id
    where entry.organization_id = p_organization_id
      and entry.entry_date >= v_month_start
      and entry.entry_date < v_next_month
      and entry.entry_type in ('project_cash_out', 'commission_payout', 'operating_cash_out')
    group by coalesce(nullif(transaction.category, ''), transaction.transaction_kind)
    order by amount desc, label
    limit 6
  )
  select jsonb_build_object(
    'kpi_version', 2,
    'reporting_month', v_month_start,
    'cash_in', coalesce((
      select sum(monthly.cash_in)
      from monthly_flow monthly
      where monthly.month_start = v_month_start
    ), 0),
    'cash_out', coalesce((
      select sum(monthly.cash_out)
      from monthly_flow monthly
      where monthly.month_start = v_month_start
    ), 0),
    'available_cash', coalesce((select available_cash from cash_position), 0),
    'supplier_payables_open', round(coalesce((
      select sum(greatest(payable.amount - payable.amount_paid, 0))
      from public.supplier_payables payable
      where payable.organization_id = p_organization_id
        and payable.status not in ('paid', 'cancelled')
    ), 0), 2),
    'commission_payables_open', round(coalesce((
      select sum(allocation.amount)
      from public.commission_summary_allocations allocation
      where allocation.organization_id = p_organization_id
        and allocation.status = 'not_yet_paid'
    ), 0), 2),
    'pending_cash_out', (
      select count(*)
      from public.finance_revised_transactions transaction
      where transaction.organization_id = p_organization_id
        and transaction.transaction_kind in ('project_cash_out', 'operating_cash_out', 'commission_payout')
        and transaction.status = 'pending'
    ),
    'pending_budget_requests', (
      select count(*)
      from public.finance_working_fund_requests request
      where request.organization_id = p_organization_id
        and request.status = 'pending'
    ) + (
      select count(*)
      from public.finance_daily_fund_requests request
      where request.organization_id = p_organization_id
        and request.status = 'pending'
    ),
    'budget_granted', 0,
    'budget_allocated', 0,
    'budget_remaining', 0,
    'monthly_cash_flow', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'label', to_char(monthly.month_start, 'Mon'),
          'month', to_char(monthly.month_start, 'YYYY-MM'),
          'cash_in', monthly.cash_in,
          'cash_out', monthly.cash_out,
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
    'account_balances', '[]'::jsonb
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.shared_kpi_finance_dashboard(uuid, date)
from public, anon;
grant execute on function public.shared_kpi_finance_dashboard(uuid, date)
to authenticated;

-- The revised workspace does not use these legacy account, budget, bank/e-wallet,
-- manual-income, or old transaction RPCs. Revoke their API entry points while
-- retaining the historical tables for explicit reconciliation outside the app.
do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'allocate_finance_account_budget',
        'approve_and_pay_finance_transaction',
        'archive_finance_category',
        'assign_finance_transaction_account',
        'create_finance_account_funding_request',
        'create_finance_account_funding',
        'create_finance_account_type',
        'create_finance_account_with_mapping',
        'create_finance_account',
        'create_finance_category',
        'create_finance_budget_grant',
        'create_finance_budget_request',
        'create_finance_transaction_with_budget',
        'create_finance_transaction_with_commission_allocation',
        'create_finance_transaction',
        'create_manual_finance_income',
        'delete_finance_account',
        'external_finance_quotation_rows',
        'finance_commission_payable_quotation_ids',
        'finance_project_expense_rows',
        'finance_quotation_direct_cost_rows',
        'get_finance_activity_history',
        'get_finance_budget_snapshot',
        'get_finance_foundation_snapshot',
        'link_operating_cost_finance_transaction',
        'list_finance_expense_accounts',
        'list_finance_funding_request_accounts',
        'list_finance_payment_accounts',
        'mark_finance_transaction_paid',
        'reallocate_finance_account_budget',
        'remove_finance_account_type',
        'remove_finance_category',
        'request_finance_transaction_revision',
        'request_manual_finance_income_revision',
        'resubmit_finance_account_funding_request',
        'resubmit_finance_budget_request',
        'resubmit_finance_transaction_as_regular',
        'resubmit_finance_transaction',
        'resubmit_manual_finance_income',
        'resubmit_quotation_payment_with_account',
        'register_quotation_payment_with_account',
        'return_finance_account_budget',
        'review_finance_account_funding_request',
        'review_finance_budget_request',
        'review_finance_transaction',
        'set_finance_account_active',
        'list_quotation_payment_accounts',
        'update_pending_quotation_payment_account',
        'upsert_finance_foundation_settings',
        'verify_manual_finance_income',
        'void_finance_account_funding',
        'void_manual_finance_income',
        'update_finance_account'
      ])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_signature
    );
  end loop;
end;
$$;

-- Direct reads of retired account/transaction tables are also removed. Their
-- rows remain available to service-role reconciliation and guarded functions.
do $$
declare
  v_table text;
begin
  for v_table in
    select unnest(array[
      'finance_accounts',
      'finance_account_budget_allocation_events',
      'finance_account_budget_allocations',
      'finance_account_funding_entries',
      'finance_account_funding_requests',
      'finance_account_types',
      'finance_budget_grants',
      'finance_budget_periods',
      'finance_budget_request_revisions',
      'finance_budget_requests',
      'finance_account_balances',
      'finance_account_budget_summary',
      'finance_foundation_settings',
      'finance_monthly_summary',
      'finance_operating_cost_summary',
      'finance_project_fund_summary',
      'finance_project_labor_summary',
      'finance_transaction_revisions',
      'finance_transactions'
    ])
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        v_table
      );
    end if;
  end loop;
end;
$$;

commit;
