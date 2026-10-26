-- Allow Internal Finance to permanently remove only unused finance accounts.
-- Accounts with balances or financial history must remain available for audit
-- and can still be deactivated instead.

begin;

create or replace function public.delete_finance_account(
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_account public.finance_accounts%rowtype;
begin
  select * into v_account
  from public.finance_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Finance account not found';
  end if;

  if not private.finance_is_internal(v_account.organization_id) then
    raise exception 'Only Internal Finance can permanently delete a Finance account';
  end if;

  if coalesce(v_account.opening_balance, 0) <> 0 then
    raise exception 'Cannot permanently delete an account with an opening balance; deactivate it instead';
  end if;

  if exists (
    select 1 from public.finance_transactions
    where account_id = v_account.id
  ) then
    raise exception 'Cannot permanently delete an account with finance transactions; deactivate it instead';
  end if;

  if exists (
    select 1 from public.quotation_payment_records
    where finance_account_id = v_account.id
  ) then
    raise exception 'Cannot permanently delete an account linked to quotation payments; deactivate it instead';
  end if;

  if exists (
    select 1 from public.finance_account_budget_allocations
    where account_id = v_account.id
  ) then
    raise exception 'Cannot permanently delete an account linked to budget allocations; deactivate it instead';
  end if;

  if exists (
    select 1 from public.finance_account_funding_entries
    where account_id = v_account.id
  ) then
    raise exception 'Cannot permanently delete an account with funding history; deactivate it instead';
  end if;

  if exists (
    select 1 from public.finance_account_funding_requests
    where account_id = v_account.id
  ) then
    raise exception 'Cannot permanently delete an account with funding requests; deactivate it instead';
  end if;

  delete from public.finance_accounts
  where id = v_account.id;

  return v_account.id;
end;
$$;

revoke all on function public.delete_finance_account(uuid) from public;
grant execute on function public.delete_finance_account(uuid) to authenticated;

commit;
