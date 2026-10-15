-- Make Internal Finance approval and settlement one atomic action for ordinary
-- Money Out. Supplier payables and commission payouts keep their own workflows.
-- Run after 219_commission_payouts_paid_only.sql and before deploying the
-- matching Finance workspace update. Safe to re-run.

begin;

create or replace function public.approve_and_pay_finance_transaction(
  p_transaction_id uuid,
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
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense'
    or v_transaction.is_voided
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status not in ('pending', 'approved') then
    raise exception 'Only unpaid pending or approved Money Out can be approved and paid';
  end if;
  if v_transaction.source_payment_id is not null
    or v_transaction.supplier_payable_id is not null
    or v_transaction.commission_summary_id is not null
    or v_transaction.commission_allocation_id is not null then
    raise exception 'Only regular Money Out can use approve and pay';
  end if;
  if v_transaction.account_id is null or not exists (
    select 1
    from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance payment account before approving and paying';
  end if;

  update public.finance_transactions
  set approval_status = 'approved',
      approved_at = coalesce(v_transaction.approved_at, now()),
      approved_by = coalesce(v_transaction.approved_by, (select auth.uid())),
      payment_status = 'paid',
      paid_at = now(),
      paid_by = (select auth.uid()),
      decision_note = coalesce(
        nullif(btrim(coalesce(p_decision_note, '')), ''),
        v_transaction.decision_note
      )
  where id = v_transaction.id;

  perform private.sync_paid_finance_source(v_transaction.id);
  return v_transaction.id;
end;
$$;

revoke all on function public.approve_and_pay_finance_transaction(uuid, text) from public;
grant execute on function public.approve_and_pay_finance_transaction(uuid, text) to authenticated;

-- Keep the previous review RPC compatible with older deployed clients. An
-- approval of ordinary Money Out now follows the same atomic approve-and-pay
-- path; supplier and commission-linked records keep the legacy review path.
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
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense' or v_transaction.approval_status <> 'pending' then
    raise exception 'Only pending Money Out transactions can be reviewed';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose Approved or Rejected';
  end if;

  if p_decision = 'approved'
    and v_transaction.source_payment_id is null
    and v_transaction.supplier_payable_id is null
    and v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    return public.approve_and_pay_finance_transaction(
      v_transaction.id,
      p_decision_note
    );
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

-- Do not leave a second settlement path for ordinary Money Out. This RPC is
-- retained for Money In, supplier payments, and commission payouts.
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
  if (v_transaction.transaction_type = 'expense' and v_transaction.approval_status <> 'approved')
    or (v_transaction.transaction_type = 'income' and v_transaction.approval_status <> 'not_required') then
    raise exception 'Only an approved Money Out or recorded Money In can be marked paid';
  end if;
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  if v_transaction.transaction_type = 'expense'
    and v_transaction.source_payment_id is null
    and v_transaction.supplier_payable_id is null
    and v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    raise exception 'Regular Money Out must use approve and pay';
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
