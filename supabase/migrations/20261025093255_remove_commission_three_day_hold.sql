-- Commission payouts become eligible as soon as the quotation is fully paid
-- and the final client payment is verified. Internal Finance decides when to
-- record the payout; no three-day waiting period is applied.

begin;

create or replace function private.sync_paid_finance_source(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_allocation public.commission_summary_allocations%rowtype;
  v_latest_verified timestamptz;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'paid'
    or v_transaction.approval_status <> 'approved' then
    return;
  end if;

  if v_transaction.commission_allocation_id is not null then
    if v_transaction.supplier_payable_id is not null then
      raise exception 'A Money Out transaction cannot link a supplier payable and commission allocation together';
    end if;

    select * into v_allocation
    from public.commission_summary_allocations allocation
    where allocation.id = v_transaction.commission_allocation_id
      and allocation.organization_id = v_transaction.organization_id
    for update;

    if not found or v_allocation.status <> 'not_yet_paid' then
      raise exception 'The commission allocation is no longer payable';
    end if;
    if round(v_allocation.amount, 2) <> round(v_transaction.amount, 2) then
      raise exception 'The Money Out amount must equal the selected commission allocation';
    end if;
    if not private.quotation_is_fully_paid(v_allocation.quotation_id) then
      raise exception 'The commission cannot be paid until the quotation is fully paid';
    end if;

    select max(payment.verified_at) into v_latest_verified
    from public.quotation_payment_records payment
    where payment.organization_id = v_transaction.organization_id
      and payment.quotation_id = v_allocation.quotation_id
      and payment.status = 'verified';
    if v_latest_verified is null then
      raise exception 'The commission cannot be paid until a client payment is verified';
    end if;

    update public.commission_summary_allocations
    set status = 'paid',
        eligible_at = v_latest_verified,
        paid_at = coalesce(v_transaction.paid_at, now()),
        paid_by = coalesce(v_transaction.paid_by, (select auth.uid()))
    where id = v_allocation.id
      and status = 'not_yet_paid';

    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summaries summary
    set status = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then 'paid'
          else 'not_yet_paid'
        end,
        paid_at = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then coalesce(paid_at, v_transaction.paid_at, now())
          else null
        end,
        paid_by = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then coalesce(paid_by, v_transaction.paid_by, (select auth.uid()))
          else null
        end
    where id = v_allocation.commission_summary_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);
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
    if not private.quotation_is_fully_paid(v_transaction.quotation_id) then
      raise exception 'The commission cannot be paid until the quotation is fully paid';
    end if;
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
    where payment.quotation_id = v_transaction.quotation_id
      and payment.status = 'verified';
    if v_latest_verified is null then
      raise exception 'The commission cannot be paid until a client payment is verified';
    end if;
    update public.commission_summaries
    set status = 'paid', paid_at = coalesce(paid_at, v_transaction.paid_at, now()), paid_by = coalesce(paid_by, (select auth.uid()))
    where id = v_transaction.commission_summary_id
      and status = 'not_yet_paid';
  end if;
end;
$$;

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
  if v_latest_verified is null then
    raise exception 'The commission cannot be paid until a client payment is verified';
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

create or replace function public.finance_sidebar_queue_counts(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_counts jsonb;
  v_legacy_pending bigint := 0;
  v_new_pending bigint := 0;
  v_legacy_revision bigint := 0;
  v_new_revision bigint := 0;
  v_old_commission bigint := 0;
  v_current_commission bigint := 0;
  v_finance bigint;
begin
  v_counts := public.sidebar_queue_counts(p_organization_id);
  v_finance := coalesce((v_counts ->> 'finance')::bigint, 0);

  if private.finance_is_internal(p_organization_id) then
    select count(*) into v_old_commission
    from public.commission_summary_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.status = 'not_yet_paid'
      and allocation.amount > 0
      and private.quotation_is_fully_paid(allocation.quotation_id)
      and (
        select max(payment.verified_at)
        from public.quotation_payment_records payment
        where payment.organization_id = p_organization_id
          and payment.quotation_id = allocation.quotation_id
          and payment.status::text = 'verified'
          and payment.verified_at is not null
      ) <= now() - interval '3 days';

    select count(*) into v_current_commission
    from public.commission_summary_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.status = 'not_yet_paid'
      and allocation.amount > 0
      and private.quotation_is_fully_paid(allocation.quotation_id)
      and exists (
        select 1
        from public.quotation_payment_records payment
        where payment.organization_id = p_organization_id
          and payment.quotation_id = allocation.quotation_id
          and payment.status::text = 'verified'
          and payment.verified_at is not null
      );

    v_finance := v_finance - v_old_commission + v_current_commission;

    select count(*) into v_legacy_pending
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    if private.finance_is_budget_operator(p_organization_id) then
      select count(*) into v_new_pending
      from public.finance_account_funding_requests request
      where request.organization_id = p_organization_id
        and request.status::text = 'pending';
    end if;

    v_finance := v_finance - v_legacy_pending + v_new_pending;
  elsif private.has_text_role(p_organization_id, array['external_finance']) then
    select count(*) into v_legacy_revision
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    select count(*) into v_new_revision
    from public.finance_account_funding_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    v_finance := v_finance - v_legacy_revision + v_new_revision;
  end if;

  return jsonb_set(
    v_counts,
    '{finance}',
    to_jsonb(greatest(v_finance, 0)),
    true
  );
end;
$$;

revoke all on function public.finance_sidebar_queue_counts(uuid) from public, anon, authenticated;
grant execute on function public.finance_sidebar_queue_counts(uuid) to authenticated;

commit;
