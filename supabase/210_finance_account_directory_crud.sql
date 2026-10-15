-- Add safe CRUD operations for the Internal Finance account directory.
-- Deactivation is the delete operation: historical balances, payments, and
-- receipts continue to reference the account and remain auditable.
-- Run after 209_price_quotation_review_payment_terms.sql and before the
-- matching Finance workspace update. Safe to re-run.

begin;

create or replace function public.update_finance_account(
  p_account_id uuid,
  p_account_name text,
  p_account_type text,
  p_account_number text,
  p_payment_method public.payment_method,
  p_is_default_for_payment_method boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_account public.finance_accounts%rowtype;
  v_is_default boolean;
  v_payment_method public.payment_method := coalesce(p_payment_method, 'other'::public.payment_method);
begin
  select * into v_account
  from public.finance_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Finance account not found';
  end if;
  v_is_default := coalesce(
    p_is_default_for_payment_method,
    v_account.is_default_for_payment_method
  );
  if not private.finance_is_internal(v_account.organization_id) then
    raise exception 'Only Internal Finance can edit a Finance account';
  end if;
  if nullif(btrim(coalesce(p_account_name, '')), '') is null then
    raise exception 'Account name is required';
  end if;
  if p_account_type not in ('bank', 'e_wallet', 'cash', 'other') then
    raise exception 'Choose a valid account type';
  end if;
  if v_is_default and not v_account.is_active then
    raise exception 'An inactive account cannot be the default receiving account';
  end if;
  if v_payment_method is distinct from v_account.payment_method
    and exists (
      select 1
      from public.quotation_payment_records payment
      where payment.finance_account_id = v_account.id
    ) then
    raise exception 'Cannot change the payment method of an account already linked to quotation receipts; create a new account instead';
  end if;

  if v_is_default then
    update public.finance_accounts
    set is_default_for_payment_method = false
    where organization_id = v_account.organization_id
      and payment_method = v_payment_method
      and is_default_for_payment_method
      and id <> v_account.id;
  end if;

  update public.finance_accounts
  set account_name = btrim(p_account_name),
      account_type = p_account_type,
      account_number = nullif(btrim(coalesce(p_account_number, '')), ''),
      payment_method = v_payment_method,
      is_default_for_payment_method = v_is_default
  where id = v_account.id;

  return v_account.id;
end;
$$;

revoke all on function public.update_finance_account(
  uuid, text, text, text, public.payment_method, boolean
) from public;
grant execute on function public.update_finance_account(
  uuid, text, text, text, public.payment_method, boolean
) to authenticated;

create or replace function public.set_finance_account_active(
  p_account_id uuid,
  p_is_active boolean
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
    raise exception 'Only Internal Finance can change a Finance account status';
  end if;
  if p_is_active is null then
    raise exception 'Account status is required';
  end if;

  update public.finance_accounts
  set is_active = p_is_active,
      is_default_for_payment_method = case
        when p_is_active then is_default_for_payment_method
        else false
      end
  where id = v_account.id;

  return v_account.id;
end;
$$;

revoke all on function public.set_finance_account_active(uuid, boolean) from public;
grant execute on function public.set_finance_account_active(uuid, boolean) to authenticated;

commit;
