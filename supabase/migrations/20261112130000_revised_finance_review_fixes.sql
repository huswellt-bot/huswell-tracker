-- Revised Finance review fixes.
-- Keep shared-pool returns reversible, make Daily Fund request reporting honest
-- about shared-pool usage, harden receipt evidence, and retire the old pending
-- transaction receipt policies.

begin;

create or replace function public.void_finance_revised_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_revised_transactions%rowtype;
  v_request public.finance_working_fund_requests%rowtype;
  v_daily_request public.finance_daily_fund_requests%rowtype;
  v_entry record;
  v_balance numeric;
  v_adjustment_id uuid;
  v_new_returned numeric;
  v_outstanding numeric;
  v_has_repayment boolean;
  v_summary_id uuid;
  v_actor uuid := (select auth.uid());
  v_business_date date := private.finance_revised_business_date();
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
    raise exception 'Only the GM can reverse a posted Finance transaction';
  end if;
  if v_transaction.status <> 'approved' then
    raise exception 'Only an approved Finance transaction can be reversed';
  end if;
  if v_transaction.transaction_kind = 'adjustment' then
    raise exception 'A reversal adjustment cannot be reversed again';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reversal reason is required';
  end if;
  if exists (
    select 1
    from public.finance_revised_transactions reversal
    where reversal.reversal_of_transaction_id = v_transaction.id
      and reversal.status = 'approved'
  ) then
    raise exception 'This Finance transaction has already been reversed';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));

  for v_entry in
    select *
    from public.finance_revised_ledger_entries entry
    where entry.transaction_id = v_transaction.id
    order by entry.created_at, entry.id
  loop
    if v_entry.direction = 'in' then
      v_balance := private.finance_revised_balance(
        v_transaction.organization_id,
        v_entry.ledger_type,
        v_entry.project_fund_id
      );
      if v_balance + 0.001 < v_entry.amount then
        raise exception 'This transaction cannot be reversed because its funds have already been used';
      end if;
    end if;
  end loop;

  if v_transaction.transaction_kind = 'daily_fund_allocation' then
    if exists (
      select 1
      from public.finance_revised_transactions dependent
      where dependent.organization_id = v_transaction.organization_id
        and dependent.daily_fund_request_id = v_transaction.daily_fund_request_id
        and dependent.transaction_kind in ('operating_cash_out', 'daily_fund_return')
        and dependent.status not in ('rejected', 'voided')
    ) then
      raise exception 'Daily Fund allocation cannot be reversed after it has been used or returned';
    end if;
    update public.finance_daily_fund_requests
    set status = 'cancelled', updated_at = now()
    where id = v_transaction.daily_fund_request_id
      and organization_id = v_transaction.organization_id;
  elsif v_transaction.transaction_kind = 'daily_fund_return'
    and v_transaction.daily_fund_request_id is not null then
    -- Request-linked returns retain their historical request status behavior.
    -- Shared-pool returns have no request ID and intentionally fall through to
    -- the generic ledger reversal below.
    select * into v_daily_request
    from public.finance_daily_fund_requests request
    where request.id = v_transaction.daily_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Daily Fund request not found for this reversal';
    end if;
    v_new_returned := round(coalesce(v_daily_request.returned_amount, 0) - v_transaction.amount, 2);
    if v_new_returned < 0 then
      raise exception 'Daily Fund return history is inconsistent';
    end if;
    update public.finance_daily_fund_requests
    set returned_amount = v_new_returned,
        status = case
          when v_new_returned >= round(coalesce(v_daily_request.approved_amount, 0), 2) then 'returned'
          when v_new_returned > 0 then 'partially_returned'
          else 'approved'
        end,
        updated_at = now()
    where id = v_daily_request.id;
  elsif v_transaction.transaction_kind = 'working_fund_support' then
    select * into v_request
    from public.finance_working_fund_requests request
    where request.id = v_transaction.working_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Working Fund request not found for this reversal';
    end if;
    if exists (
      select 1
      from public.finance_revised_transactions dependent
      where dependent.organization_id = v_transaction.organization_id
        and dependent.working_fund_request_id = v_request.id
        and dependent.transaction_kind = 'working_fund_repayment'
        and dependent.status not in ('rejected', 'voided')
    ) then
      raise exception 'Working Fund support cannot be reversed after a repayment was submitted';
    end if;
    update public.finance_working_fund_requests
    set support_transaction_id = null, status = 'approved', updated_at = now()
    where id = v_request.id;
  elsif v_transaction.transaction_kind = 'working_fund_repayment' then
    select * into v_request
    from public.finance_working_fund_requests request
    where request.id = v_transaction.working_fund_request_id
      and request.organization_id = v_transaction.organization_id
    for update;
    if not found then
      raise exception 'Working Fund request not found for this reversal';
    end if;
    select round(coalesce(sum(
      case
        when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
          and entry.direction = 'in' then entry.amount
        when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
          and entry.direction = 'out' then -entry.amount
        else 0
      end
    ), 0), 2)
    into v_outstanding
    from public.finance_revised_ledger_entries entry
    join public.finance_revised_transactions transaction
      on transaction.id = entry.transaction_id
    where entry.organization_id = v_transaction.organization_id
      and entry.project_fund_id = v_transaction.project_fund_id
      and entry.ledger_type = 'project'
      and transaction.working_fund_request_id = v_request.id
      and transaction.id <> v_transaction.id;
    select exists (
      select 1
      from public.finance_revised_transactions repayment
      where repayment.working_fund_request_id = v_request.id
        and repayment.transaction_kind = 'working_fund_repayment'
        and repayment.status = 'approved'
        and repayment.id <> v_transaction.id
    ) into v_has_repayment;
    update public.finance_working_fund_requests
    set status = case
          when coalesce(v_outstanding, 0) <= 0 then 'repaid'
          when v_has_repayment then 'partially_repaid'
          else 'approved'
        end,
        updated_at = now()
    where id = v_request.id;
  elsif v_transaction.transaction_kind = 'commission_payout' then
    select allocation.commission_summary_id into v_summary_id
    from public.commission_summary_allocations allocation
    where allocation.id = v_transaction.commission_allocation_id
      and allocation.organization_id = v_transaction.organization_id
    for update;
    if v_summary_id is null then
      raise exception 'Commission allocation not found for this reversal';
    end if;
    update public.commission_summary_allocations
    set status = 'not_yet_paid', eligible_at = coalesce(eligible_at, now()), paid_at = null, paid_by = null
    where id = v_transaction.commission_allocation_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summaries summary
    set status = 'not_yet_paid', paid_at = null, paid_by = null
    where summary.id = v_summary_id
      and summary.organization_id = v_transaction.organization_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    working_fund_request_id,
    daily_fund_request_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    status,
    submitted_by,
    approved_by,
    approved_at,
    decision_note,
    reversal_of_transaction_id
  )
  values (
    v_transaction.organization_id,
    'adjustment',
    v_transaction.project_fund_id,
    case when v_transaction.transaction_kind in ('working_fund_support', 'working_fund_repayment') then v_transaction.working_fund_request_id else null end,
    case when v_transaction.transaction_kind in ('daily_fund_allocation', 'daily_fund_return', 'operating_cash_out') then v_transaction.daily_fund_request_id else null end,
    v_transaction.amount,
    v_business_date,
    'Reversal / adjustment',
    'Reversal of ' || v_transaction.id::text,
    'Reversal reason: ' || btrim(p_reason),
    'approved',
    v_actor,
    v_actor,
    now(),
    btrim(p_reason),
    v_transaction.id
  )
  returning id into v_adjustment_id;

  for v_entry in
    select *
    from public.finance_revised_ledger_entries entry
    where entry.transaction_id = v_transaction.id
    order by entry.created_at, entry.id
  loop
    perform private.finance_revised_add_entry(
      v_transaction.organization_id,
      v_adjustment_id,
      v_entry.ledger_type,
      v_entry.project_fund_id,
      v_entry.entry_type,
      case when v_entry.direction = 'in' then 'out' else 'in' end,
      v_entry.amount,
      v_business_date,
      'Reversal of ' || v_transaction.id::text,
      v_actor
    );
  end loop;

  update public.finance_revised_transactions
  set status = 'voided', decision_note = 'Reversed: ' || btrim(p_reason), updated_at = now()
  where id = v_transaction.id;

  return v_adjustment_id;
end;
$$;

revoke all on function public.void_finance_revised_transaction(uuid, text) from public, anon;
grant execute on function public.void_finance_revised_transaction(uuid, text) to authenticated;

create or replace view public.finance_revised_daily_fund_request_feed
with (security_invoker = true)
as
with daily_pool_metrics as (
  select
    entry.organization_id,
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_allocation'
        then case when entry.direction = 'in' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2) as shared_pool_allocated_amount,
    round(coalesce(sum(
      case when entry.entry_type = 'operating_cash_out'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2) as shared_pool_spent_amount,
    round(coalesce(sum(
      case when entry.entry_type = 'daily_fund_return'
        then case when entry.direction = 'out' then entry.amount else -entry.amount end
        else 0 end
    ), 0), 2) as shared_pool_returned_amount
  from public.finance_revised_ledger_entries entry
  where entry.ledger_type = 'daily'
  group by entry.organization_id
)
select
  request.id,
  request.organization_id,
  request.fund_date,
  request.requested_amount,
  request.approved_amount,
  request.returned_amount,
  request.status,
  request.purpose,
  request.note,
  request.requested_by,
  request.requested_at,
  request.approved_by,
  request.approved_at,
  request.decision_note,
  request.created_at,
  request.updated_at,
  coalesce(spending.spent_amount, 0) as spent_amount,
  null::numeric as unused_amount,
  coalesce(requested_profile.full_name, request.requested_by::text) as requested_by_name,
  coalesce(approved_profile.full_name, request.approved_by::text) as approved_by_name,
  private.finance_revised_balance(request.organization_id, 'daily') as shared_pool_balance,
  coalesce(pool.shared_pool_allocated_amount, 0) as shared_pool_allocated_amount,
  coalesce(pool.shared_pool_spent_amount, 0) as shared_pool_spent_amount,
  coalesce(pool.shared_pool_returned_amount, 0) as shared_pool_returned_amount
from public.finance_daily_fund_requests request
left join lateral (
  select private.finance_revised_daily_fund_spent(request.organization_id, request.id) as spent_amount
) spending on true
left join public.profiles requested_profile
  on requested_profile.id = request.requested_by
left join public.profiles approved_profile
  on approved_profile.id = request.approved_by
left join daily_pool_metrics pool
  on pool.organization_id = request.organization_id;

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
  v_actual_content_type text;
  v_actual_file_size bigint;
begin
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type is null
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

  select
    storage_object.metadata ->> 'mimetype',
    case
      when coalesce(storage_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (storage_object.metadata ->> 'size')::bigint
      else null
    end
  into v_actual_content_type, v_actual_file_size
  from storage.objects storage_object
  where storage_object.bucket_id = 'finance-receipts'
    and storage_object.name = p_receipt_storage_path;

  if not found then
    raise exception 'Upload the transaction receipt image before saving the transaction';
  end if;
  if v_actual_content_type is distinct from p_receipt_content_type
    or v_actual_file_size is distinct from p_receipt_file_size then
    raise exception 'Receipt metadata does not match the uploaded file';
  end if;
end;
$$;

revoke all on function private.finance_revised_validate_receipt(uuid, text, text, text, bigint)
from public, anon, authenticated;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'finance-receipts';

-- Keep malformed object keys from reaching a UUID cast inside the storage
-- policy. Invalid paths should be denied, not turn into a storage API error.
drop policy if exists "finance receipts: revised transaction upload" on storage.objects;
create policy "finance receipts: revised transaction upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/revised-transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.finance_revised_is_accountant(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
);

-- The revised receipt flow uses /revised-transactions/. Remove the old
-- pending /transactions/ policies so the retired Finance API cannot continue
-- creating orphan receipt objects.
drop policy if exists "finance receipts: pending transaction upload" on storage.objects;
drop policy if exists "finance receipts: pending transaction read" on storage.objects;
drop policy if exists "finance receipts: pending transaction delete" on storage.objects;

commit;
