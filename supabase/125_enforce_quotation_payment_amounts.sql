-- Enforce quotation payment types and amounts at the database boundary.
-- Run after 124_quotation_payment_reviewer_routing.sql.
-- Safe to re-run.

begin;

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
  v_reviewer uuid;
  v_amount numeric;
  v_total numeric;
  v_verified numeric;
  v_pending numeric;
  v_available numeric;
  v_downpayment_remaining numeric;
begin
  -- Serialize receipt registration per quotation so concurrent submissions
  -- cannot both consume the same remaining balance.
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
    raise exception 'Only the quotation owner, assigned Sales & Pricing Officer, or General Manager can record a payment';
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

  v_reviewer := private.quotation_payment_reviewer(v_quote.id);

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
    v_reviewer
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

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
  v_is_manager boolean;
  v_is_reviewer boolean;
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
  v_is_manager := private.has_text_role(v_payment.organization_id, array['super_admin', 'owner', 'admin']);
  v_is_reviewer := v_payment.reviewer_user_id = (select auth.uid())
    and private.has_text_role(v_payment.organization_id, array['pricing_officer']);
  if not v_is_manager and not v_is_reviewer then
    raise exception 'Only the assigned Sales & Pricing Officer or General Manager can verify quotation payments';
  end if;
  if v_is_reviewer and v_payment.submitted_by = (select auth.uid()) then
    raise exception 'The payment submitter cannot verify their own receipt; General Manager review is required';
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
    -- Recheck the total at verification time because an approved quotation
    -- may have been edited after this receipt was submitted.
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
      verified_at = now(),
      verification_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_payment.id
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) from public;
revoke all on function public.review_quotation_payment(uuid, text, text) from public;
grant execute on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.review_quotation_payment(uuid, text, text) to authenticated;

commit;

-- Rollback: restore the function definition from
-- 124_quotation_payment_reviewer_routing.sql.
