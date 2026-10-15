-- Store the exact Finance account selected for a quotation payment.
-- External Finance chooses from active account names such as China Bank or
-- GCash. The verified Money In entry uses that exact account; the existing
-- payment-method default remains only as a compatibility fallback for older
-- records created before this migration.
-- Run after 207_quotation_payment_terms_options.sql and before the matching
-- application update. Safe to re-run.

begin;

alter table public.quotation_payment_records
  add column if not exists finance_account_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quotation_payment_records'::regclass
      and conname = 'quotation_payment_records_finance_account_id_fkey'
  ) then
    alter table public.quotation_payment_records
      add constraint quotation_payment_records_finance_account_id_fkey
      foreign key (finance_account_id)
      references public.finance_accounts(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists quotation_payment_records_finance_account_idx
  on public.quotation_payment_records(finance_account_id);

-- Preserve the exact destination for historical verified receipts whenever
-- the automatic Money In entry already has one.
update public.quotation_payment_records payment
set finance_account_id = entry.account_id
from public.finance_transactions entry
where entry.source_payment_id = payment.id
  and entry.account_id is not null
  and payment.finance_account_id is null;

-- Return only the account fields needed by the payment form. Account numbers,
-- opening balances, and other Finance-only details stay server-side.
create or replace function public.list_quotation_payment_accounts(
  p_organization_id uuid
)
returns table (
  id uuid,
  account_name text,
  account_type text,
  payment_method public.payment_method
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array[
      'super_admin',
      'owner',
      'admin',
      'accountant',
      'internal_finance',
      'project_manager',
      'sales_pricing_officer'
    ]) then
    raise exception 'You are not authorized to view quotation receiving accounts';
  end if;

  return query
  select
    account.id,
    account.account_name,
    account.account_type,
    account.payment_method
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;

revoke all on function public.list_quotation_payment_accounts(uuid) from public;
grant execute on function public.list_quotation_payment_accounts(uuid) to authenticated;

-- New submissions must identify the exact receiving account. The payment
-- method is derived from that account so PDC/check enforcement cannot be
-- bypassed by sending a mismatched method from the browser.
create or replace function public.register_quotation_payment_with_account(
  p_payment_id uuid,
  p_quotation_id uuid,
  p_payment_kind text,
  p_amount numeric,
  p_paid_at date,
  p_finance_account_id uuid,
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
  v_account public.finance_accounts%rowtype;
  v_payment public.quotation_payment_records%rowtype;
  v_method public.payment_method;
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
    raise exception 'Only External Finance can submit a quotation payment receipt';
  end if;
  if p_payment_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'Enter a payment amount greater than zero';
  end if;
  if p_payment_kind is null
    or p_payment_kind not in ('downpayment', 'full_payment') then
    raise exception 'Unsupported payment type';
  end if;
  if p_finance_account_id is null then
    raise exception 'Choose the account that received the client payment';
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

  select * into v_account
  from public.finance_accounts account
  where account.id = p_finance_account_id
    and account.organization_id = v_quote.organization_id
    and account.is_active
  for share;

  if not found then
    raise exception 'Choose an active Finance account';
  end if;
  v_method := v_account.payment_method;

  if p_payment_kind = 'full_payment'
    and coalesce(v_quote.payment_terms_option, 'completion_50_50') = 'pdc_50_50'
    and v_method is distinct from 'check'::public.payment_method then
    raise exception 'The remaining balance for this term must be recorded through a check (PDC) account';
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
    v_total * (coalesce(v_quote.downpayment_rate, 50) / 100) - v_verified - v_pending,
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
    finance_account_id,
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
    v_method,
    p_finance_account_id,
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

revoke all on function public.register_quotation_payment_with_account(
  uuid, uuid, text, numeric, date, uuid, text, text, text, text, text, bigint
) from public;
grant execute on function public.register_quotation_payment_with_account(
  uuid, uuid, text, numeric, date, uuid, text, text, text, text, text, bigint
) to authenticated;

-- Use the selected account for new receipts. Legacy records without an
-- account continue using the old method-to-default mapping.
create or replace function private.sync_quotation_payment_to_finance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_selected_account public.finance_accounts%rowtype;
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

    if new.finance_account_id is not null then
      select * into v_selected_account
      from public.finance_accounts account
      where account.id = new.finance_account_id
        and account.organization_id = new.organization_id
      for share;

      if not found then
        raise exception 'The selected quotation payment account no longer exists';
      end if;
      if v_selected_account.payment_method is distinct from new.method then
        raise exception 'The selected quotation payment account does not match the payment method';
      end if;
      v_account_id := v_selected_account.id;
    else
      select account.id into v_account_id
      from public.finance_accounts account
      where account.organization_id = new.organization_id
        and account.is_active
        and account.payment_method = new.method
        and account.is_default_for_payment_method
      order by account.created_at, account.id
      limit 1;

      -- Keep the compatibility fallback auditable once the receipt is
      -- verified, without changing the legacy registration function.
      if v_account_id is not null then
        update public.quotation_payment_records
        set finance_account_id = v_account_id
        where id = new.id
          and finance_account_id is null;
      end if;
    end if;

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

commit;
