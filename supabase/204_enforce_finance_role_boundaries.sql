-- Enforce the agreed Internal Finance / External Finance transaction boundary.
-- Run after 203_finance_budget_allocation_and_role_guards.sql and before the
-- matching Finance workspace update. Safe to re-run.

begin;

-- Internal Finance does not create generic ledger rows. Money In is created by
-- verified quotation-payment reconciliation, while commission Money Out is
-- created only through the controlled commission-allocation RPC. External
-- Finance remains the submitter of ordinary unpaid Money Out entries.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
begin
  if private.finance_is_internal(new.organization_id)
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

-- Commission payouts are the only transaction-creation path available to
-- Internal Finance. Keep the existing signature for client compatibility.
create or replace function public.create_finance_transaction_with_commission_allocation(
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
  p_commission_allocation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_allocation public.commission_summary_allocations%rowtype;
  v_transaction_id uuid;
  v_latest_verified timestamptz;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_internal(v_organization_id) then
    raise exception 'Only Internal Finance can create a commission payout';
  end if;
  if p_commission_allocation_id is null then
    raise exception 'Select an eligible commission allocation';
  end if;
  if p_transaction_type <> 'expense'
    or p_supplier_payable_id is not null
    or p_commission_summary_id is not null then
    raise exception 'A commission allocation can only be linked to Money Out';
  end if;
  if p_account_id is null then
    raise exception 'Choose an active Finance account for the commission payout';
  end if;

  select * into v_allocation
  from public.commission_summary_allocations allocation
  where allocation.id = p_commission_allocation_id
    and allocation.organization_id = v_organization_id
  for update;
  if not found or v_allocation.status <> 'not_yet_paid' then
    raise exception 'The commission allocation is no longer payable';
  end if;
  if not private.quotation_is_fully_paid(v_allocation.quotation_id) then
    raise exception 'The commission cannot be paid until the quotation is fully paid';
  end if;
  select max(payment.verified_at)
  into v_latest_verified
  from public.quotation_payment_records payment
  where payment.quotation_id = v_allocation.quotation_id
    and payment.status = 'verified';
  if v_latest_verified is null or now() < v_latest_verified + interval '3 days' then
    raise exception 'The commission becomes payable three days after the latest verified client payment';
  end if;
  if round(coalesce(p_amount, 0), 2) <> round(v_allocation.amount, 2) then
    raise exception 'The Money Out amount must equal the selected commission allocation';
  end if;
  if p_quotation_id is not null and p_quotation_id is distinct from v_allocation.quotation_id then
    raise exception 'The selected quotation does not match the commission allocation';
  end if;
  if exists (
    select 1
    from public.finance_transactions transaction
    where transaction.commission_allocation_id = v_allocation.id
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'cancelled')
  ) then
    raise exception 'This commission allocation already has an active Finance transaction';
  end if;

  -- The base RPC remains the ordinary External Finance submission path. This
  -- transaction-local marker lets its shared insert pass only from this
  -- validated commission workflow.
  perform set_config('huswell.allow_commission_allocation_insert', 'on', true);
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
    p_quotation_id => coalesce(p_quotation_id, v_allocation.quotation_id),
    p_supplier_payable_id => null,
    p_commission_summary_id => null,
    p_receipt_storage_path => p_receipt_storage_path,
    p_receipt_file_name => p_receipt_file_name,
    p_receipt_content_type => p_receipt_content_type,
    p_receipt_file_size => p_receipt_file_size
  );

  update public.finance_transactions
  set commission_summary_id = v_allocation.commission_summary_id,
      commission_allocation_id = v_allocation.id
  where id = v_transaction_id;

  if p_payment_status = 'paid' then
    perform private.sync_paid_finance_source(v_transaction_id);
  end if;
  return v_transaction_id;
end;
$$;

revoke all on function public.create_finance_transaction_with_commission_allocation(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) from public;
grant execute on function public.create_finance_transaction_with_commission_allocation(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) to authenticated;

-- Money In is created by verified quotation-payment reconciliation. Internal
-- Finance may settle unpaid Money Out, but cannot manually mark an income row
-- paid from the ledger.
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
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense' then
    raise exception 'Money In is created automatically after payment verification';
  end if;
  if v_transaction.approval_status <> 'approved' then
    raise exception 'Only an approved Money Out can be marked paid';
  end if;
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  if v_transaction.account_id is null or not exists (
    select 1
    from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Assign an active Finance account before marking this transaction paid';
  end if;
  update public.finance_transactions
  set payment_status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      paid_by = (select auth.uid())
  where id = v_transaction.id;
  perform private.sync_paid_finance_source(v_transaction.id);
  return v_transaction.id;
end;
$$;

revoke all on function public.mark_finance_transaction_paid(uuid, timestamptz) from public;
grant execute on function public.mark_finance_transaction_paid(uuid, timestamptz) to authenticated;

commit;
