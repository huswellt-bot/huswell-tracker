-- Make General Manager budget-only in Finance and preserve historical rows
-- created by the legacy External Finance budget-request workflow.
-- Run after 232_finance_monthly_budget_account_allocations.sql. Safe to re-run.

begin;

-- Finance operational permissions belong only to the two Finance roles. GM
-- retains a separate budget-viewer path for the approved pool and allocations.
create or replace function private.finance_is_internal(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array['internal_finance']);
$$;

create or replace function private.finance_is_external_or_internal(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array['internal_finance', 'external_finance']);
$$;

create or replace function private.finance_is_budget_operator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array['internal_finance']);
$$;

create or replace function private.finance_is_budget_viewer(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin', 'internal_finance'
  ]);
$$;

revoke all on function private.finance_is_internal(uuid),
  private.finance_is_external_or_internal(uuid),
  private.finance_is_budget_operator(uuid),
  private.finance_is_budget_viewer(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_internal(uuid),
  private.finance_is_external_or_internal(uuid),
  private.finance_is_budget_viewer(uuid)
to authenticated;

-- Quotation payment history follows the Finance role boundary. Assigned
-- reviewers remain able to read their own assigned record, but management,
-- Accountant, Production, and Warehouse do not receive the old broad read
-- path merely because they belong to the organization.
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
      and private.finance_is_external_or_internal(quote.organization_id)
  );
$$;

drop policy if exists "quotation payment records: authorized read"
  on public.quotation_payment_records;
create policy "quotation payment records: authorized read"
on public.quotation_payment_records for select to authenticated
using (
  private.can_view_quotation_payment(quotation_id)
  or reviewer_user_id = (select auth.uid())
);

drop policy if exists "quotation payment receipts: authorized read"
  on storage.objects;
create policy "quotation payment receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and exists (
    select 1
    from public.quotation_payment_records payment
    where payment.receipt_storage_path = storage.objects.name
      and (
        private.finance_is_external_or_internal(payment.organization_id)
        or payment.reviewer_user_id = (select auth.uid())
      )
  )
);

-- Remove the old management/accountant Finance read path from the core ledger.
drop policy if exists "finance accounts: finance read" on public.finance_accounts;
create policy "finance accounts: finance read"
on public.finance_accounts for select to authenticated
using (private.finance_is_internal(organization_id));

drop policy if exists "finance account funding: finance read"
  on public.finance_account_funding_entries;
create policy "finance account funding: finance read"
on public.finance_account_funding_entries for select to authenticated
using (private.finance_is_internal(organization_id));

drop policy if exists "finance categories: finance read" on public.finance_categories;
create policy "finance categories: finance read"
on public.finance_categories for select to authenticated
using (private.finance_is_external_or_internal(organization_id));

drop policy if exists "finance transactions: finance read" on public.finance_transactions;
create policy "finance transactions: finance read"
on public.finance_transactions for select to authenticated
using (private.finance_is_external_or_internal(organization_id));

drop policy if exists "finance budget requests: finance read" on public.finance_budget_requests;
create policy "finance budget requests: finance read"
on public.finance_budget_requests for select to authenticated
using (
  requested_by = (select auth.uid())
  or private.finance_is_internal(organization_id)
);

drop policy if exists "finance transaction revisions: finance read"
  on public.finance_transaction_revisions;
create policy "finance transaction revisions: finance read"
on public.finance_transaction_revisions for select to authenticated
using (private.finance_is_external_or_internal(organization_id));

drop policy if exists "finance budget revisions: finance read"
  on public.finance_budget_request_revisions;
create policy "finance budget revisions: finance read"
on public.finance_budget_request_revisions for select to authenticated
using (
  private.finance_is_internal(organization_id)
  or exists (
    select 1
    from public.finance_budget_requests request
    where request.id = budget_request_id
      and request.requested_by = (select auth.uid())
  )
);

-- The new monthly budget tables are readable by GM and Internal Finance;
-- External Finance can read only its own requests.
drop policy if exists "finance budget periods: internal read" on public.finance_budget_periods;
drop policy if exists "finance budget periods: budget viewer read" on public.finance_budget_periods;
create policy "finance budget periods: budget viewer read"
on public.finance_budget_periods for select to authenticated
using (private.finance_is_budget_viewer(organization_id));

drop policy if exists "finance budget grants: internal read" on public.finance_budget_grants;
drop policy if exists "finance budget grants: budget viewer read" on public.finance_budget_grants;
create policy "finance budget grants: budget viewer read"
on public.finance_budget_grants for select to authenticated
using (private.finance_is_budget_viewer(organization_id));

drop policy if exists "finance account allocations: internal read"
  on public.finance_account_budget_allocations;
drop policy if exists "finance account allocations: budget viewer read"
  on public.finance_account_budget_allocations;
create policy "finance account allocations: budget viewer read"
on public.finance_account_budget_allocations for select to authenticated
using (private.finance_is_budget_viewer(organization_id));

drop policy if exists "finance account funding requests: requester or internal read"
  on public.finance_account_funding_requests;
drop policy if exists "finance account funding requests: requester or budget viewer read"
  on public.finance_account_funding_requests;
create policy "finance account funding requests: requester or budget viewer read"
on public.finance_account_funding_requests for select to authenticated
using (
  requested_by = (select auth.uid())
  or private.finance_is_budget_viewer(organization_id)
);

drop policy if exists "finance allocation events: internal read"
  on public.finance_account_budget_allocation_events;
drop policy if exists "finance allocation events: budget viewer read"
  on public.finance_account_budget_allocation_events;
create policy "finance allocation events: budget viewer read"
on public.finance_account_budget_allocation_events for select to authenticated
using (private.finance_is_budget_viewer(organization_id));

-- Keep the account-name-only selector available to GM, Internal Finance, and
-- External Finance, while removing the old Accountant/management allowance.
create or replace function public.list_finance_funding_request_accounts(
  p_organization_id uuid
)
returns table (id uuid, account_name text, is_active boolean)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not (
      private.finance_is_budget_viewer(p_organization_id)
      or private.has_text_role(p_organization_id, array['external_finance'])
    ) then
    raise exception 'You are not authorized to view Finance accounts';
  end if;
  return query
  select account.id, account.account_name, account.is_active
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;
revoke all on function public.list_finance_funding_request_accounts(uuid) from public, anon;
grant execute on function public.list_finance_funding_request_accounts(uuid) to authenticated;

create or replace function public.list_finance_payment_accounts(
  p_organization_id uuid
)
returns table (
  id uuid,
  account_name text,
  account_type text,
  payment_method public.payment_method,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.finance_is_external_or_internal(p_organization_id) then
    raise exception 'You are not authorized to view Finance payment accounts';
  end if;
  return query
  select account.id, account.account_name, account.account_type,
    account.payment_method, account.is_active
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;
revoke all on function public.list_finance_payment_accounts(uuid) from public, anon;
grant execute on function public.list_finance_payment_accounts(uuid) to authenticated;

-- The receiving-account correction is an Internal Finance operation. Replace
-- the legacy Accountant allowance while preserving the existing validation and
-- audit trail for pending quotation payments.
create or replace function public.update_pending_quotation_payment_account(
  p_payment_id uuid,
  p_finance_account_id uuid
)
returns public.quotation_payment_records
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payment public.quotation_payment_records%rowtype;
  v_quote public.quotations%rowtype;
  v_previous_account public.finance_accounts%rowtype;
  v_selected_account public.finance_accounts%rowtype;
  v_previous_method public.payment_method;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  v_previous_method := v_payment.method;
  if not private.finance_is_internal(v_payment.organization_id) then
    raise exception 'Only Internal Finance can change the receiving account';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'Only pending quotation payments can change receiving accounts';
  end if;
  if p_finance_account_id is null then
    raise exception 'Choose the Finance account that received the client payment';
  end if;

  select * into v_quote
  from public.quotations quote
  where quote.id = v_payment.quotation_id
    and quote.organization_id = v_payment.organization_id
  for share;

  if not found then
    raise exception 'The quotation linked to this payment was not found';
  end if;

  if v_payment.finance_account_id is not null then
    select * into v_previous_account
    from public.finance_accounts account
    where account.id = v_payment.finance_account_id
      and account.organization_id = v_payment.organization_id;
  end if;

  select * into v_selected_account
  from public.finance_accounts account
  where account.id = p_finance_account_id
    and account.organization_id = v_payment.organization_id
    and account.is_active
  for share;

  if not found then
    raise exception 'Choose an active Finance account';
  end if;

  if v_payment.payment_kind = 'full_payment'
    and coalesce(v_quote.payment_terms_option, 'completion_50_50') = 'pdc_50_50'
    and v_selected_account.payment_method is distinct from 'check'::public.payment_method then
    raise exception 'The remaining balance for this term must be recorded through a check (PDC) account';
  end if;

  if v_payment.finance_account_id is not distinct from v_selected_account.id
    and v_payment.method is not distinct from v_selected_account.payment_method then
    return v_payment;
  end if;

  update public.quotation_payment_records
  set finance_account_id = v_selected_account.id,
      method = v_selected_account.payment_method
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
  )
  values (
    v_payment.organization_id,
    (select auth.uid()),
    'quotation_payment',
    v_payment.id,
    'receiving_account_changed',
    jsonb_build_object(
      'quotation_id', v_payment.quotation_id,
      'finance_account_id', v_previous_account.id,
      'account_name', v_previous_account.account_name,
      'payment_method', v_previous_method::text
    ),
    jsonb_build_object(
      'quotation_id', v_payment.quotation_id,
      'finance_account_id', v_selected_account.id,
      'account_name', v_selected_account.account_name,
      'payment_method', v_selected_account.payment_method::text
    ),
    'Internal Finance corrected the receiving account before payment verification.'
  );

  return v_payment;
end;
$$;
revoke all on function public.update_pending_quotation_payment_account(uuid, uuid)
  from public, anon;
grant execute on function public.update_pending_quotation_payment_account(uuid, uuid)
  to authenticated;

-- GM can read the allocation summary without receiving raw account numbers,
-- opening balances, or receipt paths through finance_accounts.
create or replace view public.finance_account_budget_summary
with (security_invoker = false)
as
select
  allocation.organization_id,
  allocation.id,
  allocation.period_id,
  period.period_start,
  period.period_end,
  period.status as period_status,
  allocation.account_id,
  account.account_name,
  account.is_active,
  allocation.allocated_amount,
  allocation.returned_amount,
  round(coalesce(sum(
    case
      when transaction.id is not null
        and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and transaction.payment_status = 'paid'
        and transaction.approval_status = 'approved'
        then transaction.amount
      else 0
    end
  ), 0), 2) as used_amount,
  round(coalesce(sum(
    case
      when transaction.id is not null
        and not transaction.is_voided
        and transaction.transaction_type = 'expense'
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
        and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')
        then transaction.amount
      else 0
    end
  ), 0), 2) as committed_amount,
  round(greatest(
    allocation.allocated_amount - coalesce(sum(
      case
        when transaction.id is not null
          and not transaction.is_voided
          and transaction.transaction_type = 'expense'
          and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          then transaction.amount
        else 0
      end
    ), 0),
    0
  ), 2) as available_amount
from public.finance_account_budget_allocations allocation
join public.finance_budget_periods period on period.id = allocation.period_id
join public.finance_accounts account on account.id = allocation.account_id
left join public.finance_transactions transaction
  on transaction.account_budget_allocation_id = allocation.id
where private.finance_is_budget_viewer(allocation.organization_id)
group by allocation.organization_id, allocation.id, allocation.period_id,
  period.period_start, period.period_end, period.status, allocation.account_id,
  account.account_name, account.is_active, allocation.allocated_amount,
  allocation.returned_amount;
revoke all on public.finance_account_budget_summary from anon, authenticated;
grant select on public.finance_account_budget_summary to authenticated;

create or replace function public.get_finance_budget_snapshot(
  p_organization_id uuid
)
returns table (
  period_id uuid,
  period_start date,
  period_end date,
  period_status text,
  total_granted numeric,
  total_allocated numeric,
  undistributed numeric,
  used_amount numeric,
  committed_amount numeric,
  remaining_amount numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_period_id uuid;
begin
  if p_organization_id is null or not private.finance_is_budget_viewer(p_organization_id) then
    raise exception 'Only the General Manager or Internal Finance can view the budget pool';
  end if;
  v_period_id := private.ensure_finance_budget_period(p_organization_id);
  return query
  select
    period.id,
    period.period_start,
    period.period_end,
    period.status,
    round(coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0), 2),
    round(coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0), 2),
    round(greatest(
      coalesce((select sum(grant_row.amount) from public.finance_budget_grants grant_row where grant_row.period_id = period.id), 0)
      - coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0),
      0
    ), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and transaction.payment_status = 'paid' and transaction.approval_status = 'approved'), 0), 2),
    round(coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled') and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')), 0), 2),
    round(greatest(
      coalesce((select sum(allocation.allocated_amount) from public.finance_account_budget_allocations allocation where allocation.period_id = period.id), 0)
      - coalesce((select sum(transaction.amount) from public.finance_transactions transaction where transaction.budget_period_id = period.id and not transaction.is_voided and transaction.transaction_type = 'expense' and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')), 0),
      0
    ), 2)
  from public.finance_budget_periods period
  where period.id = v_period_id;
end;
$$;
revoke all on function public.get_finance_budget_snapshot(uuid) from public, anon;
grant execute on function public.get_finance_budget_snapshot(uuid) to authenticated;

-- These Finance-only projections previously whitelisted management and/or
-- Accountant directly. Keep their signatures stable while applying the same
-- Finance role boundary as the rest of the module.
create or replace function public.finance_quotation_direct_cost_rows(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  total_direct_cost numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.finance_is_internal(p_organization_id) then
    raise exception 'Only Internal Finance can read quotation direct costs';
  end if;

  return query
  select
    quotation.id,
    round(coalesce(sum(
      case
        when costing_line.calculation_type = 'fixed_amount'
          then round(costing_line.unit_cost, 2)
        else round(costing_line.quantity * costing_line.unit_cost, 2)
      end
    ), 0), 2)
  from public.quotations quotation
  left join public.price_quotation_product_costings product_costing
    on product_costing.quotation_id = quotation.id
  left join public.price_quotation_costing_lines costing_line
    on costing_line.product_costing_id = product_costing.id
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved'
  group by quotation.id;
end;
$$;
revoke all on function public.finance_quotation_direct_cost_rows(uuid)
  from public, anon;
grant execute on function public.finance_quotation_direct_cost_rows(uuid)
  to authenticated;

create or replace function public.finance_project_expense_rows(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  client_contact_name text,
  lead_id uuid,
  total_direct_cost numeric,
  committed_project_expense numeric,
  remaining_direct_cost numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.finance_is_external_or_internal(p_organization_id) then
    raise exception 'Only Internal or External Finance can read project expense capacity';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    quotation.project_name,
    quotation.client_name,
    quotation.client_contact_name,
    quotation.lead_id,
    direct_cost.total_direct_cost,
    commitments.committed_project_expense,
    round(greatest(
      direct_cost.total_direct_cost - commitments.committed_project_expense,
      0::numeric
    ), 2)
  from public.quotations quotation
  left join lateral (
    select round(coalesce(sum(
      case
        when costing_line.calculation_type = 'fixed_amount'
          then round(costing_line.unit_cost, 2)
        else round(costing_line.quantity * costing_line.unit_cost, 2)
      end
    ), 0), 2) as total_direct_cost
    from public.price_quotation_product_costings product_costing
    left join public.price_quotation_costing_lines costing_line
      on costing_line.product_costing_id = product_costing.id
    where product_costing.quotation_id = quotation.id
  ) direct_cost on true
  left join lateral (
    select round(coalesce(sum(transaction.amount), 0), 2) as committed_project_expense
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.quotation_id = quotation.id
      and transaction.transaction_type = 'expense'
      and coalesce(transaction.is_voided, false) = false
      and transaction.approval_status::text not in (
        'rejected', 'revision_requested', 'cancelled'
      )
      and transaction.commission_summary_id is null
      and transaction.commission_allocation_id is null
  ) commitments on true
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved';
end;
$$;
revoke all on function public.finance_project_expense_rows(uuid)
  from public, anon;
grant execute on function public.finance_project_expense_rows(uuid)
  to authenticated;

-- Client payment verification is now an Internal Finance operation. GM
-- quotation access remains governed by the quotation workflow, but it cannot
-- use this Finance receipt-review RPC.
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
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
  v_total numeric;
  v_verified numeric;
  v_revision_number integer;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  if not private.finance_is_internal(v_payment.organization_id) then
    raise exception 'Only Internal Finance can review client payments';
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
revoke all on function public.review_quotation_payment(uuid, text, text)
  from public, anon;
grant execute on function public.review_quotation_payment(uuid, text, text)
  to authenticated;

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
  if not private.finance_is_internal(v_payment.organization_id) then
    raise exception 'Only Internal Finance can reverse quotation payments';
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
revoke all on function public.reverse_quotation_payment(uuid, text)
  from public, anon;
grant execute on function public.reverse_quotation_payment(uuid, text)
  to authenticated;

-- External categories are allowed at creation time; only Internal Finance can
-- edit or archive the shared directory after creation.
create or replace function private.finance_category_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    if not private.finance_is_external_or_internal(new.organization_id) then
      raise exception 'Only Internal or External Finance can create finance categories';
    end if;
  elsif not private.finance_is_internal(new.organization_id) then
    raise exception 'Only Internal Finance can update finance categories';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_categories_role_guard on public.finance_categories;
create trigger finance_categories_role_guard
before insert or update on public.finance_categories
for each row execute function private.finance_category_role_guard();

-- New rows still require a current account allocation. Existing legacy rows
-- tied to budget_request_id are grandfathered so ordinary status/payment
-- updates do not strand historical External Finance records.
create or replace function private.finance_budget_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_external boolean := private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id);
  v_budgeted boolean;
  v_period_id uuid;
  v_allocation public.finance_account_budget_allocations%rowtype;
  v_legacy_budget public.finance_budget_requests%rowtype;
  v_consumed numeric;
  v_legacy_committed numeric;
  v_amount numeric;
begin
  if tg_op = 'UPDATE'
    and old.budget_request_id is not null
    and old.organization_id = new.organization_id
    and old.transaction_type = 'expense'
    and new.transaction_type = 'expense'
    and old.budget_period_id is null
    and old.account_budget_allocation_id is null
    and new.budget_period_id is null
    and new.account_budget_allocation_id is null then
    select * into v_legacy_budget
    from public.finance_budget_requests request
    where request.id = old.budget_request_id
    for update;
    if not found or v_legacy_budget.organization_id is distinct from new.organization_id then
      raise exception 'The selected legacy budget request does not belong to this workspace';
    end if;
    if v_legacy_budget.status <> 'approved' then
      raise exception 'Only an approved legacy budget request can be used for Money Out';
    end if;
    select coalesce(sum(transaction.amount), 0)
    into v_legacy_committed
    from public.finance_transactions transaction
    where transaction.organization_id = new.organization_id
      and transaction.budget_request_id = new.budget_request_id
      and transaction.id is distinct from new.id
      and transaction.transaction_type = 'expense'
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'cancelled');
    v_amount := case when coalesce(new.is_voided, false) then 0 else round(coalesce(new.amount, 0), 2) end;
    if round(v_legacy_committed + v_amount, 2) > round(v_legacy_budget.amount, 2) then
      raise exception 'This expense exceeds the remaining approved legacy budget of %',
        round(greatest(v_legacy_budget.amount - v_legacy_committed, 0), 2);
    end if;
    return new;
  end if;

  v_budgeted := v_external or new.budget_period_id is not null;
  if tg_op = 'UPDATE' then
    v_budgeted := v_budgeted
      or old.budget_period_id is not null
      or old.account_budget_allocation_id is not null;
  end if;
  if not v_budgeted or new.transaction_type <> 'expense' then
    return new;
  end if;
  if new.account_id is null then
    raise exception 'Choose an active Finance account with available budget';
  end if;
  if tg_op = 'UPDATE' and old.budget_period_id is not null then
    v_period_id := old.budget_period_id;
  else
    v_period_id := private.ensure_finance_budget_period(new.organization_id);
  end if;
  select allocation.* into v_allocation
  from public.finance_account_budget_allocations allocation
  join public.finance_accounts account
    on account.id = allocation.account_id
   and account.organization_id = allocation.organization_id
   and account.is_active
  where allocation.organization_id = new.organization_id
    and allocation.period_id = v_period_id
    and allocation.account_id = new.account_id
  for update;
  if not found then
    raise exception 'This account has no available budget';
  end if;
  v_consumed := private.finance_budget_consumed_amount(
    new.organization_id, v_period_id, new.account_id, new.id
  );
  v_amount := case
    when new.is_voided
      or new.approval_status in ('rejected', 'revision_requested', 'cancelled')
      then 0
    else round(coalesce(new.amount, 0), 2)
  end;
  if round(v_consumed + v_amount, 2) > round(v_allocation.allocated_amount, 2) then
    raise exception 'This account has no available budget for this expense';
  end if;
  new.budget_period_id := v_period_id;
  new.account_budget_allocation_id := v_allocation.id;
  return new;
end;
$$;

drop trigger if exists finance_transactions_budget_guard on public.finance_transactions;
create trigger finance_transactions_budget_guard
before insert or update of amount, transaction_type, approval_status, payment_status,
  account_id, budget_request_id, budget_period_id, account_budget_allocation_id, is_voided
on public.finance_transactions
for each row execute function private.finance_budget_allocation_guard();

-- Lock the period before either allocation row. Every reallocation therefore
-- uses one deterministic lock order and cannot deadlock on opposite transfers.
create or replace function public.reallocate_finance_account_budget(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_note text default null,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_period_id uuid;
  v_source public.finance_account_budget_allocations%rowtype;
  v_target public.finance_account_budget_allocations%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_source_available numeric;
  v_target_previous numeric;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
    and (p_organization_id is null or organization_id = p_organization_id)
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_budget_operator(v_organization_id) then
    raise exception 'Only Internal Finance can reallocate the budget';
  end if;
  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    raise exception 'Choose two different Finance accounts';
  end if;
  if v_amount <= 0 then
    raise exception 'Reallocation amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_to_account_id
      and account.organization_id = v_organization_id
      and account.is_active
  ) then
    raise exception 'Choose an active destination Finance account';
  end if;
  v_period_id := private.ensure_finance_budget_period(v_organization_id);
  perform 1
  from public.finance_budget_periods
  where id = v_period_id
  for update;
  select * into v_source
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_from_account_id
  for update;
  if not found then
    raise exception 'The source account has no allocation in this budget period';
  end if;
  v_source_available := v_source.allocated_amount - private.finance_budget_consumed_amount(
    v_organization_id, v_period_id, p_from_account_id
  );
  if v_amount > v_source_available then
    raise exception 'Only % of unused budget can be reallocated from the source account', round(greatest(v_source_available, 0), 2);
  end if;

  select * into v_target
  from public.finance_account_budget_allocations
  where period_id = v_period_id and account_id = p_to_account_id
  for update;
  v_target_previous := coalesce(v_target.allocated_amount, 0);
  if found then
    update public.finance_account_budget_allocations
    set allocated_amount = allocated_amount + v_amount,
        updated_by = (select auth.uid())
    where id = v_target.id;
  else
    insert into public.finance_account_budget_allocations (
      organization_id, period_id, account_id, allocated_amount,
      created_by, updated_by
    ) values (
      v_organization_id, v_period_id, p_to_account_id, v_amount,
      (select auth.uid()), (select auth.uid())
    ) returning * into v_target;
  end if;
  update public.finance_account_budget_allocations
  set allocated_amount = allocated_amount - v_amount,
      updated_by = (select auth.uid())
  where id = v_source.id;

  insert into public.finance_account_budget_allocation_events (
    organization_id, period_id, allocation_id, event_type, amount,
    previous_amount, new_amount, from_account_id, to_account_id, note, created_by
  ) values (
    v_organization_id, v_period_id, v_source.id, 'reallocation_out', v_amount,
    v_source.allocated_amount, v_source.allocated_amount - v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ), (
    v_organization_id, v_period_id, v_target.id, 'reallocation_in', v_amount,
    v_target_previous, v_target_previous + v_amount,
    p_from_account_id, p_to_account_id, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  );
  return v_target.id;
end;
$$;
revoke all on function public.reallocate_finance_account_budget(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.reallocate_finance_account_budget(uuid, uuid, numeric, text, uuid) to authenticated;

-- Finance receipts follow the same role boundary as the ledger. Transaction
-- receipts remain available to External Finance; account proofs stay internal.
drop policy if exists "finance receipts: authorized read" on storage.objects;
create policy "finance receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.finance_transactions transaction
      where transaction.receipt_storage_path = storage.objects.name
        and private.finance_is_external_or_internal(transaction.organization_id)
    )
    or exists (
      select 1 from public.finance_transaction_revisions revision
      where (revision.previous_receipt_storage_path = storage.objects.name
        or revision.receipt_storage_path = storage.objects.name)
        and private.finance_is_external_or_internal(revision.organization_id)
    )
    or exists (
      select 1 from public.finance_accounts account
      where account.receipt_storage_path = storage.objects.name
        and private.finance_is_internal(account.organization_id)
    )
    or exists (
      select 1 from public.finance_account_funding_entries funding
      where funding.receipt_storage_path = storage.objects.name
        and private.finance_is_internal(funding.organization_id)
    )
  )
);

drop policy if exists "finance receipts: finance upload" on storage.objects;
create policy "finance receipts: finance upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('internal_finance', 'external_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/accounts/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text = 'internal_finance'
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text = 'internal_finance'
      )
    )
  )
);

drop policy if exists "finance receipts: finance delete" on storage.objects;
create policy "finance receipts: finance delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.finance_transactions transaction
      where transaction.receipt_storage_path = storage.objects.name
        and private.finance_is_internal(transaction.organization_id)
    )
    or exists (
      select 1 from public.finance_transaction_revisions revision
      where (revision.previous_receipt_storage_path = storage.objects.name
        or revision.receipt_storage_path = storage.objects.name)
        and private.finance_is_internal(revision.organization_id)
    )
    or exists (
      select 1 from public.finance_accounts account
      where account.receipt_storage_path = storage.objects.name
        and private.finance_is_internal(account.organization_id)
    )
    or exists (
      select 1 from public.finance_account_funding_entries funding
      where funding.receipt_storage_path = storage.objects.name
        and private.finance_is_internal(funding.organization_id)
    )
  )
);

commit;
