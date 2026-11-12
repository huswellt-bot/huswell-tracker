-- Revised Finance: shared Daily Fund pool, receipt evidence, and live-safe posting.
-- New non-project Cash Out rows draw from the shared Daily Fund balance. The
-- historical daily_fund_request_id column is retained for audit compatibility.

begin;

alter table public.finance_revised_transactions
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_file_name text,
  add column if not exists receipt_content_type text,
  add column if not exists receipt_file_size bigint;

alter table public.finance_revised_transactions
  drop constraint if exists finance_revised_transactions_daily_fund_link_check;

alter table public.finance_revised_transactions
  add constraint finance_revised_transactions_daily_fund_link_check
  check (
    (transaction_kind = 'daily_fund_allocation' and daily_fund_request_id is not null)
    or transaction_kind in ('daily_fund_return', 'operating_cash_out', 'adjustment')
    or (
      transaction_kind not in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out', 'adjustment')
      and daily_fund_request_id is null
    )
  );

create index if not exists finance_revised_transactions_receipt_idx
  on public.finance_revised_transactions(organization_id, receipt_storage_path)
  where receipt_storage_path is not null;

create or replace function private.finance_revised_validate_receipt(
  p_organization_id uuid,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_extension text;
begin
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP receipt image no larger than 10 MB';
  end if;

  if p_receipt_file_name ~ '/' or length(btrim(p_receipt_file_name)) > 255 then
    raise exception 'Receipt file name is invalid';
  end if;

  if p_receipt_storage_path !~* (
    '^' || p_organization_id::text || '/revised-transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Transaction receipt storage path is invalid';
  end if;

  v_extension := lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1)));
  if v_extension <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Receipt file extension does not match its storage path';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the transaction receipt image before saving the transaction';
  end if;
end;
$$;

revoke all on function private.finance_revised_validate_receipt(uuid, text, text, text, bigint)
from public, anon, authenticated;

-- Receipt-enabled submissions are the only public write path for new Cash In
-- and Cash Out rows. The legacy implementations remain internal call targets.
create or replace function public.create_finance_revised_cash_in_with_receipt(
  p_organization_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
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
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can record project Cash In';
  end if;

  perform private.finance_revised_validate_receipt(
    p_organization_id,
    p_receipt_storage_path,
    p_receipt_file_name,
    p_receipt_content_type,
    p_receipt_file_size
  );

  v_id := public.create_finance_revised_cash_in_with_category_accountant_legacy(
    p_organization_id,
    p_project_fund_id,
    p_amount,
    p_category_id,
    p_transaction_date,
    p_reference_number,
    p_note
  );

  update public.finance_revised_transactions
  set receipt_storage_path = p_receipt_storage_path,
      receipt_file_name = nullif(btrim(p_receipt_file_name), ''),
      receipt_content_type = p_receipt_content_type,
      receipt_file_size = p_receipt_file_size,
      updated_at = now()
  where id = v_id
    and organization_id = p_organization_id;

  return v_id;
end;
$$;

create or replace function public.create_finance_revised_cash_out_with_receipt(
  p_organization_id uuid,
  p_project_fund_id uuid default null,
  p_amount numeric default null,
  p_category_id uuid default null,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
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
  v_id uuid;
  v_kind text;
  v_status text;
  v_balance numeric;
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can record Cash Out';
  end if;

  perform private.finance_revised_validate_receipt(
    p_organization_id,
    p_receipt_storage_path,
    p_receipt_file_name,
    p_receipt_content_type,
    p_receipt_file_size
  );

  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash Out amount must be greater than zero';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.direction = 'expense'
    and category.is_active
  for share;

  if not found then
    raise exception 'Choose an active Cash Out category';
  end if;

  if p_project_fund_id is null then
    v_kind := 'operating_cash_out';
    v_balance := private.finance_revised_balance(p_organization_id, 'daily');
    if v_balance < round(p_amount, 2) then
      raise exception 'Daily Fund balance is not enough for this non-project Cash Out';
    end if;
  else
    v_kind := 'project_cash_out';
    select status
    into v_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = p_organization_id;

    if not found or v_status not in ('open', 'on_hold') then
      raise exception 'Choose an open project for project Cash Out';
    end if;

    v_balance := private.finance_revised_balance(
      p_organization_id,
      'project',
      p_project_fund_id
    );
    if v_balance < round(p_amount, 2) then
      raise exception 'Project balance is not enough. Request Working Funds for this project first';
    end if;
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    daily_fund_request_id,
    category_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    receipt_storage_path,
    receipt_file_name,
    receipt_content_type,
    receipt_file_size,
    submitted_by
  )
  values (
    p_organization_id,
    v_kind,
    p_project_fund_id,
    null,
    v_category.id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    v_category.name,
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_receipt_storage_path,
    nullif(btrim(p_receipt_file_name), ''),
    p_receipt_content_type,
    p_receipt_file_size,
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_finance_revised_commission_payout_with_receipt(
  p_organization_id uuid,
  p_commission_allocation_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
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
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can submit commission payouts';
  end if;

  perform private.finance_revised_validate_receipt(
    p_organization_id,
    p_receipt_storage_path,
    p_receipt_file_name,
    p_receipt_content_type,
    p_receipt_file_size
  );

  v_id := public.create_finance_revised_commission_payout_accountant_legacy(
    p_organization_id,
    p_commission_allocation_id,
    p_transaction_date,
    p_reference_number,
    p_note
  );

  update public.finance_revised_transactions
  set receipt_storage_path = p_receipt_storage_path,
      receipt_file_name = nullif(btrim(p_receipt_file_name), ''),
      receipt_content_type = p_receipt_content_type,
      receipt_file_size = p_receipt_file_size,
      updated_at = now()
  where id = v_id
    and organization_id = p_organization_id;

  return v_id;
end;
$$;

create or replace function public.resubmit_finance_revised_transaction_with_receipt(
  p_original_transaction_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
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
  v_original public.finance_revised_transactions%rowtype;
  v_category public.finance_categories%rowtype;
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_balance numeric;
begin
  select *
  into v_original
  from public.finance_revised_transactions transaction
  where transaction.id = p_original_transaction_id
  for update;

  if not found then
    raise exception 'Original Finance transaction not found';
  end if;
  if v_actor is null
    or not private.finance_revised_is_accountant(v_original.organization_id) then
    raise exception 'Only Accounting & Finance can resubmit Finance transactions';
  end if;
  if v_original.status <> 'revision_requested' then
    raise exception 'Only a transaction marked for revision can be resubmitted';
  end if;
  if v_original.transaction_kind not in ('project_cash_in', 'project_cash_out', 'operating_cash_out', 'commission_payout') then
    raise exception 'Only Cash In and Cash Out transactions can be resubmitted';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Finance transaction amount must be greater than zero';
  end if;

  perform private.finance_revised_validate_receipt(
    v_original.organization_id,
    p_receipt_storage_path,
    p_receipt_file_name,
    p_receipt_content_type,
    p_receipt_file_size
  );

  if exists (
    select 1
    from public.finance_revised_transactions replacement
    where replacement.revision_of_transaction_id = v_original.id
      and replacement.status not in ('rejected', 'voided')
  ) then
    raise exception 'This Finance transaction already has an active correction';
  end if;

  if v_original.transaction_kind = 'operating_cash_out' then
    if p_project_fund_id is not null then
      raise exception 'A corrected non-project Cash Out cannot select a project';
    end if;

    select *
    into v_category
    from public.finance_categories category
    where category.id = p_category_id
      and category.organization_id = v_original.organization_id
      and category.direction = 'expense'
      and category.is_active
    for share;

    if not found then
      raise exception 'Choose an active Cash Out category for the correction';
    end if;

    v_balance := private.finance_revised_balance(v_original.organization_id, 'daily');
    if v_balance < round(p_amount, 2) then
      raise exception 'Daily Fund balance is not enough for the corrected Cash Out';
    end if;

    insert into public.finance_revised_transactions (
      organization_id,
      transaction_kind,
      project_fund_id,
      daily_fund_request_id,
      category_id,
      amount,
      transaction_date,
      category,
      reference_number,
      note,
      receipt_storage_path,
      receipt_file_name,
      receipt_content_type,
      receipt_file_size,
      submitted_by,
      revision_of_transaction_id
    )
    values (
      v_original.organization_id,
      'operating_cash_out',
      null,
      null,
      v_category.id,
      round(p_amount, 2),
      coalesce(p_transaction_date, current_date),
      v_category.name,
      nullif(btrim(coalesce(p_reference_number, '')), ''),
      nullif(btrim(coalesce(p_note, '')), ''),
      p_receipt_storage_path,
      nullif(btrim(p_receipt_file_name), ''),
      p_receipt_content_type,
      p_receipt_file_size,
      v_actor,
      v_original.id
    )
    returning id into v_id;
  else
    v_id := public.resubmit_finance_revised_transaction_accountant_legacy(
      p_original_transaction_id,
      p_project_fund_id,
      p_amount,
      p_category_id,
      p_transaction_date,
      p_reference_number,
      p_note,
      null
    );

    update public.finance_revised_transactions
    set receipt_storage_path = p_receipt_storage_path,
        receipt_file_name = nullif(btrim(p_receipt_file_name), ''),
        receipt_content_type = p_receipt_content_type,
        receipt_file_size = p_receipt_file_size,
        updated_at = now()
    where id = v_id
      and organization_id = v_original.organization_id;
  end if;

  return v_id;
end;
$$;

-- New non-project Cash Out and pool-level Daily Fund returns are approved by
-- the same GM review RPC, but use aggregate pool accounting rather than a
-- selected request row.
create or replace function private.post_finance_revised_transaction_pool_v2(
  p_transaction_id uuid,
  p_actor uuid,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_revised_transactions%rowtype;
  v_daily_balance numeric;
begin
  select *
  into v_transaction
  from public.finance_revised_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.status <> 'pending' then
    raise exception 'Only pending revised Finance transactions can be posted';
  end if;
  if p_actor is null then
    raise exception 'A signed-in GM is required to post this transaction';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));
  v_daily_balance := private.finance_revised_balance(v_transaction.organization_id, 'daily');

  if v_transaction.transaction_kind = 'operating_cash_out'
    and v_transaction.daily_fund_request_id is not null then
    return private.post_finance_revised_transaction(
      p_transaction_id,
      p_actor,
      p_decision_note
    );
  elsif v_transaction.transaction_kind = 'operating_cash_out' then
    if v_transaction.project_fund_id is not null or v_transaction.daily_fund_request_id is not null then
      raise exception 'Non-project Cash Out must use the shared Daily Fund pool';
    end if;
    if v_daily_balance < v_transaction.amount then
      raise exception 'Daily Fund balance is not enough for this non-project Cash Out';
    end if;

    perform private.finance_revised_add_entry(
      v_transaction.organization_id,
      v_transaction.id,
      'daily',
      null,
      'operating_cash_out',
      'out',
      v_transaction.amount,
      v_transaction.transaction_date,
      v_transaction.note,
      v_transaction.submitted_by
    );
  elsif v_transaction.transaction_kind = 'daily_fund_return'
    and v_transaction.daily_fund_request_id is not null then
    return private.post_finance_revised_transaction(
      p_transaction_id,
      p_actor,
      p_decision_note
    );
  elsif v_transaction.transaction_kind = 'daily_fund_return' then
    if v_transaction.project_fund_id is not null or v_transaction.daily_fund_request_id is not null then
      raise exception 'Daily Fund return must use the shared Daily Fund pool';
    end if;
    if v_daily_balance < v_transaction.amount then
      raise exception 'Daily Fund return cannot exceed the available pool balance';
    end if;

    perform private.finance_revised_add_entry(
      v_transaction.organization_id,
      v_transaction.id,
      'daily',
      null,
      'daily_fund_return',
      'out',
      v_transaction.amount,
      v_transaction.transaction_date,
      v_transaction.note,
      v_transaction.submitted_by
    );
    perform private.finance_revised_add_entry(
      v_transaction.organization_id,
      v_transaction.id,
      'working',
      null,
      'daily_fund_return',
      'in',
      v_transaction.amount,
      v_transaction.transaction_date,
      v_transaction.note,
      v_transaction.submitted_by
    );
  else
    return private.post_finance_revised_transaction(
      p_transaction_id,
      p_actor,
      p_decision_note
    );
  end if;

  update public.finance_revised_transactions
  set status = 'approved',
      approved_by = p_actor,
      approved_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), ''),
      updated_at = now()
  where id = v_transaction.id;

  return v_transaction.id;
end;
$$;

create or replace function public.review_finance_revised_transaction(
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
  v_transaction public.finance_revised_transactions%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  select *
  into v_transaction
  from public.finance_revised_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Finance transaction not found';
  end if;
  if v_actor is null
    or not private.finance_revised_is_gm(v_transaction.organization_id) then
    raise exception 'Only the GM can approve Finance transactions';
  end if;
  if v_transaction.status <> 'pending' then
    raise exception 'Only pending Finance transactions can be reviewed';
  end if;
  if v_decision not in ('approved', 'revision_requested') then
    raise exception 'Use approve or request revision for Finance transactions';
  end if;

  if v_decision = 'revision_requested' then
    if v_transaction.transaction_kind not in ('project_cash_in', 'project_cash_out', 'operating_cash_out', 'commission_payout') then
      raise exception 'Only Cash In and Cash Out transactions can request revision';
    end if;
    if v_note is null then
      raise exception 'A revision note is required';
    end if;

    update public.finance_revised_transactions
    set status = 'revision_requested',
        reviewed_by = v_actor,
        reviewed_at = now(),
        decision_note = v_note,
        updated_at = now()
    where id = v_transaction.id;
  else
    perform private.post_finance_revised_transaction_pool_v2(
      v_transaction.id,
      v_actor,
      v_note
    );

    update public.finance_revised_transactions
    set reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now()
    where id = v_transaction.id;
  end if;

  return v_transaction.id;
end;
$$;

create or replace function public.create_finance_revised_daily_fund_pool_return(
  p_organization_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_balance numeric;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can return Daily Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Daily Fund return amount must be greater than zero';
  end if;

  v_balance := private.finance_revised_balance(p_organization_id, 'daily');
  if v_balance < round(p_amount, 2) then
    raise exception 'Daily Fund return cannot exceed the available pool balance';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'daily_fund_return',
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.get_finance_revised_daily_fund_snapshot(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_daily_balance numeric;
  v_working_balance numeric;
  v_allocated numeric;
  v_spent numeric;
  v_returned numeric;
  v_pending integer;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view the Daily Fund';
  end if;

  v_daily_balance := private.finance_revised_balance(p_organization_id, 'daily');
  v_working_balance := private.finance_revised_balance(p_organization_id, 'working');

  select
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_allocation'
        then case when entry.direction = 'in' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'operating_cash_out'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2),
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_return'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2)
  into v_allocated, v_spent, v_returned
  from public.finance_revised_ledger_entries entry
  where entry.organization_id = p_organization_id
    and entry.ledger_type = 'daily';

  select count(*)::integer
  into v_pending
  from public.finance_daily_fund_requests request
  where request.organization_id = p_organization_id
    and request.status = 'pending';

  return jsonb_build_object(
    'daily_fund_balance', coalesce(v_daily_balance, 0),
    'working_funds_balance', coalesce(v_working_balance, 0),
    'total_allocated', coalesce(v_allocated, 0),
    'total_spent', coalesce(v_spent, 0),
    'total_returned', coalesce(v_returned, 0),
    'unused_by_request', coalesce(v_daily_balance, 0),
    'available_for_return', coalesce(v_daily_balance, 0),
    'pending_requests', coalesce(v_pending, 0)
  );
end;
$$;

-- Keep the actor/audit columns from the latest feed and append receipt data so
-- existing consumers keep their column order.
create or replace view public.finance_revised_transaction_feed
with (security_invoker = true)
as
select
  txn.id,
  txn.organization_id,
  txn.transaction_kind,
  txn.project_fund_id,
  txn.working_fund_request_id,
  txn.daily_fund_request_id,
  txn.commission_allocation_id,
  txn.reversal_of_transaction_id,
  txn.amount,
  txn.transaction_date,
  txn.period_label,
  coalesce(txn.category, finance_category.name) as category,
  txn.reference_number,
  txn.note,
  txn.status,
  txn.submitted_by,
  txn.submitted_at,
  txn.approved_by,
  txn.approved_at,
  txn.decision_note,
  txn.created_at,
  txn.updated_at,
  fund.project_name,
  fund.client_name,
  quotation.quotation_no,
  request.purpose as working_fund_purpose,
  allocation.recipient_user_id as commission_recipient_user_id,
  coalesce(profile.full_name, 'Sales & Pricing Officer') as commission_recipient_name,
  allocation.allocation_role as commission_allocation_role,
  allocation.share_rate as commission_share_rate,
  coalesce(submitted_profile.full_name, txn.submitted_by::text) as submitted_by_name,
  coalesce(approved_profile.full_name, txn.approved_by::text) as approved_by_name,
  txn.category_id,
  txn.reviewed_by,
  txn.reviewed_at,
  txn.revision_of_transaction_id,
  coalesce(reviewed_profile.full_name, txn.reviewed_by::text) as reviewed_by_name,
  txn.receipt_storage_path,
  txn.receipt_file_name,
  txn.receipt_content_type,
  txn.receipt_file_size
from public.finance_revised_transactions txn
left join public.project_funds fund on fund.id = txn.project_fund_id
left join public.quotations quotation on quotation.id = fund.quotation_id
left join public.finance_working_fund_requests request on request.id = txn.working_fund_request_id
left join public.finance_categories finance_category on finance_category.id = txn.category_id and finance_category.organization_id = txn.organization_id
left join public.commission_summary_allocations allocation on allocation.id = txn.commission_allocation_id and allocation.organization_id = txn.organization_id
left join public.profiles profile on profile.id = allocation.recipient_user_id
left join public.profiles submitted_profile on submitted_profile.id = txn.submitted_by
left join public.profiles approved_profile on approved_profile.id = txn.approved_by
left join public.profiles reviewed_profile on reviewed_profile.id = txn.reviewed_by;

insert into storage.buckets (id, name, public)
values ('finance-receipts', 'finance-receipts', false)
on conflict (id) do update set public = false;

-- Receipts are private. Finance uploads a short-lived, org-scoped object;
-- GM/Finance can read only objects linked to a revised transaction.
drop policy if exists "finance receipts: revised transaction upload" on storage.objects;
create policy "finance receipts: revised transaction upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/revised-transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.finance_revised_is_accountant(split_part(name, '/', 1)::uuid)
);

drop policy if exists "finance receipts: revised transaction pending read" on storage.objects;
create policy "finance receipts: revised transaction pending read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/revised-transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.receipt_storage_path = storage.objects.name
  )
);

drop policy if exists "finance receipts: revised transaction read" on storage.objects;
create policy "finance receipts: revised transaction read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.receipt_storage_path = storage.objects.name
      and private.finance_revised_can_operate(transaction.organization_id)
  )
);

drop policy if exists "finance receipts: revised transaction pending delete" on storage.objects;
create policy "finance receipts: revised transaction pending delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/revised-transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.receipt_storage_path = storage.objects.name
  )
);

-- Disable the old public submission paths so a client cannot bypass receipt
-- evidence or reintroduce request-specific non-project Cash Out.
revoke all on function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text)
from public, anon, authenticated;
revoke all on function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text)
from public, anon, authenticated;

revoke all on function public.create_finance_revised_cash_in_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
from public, anon;
grant execute on function public.create_finance_revised_cash_in_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
to authenticated;
revoke all on function public.create_finance_revised_cash_out_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
from public, anon;
grant execute on function public.create_finance_revised_cash_out_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
to authenticated;
revoke all on function public.create_finance_revised_commission_payout_with_receipt(uuid, uuid, date, text, text, text, text, text, bigint)
from public, anon;
grant execute on function public.create_finance_revised_commission_payout_with_receipt(uuid, uuid, date, text, text, text, text, text, bigint)
to authenticated;
revoke all on function public.resubmit_finance_revised_transaction_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
from public, anon;
grant execute on function public.resubmit_finance_revised_transaction_with_receipt(uuid, uuid, numeric, uuid, date, text, text, text, text, text, bigint)
to authenticated;
revoke all on function public.create_finance_revised_daily_fund_pool_return(uuid, numeric, date, text)
from public, anon;
grant execute on function public.create_finance_revised_daily_fund_pool_return(uuid, numeric, date, text)
to authenticated;

commit;
