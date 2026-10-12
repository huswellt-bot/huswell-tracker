-- Enforce the Internal Finance / External Finance boundary and connect
-- submitted Money Out entries to approved budget requests.
-- Run after 202_finance_payment_confirmation_and_commission_policy.sql and
-- before deploying the matching Finance workspace update. Safe to re-run.

begin;

alter table public.finance_transactions
  add column if not exists budget_request_id uuid
    references public.finance_budget_requests(id) on delete restrict;

create index if not exists finance_transactions_budget_request_idx
  on public.finance_transactions(budget_request_id)
  where budget_request_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_transactions'::regclass
      and conname = 'finance_transactions_budget_expense_check'
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_budget_expense_check
      check (transaction_type = 'expense' or budget_request_id is null);
  end if;
end;
$$;

-- Categories are finance configuration. External Finance can use them but
-- cannot create, archive, or alter the shared category directory.
create or replace function private.finance_category_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.finance_is_internal(new.organization_id) then
    raise exception 'Only Internal Finance can manage finance categories';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_categories_role_guard on public.finance_categories;
create trigger finance_categories_role_guard
before insert or update on public.finance_categories
for each row execute function private.finance_category_role_guard();

-- External Finance submits a proposed expense. It cannot create Money In,
-- mark an expense paid, choose an account, or create a commission payout.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
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
    if new.account_id is not null then
      raise exception 'Internal Finance assigns the payment account when the expense is paid';
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

-- A budget request is a spending limit, not cash. Paid entries use the
-- budget; unpaid pending/approved entries reserve it. Lock the request row so
-- concurrent submissions cannot overspend the same approved budget.
create or replace function private.finance_budget_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_budget public.finance_budget_requests%rowtype;
  v_committed numeric;
  v_amount numeric;
begin
  if new.budget_request_id is null then
    return new;
  end if;
  if new.transaction_type <> 'expense' then
    raise exception 'Only Money Out can be linked to a budget request';
  end if;

  select * into v_budget
  from public.finance_budget_requests request
  where request.id = new.budget_request_id
  for update;

  if not found or v_budget.organization_id is distinct from new.organization_id then
    raise exception 'The selected budget request does not belong to this workspace';
  end if;
  if v_budget.status <> 'approved' then
    raise exception 'Only an approved budget request can be used for Money Out';
  end if;
  if not private.finance_is_internal(new.organization_id)
    and v_budget.requested_by is distinct from (select auth.uid()) then
    raise exception 'External Finance can use only its own approved budget requests';
  end if;

  select coalesce(sum(transaction.amount), 0)
  into v_committed
  from public.finance_transactions transaction
  where transaction.organization_id = new.organization_id
    and transaction.budget_request_id = new.budget_request_id
    and transaction.id is distinct from new.id
    and transaction.transaction_type = 'expense'
    and not transaction.is_voided
    and transaction.approval_status not in ('rejected', 'cancelled');

  v_amount := case when coalesce(new.is_voided, false) then 0 else new.amount end;
  if round(v_committed + coalesce(v_amount, 0), 2) > round(v_budget.amount, 2) then
    raise exception 'This expense exceeds the remaining approved budget of %',
      round(greatest(v_budget.amount - v_committed, 0), 2);
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_budget_guard on public.finance_transactions;
create trigger finance_transactions_budget_guard
before insert or update of amount, transaction_type, approval_status, payment_status,
  budget_request_id, is_voided
on public.finance_transactions
for each row execute function private.finance_budget_allocation_guard();

-- Do not reject or cancel a budget that already has active commitments.
create or replace function private.finance_budget_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status in ('rejected', 'cancelled')
    and old.status is distinct from new.status
    and exists (
      select 1
      from public.finance_transactions transaction
      where transaction.organization_id = new.organization_id
        and transaction.budget_request_id = new.id
        and not transaction.is_voided
        and transaction.approval_status not in ('rejected', 'cancelled')
    ) then
    raise exception 'This budget has active Money Out commitments and cannot be rejected or cancelled';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_budget_requests_status_guard
  on public.finance_budget_requests;
create trigger finance_budget_requests_status_guard
before update of status on public.finance_budget_requests
for each row execute function private.finance_budget_status_guard();

-- Keep the original transaction RPC signature. External Finance may leave the
-- account blank while the expense is unpaid; Internal Finance must assign an
-- active account before settlement.
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
  if p_account_id is null then
    if v_role <> 'external_finance'
      or p_transaction_type <> 'expense'
      or p_payment_status <> 'unpaid' then
      raise exception 'Choose an active bank, e-wallet, or cash account';
    end if;
  else
    select * into v_account from public.finance_accounts
    where id = p_account_id and organization_id = v_organization_id and is_active;
    if not found then
      raise exception 'Choose an active bank, e-wallet, or cash account';
    end if;
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

-- Internal Finance must assign an account before settling an unpaid external
-- submission. Automatic quotation Money In rows remain reconcilable too.
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
  if v_transaction.account_id is not null or v_transaction.is_voided then
    raise exception 'Only an unassigned active transaction can be reconciled';
  end if;
  if v_transaction.source_payment_id is null
    and (v_transaction.transaction_type <> 'expense'
      or v_transaction.payment_status <> 'unpaid'
      or v_transaction.approval_status not in ('pending', 'approved')) then
    raise exception 'Only an unassigned automatic payment or unpaid Money Out can be reconciled';
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
  if v_transaction.account_id is null or not exists (
    select 1 from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Assign an active Finance account before marking this transaction paid';
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

-- Add budget linkage without changing the existing transaction RPC signature.
create or replace function public.create_finance_transaction_with_budget(
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
  p_receipt_file_size bigint,
  p_budget_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction_id uuid;
begin
  if p_budget_request_id is not null and p_transaction_type <> 'expense' then
    raise exception 'Only Money Out can be linked to a budget request';
  end if;
  v_transaction_id := public.create_finance_transaction(
    p_transaction_id => p_transaction_id,
    p_transaction_type => p_transaction_type,
    p_amount => p_amount,
    p_category_id => p_category_id,
    p_account_id => p_account_id,
    p_note => p_note,
    p_transaction_date => p_transaction_date,
    p_transaction_time => p_transaction_time,
    p_payment_status => p_payment_status,
    p_lead_id => p_lead_id,
    p_customer_id => p_customer_id,
    p_quotation_id => p_quotation_id,
    p_supplier_payable_id => p_supplier_payable_id,
    p_commission_summary_id => p_commission_summary_id,
    p_receipt_storage_path => p_receipt_storage_path,
    p_receipt_file_name => p_receipt_file_name,
    p_receipt_content_type => p_receipt_content_type,
    p_receipt_file_size => p_receipt_file_size
  );
  if p_budget_request_id is not null then
    update public.finance_transactions
    set budget_request_id = p_budget_request_id
    where id = v_transaction_id;
  end if;
  return v_transaction_id;
end;
$$;

revoke all on function public.create_finance_transaction_with_budget(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) from public;
grant execute on function public.create_finance_transaction_with_budget(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) to authenticated;

commit;
