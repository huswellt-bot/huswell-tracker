-- Move quotation-payment confirmation to Internal Finance and require full
-- quotation collection before a Sales Executive commission can be paid.
-- Run after 201_fix_price_quotation_deletion_after_finance_reconciliation.sql
-- and before the matching application update. Safe to re-run.

begin;

-- Project Managers and assigned Sales & Pricing Officers may submit the
-- client's receipt. Submission is not payment confirmation.
create or replace function private.can_submit_quotation_payment(
  p_quotation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.quotations quote
    where quote.id = p_quotation_id
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'approved'
      and (
        (
          private.has_text_role(quote.organization_id, array['project_manager'])
          and (
            quote.created_by = (select auth.uid())
            or quote.prepared_by_user_id = (select auth.uid())
            or quote.submitted_by = (select auth.uid())
          )
        )
        or (
          private.has_text_role(quote.organization_id, array['sales_pricing_officer'])
          and (
            quote.pricing_reviewed_by = (select auth.uid())
            or private.is_pricing_officer_assigned(
              quote.organization_id,
              (select auth.uid()),
              quote.project_types
            )
          )
        )
      )
  );
$$;

-- Finance roles can monitor payment evidence, while the existing quotation
-- owner/reviewer access remains available for the operational quotation view.
create or replace function private.can_view_quotation_payment(
  p_quotation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.quotations quote
    where quote.id = p_quotation_id
      and (
        private.has_text_role(quote.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant',
          'internal_finance', 'external_finance', 'production', 'warehouse'
        ])
        or private.can_submit_quotation_payment(quote.id)
        or private.quotation_payment_reviewer(quote.id) = (select auth.uid())
      )
  );
$$;

-- Keep the existing registration signature for backward compatibility, but
-- stop assigning a Sales & Pricing Officer as the payment reviewer. Internal
-- Finance now works from the organization-wide confirmation queue.
create or replace function public.register_quotation_payment(
  p_payment_id uuid,
  p_quotation_id uuid,
  p_payment_kind text,
  p_amount numeric,
  p_paid_at date,
  p_method public.payment_method,
  p_reference_no text,
  p_notes text,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns public.quotation_payment_records
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_payment public.quotation_payment_records%rowtype;
  v_amount numeric;
  v_total numeric;
  v_verified numeric;
  v_pending numeric;
  v_available numeric;
  v_downpayment_remaining numeric;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text is distinct from 'approved' then
    raise exception 'Payments can only be recorded against an approved direct Price Quotation';
  end if;
  if not private.can_submit_quotation_payment(v_quote.id) then
    raise exception 'Only an authorized Project Manager or Sales & Pricing Officer can submit a payment receipt';
  end if;
  if p_payment_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'Enter a payment amount greater than zero';
  end if;
  if p_payment_kind is null
    or p_payment_kind not in ('downpayment', 'partial_payment', 'full_payment') then
    raise exception 'Unsupported payment type';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Payment amounts can use no more than two decimal places';
  end if;
  if exists (
    select 1
    from public.quotation_payment_records payment
    where payment.id = p_payment_id
  ) then
    raise exception 'This payment receipt has already been registered';
  end if;

  v_amount := round(p_amount, 2);
  v_total := round(greatest(coalesce(v_quote.total_amount, 0), 0), 2);
  if v_total <= 0 then
    raise exception 'The quotation must have a positive total before recording a payment';
  end if;

  select
    round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2),
    round(coalesce(sum(payment.amount) filter (where payment.status = 'pending'), 0), 2)
  into v_verified, v_pending
  from public.quotation_payment_records payment
  where payment.quotation_id = v_quote.id;

  v_available := round(greatest(v_total - v_verified - v_pending, 0), 2);
  v_downpayment_remaining := round(greatest(
    case v_quote.payment_requirement
      when 'none' then 0
      when 'full_payment' then v_total
      else v_total * (coalesce(v_quote.downpayment_rate, 50) / 100)
    end - v_verified - v_pending,
    0
  ), 2);

  if v_available <= 0 then
    raise exception 'No unallocated quotation balance remains; review the pending receipts first';
  end if;

  if p_payment_kind = 'downpayment' then
    if v_quote.payment_requirement is distinct from 'downpayment' then
      raise exception 'Set a downpayment term before recording a downpayment receipt';
    end if;
    if v_downpayment_remaining <= 0 then
      raise exception 'The downpayment target is already covered by verified or pending payments';
    end if;
    if v_amount <> v_downpayment_remaining then
      raise exception 'Downpayment must equal the remaining downpayment target of %', v_downpayment_remaining;
    end if;
  elsif p_payment_kind = 'partial_payment' then
    if v_amount >= v_available then
      raise exception 'Use Full payment for the entire available balance of %', v_available;
    end if;
  elsif v_amount <> v_available then
    raise exception 'Full payment must equal the available balance of % after pending receipts', v_available;
  end if;

  if p_receipt_file_name is null or nullif(btrim(p_receipt_file_name), '') is null then
    raise exception 'Upload the payment receipt image';
  end if;
  if p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size <= 0
    or p_receipt_file_size > 10485760 then
    raise exception 'Payment receipts must be JPEG, PNG, or WebP files no larger than 10 MB';
  end if;
  if p_receipt_storage_path !~* (
    '^' || v_quote.organization_id::text || '/' || v_quote.id::text || '/'
      || p_payment_id::text || '\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Payment receipt storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'quotation-payment-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the payment receipt image before registering it';
  end if;

  insert into public.quotation_payment_records (
    id,
    organization_id,
    quotation_id,
    payment_kind,
    amount,
    paid_at,
    method,
    reference_no,
    notes,
    receipt_storage_path,
    receipt_file_name,
    receipt_content_type,
    receipt_file_size,
    status,
    submitted_by,
    reviewer_user_id
  )
  values (
    p_payment_id,
    v_quote.organization_id,
    v_quote.id,
    p_payment_kind,
    v_amount,
    coalesce(p_paid_at, current_date),
    coalesce(p_method, 'cash'::public.payment_method),
    nullif(btrim(coalesce(p_reference_no, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_receipt_storage_path,
    btrim(p_receipt_file_name),
    p_receipt_content_type,
    p_receipt_file_size,
    'pending',
    (select auth.uid()),
    null
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

-- Only Internal Finance and management may decide whether a receipt reflects
-- actual funds. A pending receipt never reaches the Money In trigger.
create or replace function public.review_quotation_payment(
  p_payment_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns public.quotation_payment_records
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payment public.quotation_payment_records%rowtype;
  v_quote public.quotations%rowtype;
  v_can_review boolean;
  v_total numeric;
  v_verified numeric;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  v_can_review := private.has_text_role(v_payment.organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ]);
  if not v_can_review then
    raise exception 'Only Internal Finance or management can confirm client payments';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'Only pending quotation payments can be reviewed';
  end if;
  if p_decision not in ('verified', 'rejected') then
    raise exception 'Unsupported quotation payment decision';
  end if;
  if p_decision = 'rejected'
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'Enter a reason before rejecting the payment';
  end if;

  if p_decision = 'verified' then
    select * into v_quote
    from public.quotations
    where id = v_payment.quotation_id
    for update;

    v_total := round(greatest(coalesce(v_quote.total_amount, 0), 0), 2);
    select round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2)
    into v_verified
    from public.quotation_payment_records payment
    where payment.quotation_id = v_payment.quotation_id;

    if v_total <= 0 or v_verified + round(v_payment.amount, 2) > v_total then
      raise exception 'Verifying this receipt would exceed the quotation total';
    end if;
  end if;

  update public.quotation_payment_records
  set status = p_decision,
      verified_by = (select auth.uid()),
      verified_at = case when p_decision = 'verified' then now() else null end,
      verification_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_payment.id
  returning * into v_payment;

  return v_payment;
end;
$$;

-- Payment reversal remains a management exception. The helper is shared by
-- commission payout validation and the UI's eligibility calculation.
create or replace function private.quotation_is_fully_paid(
  p_quotation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (
      select round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2)
        >= round(greatest(coalesce(quote.total_amount, 0), 0), 2)
        and round(greatest(coalesce(quote.total_amount, 0), 0), 2) > 0
      from public.quotations quote
      left join public.quotation_payment_records payment
        on payment.quotation_id = quote.id
      where quote.id = p_quotation_id
      group by quote.total_amount
    ),
    false
  );
$$;

-- Rebuild the automatic Money In synchronizer so a payment reversal also
-- voids any linked commission payout and returns that allocation to unpaid.
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
      raise exception 'Create an active income category before confirming a quotation payment';
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
    where (source_payment_id = new.id or (quotation_id = new.quotation_id and commission_allocation_id is not null))
      and is_voided = false;

    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summary_allocations allocation
    set status = 'not_yet_paid',
        eligible_at = null,
        paid_at = null,
        paid_by = null
    where allocation.quotation_id = new.quotation_id
      and allocation.status = 'paid';

    update public.commission_summaries summary
    set status = 'not_yet_paid',
        paid_at = null,
        paid_by = null
    where summary.quotation_id = new.quotation_id
      and summary.status = 'paid';
    perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_payment_finance_sync on public.quotation_payment_records;
create trigger quotation_payment_finance_sync
after insert or update of status, verified_at, verified_by, reversed_at, reversal_note
on public.quotation_payment_records
for each row execute function private.sync_quotation_payment_to_finance();

-- Keep voided commission payout history, but allow a replacement payout after
-- a verified client payment has been reversed and later corrected.
drop index if exists public.finance_transactions_one_commission_allocation_payment_idx;
create unique index if not exists finance_transactions_one_commission_allocation_payment_idx
  on public.finance_transactions (commission_allocation_id)
  where commission_allocation_id is not null
    and is_voided = false
    and payment_status = 'paid'
    and approval_status = 'approved';

-- Enforce the full-payment commission rule at the authoritative Money Out
-- source. The existing three-day hold remains in place.
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
      raise exception 'The commission cannot be paid until a client payment is confirmed';
    end if;
    if now() < v_latest_verified + interval '3 days' then
      raise exception 'The commission becomes payable three days after the final confirmed client payment';
    end if;

    update public.commission_summary_allocations
    set status = 'paid',
        eligible_at = v_latest_verified + interval '3 days',
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
    if v_latest_verified is null or now() < v_latest_verified + interval '3 days' then
      raise exception 'The commission is not yet payable';
    end if;
    update public.commission_summaries
    set status = 'paid', paid_at = coalesce(paid_at, v_transaction.paid_at, now()), paid_by = coalesce(paid_by, (select auth.uid()))
    where id = v_transaction.commission_summary_id
      and status = 'not_yet_paid';
  end if;
end;
$$;

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
          'super_admin', 'owner', 'admin', 'accountant',
          'internal_finance', 'external_finance'
        ])
        or private.can_submit_quotation_payment(payment.quotation_id)
        or private.quotation_payment_reviewer(payment.quotation_id) = (select auth.uid())
      )
  )
);

commit;
