-- Track client payment submissions and receipt proofs against approved direct
-- Price Quotations. Mockup Quotations use their source Price Quotation as the
-- commercial payment record. Run after 122_production_request_workflow.sql.
-- Safe to re-run.

begin;

alter table public.quotations
  add column if not exists payment_requirement text not null default 'downpayment'
    check (payment_requirement in ('none', 'downpayment', 'full_payment')),
  add column if not exists downpayment_rate numeric(5,2) not null default 50
    check (downpayment_rate >= 0 and downpayment_rate <= 100);

create table if not exists public.quotation_payment_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_kind text not null check (payment_kind in ('downpayment', 'partial_payment', 'full_payment')),
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default current_date,
  method public.payment_method not null default 'cash',
  reference_no text,
  notes text,
  receipt_storage_path text not null unique,
  receipt_file_name text not null check (btrim(receipt_file_name) <> ''),
  receipt_content_type text not null check (receipt_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  receipt_file_size bigint not null check (receipt_file_size > 0 and receipt_file_size <= 10485760),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'reversed')),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verification_note text,
  reversed_by uuid references auth.users(id) on delete set null,
  reversed_at timestamptz,
  reversal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the existing quotation deletion workflow from leaving private receipt
-- objects behind when its payment rows are removed by the foreign key.
alter table public.quotation_payment_records
  drop constraint if exists quotation_payment_records_quotation_id_fkey;
alter table public.quotation_payment_records
  add constraint quotation_payment_records_quotation_id_fkey
  foreign key (quotation_id) references public.quotations(id) on delete cascade;

create index if not exists quotation_payment_records_quotation_idx
  on public.quotation_payment_records(quotation_id, paid_at desc);
create index if not exists quotation_payment_records_status_idx
  on public.quotation_payment_records(organization_id, status, submitted_at desc);

drop trigger if exists quotation_payment_records_updated_at on public.quotation_payment_records;
create trigger quotation_payment_records_updated_at
before update on public.quotation_payment_records
for each row execute function public.set_updated_at();

create or replace function public.cleanup_quotation_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from storage.objects
  where bucket_id = 'quotation-payment-receipts'
    and name = old.receipt_storage_path;
  return old;
end;
$$;

drop trigger if exists quotation_payment_records_cleanup_receipt on public.quotation_payment_records;
create trigger quotation_payment_records_cleanup_receipt
after delete on public.quotation_payment_records
for each row execute function public.cleanup_quotation_payment_receipt();

-- Keep payment terms separate from quotation prices while preserving the same
-- organization and ownership boundary used by the quotation workflow.
create or replace function public.enforce_quotation_payment_terms()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.payment_requirement is distinct from old.payment_requirement
      or new.downpayment_rate is distinct from old.downpayment_rate
    )
    and not (
      private.has_text_role(new.organization_id, array['super_admin', 'owner', 'admin'])
      or (
        new.status::text = 'approved'
        and private.has_text_role(new.organization_id, array['project_manager'])
        and (
          new.created_by = (select auth.uid())
          or new.prepared_by_user_id = (select auth.uid())
          or new.submitted_by = (select auth.uid())
          or private.is_pricing_officer_assigned(
            new.organization_id,
            (select auth.uid()),
            new.project_types
          )
        )
      )
    ) then
    raise exception 'Only the quotation owner, assigned Sales & Pricing Officer, or General Manager can change payment terms';
  end if;

  if new.payment_requirement = 'none' then
    new.downpayment_rate := 0;
  elsif new.payment_requirement = 'full_payment' then
    new.downpayment_rate := 100;
  elsif new.downpayment_rate <= 0 or new.downpayment_rate >= 100 then
    raise exception 'Downpayment percentage must be greater than 0 and less than 100';
  end if;

  return new;
end;
$$;

drop trigger if exists quotation_payment_terms_guard on public.quotations;
create trigger quotation_payment_terms_guard
before insert or update on public.quotations
for each row execute function public.enforce_quotation_payment_terms();

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
      and private.has_text_role(quote.organization_id, array['project_manager'])
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        )
      )
  );
$$;

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
      )
  );
$$;

create or replace function public.set_quotation_payment_terms(
  p_quotation_id uuid,
  p_payment_requirement text,
  p_downpayment_rate numeric default 50
)
returns public.quotations
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_rate numeric := coalesce(p_downpayment_rate, 50);
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text is distinct from 'approved' then
    raise exception 'Payment terms can only be set on an approved direct Price Quotation';
  end if;

  if not (
    private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
    or private.can_submit_quotation_payment(v_quote.id)
  ) then
    raise exception 'Only the quotation owner, assigned Sales & Pricing Officer, or General Manager can set payment terms';
  end if;

  if p_payment_requirement not in ('none', 'downpayment', 'full_payment') then
    raise exception 'Unsupported payment requirement';
  end if;
  if p_payment_requirement = 'downpayment'
    and (v_rate <= 0 or v_rate >= 100) then
    raise exception 'Downpayment percentage must be greater than 0 and less than 100';
  end if;

  update public.quotations
  set payment_requirement = p_payment_requirement,
      downpayment_rate = case
        when p_payment_requirement = 'none' then 0
        when p_payment_requirement = 'full_payment' then 100
        else v_rate
      end
  where id = v_quote.id
  returning * into v_quote;

  return v_quote;
end;
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
    submitted_by
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
    (select auth.uid())
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
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  if not private.has_text_role(v_payment.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can verify quotation payments';
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

create or replace function public.reverse_quotation_payment(
  p_payment_id uuid,
  p_reversal_note text
)
returns public.quotation_payment_records
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payment public.quotation_payment_records%rowtype;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  if not private.has_text_role(v_payment.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can reverse quotation payments';
  end if;
  if v_payment.status <> 'verified' then
    raise exception 'Only verified quotation payments can be reversed';
  end if;
  if nullif(btrim(coalesce(p_reversal_note, '')), '') is null then
    raise exception 'Enter a reason before reversing the payment';
  end if;

  update public.quotation_payment_records
  set status = 'reversed',
      reversed_by = (select auth.uid()),
      reversed_at = now(),
      reversal_note = btrim(p_reversal_note)
  where id = v_payment.id
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.set_quotation_payment_terms(uuid, text, numeric) from public;
revoke all on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) from public;
revoke all on function public.review_quotation_payment(uuid, text, text) from public;
revoke all on function public.reverse_quotation_payment(uuid, text) from public;
grant execute on function public.set_quotation_payment_terms(uuid, text, numeric) to authenticated;
grant execute on function public.register_quotation_payment(uuid, uuid, text, numeric, date, public.payment_method, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.review_quotation_payment(uuid, text, text) to authenticated;
grant execute on function public.reverse_quotation_payment(uuid, text) to authenticated;

alter table public.quotation_payment_records enable row level security;
drop policy if exists "quotation payment records: authorized read" on public.quotation_payment_records;
create policy "quotation payment records: authorized read"
on public.quotation_payment_records for select to authenticated
using (private.can_view_quotation_payment(quotation_id));
drop policy if exists "quotation payment records: no direct insert" on public.quotation_payment_records;
create policy "quotation payment records: no direct insert"
on public.quotation_payment_records for insert to authenticated
with check (false);
drop policy if exists "quotation payment records: no direct update" on public.quotation_payment_records;
create policy "quotation payment records: no direct update"
on public.quotation_payment_records for update to authenticated
using (false) with check (false);
drop policy if exists "quotation payment records: no direct delete" on public.quotation_payment_records;
create policy "quotation payment records: no direct delete"
on public.quotation_payment_records for delete to authenticated
using (false);
grant select on public.quotation_payment_records to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-payment-receipts',
  'quotation-payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quotation payment receipts: submit" on storage.objects;
create policy "quotation payment receipts: submit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotation-payment-receipts'
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.quotations quote
    where quote.organization_id::text = split_part(name, '/', 1)
      and quote.id::text = split_part(name, '/', 2)
      and private.can_submit_quotation_payment(quote.id)
  )
);

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
      )
  )
);

drop policy if exists "quotation payment receipts: submitter cleanup" on storage.objects;
create policy "quotation payment receipts: submitter cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and (
    not exists (
      select 1
      from public.quotation_payment_records payment
      where payment.receipt_storage_path = storage.objects.name
    )
    or exists (
      select 1
      from public.quotation_payment_records payment
      where payment.receipt_storage_path = storage.objects.name
        and payment.submitted_by = (select auth.uid())
        and payment.status in ('pending', 'rejected')
    )
  )
  and exists (
    select 1
    from public.quotations quote
    where quote.organization_id::text = split_part(name, '/', 1)
      and quote.id::text = split_part(name, '/', 2)
      and private.can_submit_quotation_payment(quote.id)
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quotation_payment_records'
  ) then
    alter publication supabase_realtime add table public.quotation_payment_records;
  end if;
end;
$$;

commit;
