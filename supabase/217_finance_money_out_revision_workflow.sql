-- Add an Internal Finance return-for-revision workflow for unpaid Money Out.
-- External Finance can edit the returned record and resubmit it for review.
-- Existing rejected rows remain valid historical/terminal records; this adds a
-- separate revision_requested state so a normal correction is not a rejection.
-- Run after 216_external_money_out_payment_accounts.sql and before deploying
-- the matching Finance workspace update. Safe to re-run.

begin;

-- The finance transaction status is text, so replace both status checks with
-- the additive revision state while preserving the income/expense boundary.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.finance_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%approval_status%'
  loop
    execute format(
      'alter table public.finance_transactions drop constraint if exists %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.finance_transactions
  add constraint finance_transactions_approval_status_check
  check (approval_status in ('not_required', 'pending', 'approved', 'rejected', 'revision_requested', 'cancelled'));

alter table public.finance_transactions
  add constraint finance_transactions_type_approval_status_check
  check (
    (transaction_type = 'income' and approval_status = 'not_required')
    or (transaction_type = 'expense' and approval_status in ('pending', 'approved', 'rejected', 'revision_requested', 'cancelled'))
  );

create table if not exists public.finance_transaction_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
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
  unique (transaction_id, revision_number)
);

create index if not exists finance_transaction_revisions_org_idx
  on public.finance_transaction_revisions(organization_id, requested_at desc);
create index if not exists finance_transaction_revisions_transaction_idx
  on public.finance_transaction_revisions(transaction_id, revision_number desc);
create index if not exists finance_transaction_revisions_receipt_idx
  on public.finance_transaction_revisions(previous_receipt_storage_path, receipt_storage_path);

alter table public.finance_transaction_revisions enable row level security;
revoke all on public.finance_transaction_revisions from anon, authenticated;
grant select on public.finance_transaction_revisions to authenticated;

drop policy if exists "finance transaction revisions: finance read"
  on public.finance_transaction_revisions;
create policy "finance transaction revisions: finance read"
on public.finance_transaction_revisions for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
]));

-- A returned row no longer reserves its old approved budget. A resubmission
-- reserves the same budget again, or gets a new approved pool entry if the old
-- request was cancelled while the row was being revised.
create or replace function private.finance_allocate_external_budget(
  p_organization_id uuid,
  p_amount numeric,
  p_exclude_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_budget public.finance_budget_requests%rowtype;
  v_committed numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The Money Out amount must be greater than zero';
  end if;

  if not private.has_text_role(p_organization_id, array['external_finance'])
    or private.finance_is_internal(p_organization_id) then
    raise exception 'Only External Finance can use the operating budget pool';
  end if;

  for v_budget in
    select request.*
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status = 'approved'
      and request.requested_by = (select auth.uid())
    order by request.requested_at, request.id
    for update
  loop
    select coalesce(sum(transaction.amount), 0)
    into v_committed
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.budget_request_id = v_budget.id
      and transaction.id is distinct from p_exclude_transaction_id
      and transaction.transaction_type = 'expense'
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled');

    if round(v_committed + round(p_amount, 2), 2) <= round(v_budget.amount, 2) then
      return v_budget.id;
    end if;
  end loop;

  raise exception 'No approved budget has enough remaining capacity. Request a new budget before submitting Money Out';
end;
$$;

revoke all on function private.finance_allocate_external_budget(uuid, numeric, uuid) from public, authenticated;

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
  v_external boolean;
begin
  v_external := private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id);

  if v_external and new.transaction_type = 'expense' then
    if tg_op = 'INSERT' then
      new.budget_request_id := private.finance_allocate_external_budget(
        new.organization_id,
        new.amount,
        null
      );
    elsif old.budget_request_id is null
      or (
        old.approval_status = 'revision_requested'
        and not exists (
          select 1
          from public.finance_budget_requests request
          where request.id = old.budget_request_id
            and request.organization_id = old.organization_id
            and request.status = 'approved'
            and request.requested_by = (select auth.uid())
        )
      ) then
      new.budget_request_id := private.finance_allocate_external_budget(
        new.organization_id,
        new.amount,
        new.id
      );
    else
      new.budget_request_id := old.budget_request_id;
    end if;
  end if;

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
  if v_external and v_budget.requested_by is distinct from (select auth.uid()) then
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
    and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled');

  v_amount := case
    when coalesce(new.is_voided, false)
      or new.approval_status in ('rejected', 'revision_requested', 'cancelled') then 0
    else new.amount
  end;
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
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
    ) then
    raise exception 'This budget has active Money Out commitments and cannot be rejected or cancelled';
  end if;
  return new;
end;
$$;

-- Permit only the controlled resubmission RPC to change the account selected
-- by External Finance. Direct client updates remain unavailable through RLS.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
  v_resubmission_context boolean := coalesce(current_setting('huswell.allow_finance_transaction_resubmission', true), '') = 'on';
begin
  if tg_op = 'INSERT'
    and private.finance_is_internal(new.organization_id)
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
    if new.account_id is not null and not exists (
      select 1
      from public.finance_accounts account
      where account.id = new.account_id
        and account.organization_id = new.organization_id
        and account.is_active
    ) then
      raise exception 'Choose an active Finance payment account';
    end if;
    if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id and not v_resubmission_context then
      raise exception 'Only Internal Finance or the controlled resubmission workflow can change the Money Out payment account';
    end if;
    if v_resubmission_context and (
      old.approval_status <> 'revision_requested'
      or new.approval_status <> 'pending'
      or old.payment_status <> 'unpaid'
      or new.payment_status <> 'unpaid'
      or old.source_payment_id is distinct from new.source_payment_id
      or old.commission_summary_id is distinct from new.commission_summary_id
      or old.commission_allocation_id is distinct from new.commission_allocation_id
    ) then
      raise exception 'This transaction is not in a valid revision state';
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
before insert or update of transaction_type, amount, category_id, account_id,
  note, transaction_date, transaction_time, payment_status, approval_status,
  paid_at, paid_by, approved_at, approved_by, decision_note, lead_id,
  customer_id, quotation_id, supplier_payable_id, commission_summary_id,
  commission_allocation_id, source_payment_id, receipt_storage_path,
  receipt_file_name, receipt_content_type, receipt_file_size, budget_request_id,
  is_voided
on public.finance_transactions
for each row execute function private.finance_transaction_submission_guard();

create or replace function public.request_finance_transaction_revision(
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_revision_number integer;
  v_before_data jsonb;
  v_after_data jsonb;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status not in ('pending', 'approved') then
    raise exception 'Only unpaid pending or approved Money Out can be returned for revision';
  end if;
  if v_transaction.is_voided
    or v_transaction.source_payment_id is not null
    or v_transaction.commission_summary_id is not null
    or v_transaction.commission_allocation_id is not null then
    raise exception 'This Finance transaction is not eligible for revision';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Add a reason before returning Money Out for revision';
  end if;
  if length(btrim(p_reason)) > 2000 then
    raise exception 'The revision reason must be 2000 characters or fewer';
  end if;

  v_before_data := jsonb_build_object(
    'amount', v_transaction.amount,
    'category_id', v_transaction.category_id,
    'account_id', v_transaction.account_id,
    'note', v_transaction.note,
    'transaction_date', v_transaction.transaction_date,
    'transaction_time', v_transaction.transaction_time,
    'lead_id', v_transaction.lead_id,
    'customer_id', v_transaction.customer_id,
    'quotation_id', v_transaction.quotation_id,
    'supplier_payable_id', v_transaction.supplier_payable_id,
    'budget_request_id', v_transaction.budget_request_id,
    'receipt_storage_path', v_transaction.receipt_storage_path,
    'receipt_file_name', v_transaction.receipt_file_name,
    'receipt_content_type', v_transaction.receipt_content_type,
    'receipt_file_size', v_transaction.receipt_file_size,
    'approval_status', v_transaction.approval_status,
    'decision_note', v_transaction.decision_note
  );
  v_after_data := v_before_data || jsonb_build_object(
    'approval_status', 'revision_requested',
    'decision_note', btrim(p_reason)
  );

  select coalesce(max(revision_number), 0) + 1
  into v_revision_number
  from public.finance_transaction_revisions
  where transaction_id = v_transaction.id;

  insert into public.finance_transaction_revisions (
    organization_id,
    transaction_id,
    revision_number,
    reason,
    requested_by,
    before_data,
    previous_receipt_storage_path,
    receipt_storage_path
  ) values (
    v_transaction.organization_id,
    v_transaction.id,
    v_revision_number,
    btrim(p_reason),
    (select auth.uid()),
    v_before_data,
    v_transaction.receipt_storage_path,
    v_transaction.receipt_storage_path
  );

  update public.finance_transactions
  set approval_status = 'revision_requested',
      approved_at = null,
      approved_by = null,
      decision_note = btrim(p_reason)
  where id = v_transaction.id;

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
    v_transaction.organization_id,
    (select auth.uid()),
    'finance_transaction',
    v_transaction.id,
    'revision_requested',
    v_before_data,
    v_after_data,
    'Internal Finance returned Money Out for correction.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.request_finance_transaction_revision(uuid, text) from public;
grant execute on function public.request_finance_transaction_revision(uuid, text) to authenticated;

create or replace function public.resubmit_finance_transaction(
  p_transaction_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_transaction_date date,
  p_transaction_time time,
  p_lead_id uuid,
  p_quotation_id uuid,
  p_supplier_payable_id uuid,
  p_receipt_storage_path text default null,
  p_receipt_file_name text default null,
  p_receipt_content_type text default null,
  p_receipt_file_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_payable public.supplier_payables%rowtype;
  v_revision_id uuid;
  v_before_data jsonb;
  v_after_data jsonb;
  v_receipt_path text;
  v_receipt_name text;
  v_receipt_type text;
  v_receipt_size bigint;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found
    or not private.has_text_role(v_transaction.organization_id, array['external_finance'])
    or private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense'
    or v_transaction.approval_status <> 'revision_requested'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.is_voided then
    raise exception 'Only an unpaid Money Out returned for revision can be resubmitted';
  end if;
  if v_transaction.source_payment_id is not null
    or v_transaction.commission_summary_id is not null
    or v_transaction.commission_allocation_id is not null then
    raise exception 'This Finance transaction is not eligible for External Finance resubmission';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The Money Out amount must be greater than zero';
  end if;

  if not exists (
    select 1
    from public.finance_categories category
    where category.id = p_category_id
      and category.organization_id = v_transaction.organization_id
      and category.direction = 'expense'
      and category.is_active
  ) then
    raise exception 'Choose an active expense category';
  end if;
  if not exists (
    select 1
    from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance payment account';
  end if;
  if p_lead_id is not null and not exists (
    select 1 from public.leads lead
    where lead.id = p_lead_id and lead.organization_id = v_transaction.organization_id
  ) then
    raise exception 'The selected lead does not belong to this workspace';
  end if;
  if p_quotation_id is not null and not exists (
    select 1 from public.quotations quotation
    where quotation.id = p_quotation_id and quotation.organization_id = v_transaction.organization_id
  ) then
    raise exception 'The selected quotation does not belong to this workspace';
  end if;
  if p_supplier_payable_id is not null then
    select * into v_payable
    from public.supplier_payables payable
    where payable.id = p_supplier_payable_id
      and payable.organization_id = v_transaction.organization_id
    for share;
    if not found or v_payable.status in ('paid', 'cancelled') then
      raise exception 'Choose an open supplier payable';
    end if;
    if round(coalesce(v_payable.amount_paid, 0) + round(p_amount, 2), 2) > round(v_payable.amount, 2) then
      raise exception 'The Money Out amount exceeds the supplier payable balance';
    end if;
  end if;

  v_receipt_path := nullif(btrim(coalesce(p_receipt_storage_path, '')), '');
  v_receipt_name := coalesce(nullif(btrim(coalesce(p_receipt_file_name, '')), ''), v_transaction.receipt_file_name);
  v_receipt_type := coalesce(nullif(btrim(coalesce(p_receipt_content_type, '')), ''), v_transaction.receipt_content_type);
  v_receipt_size := coalesce(p_receipt_file_size, v_transaction.receipt_file_size);

  if v_receipt_path is not null then
    if v_receipt_path = v_transaction.receipt_storage_path then
      raise exception 'A replacement receipt must use a new file';
    end if;
    if v_receipt_path !~* ('^' || v_transaction.organization_id::text || '/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
      or p_receipt_file_name is null
      or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
      or p_receipt_file_size is null
      or p_receipt_file_size not between 1 and 10485760
      or lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1))) <> lower(split_part(split_part(v_receipt_path, '/', 3), '.', 2)) then
      raise exception 'Replacement receipt storage data is invalid';
    end if;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'finance-receipts'
        and object.name = v_receipt_path
    ) then
      raise exception 'Upload the replacement receipt before resubmitting Money Out';
    end if;
    v_receipt_name := btrim(p_receipt_file_name);
    v_receipt_type := p_receipt_content_type;
    v_receipt_size := p_receipt_file_size;
  else
    v_receipt_path := v_transaction.receipt_storage_path;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'finance-receipts'
        and object.name = v_receipt_path
    ) then
      raise exception 'The current receipt is unavailable. Upload a replacement receipt before resubmitting Money Out';
    end if;
  end if;

  v_before_data := jsonb_build_object(
    'amount', v_transaction.amount,
    'category_id', v_transaction.category_id,
    'account_id', v_transaction.account_id,
    'note', v_transaction.note,
    'transaction_date', v_transaction.transaction_date,
    'transaction_time', v_transaction.transaction_time,
    'lead_id', v_transaction.lead_id,
    'customer_id', v_transaction.customer_id,
    'quotation_id', v_transaction.quotation_id,
    'supplier_payable_id', v_transaction.supplier_payable_id,
    'budget_request_id', v_transaction.budget_request_id,
    'receipt_storage_path', v_transaction.receipt_storage_path,
    'receipt_file_name', v_transaction.receipt_file_name,
    'receipt_content_type', v_transaction.receipt_content_type,
    'receipt_file_size', v_transaction.receipt_file_size,
    'approval_status', v_transaction.approval_status,
    'decision_note', v_transaction.decision_note
  );
  v_after_data := jsonb_build_object(
    'amount', round(p_amount, 2),
    'category_id', p_category_id,
    'account_id', p_account_id,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'transaction_date', p_transaction_date,
    'transaction_time', p_transaction_time,
    'lead_id', p_lead_id,
    'customer_id', v_transaction.customer_id,
    'quotation_id', p_quotation_id,
    'supplier_payable_id', p_supplier_payable_id,
    'budget_request_id', v_transaction.budget_request_id,
    'receipt_storage_path', v_receipt_path,
    'receipt_file_name', v_receipt_name,
    'receipt_content_type', v_receipt_type,
    'receipt_file_size', v_receipt_size,
    'approval_status', 'pending',
    'decision_note', null
  );

  select id into v_revision_id
  from public.finance_transaction_revisions
  where transaction_id = v_transaction.id
    and resubmitted_at is null
  order by revision_number desc
  limit 1
  for update;
  if v_revision_id is null then
    raise exception 'The revision request history could not be found';
  end if;

  perform set_config('huswell.allow_finance_transaction_resubmission', 'on', true);
  update public.finance_transactions
  set amount = round(p_amount, 2),
      category_id = p_category_id,
      account_id = p_account_id,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      transaction_date = p_transaction_date,
      transaction_time = p_transaction_time,
      lead_id = p_lead_id,
      quotation_id = p_quotation_id,
      supplier_payable_id = p_supplier_payable_id,
      receipt_storage_path = v_receipt_path,
      receipt_file_name = v_receipt_name,
      receipt_content_type = v_receipt_type,
      receipt_file_size = v_receipt_size,
      payment_status = 'unpaid',
      approval_status = 'pending',
      paid_at = null,
      paid_by = null,
      approved_at = null,
      approved_by = null,
      decision_note = null
  where id = v_transaction.id;

  update public.finance_transaction_revisions
  set resubmitted_by = (select auth.uid()),
      resubmitted_at = now(),
      after_data = v_after_data,
      receipt_storage_path = v_receipt_path
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
    v_transaction.organization_id,
    (select auth.uid()),
    'finance_transaction',
    v_transaction.id,
    'resubmitted',
    v_before_data,
    v_after_data,
    'External Finance resubmitted Money Out after revision.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.resubmit_finance_transaction(uuid, numeric, uuid, uuid, text, date, time, uuid, uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.resubmit_finance_transaction(uuid, numeric, uuid, uuid, text, date, time, uuid, uuid, uuid, text, text, text, bigint) to authenticated;

-- Preserve the finance receipt boundary and make historical revision receipts
-- readable to Finance. Historical paths are not deletable by External Finance.
drop policy if exists "finance receipts: authorized read" on storage.objects;
create policy "finance receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.finance_transactions transaction
      where transaction.receipt_storage_path = storage.objects.name
        and private.has_text_role(transaction.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
    or exists (
      select 1 from public.finance_transaction_revisions revision
      where (revision.previous_receipt_storage_path = storage.objects.name
        or revision.receipt_storage_path = storage.objects.name)
        and private.has_text_role(revision.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
    or exists (
      select 1 from public.finance_accounts account
      where account.receipt_storage_path = storage.objects.name
        and private.has_text_role(account.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
        ])
    )
    or exists (
      select 1 from public.finance_account_funding_entries funding
      where funding.receipt_storage_path = storage.objects.name
        and private.has_text_role(funding.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
        ])
    )
  )
);

drop policy if exists "finance receipts: finance delete" on storage.objects;
create policy "finance receipts: finance delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
      )
      and (
        exists (
          select 1 from public.finance_transactions transaction
          where transaction.receipt_storage_path = storage.objects.name
            and private.has_text_role(transaction.organization_id, array[
              'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
            ])
        )
        or (
          exists (
            select 1 from public.finance_transactions transaction
            where transaction.receipt_storage_path = storage.objects.name
              and private.has_text_role(transaction.organization_id, array['external_finance'])
          )
          and not exists (
            select 1 from public.finance_transaction_revisions revision
            where revision.previous_receipt_storage_path = storage.objects.name
              or revision.receipt_storage_path = storage.objects.name
          )
        )
        or not exists (
          select 1 from public.finance_transaction_revisions revision
          where revision.previous_receipt_storage_path = storage.objects.name
            or revision.receipt_storage_path = storage.objects.name
        )
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.finance_transaction_revisions revision
        where (revision.previous_receipt_storage_path = storage.objects.name
          or revision.receipt_storage_path = storage.objects.name)
          and private.has_text_role(revision.organization_id, array[
            'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
          ])
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/accounts/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
  )
);

commit;
