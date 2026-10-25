-- Treat an active monthly account allocation as spendable cash for that
-- account. The ledger still records actual Cash In and Cash Out separately;
-- adding the allocation to the balance makes the available-cash figure and
-- the paid-expense guard reflect the GM-approved spending capacity.
-- Run after 246_commission_summary_client_payment_status.sql.

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
          and period.period_start = private.finance_budget_period_start()
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

-- The same allocated amount must be accepted when an approved Cash Out is
-- posted. Paid expenses already reduce the ledger portion of current_balance,
-- so the allocation is added here as a funding capacity, not as its remaining
-- budget amount; using remaining budget would subtract the expense twice.
create or replace function private.assert_finance_account_has_funds(
  p_organization_id uuid,
  p_account_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_available numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The payment amount must be greater than zero';
  end if;

  perform 1
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = p_organization_id
    and account.is_active
  for update;
  if not found then
    raise exception 'Choose an active bank, e-wallet, or cash account';
  end if;

  select round(
    account.opening_balance
    + coalesce((
        select sum(funding.amount)
        from public.finance_account_funding_entries funding
        where funding.organization_id = account.organization_id
          and funding.account_id = account.id
          and not funding.is_voided
      ), 0)
    + coalesce((
        select sum(
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
        )
        from public.finance_transactions entry
        where entry.organization_id = account.organization_id
          and entry.account_id = account.id
      ), 0)
    + coalesce((
        select sum(allocation.allocated_amount)
        from public.finance_account_budget_allocations allocation
        join public.finance_budget_periods period
          on period.id = allocation.period_id
        where allocation.organization_id = account.organization_id
          and allocation.account_id = account.id
          and period.status = 'open'
          and period.period_start = private.finance_budget_period_start()
      ), 0),
    2
  )
  into v_available
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = p_organization_id;

  if coalesce(v_available, 0) + 0.001 < round(p_amount, 2) then
    raise exception 'Insufficient funds in the selected Finance account. Available: %, required: %',
      to_char(coalesce(v_available, 0), 'FM999999999990.00'),
      to_char(round(p_amount, 2), 'FM999999999990.00');
  end if;
end;
$$;

revoke all on function private.assert_finance_account_has_funds(uuid, uuid, numeric)
from public, authenticated;

commit;
