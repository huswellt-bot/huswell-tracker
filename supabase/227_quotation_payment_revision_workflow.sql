-- Add a non-terminal return-for-correction workflow for quotation payment
-- receipts. Returned rows stay outside Cash In until External Finance edits and
-- resubmits the same payment record.
-- Run after 226_fix_external_finance_payment_record_read_rls.sql and before
-- deploying the matching application update. Safe to re-run.

begin;

-- Keep rejected as a historical state, but use revision_requested for normal
-- correction requests so a receipt can be resubmitted without creating a
-- second payment or a duplicate posted ledger entry.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.quotation_payment_records'::regclass
      and contype = 'c'
      and (
        conname = 'quotation_payment_records_status_check'
        or pg_get_constraintdef(oid) ilike '%status%'
      )
  loop
    execute format(
      'alter table public.quotation_payment_records drop constraint if exists %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.quotation_payment_records
  add constraint quotation_payment_records_status_check
  check (status in ('pending', 'verified', 'rejected', 'revision_requested', 'reversed'));

alter table public.quotation_payment_records
  add column if not exists correction_note text,
  add column if not exists revision_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists resubmitted_by uuid references auth.users(id) on delete set null,
  add column if not exists resubmitted_at timestamptz;

create index if not exists quotation_payment_records_revision_status_idx
  on public.quotation_payment_records(organization_id, status, updated_at desc);

create table if not exists public.quotation_payment_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.quotation_payment_records(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  reason text not null check (btrim(reason) <> ''),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  resubmitted_by uuid references auth.users(id) on delete set null,
  resubmitted_at timestamptz,
  before_data jsonb not null,
  after_data jsonb,
  previous_receipt_storage_path text,
  receipt_storage_path text,
  created_at timestamptz not null default now(),
  check ((resubmitted_at is null and resubmitted_by is null) or (resubmitted_at is not null and resubmitted_by is not null)),
  unique (payment_id, revision_number)
);

create index if not exists quotation_payment_revisions_org_idx
  on public.quotation_payment_revisions(organization_id, requested_at desc);
create index if not exists quotation_payment_revisions_payment_idx
  on public.quotation_payment_revisions(payment_id, revision_number desc);
create index if not exists quotation_payment_revisions_receipt_idx
  on public.quotation_payment_revisions(previous_receipt_storage_path, receipt_storage_path);

alter table public.quotation_payment_revisions enable row level security;
revoke all on public.quotation_payment_revisions from anon, authenticated;
grant select on public.quotation_payment_revisions to authenticated;

drop policy if exists "quotation payment revisions: authorized read"
  on public.quotation_payment_revisions;
create policy "quotation payment revisions: authorized read"
on public.quotation_payment_revisions for select to authenticated
using (
  private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ])
  or exists (
    select 1
    from public.quotation_payment_records payment
    where payment.id = quotation_payment_revisions.payment_id
      and payment.organization_id = quotation_payment_revisions.organization_id
      and payment.submitted_by = (select auth.uid())
  )
);

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
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
  v_revision_number integer;
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
    raise exception 'Only Internal Finance or management can review client payments';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'Only pending quotation payments can be reviewed';
  end if;
  if p_decision not in ('verified', 'revision_requested', 'rejected') then
    raise exception 'Unsupported quotation payment decision';
  end if;
  if p_decision in ('revision_requested', 'rejected') and v_note is null then
    raise exception 'Enter a reason before returning or rejecting the payment';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'The payment review reason must be 2000 characters or fewer';
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
  elsif p_decision = 'revision_requested' then
    select coalesce(max(revision.revision_number), 0) + 1
    into v_revision_number
    from public.quotation_payment_revisions revision
    where revision.payment_id = v_payment.id;

    insert into public.quotation_payment_revisions (
      organization_id,
      payment_id,
      revision_number,
      reason,
      requested_by,
      before_data,
      previous_receipt_storage_path
    ) values (
      v_payment.organization_id,
      v_payment.id,
      v_revision_number,
      v_note,
      (select auth.uid()),
      jsonb_build_object(
        'quotation_id', v_payment.quotation_id,
        'payment_kind', v_payment.payment_kind,
        'amount', v_payment.amount,
        'paid_at', v_payment.paid_at,
        'method', v_payment.method::text,
        'finance_account_id', v_payment.finance_account_id,
        'reference_no', v_payment.reference_no,
        'notes', v_payment.notes,
        'receipt_storage_path', v_payment.receipt_storage_path,
        'receipt_file_name', v_payment.receipt_file_name,
        'receipt_content_type', v_payment.receipt_content_type,
        'receipt_file_size', v_payment.receipt_file_size,
        'status', v_payment.status
      ),
      v_payment.receipt_storage_path
    );
  end if;

  update public.quotation_payment_records
  set status = p_decision,
      verified_by = case when p_decision in ('verified', 'rejected') then (select auth.uid()) else null end,
      verified_at = case when p_decision = 'verified' then now() else null end,
      verification_note = case when p_decision in ('verified', 'rejected') then v_note else null end,
      correction_note = case when p_decision = 'revision_requested' then v_note else null end,
      revision_requested_by = case when p_decision = 'revision_requested' then (select auth.uid()) else null end,
      revision_requested_at = case when p_decision = 'revision_requested' then now() else null end
  where id = v_payment.id
  returning * into v_payment;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  ) values (
    v_payment.organization_id,
    (select auth.uid()),
    'quotation_payment',
    v_payment.id,
    case
      when p_decision = 'verified' then 'quotation_payment_verified'
      when p_decision = 'revision_requested' then 'quotation_payment_returned_for_correction'
      else 'quotation_payment_rejected'
    end,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', p_decision,
      'verification_note', case when p_decision in ('verified', 'rejected') then v_note else null end,
      'correction_note', case when p_decision = 'revision_requested' then v_note else null end
    ),
    v_note
  );

  return v_payment;
end;
$$;

revoke all on function public.review_quotation_payment(uuid, text, text) from public;
grant execute on function public.review_quotation_payment(uuid, text, text) to authenticated;

-- External Finance resubmits the same returned row. A new receipt object is
-- required, while the previous object path remains in revision history.
create or replace function public.resubmit_quotation_payment_with_account(
  p_payment_id uuid,
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
  v_payment public.quotation_payment_records%rowtype;
  v_quote public.quotations%rowtype;
  v_account public.finance_accounts%rowtype;
  v_revision_id uuid;
  v_method public.payment_method;
  v_total numeric;
  v_verified numeric;
  v_pending numeric;
  v_available numeric;
  v_downpayment_remaining numeric;
  v_amount numeric;
  v_before_data jsonb;
  v_after_data jsonb;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found
    or v_payment.status <> 'revision_requested'
    or v_payment.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_payment.organization_id, array['external_finance']) then
    raise exception 'Only your returned quotation payment receipts can be resubmitted';
  end if;

  select * into v_quote
  from public.quotations quote
  where quote.id = v_payment.quotation_id
    and quote.organization_id = v_payment.organization_id
  for share;

  if not found
    or v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text is distinct from 'approved' then
    raise exception 'Payments can only be resubmitted against an approved direct Price Quotation';
  end if;
  if p_payment_kind is null or p_payment_kind not in ('downpayment', 'full_payment') then
    raise exception 'Unsupported payment type';
  end if;
  if p_finance_account_id is null then
    raise exception 'Choose the account that received the client payment';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a payment amount with no more than two decimal places';
  end if;

  select * into v_account
  from public.finance_accounts account
  where account.id = p_finance_account_id
    and account.organization_id = v_payment.organization_id
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
  select
    round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2),
    round(coalesce(sum(payment.amount) filter (where payment.status = 'pending' and payment.id <> v_payment.id), 0), 2)
  into v_verified, v_pending
  from public.quotation_payment_records payment
  where payment.quotation_id = v_quote.id;
  v_available := round(greatest(v_total - v_verified - v_pending, 0), 2);
  v_downpayment_remaining := round(greatest(
    v_total * (coalesce(v_quote.downpayment_rate, 50) / 100) - v_verified - v_pending,
    0
  ), 2);

  if v_available <= 0 then
    raise exception 'No unallocated quotation balance remains; review the other pending receipts first';
  end if;
  if p_payment_kind = 'downpayment' then
    if v_quote.payment_requirement is distinct from 'downpayment' then
      raise exception 'Set a downpayment term before recording a downpayment receipt';
    end if;
    if v_downpayment_remaining <= 0 or v_amount <> v_downpayment_remaining then
      raise exception 'Downpayment must equal the remaining downpayment target of %', v_downpayment_remaining;
    end if;
  elsif v_amount <> v_available then
    raise exception 'Full payment must equal the available balance of % after pending receipts', v_available;
  end if;

  if p_receipt_file_name is null or nullif(btrim(p_receipt_file_name), '') is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size <= 0
    or p_receipt_file_size > 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP replacement receipt no larger than 10 MB';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_storage_path = v_payment.receipt_storage_path
    or p_receipt_storage_path !~* (
      '^' || v_payment.organization_id::text || '/' || v_payment.quotation_id::text
        || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    ) then
    raise exception 'Replacement receipt storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'quotation-payment-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the replacement receipt before resubmitting it';
  end if;

  select revision.id into v_revision_id
  from public.quotation_payment_revisions revision
  where revision.payment_id = v_payment.id
    and revision.resubmitted_at is null
  order by revision.revision_number desc
  limit 1
  for update;
  if v_revision_id is null then
    raise exception 'The quotation payment correction history could not be found';
  end if;

  v_before_data := jsonb_build_object(
    'status', v_payment.status,
    'payment_kind', v_payment.payment_kind,
    'amount', v_payment.amount,
    'paid_at', v_payment.paid_at,
    'method', v_payment.method::text,
    'finance_account_id', v_payment.finance_account_id,
    'reference_no', v_payment.reference_no,
    'notes', v_payment.notes,
    'receipt_storage_path', v_payment.receipt_storage_path,
    'receipt_file_name', v_payment.receipt_file_name,
    'receipt_content_type', v_payment.receipt_content_type,
    'receipt_file_size', v_payment.receipt_file_size,
    'correction_note', v_payment.correction_note
  );
  v_after_data := jsonb_build_object(
    'status', 'pending',
    'payment_kind', p_payment_kind,
    'amount', v_amount,
    'paid_at', coalesce(p_paid_at, current_date),
    'method', v_method::text,
    'finance_account_id', p_finance_account_id,
    'reference_no', nullif(btrim(coalesce(p_reference_no, '')), ''),
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'receipt_storage_path', p_receipt_storage_path,
    'receipt_file_name', btrim(p_receipt_file_name),
    'receipt_content_type', p_receipt_content_type,
    'receipt_file_size', p_receipt_file_size
  );

  update public.quotation_payment_records
  set payment_kind = p_payment_kind,
      amount = v_amount,
      paid_at = coalesce(p_paid_at, current_date),
      method = v_method,
      finance_account_id = p_finance_account_id,
      reference_no = nullif(btrim(coalesce(p_reference_no, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      receipt_storage_path = p_receipt_storage_path,
      receipt_file_name = btrim(p_receipt_file_name),
      receipt_content_type = p_receipt_content_type,
      receipt_file_size = p_receipt_file_size,
      status = 'pending',
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      reviewer_user_id = null,
      verified_by = null,
      verified_at = null,
      verification_note = null,
      correction_note = null,
      revision_requested_by = null,
      revision_requested_at = null,
      resubmitted_by = (select auth.uid()),
      resubmitted_at = now()
  where id = v_payment.id
  returning * into v_payment;

  update public.quotation_payment_revisions
  set resubmitted_by = (select auth.uid()),
      resubmitted_at = now(),
      after_data = v_after_data,
      receipt_storage_path = p_receipt_storage_path
  where id = v_revision_id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  ) values (
    v_payment.organization_id,
    (select auth.uid()),
    'quotation_payment',
    v_payment.id,
    'quotation_payment_resubmitted',
    v_before_data,
    v_after_data,
    'External Finance corrected and resubmitted the quotation payment receipt.'
  );

  return v_payment;
end;
$$;

revoke all on function public.resubmit_quotation_payment_with_account(
  uuid, text, numeric, date, uuid, text, text, text, text, text, bigint
) from public;
grant execute on function public.resubmit_quotation_payment_with_account(
  uuid, text, numeric, date, uuid, text, text, text, text, text, bigint
) to authenticated;

commit;
