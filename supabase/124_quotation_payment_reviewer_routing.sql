  -- Route pending quotation-payment receipt reviews to the Sales & Pricing
-- Officer who priced the quotation, while retaining General Manager override
-- access. Run after 123_quotation_payment_tracking.sql.
-- Safe to re-run.

begin;

alter table public.quotation_payment_records
  add column if not exists reviewer_user_id uuid references auth.users(id) on delete set null;

create index if not exists quotation_payment_records_reviewer_status_idx
  on public.quotation_payment_records (reviewer_user_id, status, created_at desc);

create or replace function private.quotation_payment_reviewer(
  p_quotation_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (
      select quote.pricing_reviewed_by
      from public.quotations quote
      join public.organization_members member
        on member.organization_id = quote.organization_id
       and member.user_id = quote.pricing_reviewed_by
      where quote.id = p_quotation_id
        and member.role::text = 'sales_pricing_officer'
    ),
    (
      select assignment.pricing_officer_user_id
      from public.quotations quote
      join public.pricing_officer_project_types assignment
        on assignment.organization_id = quote.organization_id
       and assignment.project_type = private.normalize_price_quotation_project_type(quote.project_types)
      join public.organization_members member
        on member.organization_id = assignment.organization_id
       and member.user_id = assignment.pricing_officer_user_id
      where quote.id = p_quotation_id
        and member.role::text = 'sales_pricing_officer'
      order by assignment.created_at asc
      limit 1
    )
  )
$$;

revoke all on function private.quotation_payment_reviewer(uuid) from public;

update public.quotation_payment_records payment
set reviewer_user_id = private.quotation_payment_reviewer(payment.quotation_id)
where payment.reviewer_user_id is null;

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
        private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin', 'accountant', 'production', 'warehouse'])
        or private.can_submit_quotation_payment(quote.id)
        or private.quotation_payment_reviewer(quote.id) = (select auth.uid())
      )
  )
$$;

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
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for share;

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
  if p_payment_kind not in ('downpayment', 'partial_payment', 'full_payment') then
    raise exception 'Unsupported payment type';
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
    p_amount,
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
  v_is_manager boolean;
  v_is_reviewer boolean;
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
        private.has_text_role(payment.organization_id, array['super_admin', 'owner', 'admin', 'accountant'])
        or private.can_submit_quotation_payment(payment.quotation_id)
        or payment.reviewer_user_id = (select auth.uid())
      )
  )
);

revoke all on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) from public;
revoke all on function public.review_quotation_payment(uuid, text, text) from public;
grant execute on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.review_quotation_payment(uuid, text, text) to authenticated;

commit;

-- Rollback: restore migration 123's function definitions and drop the
-- reviewer_user_id column only after all deployed app code stops using it.
