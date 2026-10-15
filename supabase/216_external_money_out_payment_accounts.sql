-- Let External Finance select the active Finance account used for Money Out.
-- Internal Finance still owns approval, account correction, payment settlement,
-- and the balance deduction. This migration preserves the limited account
-- directory boundary introduced by migration 212.
-- Run after 215_quotation_payment_receiving_account_correction.sql and before
-- deploying the matching Finance workspace update. Safe to re-run.

begin;

-- External Finance may see only the minimum account directory fields needed to
-- choose where a proposed Money Out will be paid from. Balances, account
-- numbers, opening amounts, funding, and account receipts remain internal.
create or replace function public.list_finance_payment_accounts(
  p_organization_id uuid
)
returns table (
  id uuid,
  account_name text,
  account_type text,
  payment_method public.payment_method,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array[
      'super_admin',
      'owner',
      'admin',
      'accountant',
      'internal_finance',
      'external_finance'
    ]) then
    raise exception 'You are not authorized to view Finance payment accounts';
  end if;

  return query
  select
    account.id,
    account.account_name,
    account.account_type,
    account.payment_method,
    account.is_active
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;

revoke all on function public.list_finance_payment_accounts(uuid) from public;
grant execute on function public.list_finance_payment_accounts(uuid) to authenticated;

-- External Finance may choose an active account at submission time. It cannot
-- confirm payment or change the account after submission; Internal Finance
-- uses the controlled account-assignment RPC below for corrections.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
begin
  if tg_op = 'INSERT'
    and private.finance_is_internal(new.organization_id)
    and new.source_payment_id is null
    and new.commission_allocation_id is null
    and not v_commission_context then
    raise exception 'Internal Finance cannot create generic Money In or Money Out. Use payment verification, expense approval, or the commission payout workflow';
  end if;

  if private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id) then
    if new.transaction_type <> 'expense' then
      raise exception 'External Finance can submit Money Out only';
    end if;
    if new.payment_status <> 'unpaid' then
      raise exception 'External Finance cannot confirm a payment as paid';
    end if;
    if new.approval_status <> 'pending' then
      raise exception 'External Finance submissions must remain pending approval';
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
    if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then
      raise exception 'Only Internal Finance can change the Money Out payment account';
    end if;
    if new.commission_summary_id is not null
      or new.commission_allocation_id is not null then
      raise exception 'External Finance cannot submit commission payouts';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_submission_guard
  on public.finance_transactions;
create trigger finance_transactions_submission_guard
before insert or update of transaction_type, payment_status, approval_status,
  account_id, commission_summary_id, commission_allocation_id
on public.finance_transactions
for each row execute function private.finance_transaction_submission_guard();

-- Internal Finance can verify or correct the account selected by External
-- Finance while the Money Out is still unpaid. Automatic quotation Money In
-- rows retain their original account-reconciliation rule.
create or replace function public.assign_finance_transaction_account(
  p_transaction_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_previous_account public.finance_accounts%rowtype;
  v_selected_account public.finance_accounts%rowtype;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.is_voided then
    raise exception 'Voided transactions cannot change payment accounts';
  end if;

  if v_transaction.source_payment_id is not null then
    if v_transaction.account_id is not null then
      raise exception 'Only an unassigned automatic quotation payment can be reconciled';
    end if;
  elsif v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status not in ('pending', 'approved') then
    raise exception 'Only an unpaid Money Out can change its payment account';
  end if;

  select * into v_selected_account
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = v_transaction.organization_id
    and account.is_active
  for share;
  if not found then
    raise exception 'Choose an active Finance payment account';
  end if;

  if v_transaction.account_id is not distinct from v_selected_account.id then
    return v_transaction.id;
  end if;

  if v_transaction.account_id is not null then
    select * into v_previous_account
    from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id;
  end if;

  update public.finance_transactions
  set account_id = v_selected_account.id
  where id = v_transaction.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  )
  values (
    v_transaction.organization_id,
    (select auth.uid()),
    'finance_transaction',
    v_transaction.id,
    'payment_account_changed',
    jsonb_build_object(
      'account_id', v_transaction.account_id,
      'account_name', v_previous_account.account_name,
      'payment_method', v_previous_account.payment_method::text
    ),
    jsonb_build_object(
      'account_id', v_selected_account.id,
      'account_name', v_selected_account.account_name,
      'payment_method', v_selected_account.payment_method::text
    ),
    case
      when v_transaction.source_payment_id is null
        then 'Internal Finance corrected the Money Out payment account before settlement.'
      else 'Internal Finance assigned the account for an automatic quotation payment.'
    end
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.assign_finance_transaction_account(uuid, uuid) from public;
grant execute on function public.assign_finance_transaction_account(uuid, uuid) to authenticated;

commit;
