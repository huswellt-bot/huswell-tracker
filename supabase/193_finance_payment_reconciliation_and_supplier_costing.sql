-- Finance payment reconciliation and supplier-costing logbook.
-- Run after 192_finance_module_and_lead_coordinator.sql and before deploying
-- the matching Finance workspace update. This migration is additive: it keeps
-- the existing finance transaction RPC signatures and adds source links,
-- account reconciliation, and supplier-costing creation.

begin;

-- A quotation payment can be posted automatically only when Finance has
-- identified the account that should receive a particular payment method.
alter table public.finance_accounts
  add column if not exists payment_method public.payment_method not null default 'other'::public.payment_method,
  add column if not exists is_default_for_payment_method boolean not null default false;

update public.finance_accounts
set payment_method = case account_type
  when 'cash' then 'cash'::public.payment_method
  when 'bank' then 'bank_transfer'::public.payment_method
  when 'e_wallet' then 'gcash'::public.payment_method
  else 'other'::public.payment_method
end
where payment_method = 'other'::public.payment_method;

create unique index if not exists finance_accounts_org_default_payment_method_idx
  on public.finance_accounts(organization_id, payment_method)
  where is_active and is_default_for_payment_method;

-- Preserve a deterministic default for existing accounts when a workspace has
-- no default yet. New accounts can explicitly replace it through the RPC/UI.
do $$
declare
  account_group record;
  default_account_id uuid;
begin
  for account_group in
    select organization_id, payment_method
    from public.finance_accounts
    where is_active
    group by organization_id, payment_method
  loop
    if not exists (
      select 1
      from public.finance_accounts account
      where account.organization_id = account_group.organization_id
        and account.payment_method = account_group.payment_method
        and account.is_active
        and account.is_default_for_payment_method
    ) then
      select account.id into default_account_id
      from public.finance_accounts account
      where account.organization_id = account_group.organization_id
        and account.payment_method = account_group.payment_method
        and account.is_active
      order by account.created_at, account.id
      limit 1;

      update public.finance_accounts
      set is_default_for_payment_method = true
      where id = default_account_id;
    end if;
  end loop;
end;
$$;

-- Source-generated Money In entries reuse the original quotation receipt.
-- They may temporarily have no account when the payment method has not yet
-- been mapped; Internal Finance can reconcile that entry without changing the
-- amount or source.
alter table public.finance_transactions
  alter column account_id drop not null,
  add column if not exists receipt_bucket text not null default 'finance-receipts',
  add column if not exists source_payment_id uuid references public.quotation_payment_records(id) on delete restrict,
  add column if not exists is_voided boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_transactions'::regclass
      and conname = 'finance_transactions_receipt_bucket_check'
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_receipt_bucket_check
      check (receipt_bucket in ('finance-receipts', 'quotation-payment-receipts'));
  end if;
end;
$$;

create unique index if not exists finance_transactions_source_payment_idx
  on public.finance_transactions(source_payment_id)
  where source_payment_id is not null;

-- Supplier payables are the External Finance supplier-costing logbook. The
-- existing amount/amount_paid columns remain authoritative for accumulation.
alter table public.supplier_payables
  add column if not exists quotation_id uuid references public.quotations(id) on delete set null,
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

create index if not exists supplier_payables_org_quotation_idx
  on public.supplier_payables(organization_id, quotation_id, due_date);
create index if not exists supplier_payables_org_supplier_idx
  on public.supplier_payables(organization_id, supplier_id, status, due_date);

-- Finance needs the quotation identity to link a supplier-costing entry to the
-- CRM record. This is read-only access; quotation editing remains role-bound.
drop policy if exists "quotations: finance read" on public.quotations;
create policy "quotations: finance read"
on public.quotations for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

-- Finance can open the source receipt attached to an automatically generated
-- Money In transaction.
drop policy if exists "quotation payment receipts: authorized read" on storage.objects;
create policy "quotation payment receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and exists (
    select 1
    from public.quotation_payment_records payment
    where payment.receipt_storage_path = storage.objects.name
      and (
        private.has_text_role(payment.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
        or private.can_submit_quotation_payment(payment.quotation_id)
      )
  )
);

-- Preserve account creation compatibility while adding payment-method mapping
-- for new Finance UI calls.
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
    receipt_storage_path, receipt_file_name, receipt_content_type,
    receipt_file_size, created_by
  ) values (
    p_account_id, v_organization_id, btrim(p_account_name), p_account_type,
    nullif(btrim(coalesce(p_account_number, '')), ''), round(coalesce(p_opening_balance, 0), 2),
    v_payment_method, coalesce(p_is_default_for_payment_method, false),
    p_receipt_storage_path, btrim(p_receipt_file_name), p_receipt_content_type,
    p_receipt_file_size, (select auth.uid())
  );
  return p_account_id;
end;
$$;

revoke all on function public.create_finance_account_with_mapping(uuid, text, text, text, numeric, text, text, text, bigint, public.payment_method, boolean) from public;
grant execute on function public.create_finance_account_with_mapping(uuid, text, text, text, numeric, text, text, text, bigint, public.payment_method, boolean) to authenticated;

-- Create one confirmed/open supplier-costing logbook entry. Actual payments
-- still go through create_finance_transaction and Internal Finance approval.
create or replace function public.create_supplier_payable(
  p_payable_id uuid,
  p_supplier_id uuid,
  p_quotation_id uuid,
  p_lead_id uuid,
  p_description text,
  p_amount numeric,
  p_due_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_lead_id uuid := p_lead_id;
  v_quotation public.quotations%rowtype;
  v_payable_no text;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_external_or_internal(v_organization_id) then
    raise exception 'Only Finance users can record supplier costing';
  end if;
  if p_payable_id is null or p_supplier_id is null then
    raise exception 'Choose a supplier before recording supplier costing';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'Description is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Supplier costing amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.organization_id = v_organization_id
  ) then
    raise exception 'The selected supplier does not belong to this workspace';
  end if;
  if p_quotation_id is not null then
    select * into v_quotation
    from public.quotations quotation
    where quotation.id = p_quotation_id
      and quotation.organization_id = v_organization_id;
    if not found then
      raise exception 'The selected quotation does not belong to this workspace';
    end if;
    if p_lead_id is not null
      and v_quotation.lead_id is not null
      and p_lead_id is distinct from v_quotation.lead_id then
      raise exception 'The selected Name / Company does not match the quotation';
    end if;
    v_lead_id := coalesce(p_lead_id, v_quotation.lead_id);
  end if;
  if v_lead_id is not null and not exists (
    select 1 from public.leads lead_row
    where lead_row.id = v_lead_id and lead_row.organization_id = v_organization_id
  ) then
    raise exception 'The selected Name / Company lead does not belong to this workspace';
  end if;

  v_payable_no := format(
    'SUP-%s-%s',
    to_char(current_date, 'YYYYMMDD'),
    upper(substr(replace(p_payable_id::text, '-', ''), 1, 6))
  );

  insert into public.supplier_payables (
    id, organization_id, supplier_id, payable_no, description, amount,
    amount_paid, due_date, status, notes, created_by, quotation_id, lead_id,
    confirmed_at, confirmed_by
  ) values (
    p_payable_id, v_organization_id, p_supplier_id, v_payable_no,
    btrim(p_description), round(p_amount, 2), 0, p_due_date, 'open',
    nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()),
    p_quotation_id, v_lead_id, now(), (select auth.uid())
  );
  return p_payable_id;
end;
$$;

revoke all on function public.create_supplier_payable(uuid, uuid, uuid, uuid, text, numeric, date, text) from public;
grant execute on function public.create_supplier_payable(uuid, uuid, uuid, uuid, text, numeric, date, text) to authenticated;

-- Internal Finance can reconcile an automatically created Money In entry when
-- no default account was configured for the payment method.
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
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.source_payment_id is null or v_transaction.account_id is not null or v_transaction.is_voided then
    raise exception 'Only an unassigned automatic quotation payment can be reconciled';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance account';
  end if;
  update public.finance_transactions
  set account_id = p_account_id
  where id = v_transaction.id;
  return v_transaction.id;
end;
$$;

revoke all on function public.assign_finance_transaction_account(uuid, uuid) from public;
grant execute on function public.assign_finance_transaction_account(uuid, uuid) to authenticated;

-- The verified quotation receipt is the source of truth for automatic Money
-- In. A partial/full/downpayment record creates exactly one linked entry; a
-- later reversal voids that entry without deleting financial history.
create or replace function private.sync_quotation_payment_to_finance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_category_id uuid;
  v_account_id uuid;
  v_category_pattern text;
  v_note text;
begin
  if new.status = 'verified'
    and (
      tg_op = 'INSERT'
      or (tg_op = 'UPDATE' and old.status is distinct from 'verified')
      or not exists (
        select 1
        from public.finance_transactions transaction
        where transaction.source_payment_id = new.id
      )
    ) then
    select * into v_quote
    from public.quotations quotation
    where quotation.id = new.quotation_id;

    v_category_pattern := case new.payment_kind
      when 'downpayment' then '%down payment%'
      when 'full_payment' then '%full payment%'
      else '%collection%'
    end;

    select category.id into v_category_id
    from public.finance_categories category
    where category.organization_id = new.organization_id
      and category.direction = 'income'
      and category.is_active
      and lower(category.name) like 'customer payment%'
      and lower(category.name) like v_category_pattern
    order by category.is_system desc, category.created_at
    limit 1;

    if v_category_id is null then
      select category.id into v_category_id
      from public.finance_categories category
      where category.organization_id = new.organization_id
        and category.direction = 'income'
        and category.is_active
      order by category.is_system desc, category.created_at
      limit 1;
    end if;
    if v_category_id is null then
      raise exception 'Create an active income category before verifying a quotation payment';
    end if;

    select account.id into v_account_id
    from public.finance_accounts account
    where account.organization_id = new.organization_id
      and account.is_active
      and account.payment_method = new.method
      and account.is_default_for_payment_method
    order by account.created_at, account.id
    limit 1;

    v_note := format(
      'Quotation %s - %s',
      coalesce(v_quote.quotation_no, new.quotation_id::text),
      initcap(replace(new.payment_kind, '_', ' '))
    );
    if nullif(btrim(coalesce(new.reference_no, '')), '') is not null then
      v_note := v_note || ' - Ref ' || btrim(new.reference_no);
    end if;
    if nullif(btrim(coalesce(new.notes, '')), '') is not null then
      v_note := v_note || ' - ' || btrim(new.notes);
    end if;

    insert into public.finance_transactions (
      organization_id, transaction_type, amount, category_id, account_id,
      note, transaction_date, transaction_time, payment_status, approval_status,
      paid_at, paid_by, lead_id, customer_id, quotation_id,
      receipt_bucket, receipt_storage_path, receipt_file_name,
      receipt_content_type, receipt_file_size, submitted_by, source_payment_id
    ) values (
      new.organization_id, 'income', round(new.amount, 2), v_category_id, v_account_id,
      v_note, new.paid_at, coalesce(new.verified_at, new.submitted_at)::time,
      'paid', 'not_required',
      coalesce(new.paid_at::timestamp at time zone 'Asia/Manila', new.verified_at, now()),
      coalesce(new.verified_by, new.submitted_by), v_quote.lead_id, v_quote.customer_id,
      new.quotation_id, 'quotation-payment-receipts', new.receipt_storage_path,
      new.receipt_file_name, new.receipt_content_type, new.receipt_file_size,
      new.submitted_by, new.id
    ) on conflict do nothing;
  elsif new.status = 'reversed' and old.status = 'verified' then
    update public.finance_transactions
    set is_voided = true,
        voided_at = coalesce(new.reversed_at, now()),
        voided_by = new.reversed_by,
        void_reason = nullif(btrim(coalesce(new.reversal_note, '')), '')
    where source_payment_id = new.id
      and is_voided = false;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_payment_finance_sync on public.quotation_payment_records;
create trigger quotation_payment_finance_sync
after insert or update of status, verified_at, verified_by, reversed_at, reversal_note
on public.quotation_payment_records
for each row execute function private.sync_quotation_payment_to_finance();

-- Backfill verified quotation payments that existed before this migration. The
-- source-payment uniqueness check keeps this safe to re-run.
update public.quotation_payment_records
set status = 'verified'
where status = 'verified';

-- Exclude reversed source payments from account balances without deleting the
-- original audit row.
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

commit;
