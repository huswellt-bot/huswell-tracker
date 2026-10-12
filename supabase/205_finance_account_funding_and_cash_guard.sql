-- Record later account funding without misclassifying it as customer income,
-- and prevent paid Money Out from taking an account below zero.
-- Run after 204_enforce_finance_role_boundaries.sql and before deploying the
-- matching Finance workspace update. Safe to re-run.

begin;

create table if not exists public.finance_account_funding_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  funding_source text not null check (funding_source in (
    'owner_funding', 'loan_received', 'external_deposit', 'other'
  )),
  funding_date date not null default current_date,
  note text,
  receipt_storage_path text not null unique,
  receipt_file_name text not null check (btrim(receipt_file_name) <> ''),
  receipt_content_type text not null check (receipt_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  receipt_file_size bigint not null check (receipt_file_size between 1 and 10485760),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  check ((is_voided = false and voided_at is null and voided_by is null) or is_voided = true)
);

create index if not exists finance_account_funding_org_date_idx
  on public.finance_account_funding_entries(organization_id, funding_date desc, created_at desc);
create index if not exists finance_account_funding_account_idx
  on public.finance_account_funding_entries(account_id, funding_date desc, created_at desc);

drop trigger if exists finance_account_funding_entries_updated_at
  on public.finance_account_funding_entries;
create trigger finance_account_funding_entries_updated_at
before update on public.finance_account_funding_entries
for each row execute function public.set_updated_at();

alter table public.finance_account_funding_entries enable row level security;
revoke all on public.finance_account_funding_entries from anon, authenticated;
grant select on public.finance_account_funding_entries to authenticated;

drop policy if exists "finance account funding: finance read"
  on public.finance_account_funding_entries;
create policy "finance account funding: finance read"
on public.finance_account_funding_entries for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

-- Extend the private finance receipt policies to cover account-funding proof.
drop policy if exists "finance receipts: authorized read" on storage.objects;
create policy "finance receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.finance_transactions transaction
      where transaction.receipt_storage_path = storage.objects.name
        and private.has_text_role(transaction.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
    or exists (
      select 1 from public.finance_accounts account
      where account.receipt_storage_path = storage.objects.name
        and private.has_text_role(account.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
    or exists (
      select 1 from public.finance_account_funding_entries funding
      where funding.receipt_storage_path = storage.objects.name
        and private.has_text_role(funding.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
  )
);

drop policy if exists "finance receipts: finance upload" on storage.objects;
create policy "finance receipts: finance upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/(transactions|accounts)/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
  )
);

-- Account funding changes cash only. It is intentionally excluded from the
-- Money In / Money Out income and expense totals.
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
  account.is_default_for_payment_method
from public.finance_accounts account
left join public.finance_transactions entry
  on entry.account_id = account.id
group by account.organization_id, account.id, account.account_name,
  account.account_type, account.account_number, account.opening_balance,
  account.is_active, account.payment_method, account.is_default_for_payment_method;

-- Lock the account before calculating available cash so two concurrent paid
-- expenses cannot both spend the same remaining balance.
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

create or replace function private.finance_paid_expense_balance_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_should_check boolean;
begin
  if new.transaction_type <> 'expense'
    or new.payment_status <> 'paid'
    or coalesce(new.is_voided, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_should_check := true;
  else
    v_should_check := old.transaction_type is distinct from new.transaction_type
      or old.payment_status is distinct from new.payment_status
      or old.account_id is distinct from new.account_id
      or old.is_voided is distinct from new.is_voided;
  end if;

  if v_should_check then
    perform private.assert_finance_account_has_funds(
      new.organization_id,
      new.account_id,
      new.amount
    );
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_paid_balance_guard
  on public.finance_transactions;
create trigger finance_transactions_paid_balance_guard
before insert or update of transaction_type, payment_status, account_id, is_voided
on public.finance_transactions
for each row execute function private.finance_paid_expense_balance_guard();

create or replace function public.create_finance_account_funding(
  p_funding_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_funding_source text,
  p_note text,
  p_funding_date date,
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
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_internal(v_organization_id) then
    raise exception 'Only Internal Finance can add funds to an account';
  end if;
  if p_funding_id is null or p_account_id is null then
    raise exception 'A funding entry and account are required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Funding amount must be greater than zero';
  end if;
  if p_funding_source not in ('owner_funding', 'loan_received', 'external_deposit', 'other') then
    raise exception 'Choose a valid funding source';
  end if;
  perform 1
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = v_organization_id
    and account.is_active
  for update;
  if not found then
    raise exception 'Choose an active bank, e-wallet, or cash account';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP receipt image no larger than 10 MB';
  end if;
  if split_part(p_receipt_storage_path, '/', 1) <> v_organization_id::text
    or split_part(p_receipt_storage_path, '/', 2) <> 'account-funding'
    or split_part(split_part(p_receipt_storage_path, '/', 3), '.', 1) <> p_funding_id::text
    or split_part(p_receipt_storage_path, '/', 4) <> ''
    or lower(regexp_replace(p_receipt_file_name, '^.*\.', '')) <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Account funding receipt storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the account funding receipt image before saving the entry';
  end if;

  insert into public.finance_account_funding_entries (
    id, organization_id, account_id, amount, funding_source, funding_date,
    note, receipt_storage_path, receipt_file_name, receipt_content_type,
    receipt_file_size, created_by
  ) values (
    p_funding_id, v_organization_id, p_account_id, round(p_amount, 2),
    p_funding_source, coalesce(p_funding_date, current_date),
    nullif(btrim(coalesce(p_note, '')), ''), p_receipt_storage_path,
    btrim(p_receipt_file_name), p_receipt_content_type, p_receipt_file_size,
    (select auth.uid())
  );
  return p_funding_id;
end;
$$;

revoke all on function public.create_finance_account_funding(
  uuid, uuid, numeric, text, text, date, text, text, text, bigint
) from public;
grant execute on function public.create_finance_account_funding(
  uuid, uuid, numeric, text, text, date, text, text, text, bigint
) to authenticated;

create or replace function public.void_finance_account_funding(
  p_funding_id uuid,
  p_void_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_entry public.finance_account_funding_entries%rowtype;
begin
  select * into v_entry
  from public.finance_account_funding_entries
  where id = p_funding_id
  for update;

  if not found or not private.finance_is_internal(v_entry.organization_id) then
    raise exception 'Account funding entry not found';
  end if;
  if v_entry.is_voided then
    return v_entry.id;
  end if;
  if nullif(btrim(coalesce(p_void_reason, '')), '') is null then
    raise exception 'Add a reason before voiding account funding';
  end if;

  update public.finance_account_funding_entries
  set is_voided = true,
      voided_at = now(),
      voided_by = (select auth.uid()),
      void_reason = nullif(btrim(p_void_reason), '')
  where id = v_entry.id;
  return v_entry.id;
end;
$$;

revoke all on function public.void_finance_account_funding(uuid, text) from public;
grant execute on function public.void_finance_account_funding(uuid, text) to authenticated;

commit;
