-- Add a separate External Finance -> Internal Finance workflow for other Money In.
-- Quotation-payment Money In and account funding remain separate sources.
-- Run after 220_finance_regular_expense_approve_and_pay.sql and before deploying
-- the matching Finance workspace update. Safe to re-run.

begin;

alter table public.finance_transactions
  add column if not exists income_source text,
  add column if not exists income_review_status text,
  add column if not exists reference_number text;

alter table public.finance_transactions
  alter column income_review_status set default 'none';

update public.finance_transactions
set income_review_status = 'none'
where income_review_status is null;

update public.finance_transactions
set income_source = 'quotation_payment',
    income_review_status = case
      when payment_status = 'paid' then 'verified'
      else 'pending'
    end
where transaction_type = 'income'
  and source_payment_id is not null
  and income_source is null;

alter table public.finance_transactions
  alter column income_review_status set not null;

alter table public.finance_transactions
  drop constraint if exists finance_transactions_income_source_check;
alter table public.finance_transactions
  add constraint finance_transactions_income_source_check
  check (income_source is null or income_source in ('quotation_payment', 'manual'));

alter table public.finance_transactions
  drop constraint if exists finance_transactions_income_review_status_check;
alter table public.finance_transactions
  add constraint finance_transactions_income_review_status_check
  check (income_review_status in ('none', 'pending', 'revision_requested', 'verified', 'voided'));

create index if not exists finance_transactions_manual_income_review_idx
  on public.finance_transactions(organization_id, income_review_status, transaction_date desc)
  where transaction_type = 'income' and income_source = 'manual';

-- Keep quotation-payment Money In explicitly separate for future verified
-- receipt rows, while leaving legacy unlinked income rows untouched.
create or replace function private.finance_transaction_income_source_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.transaction_type = 'income' and new.source_payment_id is not null then
    new.income_source := 'quotation_payment';
    new.income_review_status := case when new.payment_status = 'paid' then 'verified' else 'pending' end;
  elsif new.transaction_type = 'expense' then
    new.income_source := null;
    new.income_review_status := 'none';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_income_source_defaults
  on public.finance_transactions;
create trigger finance_transactions_income_source_defaults
before insert or update of transaction_type, source_payment_id, payment_status,
  income_source, income_review_status
on public.finance_transactions
for each row execute function private.finance_transaction_income_source_defaults();

-- Reinstall the shared submission guard with an explicit, transaction-local
-- exception for the two controlled manual-income RPCs. Direct generic income
-- submission and direct status changes remain blocked.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
  v_resubmission_context boolean := coalesce(current_setting('huswell.allow_finance_transaction_resubmission', true), '') = 'on';
  v_manual_income_insert_context boolean := coalesce(current_setting('huswell.allow_manual_income_insert', true), '') = 'on';
  v_manual_income_resubmission_context boolean := coalesce(current_setting('huswell.allow_manual_income_resubmission', true), '') = 'on';
begin
  if tg_op = 'INSERT'
    and private.finance_is_internal(new.organization_id)
    and new.source_payment_id is null
    and new.commission_allocation_id is null
    and not v_commission_context
    and not v_manual_income_insert_context then
    raise exception 'Internal Finance cannot create generic Money In or Money Out. Use payment verification, expense approval, or the commission payout workflow';
  end if;

  if private.finance_is_internal(new.organization_id)
    and (v_manual_income_insert_context or v_manual_income_resubmission_context) then
    raise exception 'Manual Money In is an External Finance submission workflow';
  end if;

  if private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id) then
    if v_manual_income_insert_context or v_manual_income_resubmission_context then
      if new.transaction_type <> 'income'
        or new.income_source <> 'manual'
        or new.income_review_status <> 'pending'
        or new.payment_status <> 'unpaid'
        or new.approval_status <> 'not_required'
        or new.source_payment_id is not null
        or new.lead_id is not null
        or new.customer_id is not null
        or new.quotation_id is not null
        or new.supplier_payable_id is not null
        or new.commission_summary_id is not null
        or new.commission_allocation_id is not null
        or new.budget_request_id is not null then
        raise exception 'Manual Money In must remain an unverified standalone income record';
      end if;
      if new.account_id is null or not exists (
        select 1
        from public.finance_accounts account
        where account.id = new.account_id
          and account.organization_id = new.organization_id
          and account.is_active
      ) then
        raise exception 'Choose an active Finance receiving account';
      end if;
      if tg_op = 'UPDATE' then
        if not v_manual_income_resubmission_context
          or old.income_source <> 'manual'
          or old.income_review_status <> 'revision_requested'
          or new.income_review_status <> 'pending'
          or old.payment_status <> 'unpaid'
          or new.payment_status <> 'unpaid'
          or old.source_payment_id is distinct from new.source_payment_id
          or old.quotation_id is distinct from new.quotation_id
          or old.supplier_payable_id is distinct from new.supplier_payable_id
          or old.commission_summary_id is distinct from new.commission_summary_id
          or old.commission_allocation_id is distinct from new.commission_allocation_id
          or old.budget_request_id is distinct from new.budget_request_id then
          raise exception 'This Money In is not in a valid correction state';
        end if;
      elsif not v_manual_income_insert_context then
        raise exception 'Only the controlled Money In submission workflow can create this record';
      end if;
    else
      if new.transaction_type <> 'expense' then
        raise exception 'External Finance can submit Money Out or use the manual Money In workflow';
      end if;
      if new.payment_status <> 'unpaid' then
        raise exception 'External Finance cannot confirm a payment as paid';
      end if;
      if new.approval_status <> 'pending' then
        raise exception 'External Finance submissions must remain pending approval';
      end if;
      if new.income_source is not null or new.income_review_status <> 'none' then
        raise exception 'Only the manual Money In workflow can set income review fields';
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
  income_source, income_review_status, reference_number, is_voided
on public.finance_transactions
for each row execute function private.finance_transaction_submission_guard();

-- External Finance creates standalone income as unpaid. The selected account
-- is only a proposed receiving account until Internal Finance verifies it.
create or replace function public.create_manual_finance_income(
  p_income_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_reference_number text,
  p_transaction_date date,
  p_transaction_time time,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_category public.finance_categories%rowtype;
  v_account public.finance_accounts%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reference text := nullif(btrim(coalesce(p_reference_number, '')), '');
begin
  -- The selected Finance account is the authoritative organization context.
  -- Do not choose an arbitrary membership when a user belongs to more than
  -- one organization.
  select account.organization_id into v_organization_id
  from public.finance_accounts account
  where account.id = p_account_id
    and account.is_active;

  if v_organization_id is null
    or not private.has_text_role(v_organization_id, array['external_finance'])
    or private.finance_is_internal(v_organization_id) then
    raise exception 'Only External Finance can submit manual Money In';
  end if;
  if p_income_id is null then
    raise exception 'A Money In record is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The Money In amount must be greater than zero';
  end if;
  if length(coalesce(v_note, '')) > 2000 then
    raise exception 'The Money In note must be 2000 characters or fewer';
  end if;
  if length(coalesce(v_reference, '')) > 200 then
    raise exception 'The reference number must be 200 characters or fewer';
  end if;

  select * into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = v_organization_id
    and category.direction = 'income'
    and category.is_active;
  if not found then
    raise exception 'Choose an active income category';
  end if;

  select * into v_account
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = v_organization_id
    and account.is_active
  for share;
  if not found then
    raise exception 'Choose an active Finance receiving account';
  end if;

  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or btrim(p_receipt_file_name) = ''
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP proof image no larger than 10 MB';
  end if;
  if split_part(p_receipt_storage_path, '/', 1) <> v_organization_id::text
    or split_part(p_receipt_storage_path, '/', 2) <> 'transactions'
    or split_part(split_part(p_receipt_storage_path, '/', 3), '.', 1) <> p_income_id::text
    or split_part(p_receipt_storage_path, '/', 4) <> ''
    or lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1))) <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Money In proof storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the Money In proof before saving the record';
  end if;

  perform set_config('huswell.allow_manual_income_insert', 'on', true);
  insert into public.finance_transactions (
    id, organization_id, transaction_type, amount, category_id, account_id,
    note, reference_number, transaction_date, transaction_time, payment_status,
    approval_status, income_source, income_review_status, lead_id, customer_id,
    quotation_id, supplier_payable_id, commission_summary_id,
    receipt_storage_path, receipt_file_name, receipt_content_type,
    receipt_file_size, submitted_by
  ) values (
    p_income_id, v_organization_id, 'income', round(p_amount, 2), p_category_id,
    p_account_id, v_note, v_reference, coalesce(p_transaction_date, current_date),
    p_transaction_time, 'unpaid', 'not_required', 'manual', 'pending', null, null,
    null, null, null, p_receipt_storage_path, btrim(p_receipt_file_name),
    p_receipt_content_type, p_receipt_file_size, (select auth.uid())
  );

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_organization_id, (select auth.uid()), 'finance_transaction', p_income_id,
    'manual_income_submitted', null,
    jsonb_build_object(
      'amount', round(p_amount, 2),
      'category_id', p_category_id,
      'account_id', p_account_id,
      'reference_number', v_reference,
      'income_source', 'manual',
      'income_review_status', 'pending'
    ),
    'External Finance submitted standalone Money In for Internal Finance verification.'
  );

  return p_income_id;
end;
$$;

revoke all on function public.create_manual_finance_income(uuid, numeric, uuid, uuid, text, text, date, time, text, text, text, bigint) from public;
grant execute on function public.create_manual_finance_income(uuid, numeric, uuid, uuid, text, text, date, time, text, text, text, bigint) to authenticated;

create or replace function public.verify_manual_finance_income(
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
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'income'
    or v_transaction.income_source <> 'manual'
    or v_transaction.income_review_status <> 'pending'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.is_voided then
    raise exception 'Only pending manual Money In can be verified';
  end if;
  if length(coalesce(v_note, '')) > 2000 then
    raise exception 'The verification note must be 2000 characters or fewer';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Assign an active Finance receiving account before verification';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = v_transaction.receipt_storage_path
  ) then
    raise exception 'The Money In proof is unavailable; request a correction before verification';
  end if;

  update public.finance_transactions
  set payment_status = 'paid',
      paid_at = now(),
      paid_by = (select auth.uid()),
      income_review_status = 'verified',
      decision_note = v_note
  where id = v_transaction.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_transaction.organization_id, (select auth.uid()), 'finance_transaction',
    v_transaction.id, 'manual_income_verified',
    jsonb_build_object(
      'payment_status', 'unpaid',
      'income_review_status', 'pending',
      'account_id', v_transaction.account_id
    ),
    jsonb_build_object(
      'payment_status', 'paid',
      'income_review_status', 'verified',
      'account_id', v_transaction.account_id,
      'amount', v_transaction.amount
    ),
    'Internal Finance verified standalone Money In; the selected account balance now includes it.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.verify_manual_finance_income(uuid, text) from public;
grant execute on function public.verify_manual_finance_income(uuid, text) to authenticated;

create or replace function public.request_manual_finance_income_revision(
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
  if v_transaction.transaction_type <> 'income'
    or v_transaction.income_source <> 'manual'
    or v_transaction.income_review_status <> 'pending'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.is_voided then
    raise exception 'Only pending manual Money In can be returned for correction';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Add a reason before returning Money In for correction';
  end if;
  if length(btrim(p_reason)) > 2000 then
    raise exception 'The correction reason must be 2000 characters or fewer';
  end if;

  v_before_data := jsonb_build_object(
    'amount', v_transaction.amount,
    'category_id', v_transaction.category_id,
    'account_id', v_transaction.account_id,
    'note', v_transaction.note,
    'reference_number', v_transaction.reference_number,
    'transaction_date', v_transaction.transaction_date,
    'transaction_time', v_transaction.transaction_time,
    'receipt_storage_path', v_transaction.receipt_storage_path,
    'receipt_file_name', v_transaction.receipt_file_name,
    'receipt_content_type', v_transaction.receipt_content_type,
    'receipt_file_size', v_transaction.receipt_file_size,
    'income_source', v_transaction.income_source,
    'income_review_status', v_transaction.income_review_status,
    'decision_note', v_transaction.decision_note
  );
  v_after_data := v_before_data || jsonb_build_object(
    'income_review_status', 'revision_requested',
    'decision_note', btrim(p_reason)
  );

  select coalesce(max(revision_number), 0) + 1
  into v_revision_number
  from public.finance_transaction_revisions
  where transaction_id = v_transaction.id;

  insert into public.finance_transaction_revisions (
    organization_id, transaction_id, revision_number, reason, requested_by,
    before_data, previous_receipt_storage_path, receipt_storage_path
  ) values (
    v_transaction.organization_id, v_transaction.id, v_revision_number,
    btrim(p_reason), (select auth.uid()), v_before_data,
    v_transaction.receipt_storage_path, v_transaction.receipt_storage_path
  );

  update public.finance_transactions
  set income_review_status = 'revision_requested',
      decision_note = btrim(p_reason)
  where id = v_transaction.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_transaction.organization_id, (select auth.uid()), 'finance_transaction',
    v_transaction.id, 'manual_income_revision_requested', v_before_data,
    v_after_data,
    'Internal Finance returned standalone Money In to External Finance for correction.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.request_manual_finance_income_revision(uuid, text) from public;
grant execute on function public.request_manual_finance_income_revision(uuid, text) to authenticated;

create or replace function public.resubmit_manual_finance_income(
  p_transaction_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_reference_number text,
  p_transaction_date date,
  p_transaction_time time,
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
  v_revision_id uuid;
  v_before_data jsonb;
  v_after_data jsonb;
  v_receipt_path text;
  v_receipt_name text;
  v_receipt_type text;
  v_receipt_size bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reference text := nullif(btrim(coalesce(p_reference_number, '')), '');
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
  if v_transaction.transaction_type <> 'income'
    or v_transaction.income_source <> 'manual'
    or v_transaction.income_review_status <> 'revision_requested'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.is_voided then
    raise exception 'Only manual Money In returned for correction can be resubmitted';
  end if;
  if v_transaction.source_payment_id is not null
    or v_transaction.lead_id is not null
    or v_transaction.customer_id is not null
    or v_transaction.quotation_id is not null
    or v_transaction.supplier_payable_id is not null
    or v_transaction.commission_summary_id is not null
    or v_transaction.commission_allocation_id is not null
    or v_transaction.budget_request_id is not null then
    raise exception 'This Money In is not an eligible standalone record';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The Money In amount must be greater than zero';
  end if;
  if length(coalesce(v_note, '')) > 2000 then
    raise exception 'The Money In note must be 2000 characters or fewer';
  end if;
  if length(coalesce(v_reference, '')) > 200 then
    raise exception 'The reference number must be 200 characters or fewer';
  end if;
  if not exists (
    select 1 from public.finance_categories category
    where category.id = p_category_id
      and category.organization_id = v_transaction.organization_id
      and category.direction = 'income'
      and category.is_active
  ) then
    raise exception 'Choose an active income category';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active Finance receiving account';
  end if;

  v_receipt_path := nullif(btrim(coalesce(p_receipt_storage_path, '')), '');
  v_receipt_name := coalesce(nullif(btrim(coalesce(p_receipt_file_name, '')), ''), v_transaction.receipt_file_name);
  v_receipt_type := coalesce(nullif(btrim(coalesce(p_receipt_content_type, '')), ''), v_transaction.receipt_content_type);
  v_receipt_size := coalesce(p_receipt_file_size, v_transaction.receipt_file_size);

  if v_receipt_path is not null then
    if v_receipt_path = v_transaction.receipt_storage_path then
      raise exception 'A replacement proof must use a new file';
    end if;
    if v_receipt_path !~* ('^' || v_transaction.organization_id::text || '/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
      or p_receipt_file_name is null
      or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
      or p_receipt_file_size is null
      or p_receipt_file_size not between 1 and 10485760
      or lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1))) <> lower(split_part(split_part(v_receipt_path, '/', 3), '.', 2)) then
      raise exception 'Replacement proof storage data is invalid';
    end if;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'finance-receipts'
        and object.name = v_receipt_path
    ) then
      raise exception 'Upload the replacement proof before resubmitting Money In';
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
      raise exception 'The current proof is unavailable. Upload a replacement before resubmitting Money In';
    end if;
  end if;

  v_before_data := jsonb_build_object(
    'amount', v_transaction.amount,
    'category_id', v_transaction.category_id,
    'account_id', v_transaction.account_id,
    'note', v_transaction.note,
    'reference_number', v_transaction.reference_number,
    'transaction_date', v_transaction.transaction_date,
    'transaction_time', v_transaction.transaction_time,
    'receipt_storage_path', v_transaction.receipt_storage_path,
    'receipt_file_name', v_transaction.receipt_file_name,
    'receipt_content_type', v_transaction.receipt_content_type,
    'receipt_file_size', v_transaction.receipt_file_size,
    'income_review_status', v_transaction.income_review_status,
    'decision_note', v_transaction.decision_note
  );
  v_after_data := jsonb_build_object(
    'amount', round(p_amount, 2),
    'category_id', p_category_id,
    'account_id', p_account_id,
    'note', v_note,
    'reference_number', v_reference,
    'transaction_date', coalesce(p_transaction_date, current_date),
    'transaction_time', p_transaction_time,
    'receipt_storage_path', v_receipt_path,
    'receipt_file_name', v_receipt_name,
    'receipt_content_type', v_receipt_type,
    'receipt_file_size', v_receipt_size,
    'income_review_status', 'pending',
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
    raise exception 'The Money In correction history could not be found';
  end if;

  perform set_config('huswell.allow_manual_income_resubmission', 'on', true);
  update public.finance_transactions
  set amount = round(p_amount, 2),
      category_id = p_category_id,
      account_id = p_account_id,
      note = v_note,
      reference_number = v_reference,
      transaction_date = coalesce(p_transaction_date, current_date),
      transaction_time = p_transaction_time,
      receipt_storage_path = v_receipt_path,
      receipt_file_name = v_receipt_name,
      receipt_content_type = v_receipt_type,
      receipt_file_size = v_receipt_size,
      payment_status = 'unpaid',
      income_review_status = 'pending',
      paid_at = null,
      paid_by = null,
      decision_note = null
  where id = v_transaction.id;

  update public.finance_transaction_revisions
  set resubmitted_by = (select auth.uid()),
      resubmitted_at = now(),
      after_data = v_after_data,
      receipt_storage_path = v_receipt_path
  where id = v_revision_id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_transaction.organization_id, (select auth.uid()), 'finance_transaction',
    v_transaction.id, 'manual_income_resubmitted', v_before_data,
    v_after_data,
    'External Finance resubmitted standalone Money In after correction.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.resubmit_manual_finance_income(uuid, numeric, uuid, uuid, text, text, date, time, text, text, text, bigint) from public;
grant execute on function public.resubmit_manual_finance_income(uuid, numeric, uuid, uuid, text, text, date, time, text, text, text, bigint) to authenticated;

create or replace function public.void_manual_finance_income(
  p_transaction_id uuid,
  p_void_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_void_reason, '')), '');
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'income'
    or v_transaction.income_source <> 'manual'
    or v_transaction.income_review_status <> 'verified'
    or v_transaction.payment_status <> 'paid'
    or v_transaction.is_voided then
    raise exception 'Only verified manual Money In can be reversed';
  end if;
  if v_reason is null then
    raise exception 'Add a reason before reversing Money In';
  end if;
  if length(v_reason) > 2000 then
    raise exception 'The reversal reason must be 2000 characters or fewer';
  end if;

  update public.finance_transactions
  set is_voided = true,
      voided_at = now(),
      voided_by = (select auth.uid()),
      void_reason = v_reason,
      income_review_status = 'voided'
  where id = v_transaction.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_transaction.organization_id, (select auth.uid()), 'finance_transaction',
    v_transaction.id, 'manual_income_voided',
    jsonb_build_object(
      'payment_status', 'paid',
      'income_review_status', 'verified',
      'is_voided', false,
      'account_id', v_transaction.account_id,
      'amount', v_transaction.amount
    ),
    jsonb_build_object(
      'payment_status', 'paid',
      'income_review_status', 'voided',
      'is_voided', true,
      'void_reason', v_reason
    ),
    'Internal Finance reversed standalone Money In; the account balance no longer includes it.'
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.void_manual_finance_income(uuid, text) from public;
grant execute on function public.void_manual_finance_income(uuid, text) to authenticated;

-- Manual Money In can be corrected to another active account while it is still
-- awaiting verification. Automatic quotation Money In keeps its existing rule.
create or replace function public.assign_finance_transaction_account(
  p_transaction_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_previous_account public.finance_accounts%rowtype;
  v_selected_account public.finance_accounts%rowtype;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.is_voided then
    raise exception 'Voided transactions cannot change payment accounts';
  end if;

  if v_transaction.source_payment_id is not null then
    if v_transaction.account_id is not null then
      raise exception 'Only an unassigned automatic quotation payment can be reconciled';
    end if;
  elsif v_transaction.transaction_type = 'income'
    and v_transaction.income_source = 'manual'
    and v_transaction.payment_status = 'unpaid'
    and v_transaction.income_review_status in ('pending', 'revision_requested') then
    null;
  elsif v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status not in ('pending', 'approved') then
    raise exception 'Only an unpaid Finance transaction awaiting review can change its payment account';
  end if;

  select * into v_selected_account
  from public.finance_accounts account
  where account.id = p_account_id
    and account.organization_id = v_transaction.organization_id
    and account.is_active
  for share;
  if not found then
    raise exception 'Choose an active Finance payment account';
  end if;

  if v_transaction.account_id is not distinct from v_selected_account.id then
    return v_transaction.id;
  end if;

  if v_transaction.account_id is not null then
    select * into v_previous_account
    from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id;
  end if;

  update public.finance_transactions
  set account_id = v_selected_account.id
  where id = v_transaction.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_transaction.organization_id, (select auth.uid()), 'finance_transaction',
    v_transaction.id, 'payment_account_changed',
    jsonb_build_object(
      'account_id', v_transaction.account_id,
      'account_name', v_previous_account.account_name,
      'payment_method', v_previous_account.payment_method::text
    ),
    jsonb_build_object(
      'account_id', v_selected_account.id,
      'account_name', v_selected_account.account_name,
      'payment_method', v_selected_account.payment_method::text
    ),
    case
      when v_transaction.source_payment_id is not null
        then 'Internal Finance assigned the account for an automatic quotation payment.'
      when v_transaction.income_source = 'manual'
        then 'Internal Finance corrected the Money In receiving account before verification.'
      else 'Internal Finance corrected the Money Out payment account before settlement.'
    end
  );

  return v_transaction.id;
end;
$$;

revoke all on function public.assign_finance_transaction_account(uuid, uuid) from public;
grant execute on function public.assign_finance_transaction_account(uuid, uuid) to authenticated;

-- Retain this legacy settlement RPC for supplier/commission/source-compatible
-- records, but make manual Money In verification the only settlement path for
-- standalone income.
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
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  if v_transaction.transaction_type = 'income'
    and v_transaction.income_source = 'manual' then
    raise exception 'Manual Money In must use Verify Money In';
  end if;
  if (v_transaction.transaction_type = 'expense' and v_transaction.approval_status <> 'approved')
    or (v_transaction.transaction_type = 'income' and v_transaction.approval_status <> 'not_required') then
    raise exception 'Only an approved Money Out or recorded Money In can be marked paid';
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
