-- Finance commission payables no longer depend on a Production schedule.
-- The separate Commission Summary visibility rule remains unchanged.

create or replace function public.finance_commission_payable_quotation_ids(
  p_organization_id uuid
)
returns table(quotation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.finance_is_internal(p_organization_id) then
    raise exception 'Only Internal Finance can view commission payable quotations';
  end if;

  return query
  select distinct allocation.quotation_id
  from public.commission_summary_allocations allocation
  where allocation.organization_id = p_organization_id
    and allocation.status = 'not_yet_paid';
end;
$$;

revoke all on function public.finance_commission_payable_quotation_ids(uuid) from public, anon;
grant execute on function public.finance_commission_payable_quotation_ids(uuid) to authenticated;

drop trigger if exists finance_transactions_commission_production_guard
  on public.finance_transactions;
drop function if exists private.enforce_commission_production_confirmation();

-- The existing dashboard function includes the old Production filter in its
-- commission-payables KPI. Preserve its other calculations and replace only
-- that KPI with all open commission allocations.
alter function public.shared_kpi_finance_dashboard(uuid, date)
  rename to shared_kpi_finance_dashboard_prod_gate_legacy;

revoke all on function public.shared_kpi_finance_dashboard_prod_gate_legacy(uuid, date)
from public, anon, authenticated;

create or replace function public.shared_kpi_finance_dashboard(
  p_organization_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_result jsonb;
  v_commission_payables numeric;
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Not authorized for GM Finance dashboard';
  end if;

  v_result := public.shared_kpi_finance_dashboard_prod_gate_legacy(p_organization_id, p_month);

  select round(coalesce(sum(allocation.amount), 0), 2)
  into v_commission_payables
  from public.commission_summary_allocations allocation
  where allocation.organization_id = p_organization_id
    and allocation.status = 'not_yet_paid';

  return jsonb_set(
    v_result,
    '{commission_payables_open}',
    to_jsonb(v_commission_payables),
    true
  );
end;
$$;

revoke all on function public.shared_kpi_finance_dashboard(uuid, date) from public, anon;
grant execute on function public.shared_kpi_finance_dashboard(uuid, date) to authenticated;

-- Recalculate the Finance sidebar queue from all fully paid, verified
-- commission allocations instead of requiring an approved Production schedule.
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
  v_legacy_revision bigint := 0;
  v_new_revision bigint := 0;
  v_old_commission bigint := 0;
  v_current_commission bigint := 0;
  v_finance bigint;
begin
  v_counts := public.sidebar_queue_counts(p_organization_id);
  v_finance := coalesce((v_counts ->> 'finance')::bigint, 0);

  if private.finance_is_internal(p_organization_id) then
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

    v_finance := v_finance - v_legacy_pending + v_new_pending;
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
