-- Integrity fixes identified during the revised Finance workflow review.
-- These are forward-only corrections for the already released ledger.

begin;

-- Include revised Finance work in the approval badge. The legacy queue helper
-- does not know about the project-ledger tables and does not recognize the
-- unified accountant role.
create or replace function public.finance_sidebar_queue_counts(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_counts jsonb;
  v_legacy_pending bigint := 0;
  v_new_pending bigint := 0;
  v_revised_pending bigint := 0;
  v_legacy_revision bigint := 0;
  v_new_revision bigint := 0;
  v_old_commission bigint := 0;
  v_current_commission bigint := 0;
  v_finance bigint;
begin
  v_counts := public.sidebar_queue_counts(p_organization_id);
  v_finance := coalesce((v_counts ->> 'finance')::bigint, 0);

  if private.finance_revised_can_operate(p_organization_id) then
    select count(*) into v_old_commission
    from public.commission_summary_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.status = 'not_yet_paid'
      and allocation.amount > 0
      and private.quotation_is_fully_paid(allocation.quotation_id)
      and (
        select max(payment.verified_at)
        from public.quotation_payment_records payment
        where payment.organization_id = p_organization_id
          and payment.quotation_id = allocation.quotation_id
          and payment.status::text = 'verified'
          and payment.verified_at is not null
      ) <= now() - interval '3 days';

    select count(*) into v_current_commission
    from public.commission_summary_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.status = 'not_yet_paid'
      and allocation.amount > 0
      and private.quotation_is_fully_paid(allocation.quotation_id)
      and exists (
        select 1
        from public.quotation_payment_records payment
        where payment.organization_id = p_organization_id
          and payment.quotation_id = allocation.quotation_id
          and payment.status::text = 'verified'
          and payment.verified_at is not null
      );

    v_finance := v_finance - v_old_commission + v_current_commission;

    select count(*) into v_legacy_pending
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    if private.finance_is_budget_operator(p_organization_id) then
      select count(*) into v_new_pending
      from public.finance_account_funding_requests request
      where request.organization_id = p_organization_id
        and request.status::text = 'pending';
    end if;

    select
      coalesce((
        select count(*)
        from public.finance_revised_transactions transaction
        where transaction.organization_id = p_organization_id
          and transaction.status = 'pending'
      ), 0)
      + coalesce((
        select count(*)
        from public.finance_working_fund_requests request
        where request.organization_id = p_organization_id
          and request.status = 'pending'
      ), 0)
      + coalesce((
        select count(*)
        from public.finance_daily_fund_requests request
        where request.organization_id = p_organization_id
          and request.status = 'pending'
      ), 0)
    into v_revised_pending;

    v_finance := v_finance - v_legacy_pending + v_new_pending + v_revised_pending;
  elsif private.has_text_role(p_organization_id, array['external_finance']) then
    select count(*) into v_legacy_revision
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    select count(*) into v_new_revision
    from public.finance_account_funding_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';

    v_finance := v_finance - v_legacy_revision + v_new_revision;
  end if;

  return jsonb_set(
    v_counts,
    '{finance}',
    to_jsonb(greatest(v_finance, 0)),
    true
  );
end;
$$;

revoke all on function public.finance_sidebar_queue_counts(uuid) from public, anon, authenticated;
grant execute on function public.finance_sidebar_queue_counts(uuid) to authenticated;

-- Seeded/system categories are permanent configuration. Referenced custom
-- categories are archived, but system categories must never be deleted.
create or replace function public.delete_finance_revised_category(
  p_organization_id uuid,
  p_category_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can delete Finance categories';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.is_active
  for update;

  if not found then
    raise exception 'Finance category not found';
  end if;

  if v_category.is_system then
    raise exception 'System Finance categories cannot be deleted';
  end if;

  if exists (
    select 1
    from public.finance_transactions transaction
    where transaction.category_id = v_category.id
  ) or exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.category_id = v_category.id
  ) then
    update public.finance_categories
    set is_active = false,
        updated_at = now()
    where id = v_category.id;
    return 'archived';
  end if;

  delete from public.finance_categories
  where id = v_category.id;
  return 'deleted';
end;
$$;

revoke all on function public.delete_finance_revised_category(uuid, uuid) from public, anon;
grant execute on function public.delete_finance_revised_category(uuid, uuid) to authenticated;

-- Recompute a Working Fund request after an approved repayment is reversed.
-- Only still-approved support/repayment transactions count; the voided
-- repayment and its approved adjustment are intentionally excluded.
create or replace function private.finance_revised_sync_working_fund_request_status(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.finance_working_fund_requests%rowtype;
  v_outstanding numeric;
  v_has_repayment boolean;
begin
  if p_request_id is null then
    return;
  end if;

  select *
  into v_request
  from public.finance_working_fund_requests request
  where request.id = p_request_id
  for update;

  if not found then
    return;
  end if;

  select round(coalesce(sum(
    case
      when entry.entry_type = 'working_fund_support' and entry.direction = 'in' then entry.amount
      when entry.entry_type = 'working_fund_repayment' and entry.direction = 'out' then -entry.amount
      else 0
    end
  ), 0), 2)
  into v_outstanding
  from public.finance_revised_ledger_entries entry
  join public.finance_revised_transactions transaction
    on transaction.id = entry.transaction_id
  where entry.organization_id = v_request.organization_id
    and entry.project_fund_id = v_request.project_fund_id
    and entry.ledger_type = 'project'
    and transaction.working_fund_request_id = v_request.id
    and transaction.status = 'approved'
    and transaction.transaction_kind in ('working_fund_support', 'working_fund_repayment');

  select exists (
    select 1
    from public.finance_revised_transactions repayment
    where repayment.working_fund_request_id = v_request.id
      and repayment.transaction_kind = 'working_fund_repayment'
      and repayment.status = 'approved'
  )
  into v_has_repayment;

  update public.finance_working_fund_requests
  set status = case
        when coalesce(v_outstanding, 0) <= 0 then 'repaid'
        when v_has_repayment then 'partially_repaid'
        else 'approved'
      end,
      updated_at = now()
  where id = v_request.id;
end;
$$;

revoke all on function private.finance_revised_sync_working_fund_request_status(uuid) from public, anon, authenticated;

create or replace function private.finance_revised_sync_request_after_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'voided'
    and new.transaction_kind = 'working_fund_repayment'
    and new.working_fund_request_id is not null then
    perform private.finance_revised_sync_working_fund_request_status(new.working_fund_request_id);
  end if;
  return new;
end;
$$;

revoke all on function private.finance_revised_sync_request_after_reversal() from public, anon, authenticated;

drop trigger if exists finance_revised_request_status_after_reversal on public.finance_revised_transactions;
create trigger finance_revised_request_status_after_reversal
after update of status on public.finance_revised_transactions
for each row
execute function private.finance_revised_sync_request_after_reversal();

commit;
