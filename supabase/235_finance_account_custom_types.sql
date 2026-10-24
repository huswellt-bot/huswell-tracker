-- Add organization-scoped custom account types. The account directory keeps
-- account_type = 'other' for compatibility and stores the selected custom
-- type in custom_account_type_id.
-- Run after 234_finance_accounts_metadata_only.sql and before deploying the
-- matching Finance workspace update. Safe to re-run.

begin;

create table if not exists public.finance_account_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_account_types_active_name_idx
  on public.finance_account_types(organization_id, lower(btrim(name)))
  where is_active;
create index if not exists finance_account_types_org_active_idx
  on public.finance_account_types(organization_id, is_active, name);

drop trigger if exists finance_account_types_set_updated_at on public.finance_account_types;
create trigger finance_account_types_set_updated_at
before update on public.finance_account_types
for each row execute function public.set_updated_at();

alter table public.finance_account_types enable row level security;
revoke all on table public.finance_account_types from anon, authenticated;
grant select on table public.finance_account_types to authenticated;
drop policy if exists finance_account_types_internal_select on public.finance_account_types;
create policy finance_account_types_internal_select
on public.finance_account_types
for select to authenticated
using (private.finance_is_internal(organization_id));

alter table public.finance_accounts
  add column if not exists custom_account_type_id uuid
  references public.finance_account_types(id) on delete restrict;
create index if not exists finance_accounts_custom_account_type_idx
  on public.finance_accounts(custom_account_type_id);

create or replace function public.create_finance_account_type(
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_internal(v_organization_id) then
    raise exception 'Only Internal Finance can create account types';
  end if;
  if v_name = '' then
    raise exception 'Account type name is required';
  end if;
  if length(v_name) > 80 then
    raise exception 'Account type name must be 80 characters or fewer';
  end if;

  begin
    insert into public.finance_account_types (organization_id, name, created_by)
    values (v_organization_id, v_name, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That account type already exists';
  end;

  return v_id;
end;
$$;

revoke all on function public.create_finance_account_type(text) from public;
grant execute on function public.create_finance_account_type(text) to authenticated;

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

drop function if exists public.create_finance_account_with_mapping(
  uuid, text, text, text, numeric, text, text, text, bigint,
  public.payment_method, boolean
);

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
  p_is_default_for_payment_method boolean default false,
  p_custom_account_type_id uuid default null
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
  if p_custom_account_type_id is not null then
    if p_account_type <> 'other' then
      raise exception 'Custom account types must use the Other account type';
    end if;
    if not exists (
      select 1
      from public.finance_account_types
      where id = p_custom_account_type_id
        and organization_id = v_organization_id
        and is_active
    ) then
      raise exception 'Choose a valid active custom account type';
    end if;
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
    opening_balance, payment_method, is_default_for_payment_method,
    custom_account_type_id, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    null, 0, v_payment_method, coalesce(p_is_default_for_payment_method, false),
    p_custom_account_type_id, (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account_with_mapping(
  uuid, text, text, text, numeric, text, text, text, bigint,
  public.payment_method, boolean, uuid
) from public;
grant execute on function public.create_finance_account_with_mapping(
  uuid, text, text, text, numeric, text, text, text, bigint,
  public.payment_method, boolean, uuid
) to authenticated;

drop function if exists public.create_finance_account(
  uuid, text, text, text, numeric, text, text, text, bigint
);

create or replace function public.create_finance_account(
  p_account_id uuid,
  p_account_name text,
  p_account_type text,
  p_account_number text,
  p_opening_balance numeric,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint,
  p_custom_account_type_id uuid default null
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
  if p_custom_account_type_id is not null then
    if p_account_type <> 'other' then
      raise exception 'Custom account types must use the Other account type';
    end if;
    if not exists (
      select 1
      from public.finance_account_types
      where id = p_custom_account_type_id
        and organization_id = v_organization_id
        and is_active
    ) then
      raise exception 'Choose a valid active custom account type';
    end if;
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
    opening_balance, payment_method, custom_account_type_id, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    null, 0, v_payment_method, p_custom_account_type_id, (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account(
  uuid, text, text, text, numeric, text, text, text, bigint, uuid
) from public;
grant execute on function public.create_finance_account(
  uuid, text, text, text, numeric, text, text, text, bigint, uuid
) to authenticated;

drop function if exists public.update_finance_account(
  uuid, text, text, text, public.payment_method, boolean
);

create or replace function public.update_finance_account(
  p_account_id uuid,
  p_account_name text,
  p_account_type text,
  p_account_number text,
  p_payment_method public.payment_method,
  p_is_default_for_payment_method boolean default null,
  p_custom_account_type_id uuid default null
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
  if p_custom_account_type_id is not null then
    if p_account_type <> 'other' then
      raise exception 'Custom account types must use the Other account type';
    end if;
    if not exists (
      select 1
      from public.finance_account_types
      where id = p_custom_account_type_id
        and organization_id = v_account.organization_id
        and is_active
    ) then
      raise exception 'Choose a valid active custom account type';
    end if;
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
      is_default_for_payment_method = v_is_default,
      custom_account_type_id = p_custom_account_type_id
  where id = v_account.id;

  return v_account.id;
end;
$$;

revoke all on function public.update_finance_account(
  uuid, text, text, text, public.payment_method, boolean, uuid
) from public;
grant execute on function public.update_finance_account(
  uuid, text, text, text, public.payment_method, boolean, uuid
) to authenticated;

commit;
