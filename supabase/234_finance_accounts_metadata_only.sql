-- Make new Finance accounts metadata-only. Budget capacity comes from the GM
-- budget grant and Internal Finance allocation workflow. Preserve the legacy
-- account balance and receipt columns for existing rows and audit history.
-- Run after 233_finance_gm_budget_only_and_legacy_compatibility.sql and before
-- deploying the matching Finance workspace update. Safe to re-run.

begin;

create or replace function public.create_finance_account_with_mapping(
  p_account_id uuid,
  p_account_name text,
  p_account_type text,
  p_account_number text,
  p_opening_balance numeric,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint,
  p_payment_method public.payment_method,
  p_is_default_for_payment_method boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_payment_method public.payment_method := coalesce(p_payment_method, 'other'::public.payment_method);
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_internal(v_organization_id) then
    raise exception 'Only Internal Finance can add a bank or e-wallet account';
  end if;
  if p_account_id is null or nullif(btrim(coalesce(p_account_name, '')), '') is null then
    raise exception 'Account name is required';
  end if;
  if p_account_type not in ('bank', 'e_wallet', 'cash', 'other') then
    raise exception 'Choose a valid account type';
  end if;
  if nullif(btrim(coalesce(p_account_number, '')), '') is not null
    or coalesce(p_opening_balance, 0) <> 0
    or p_receipt_storage_path is not null
    or p_receipt_file_name is not null
    or p_receipt_content_type is not null
    or p_receipt_file_size is not null then
    raise exception 'Create the account first; use GM budget allocation for spending capacity';
  end if;

  if coalesce(p_is_default_for_payment_method, false) then
    update public.finance_accounts
    set is_default_for_payment_method = false
    where organization_id = v_organization_id
      and payment_method = v_payment_method
      and is_default_for_payment_method;
  end if;

  insert into public.finance_accounts (
    id, organization_id, account_name, account_type, account_number,
    opening_balance, payment_method, is_default_for_payment_method, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    null, 0, v_payment_method, coalesce(p_is_default_for_payment_method, false),
    (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account_with_mapping(
  uuid, text, text, text, numeric, text, text, text, bigint,
  public.payment_method, boolean
) from public;
grant execute on function public.create_finance_account_with_mapping(
  uuid, text, text, text, numeric, text, text, text, bigint,
  public.payment_method, boolean
) to authenticated;

create or replace function public.create_finance_account(
  p_account_id uuid,
  p_account_name text,
  p_account_type text,
  p_account_number text,
  p_opening_balance numeric,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_payment_method public.payment_method;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_internal(v_organization_id) then
    raise exception 'Only Internal Finance can add a bank or e-wallet account';
  end if;
  if p_account_id is null or nullif(btrim(coalesce(p_account_name, '')), '') is null then
    raise exception 'Account name is required';
  end if;
  if p_account_type not in ('bank', 'e_wallet', 'cash', 'other') then
    raise exception 'Choose a valid account type';
  end if;
  if nullif(btrim(coalesce(p_account_number, '')), '') is not null
    or coalesce(p_opening_balance, 0) <> 0
    or p_receipt_storage_path is not null
    or p_receipt_file_name is not null
    or p_receipt_content_type is not null
    or p_receipt_file_size is not null then
    raise exception 'Create the account first; use GM budget allocation for spending capacity';
  end if;

  v_payment_method := case p_account_type
    when 'cash' then 'cash'::public.payment_method
    when 'bank' then 'bank_transfer'::public.payment_method
    when 'e_wallet' then 'gcash'::public.payment_method
    else 'other'::public.payment_method
  end;

  insert into public.finance_accounts (
    id, organization_id, account_name, account_type, account_number,
    opening_balance, payment_method, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    null, 0, v_payment_method, (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account(
  uuid, text, text, text, numeric, text, text, text, bigint
) from public;
grant execute on function public.create_finance_account(
  uuid, text, text, text, numeric, text, text, text, bigint
) to authenticated;

commit;
