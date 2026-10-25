-- The available-cash view is security-invoker, so authenticated Finance users
-- must not need EXECUTE on the private budget-period helper. Keep the helper
-- private and use the current Manila month directly in this user-facing view.
-- Run after 247_finance_budget_allocation_available_cash.sql.

begin;

create or replace view public.finance_account_balances
with (security_invoker = true)
as
select
  account.organization_id,
  account.id,
  account.account_name,
  account.account_type,
  account.account_number,
  account.opening_balance,
  account.is_active,
  round(
    account.opening_balance
    + coalesce((
        select sum(funding.amount)
        from public.finance_account_funding_entries funding
        where funding.organization_id = account.organization_id
          and funding.account_id = account.id
          and not funding.is_voided
      ), 0)
    + coalesce(sum(
        case
          when entry.is_voided = false
            and entry.transaction_type = 'income'
            and entry.payment_status = 'paid'
            and entry.approval_status = 'not_required'
            then entry.amount
          when entry.is_voided = false
            and entry.transaction_type = 'expense'
            and entry.payment_status = 'paid'
            and entry.approval_status = 'approved'
            then -entry.amount
          else 0
        end
      ), 0)
    + coalesce((
        select sum(allocation.allocated_amount)
        from public.finance_account_budget_allocations allocation
        join public.finance_budget_periods period
          on period.id = allocation.period_id
        where allocation.organization_id = account.organization_id
          and allocation.account_id = account.id
          and period.status = 'open'
          and period.period_start = date_trunc('month', timezone('Asia/Manila', now()))::date
      ), 0),
    2
  ) as current_balance,
  account.payment_method,
  account.is_default_for_payment_method,
  account.custom_account_type_id,
  custom_type.name as custom_account_type_name
from public.finance_accounts account
left join public.finance_transactions entry
  on entry.account_id = account.id
left join public.finance_account_types custom_type
  on custom_type.id = account.custom_account_type_id
 and custom_type.organization_id = account.organization_id
group by account.organization_id, account.id, account.account_name,
  account.account_type, account.account_number, account.opening_balance,
  account.is_active, account.payment_method, account.is_default_for_payment_method,
  account.custom_account_type_id, custom_type.name;

commit;
