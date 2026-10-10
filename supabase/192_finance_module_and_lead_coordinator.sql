-- Operational Finance module, finance user roles, and Lead Coordinator routing.
-- Run after migration 191_employee_request_workflow.sql and before deploying the
-- matching application update. This migration is additive and preserves the
-- legacy accountant role as a backward-compatible Internal Finance alias.

-- Keep enum changes outside the transaction for compatibility with older
-- PostgreSQL versions used by some Supabase projects.
alter type public.member_role add value if not exists 'internal_finance';
alter type public.member_role add value if not exists 'external_finance';
alter type public.member_role add value if not exists 'lead_coordinator';

begin;

-- Finance accounts are the authoritative payment-method directory. Balances
-- are derived from approved/paid finance transactions plus the opening balance.
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_name text not null check (btrim(account_name) <> ''),
  account_type text not null check (account_type in ('bank', 'e_wallet', 'cash', 'other')),
  account_number text,
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  receipt_storage_path text unique,
  receipt_file_name text,
  receipt_content_type text check (receipt_content_type is null or receipt_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  receipt_file_size bigint check (receipt_file_size is null or receipt_file_size between 1 and 10485760),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_accounts_org_active_idx
  on public.finance_accounts(organization_id, is_active, account_name);

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction text not null check (direction in ('income', 'expense')),
  name text not null check (btrim(name) <> ''),
  expense_class text check (expense_class is null or expense_class in ('operating', 'non_operating')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'income' and expense_class is null) or direction = 'expense')
);
create unique index if not exists finance_categories_active_name_idx
  on public.finance_categories(organization_id, direction, lower(name))
  where is_active;
create index if not exists finance_categories_org_direction_idx
  on public.finance_categories(organization_id, direction, is_active);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid not null references public.finance_categories(id) on delete restrict,
  account_id uuid not null references public.finance_accounts(id) on delete restrict,
  note text,
  transaction_date date not null default current_date,
  transaction_time time,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  approval_status text not null default 'pending' check (approval_status in ('not_required', 'pending', 'approved', 'rejected', 'cancelled')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  decision_note text,
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  supplier_payable_id uuid references public.supplier_payables(id) on delete set null,
  commission_summary_id uuid references public.commission_summaries(id) on delete set null,
  receipt_storage_path text not null unique,
  receipt_file_name text not null check (btrim(receipt_file_name) <> ''),
  receipt_content_type text not null check (receipt_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  receipt_file_size bigint not null check (receipt_file_size between 1 and 10485760),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (transaction_type = 'income' and approval_status = 'not_required')
    or (transaction_type = 'expense' and approval_status in ('pending', 'approved', 'rejected', 'cancelled'))
  ),
  check ((payment_status = 'paid' and paid_at is not null) or (payment_status = 'unpaid' and paid_at is null)),
  check (transaction_type = 'expense' or (supplier_payable_id is null and commission_summary_id is null))
);
create index if not exists finance_transactions_org_date_idx
  on public.finance_transactions(organization_id, transaction_date desc, created_at desc);
create index if not exists finance_transactions_org_status_idx
  on public.finance_transactions(organization_id, transaction_type, approval_status, payment_status);
drop index if exists public.finance_transactions_one_supplier_payment_idx;
create index if not exists finance_transactions_supplier_payable_idx
  on public.finance_transactions(supplier_payable_id)
  where supplier_payable_id is not null;
create unique index if not exists finance_transactions_one_commission_payment_idx
  on public.finance_transactions(commission_summary_id)
  where commission_summary_id is not null and payment_status = 'paid' and approval_status = 'approved';

create table if not exists public.finance_budget_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_budget_requests_org_status_idx
  on public.finance_budget_requests(organization_id, status, requested_at desc);

create table if not exists public.lead_transfer_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_owner_id uuid references auth.users(id) on delete set null,
  new_owner_id uuid not null references auth.users(id) on delete restrict,
  transferred_by uuid not null references auth.users(id) on delete restrict,
  note text,
  transferred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists lead_transfer_history_lead_idx
  on public.lead_transfer_history(organization_id, lead_id, transferred_at desc);

drop trigger if exists finance_accounts_updated_at on public.finance_accounts;
create trigger finance_accounts_updated_at
before update on public.finance_accounts
for each row execute function public.set_updated_at();
drop trigger if exists finance_categories_updated_at on public.finance_categories;
create trigger finance_categories_updated_at
before update on public.finance_categories
for each row execute function public.set_updated_at();
drop trigger if exists finance_transactions_updated_at on public.finance_transactions;
create trigger finance_transactions_updated_at
before update on public.finance_transactions
for each row execute function public.set_updated_at();
drop trigger if exists finance_budget_requests_updated_at on public.finance_budget_requests;
create trigger finance_budget_requests_updated_at
before update on public.finance_budget_requests
for each row execute function public.set_updated_at();

-- Seed the requested defaults once for every existing organization. Custom
-- categories remain organization-scoped and can be soft-deleted.
do $$
declare
  organization_row record;
  category_name text;
  income_categories text[] := array[
    'Customer payment · Down payment',
    'Customer payment · Balance due',
    'Customer payment · Collection',
    'Customer payment · Full payment',
    'Owner''s capital',
    'Loan received',
    'Refund received',
    'Asset sale'
  ];
  operating_expenses text[] := array[
    'Inventory / stocks',
    'Raw materials',
    'Rent',
    'Electricity',
    'Water',
    'Internet and load',
    'Salaries and wages',
    'Transportation',
    'Delivery and shipping',
    'Packaging supplies',
    'Office supplies',
    'Repairs and maintenance',
    'Advertising and marketing',
    'Commissions',
    'Bank and transaction fees',
    'Miscellaneous expenses',
    'Food',
    'Online shop'
  ];
  non_operating_expenses text[] := array[
    'Equipment and furniture',
    'Permits and licenses',
    'Taxes and government fees',
    'Loan payments',
    'Owner''s withdrawal',
    'Refunds to customers'
  ];
begin
  for organization_row in select id from public.organizations loop
    foreach category_name in array income_categories loop
      insert into public.finance_categories (organization_id, direction, name, is_system)
      select organization_row.id, 'income', category_name, true
      where not exists (
        select 1 from public.finance_categories category
        where category.organization_id = organization_row.id
          and category.direction = 'income'
          and lower(category.name) = lower(category_name)
          and category.is_active
      );
    end loop;
    foreach category_name in array operating_expenses loop
      insert into public.finance_categories (organization_id, direction, name, expense_class, is_system)
      select organization_row.id, 'expense', category_name, 'operating', true
      where not exists (
        select 1 from public.finance_categories category
        where category.organization_id = organization_row.id
          and category.direction = 'expense'
          and lower(category.name) = lower(category_name)
          and category.is_active
      );
    end loop;
    foreach category_name in array non_operating_expenses loop
      insert into public.finance_categories (organization_id, direction, name, expense_class, is_system)
      select organization_row.id, 'expense', category_name, 'non_operating', true
      where not exists (
        select 1 from public.finance_categories category
        where category.organization_id = organization_row.id
          and category.direction = 'expense'
          and lower(category.name) = lower(category_name)
          and category.is_active
      );
    end loop;
  end loop;
end;
$$;

-- Finance balances are derived from one ledger, so pending/unpaid items never
-- inflate cash and account-to-account movements are not represented as income.
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
    + coalesce(sum(
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
      ), 0),
    2
  ) as current_balance
from public.finance_accounts account
left join public.finance_transactions entry
  on entry.account_id = account.id
group by account.organization_id, account.id, account.account_name,
  account.account_type, account.account_number, account.opening_balance,
  account.is_active;

-- Storage is private. RPCs verify that an object exists and is linked to the
-- submitted record before the record becomes visible in the ledger.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-receipts',
  'finance-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.finance_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_budget_requests enable row level security;
alter table public.lead_transfer_history enable row level security;

revoke all on public.finance_accounts, public.finance_categories,
  public.finance_transactions, public.finance_budget_requests,
  public.lead_transfer_history from anon, authenticated;
grant select on public.finance_accounts, public.finance_categories,
  public.finance_transactions, public.finance_budget_requests,
  public.lead_transfer_history to authenticated;
grant select on public.finance_account_balances to authenticated;

drop policy if exists "finance accounts: finance read" on public.finance_accounts;
create policy "finance accounts: finance read"
on public.finance_accounts for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "finance categories: finance read" on public.finance_categories;
create policy "finance categories: finance read"
on public.finance_categories for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "finance transactions: finance read" on public.finance_transactions;
create policy "finance transactions: finance read"
on public.finance_transactions for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "finance budget requests: finance read" on public.finance_budget_requests;
create policy "finance budget requests: finance read"
on public.finance_budget_requests for select to authenticated
using (
  requested_by = (select auth.uid())
  or private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ])
);

drop policy if exists "lead transfer history: participants read" on public.lead_transfer_history;
create policy "lead transfer history: participants read"
on public.lead_transfer_history for select to authenticated
using (
  previous_owner_id = (select auth.uid())
  or new_owner_id = (select auth.uid())
  or transferred_by = (select auth.uid())
  or private.has_text_role(organization_id, array['super_admin', 'owner', 'admin'])
);

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
  )
);

drop policy if exists "finance receipts: finance upload" on storage.objects;
create policy "finance receipts: finance upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and storage.objects.name ~* '^[0-9a-f-]{36}/(transactions|accounts)/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1 from public.organization_members member
    where member.organization_id::text = split_part(storage.objects.name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
  )
);

drop policy if exists "finance receipts: finance delete" on storage.objects;
create policy "finance receipts: finance delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and exists (
    select 1 from public.organization_members member
    where member.organization_id::text = split_part(storage.objects.name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
  )
);

-- Allow Finance to select the CRM names needed by the Name / Company field.
drop policy if exists "leads: finance read" on public.leads;
create policy "leads: finance read"
on public.leads for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "supplier payables: finance read" on public.supplier_payables;
create policy "supplier payables: finance read"
on public.supplier_payables for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "suppliers: finance read" on public.suppliers;
create policy "suppliers: finance read"
on public.suppliers for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "commission summaries: finance read" on public.commission_summaries;
create policy "commission summaries: finance read"
on public.commission_summaries for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

drop policy if exists "quotation payment records: finance read" on public.quotation_payment_records;
create policy "quotation payment records: finance read"
on public.quotation_payment_records for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

-- Finance functions are the only write path for the new ledger.
create or replace function private.finance_is_internal(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ]);
$$;

create or replace function private.finance_is_external_or_internal(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
  ]);
$$;

grant execute on function private.finance_is_internal(uuid),
  private.finance_is_external_or_internal(uuid) to authenticated;

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
  if coalesce(p_opening_balance, 0) < 0 then
    raise exception 'Opening balance cannot be negative';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP receipt image no larger than 10 MB';
  end if;
  if split_part(p_receipt_storage_path, '/', 1) <> v_organization_id::text
    or split_part(p_receipt_storage_path, '/', 2) <> 'accounts'
    or split_part(split_part(p_receipt_storage_path, '/', 3), '.', 1) <> p_account_id::text
    or split_part(p_receipt_storage_path, '/', 4) <> ''
    or lower(regexp_replace(p_receipt_file_name, '^.*\.', '')) <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Account receipt storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the account receipt image before saving the account';
  end if;
  insert into public.finance_accounts (
    id, organization_id, account_name, account_type, account_number,
    opening_balance, receipt_storage_path, receipt_file_name,
    receipt_content_type, receipt_file_size, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    nullif(btrim(coalesce(p_account_number, '')), ''), round(coalesce(p_opening_balance, 0), 2),
    p_receipt_storage_path, btrim(p_receipt_file_name), p_receipt_content_type,
    p_receipt_file_size, (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account(uuid, text, text, text, numeric, text, text, text, bigint) from public;
grant execute on function public.create_finance_account(uuid, text, text, text, numeric, text, text, text, bigint) to authenticated;

create or replace function public.create_finance_category(
  p_direction text,
  p_name text,
  p_expense_class text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_id uuid;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_external_or_internal(v_organization_id) then
    raise exception 'Only Finance users can add a category';
  end if;
  if p_direction not in ('income', 'expense') or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Category direction and name are required';
  end if;
  if p_direction = 'income' and p_expense_class is not null then
    raise exception 'Income categories cannot have an expense class';
  end if;
  if p_direction = 'expense' and p_expense_class not in ('operating', 'non_operating') then
    raise exception 'Choose Operating or Non Operating Expense';
  end if;
  insert into public.finance_categories (organization_id, direction, name, expense_class, created_by)
  values (v_organization_id, p_direction, btrim(p_name), p_expense_class, (select auth.uid()))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'That category already exists';
end;
$$;

revoke all on function public.create_finance_category(text, text, text) from public;
grant execute on function public.create_finance_category(text, text, text) to authenticated;

create or replace function public.archive_finance_category(p_category_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_category public.finance_categories%rowtype;
begin
  select * into v_category from public.finance_categories where id = p_category_id for update;
  if not found or not private.finance_is_external_or_internal(v_category.organization_id) then
    raise exception 'Finance category not found';
  end if;
  if v_category.is_system then
    raise exception 'Default categories cannot be deleted';
  end if;
  update public.finance_categories set is_active = false where id = v_category.id;
  return v_category.id;
end;
$$;

revoke all on function public.archive_finance_category(uuid) from public;
grant execute on function public.archive_finance_category(uuid) to authenticated;

create or replace function public.create_finance_transaction(
  p_transaction_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_transaction_date date,
  p_transaction_time time,
  p_payment_status text,
  p_lead_id uuid,
  p_customer_id uuid,
  p_quotation_id uuid,
  p_supplier_payable_id uuid,
  p_commission_summary_id uuid,
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
  v_category public.finance_categories%rowtype;
  v_account public.finance_accounts%rowtype;
  v_role text;
  v_approval_status text;
  v_paid_at timestamptz;
begin
  select organization_id, role::text into v_organization_id, v_role
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_external_or_internal(v_organization_id) then
    raise exception 'Only Finance users can add a transaction';
  end if;
  if p_transaction_id is null or p_transaction_type not in ('income', 'expense') then
    raise exception 'Choose Money In or Money Out';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  select * into v_category from public.finance_categories
  where id = p_category_id and organization_id = v_organization_id and is_active;
  if not found or v_category.direction <> p_transaction_type then
    raise exception 'Choose an active category for this transaction';
  end if;
  select * into v_account from public.finance_accounts
  where id = p_account_id and organization_id = v_organization_id and is_active;
  if not found then
    raise exception 'Choose an active bank, e-wallet, or cash account';
  end if;
  if p_payment_status not in ('paid', 'unpaid') then
    raise exception 'Choose Paid or Unpaid';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP receipt image no larger than 10 MB';
  end if;
  if split_part(p_receipt_storage_path, '/', 1) <> v_organization_id::text
    or split_part(p_receipt_storage_path, '/', 2) <> 'transactions'
    or split_part(split_part(p_receipt_storage_path, '/', 3), '.', 1) <> p_transaction_id::text
    or split_part(p_receipt_storage_path, '/', 4) <> ''
    or lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1))) <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Transaction receipt storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the transaction receipt image before saving the transaction';
  end if;
  if p_lead_id is not null and not exists (
    select 1 from public.leads lead_row
    where lead_row.id = p_lead_id and lead_row.organization_id = v_organization_id
  ) then
    raise exception 'The selected Name / Company lead does not belong to this workspace';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers customer
    where customer.id = p_customer_id and customer.organization_id = v_organization_id
  ) then
    raise exception 'The selected customer does not belong to this workspace';
  end if;
  if p_quotation_id is not null and not exists (
    select 1 from public.quotations quotation
    where quotation.id = p_quotation_id and quotation.organization_id = v_organization_id
  ) then
    raise exception 'The selected quotation does not belong to this workspace';
  end if;
  if p_transaction_type = 'income' and (p_supplier_payable_id is not null or p_commission_summary_id is not null) then
    raise exception 'Payables can only be linked to Money Out';
  end if;
  if p_supplier_payable_id is not null and p_commission_summary_id is not null then
    raise exception 'Link Money Out to a supplier payable or commission, not both';
  end if;
  if p_supplier_payable_id is not null and not exists (
    select 1 from public.supplier_payables payable
    where payable.id = p_supplier_payable_id and payable.organization_id = v_organization_id
      and payable.status not in ('paid', 'cancelled')
      and payable.amount_paid + round(p_amount, 2) <= payable.amount
  ) then
    raise exception 'The supplier payable amount exceeds its remaining balance';
  end if;
  if p_commission_summary_id is not null and not exists (
    select 1 from public.commission_summaries summary
    where summary.id = p_commission_summary_id and summary.organization_id = v_organization_id
      and summary.status = 'not_yet_paid'
      and round(summary.commission_amount + summary.va_commission_amount, 2) = round(p_amount, 2)
  ) then
    raise exception 'The Money Out amount must equal the selected commission';
  end if;
  v_approval_status := case
    when p_transaction_type = 'income' then 'not_required'
    when v_role in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance') then 'approved'
    else 'pending'
  end;
  v_paid_at := case when p_payment_status = 'paid' then now() else null end;
  insert into public.finance_transactions (
    id, organization_id, transaction_type, amount, category_id, account_id,
    note, transaction_date, transaction_time, payment_status, approval_status,
    paid_at, paid_by, approved_at, approved_by, lead_id, customer_id,
    quotation_id, supplier_payable_id, commission_summary_id,
    receipt_storage_path, receipt_file_name, receipt_content_type,
    receipt_file_size, submitted_by
  ) values (
    p_transaction_id, v_organization_id, p_transaction_type, round(p_amount, 2),
    p_category_id, p_account_id, nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_transaction_date, current_date), p_transaction_time,
    p_payment_status, v_approval_status, v_paid_at,
    case when p_payment_status = 'paid' then (select auth.uid()) else null end,
    case when v_approval_status = 'approved' then now() else null end,
    case when v_approval_status = 'approved' then (select auth.uid()) else null end,
    p_lead_id, p_customer_id, p_quotation_id, p_supplier_payable_id,
    p_commission_summary_id, p_receipt_storage_path, btrim(p_receipt_file_name),
    p_receipt_content_type, p_receipt_file_size, (select auth.uid())
  );
  if v_approval_status = 'approved' and p_payment_status = 'paid' then
    perform private.sync_paid_finance_source(p_transaction_id);
  end if;
  return p_transaction_id;
end;
$$;

revoke all on function public.create_finance_transaction(uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.create_finance_transaction(uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) to authenticated;

create or replace function private.sync_paid_finance_source(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_latest_verified timestamptz;
begin
  select * into v_transaction from public.finance_transactions
  where id = p_transaction_id for update;
  if not found or v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'paid'
    or v_transaction.approval_status <> 'approved' then
    return;
  end if;
  if v_transaction.supplier_payable_id is not null then
    if not exists (
      select 1 from public.supplier_payables payable
      where payable.id = v_transaction.supplier_payable_id
        and payable.organization_id = v_transaction.organization_id
        and payable.status not in ('paid', 'cancelled')
        and payable.amount_paid + v_transaction.amount <= payable.amount
    ) then
      raise exception 'The supplier payable no longer has enough remaining balance';
    end if;
    update public.supplier_payables payable
    set amount_paid = round(payable.amount_paid + v_transaction.amount, 2),
        status = case
          when payable.amount_paid + v_transaction.amount >= payable.amount then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where payable.id = v_transaction.supplier_payable_id
      and payable.organization_id = v_transaction.organization_id;
  end if;
  if v_transaction.commission_summary_id is not null then
    if not exists (
      select 1 from public.commission_summaries summary
      where summary.id = v_transaction.commission_summary_id
        and summary.organization_id = v_transaction.organization_id
        and round(summary.commission_amount + summary.va_commission_amount, 2) = round(v_transaction.amount, 2)
        and summary.status = 'not_yet_paid'
    ) then
      raise exception 'The commission amount or status has changed';
    end if;
    select max(payment.verified_at) into v_latest_verified
    from public.quotation_payment_records payment
    join public.commission_summaries summary on summary.quotation_id = payment.quotation_id
    where summary.id = v_transaction.commission_summary_id
      and payment.status = 'verified';
    if v_latest_verified is null then
      raise exception 'The commission cannot be paid until a client payment is verified';
    end if;
    if now() < v_latest_verified + interval '3 days' then
      raise exception 'The commission becomes payable three days after the verified client payment';
    end if;
    update public.commission_summaries
    set status = 'paid', paid_at = coalesce(paid_at, v_transaction.paid_at, now()), paid_by = coalesce(paid_by, (select auth.uid()))
    where id = v_transaction.commission_summary_id
      and status = 'not_yet_paid';
  end if;
end;
$$;

create or replace function public.review_finance_transaction(
  p_transaction_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
begin
  select * into v_transaction from public.finance_transactions where id = p_transaction_id for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense' or v_transaction.approval_status <> 'pending' then
    raise exception 'Only pending Money Out transactions can be reviewed';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose Approved or Rejected';
  end if;
  update public.finance_transactions
  set approval_status = p_decision,
      approved_by = (select auth.uid()),
      approved_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_transaction.id;
  if p_decision = 'approved' and v_transaction.payment_status = 'paid' then
    perform private.sync_paid_finance_source(v_transaction.id);
  end if;
  return v_transaction.id;
end;
$$;

revoke all on function public.review_finance_transaction(uuid, text, text) from public;
grant execute on function public.review_finance_transaction(uuid, text, text) to authenticated;

create or replace function public.mark_finance_transaction_paid(
  p_transaction_id uuid,
  p_paid_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
begin
  select * into v_transaction from public.finance_transactions where id = p_transaction_id for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if (v_transaction.transaction_type = 'expense' and v_transaction.approval_status <> 'approved')
    or (v_transaction.transaction_type = 'income' and v_transaction.approval_status <> 'not_required') then
    raise exception 'Only an approved Money Out or recorded Money In can be marked paid';
  end if;
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  update public.finance_transactions
  set payment_status = 'paid', paid_at = coalesce(p_paid_at, now()), paid_by = (select auth.uid())
  where id = v_transaction.id;
  perform private.sync_paid_finance_source(v_transaction.id);
  return v_transaction.id;
end;
$$;

revoke all on function public.mark_finance_transaction_paid(uuid, timestamptz) from public;
grant execute on function public.mark_finance_transaction_paid(uuid, timestamptz) to authenticated;

create or replace function public.create_finance_budget_request(
  p_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_id uuid;
begin
  select organization_id into v_organization_id from public.organization_members
  where user_id = (select auth.uid()) order by created_at limit 1;
  if v_organization_id is null or not private.has_text_role(v_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can request a budget';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Budget amount must be greater than zero'; end if;
  insert into public.finance_budget_requests (organization_id, amount, note, requested_by)
  values (v_organization_id, round(p_amount, 2), nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_finance_budget_request(numeric, text) from public;
grant execute on function public.create_finance_budget_request(numeric, text) to authenticated;

create or replace function public.review_finance_budget_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.finance_budget_requests%rowtype;
begin
  select * into v_request from public.finance_budget_requests where id = p_request_id for update;
  if not found or not private.finance_is_internal(v_request.organization_id) then
    raise exception 'Budget request not found';
  end if;
  if v_request.status <> 'pending' or p_decision not in ('approved', 'rejected') then
    raise exception 'Only pending budget requests can be reviewed';
  end if;
  update public.finance_budget_requests
  set status = p_decision,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;
  return v_request.id;
end;
$$;

revoke all on function public.review_finance_budget_request(uuid, text, text) from public;
grant execute on function public.review_finance_budget_request(uuid, text, text) to authenticated;

-- Make transfer ownership explicit without changing the existing endorsement
-- history. The old endorsement workflow remains available for its original
-- business purpose; this RPC is the true Lead Coordinator handoff.
create or replace function public.assign_lead_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    if coalesce(current_setting('huswell.allow_lead_owner_transfer', true), '') <> 'on'
      and not private.has_text_role(old.organization_id, array['super_admin', 'owner', 'admin']) then
      new.assigned_to := old.assigned_to;
    end if;
    new.outbound_caller := old.outbound_caller;
    return new;
  end if;
  if actor_id is not null then
    new.created_by := actor_id;
    new.assigned_to := actor_id;
    select nullif(btrim(full_name), '') into actor_name from public.profiles where id = actor_id;
    new.outbound_caller := actor_name;
  else
    -- Service-role lead intake (for example, the chatbot webhook) has no
    -- auth.uid(). Route it to the first Lead Coordinator when one exists;
    -- otherwise it remains available for management assignment.
    select member.user_id into new.assigned_to
    from public.organization_members member
    where member.organization_id = new.organization_id
      and member.role::text = 'lead_coordinator'
    order by member.created_at
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_creator on public.leads;
create trigger leads_assign_creator
before insert or update on public.leads
for each row execute function public.assign_lead_creator();

drop policy if exists "leads: lead coordinator read" on public.leads;
create policy "leads: lead coordinator read"
on public.leads for select to authenticated
using (
  assigned_to = (select auth.uid())
  and private.has_text_role(organization_id, array['lead_coordinator'])
);

drop policy if exists "leads: lead coordinator insert" on public.leads;
create policy "leads: lead coordinator insert"
on public.leads for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.has_text_role(organization_id, array['lead_coordinator'])
);

drop policy if exists "leads: assigned pricing owner read" on public.leads;
create policy "leads: assigned pricing owner read"
on public.leads for select to authenticated
using (
  assigned_to = (select auth.uid())
  and private.has_text_role(organization_id, array['sales_pricing_officer'])
);

drop policy if exists "leads: assigned pricing owner update" on public.leads;
create policy "leads: assigned pricing owner update"
on public.leads for update to authenticated
using (
  assigned_to = (select auth.uid())
  and private.has_text_role(organization_id, array['sales_pricing_officer'])
)
with check (
  assigned_to = (select auth.uid())
  and private.has_text_role(organization_id, array['sales_pricing_officer'])
);

drop policy if exists "members: lead coordinators read pricing officers" on public.organization_members;
create policy "members: lead coordinators read pricing officers"
on public.organization_members for select to authenticated
using (
  role::text = 'sales_pricing_officer'
  and private.has_text_role(organization_id, array['lead_coordinator'])
);

drop policy if exists "profiles: lead coordinators read pricing officers" on public.profiles;
create policy "profiles: lead coordinators read pricing officers"
on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.organization_members member
    where member.user_id = profiles.id
      and member.role::text = 'sales_pricing_officer'
      and private.has_text_role(member.organization_id, array['lead_coordinator'])
  )
);

revoke all on public.lead_transfer_history from authenticated;
grant select on public.lead_transfer_history to authenticated;

create or replace function public.transfer_lead_to_pricing_officer(
  p_lead_id uuid,
  p_recipient_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_actor_is_manager boolean;
  v_actor_is_coordinator boolean;
  v_previous_owner uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 2));
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  v_actor_is_manager := private.has_text_role(v_lead.organization_id, array['super_admin', 'owner', 'admin']);
  v_actor_is_coordinator := private.has_text_role(v_lead.organization_id, array['lead_coordinator']);
  if not v_actor_is_manager and not v_actor_is_coordinator then
    raise exception 'Only a Lead Coordinator or administrator can transfer a lead';
  end if;
  if v_actor_is_coordinator and coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid()) then
    raise exception 'Only leads assigned to the current Lead Coordinator can be transferred';
  end if;
  if p_recipient_user_id is null or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select a Sales & Pricing Officer';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected user is not an active Sales & Pricing Officer';
  end if;
  if coalesce(v_lead.evaluation_number, 0) = 7 then raise exception 'Done Deals cannot be transferred'; end if;
  if v_lead.endorsed_by is not null or v_lead.endorsed_to is not null or v_lead.endorsed_at is not null then
    raise exception 'Resolve the existing lead endorsement before transferring ownership';
  end if;
  if exists (
    select 1 from public.quotations quotation
    where quotation.lead_id = v_lead.id
      and quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
  ) then
    raise exception 'A lead with an approved Price Quotation cannot change owner';
  end if;
  v_previous_owner := coalesce(v_lead.assigned_to, v_lead.created_by);
  perform set_config('huswell.allow_lead_owner_transfer', 'on', true);
  update public.leads set assigned_to = p_recipient_user_id where id = v_lead.id;
  perform set_config('huswell.allow_lead_owner_transfer', 'off', true);
  insert into public.lead_transfer_history (
    organization_id, lead_id, previous_owner_id, new_owner_id, transferred_by, note
  ) values (
    v_lead.organization_id, v_lead.id, v_previous_owner, p_recipient_user_id,
    (select auth.uid()), nullif(btrim(coalesce(p_note, '')), '')
  );
  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_lead.organization_id, (select auth.uid()), 'lead', v_lead.id, 'ownership_transferred',
    jsonb_build_object('assigned_to', v_previous_owner),
    jsonb_build_object('assigned_to', p_recipient_user_id),
    nullif(btrim(coalesce(p_note, '')), '')
  );
  return v_lead.id;
end;
$$;

revoke all on function public.transfer_lead_to_pricing_officer(uuid, uuid, text) from public;
grant execute on function public.transfer_lead_to_pricing_officer(uuid, uuid, text) to authenticated;

commit;
