-- Add one organization-scoped, role-aware source for actionable sidebar queue badges.
-- Run after 221_manual_finance_income.sql and before deploying the matching
-- workspace navigation update. Do not execute this file from the browser.

begin;

create or replace function public.sidebar_queue_counts(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_is_management boolean;
  v_is_internal boolean;
  v_is_external boolean;
  v_is_pricing boolean;
  v_is_letter_reviewer boolean;
  v_is_production_delegate boolean;
  v_management_approvals bigint := 0;
  v_pdf_costing bigint := 0;
  v_pricing_review bigint := 0;
  v_production_approval bigint := 0;
  v_letter_requests bigint := 0;
  v_quotation_payments bigint := 0;
  v_finance bigint := 0;
begin
  if p_organization_id is null
     or not private.is_org_member(p_organization_id) then
    raise exception 'Organization access denied';
  end if;

  v_is_management := private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  );
  v_is_internal := private.finance_is_internal(p_organization_id);
  v_is_external := not v_is_internal and private.has_text_role(
    p_organization_id,
    array['external_finance']
  );
  v_is_pricing := private.has_text_role(
    p_organization_id,
    array['sales_pricing_officer']
  );
  v_is_letter_reviewer := private.has_text_role(
    p_organization_id,
    array['owner', 'admin', 'payroll']
  );
  v_is_production_delegate := private.is_production_approval_delegate(
    p_organization_id
  );

  if v_is_management then
    select count(*) into v_management_approvals
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.status::text = 'pending_gm_approval'
      and quotation.document_type::text = 'price_quotation'
      and quotation.costing_source_id is null;

    select v_management_approvals + count(*) into v_management_approvals
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.status::text = 'pending'
      and quotation.document_type::text = 'costing_breakdown';

    select v_management_approvals + count(*) into v_management_approvals
    from public.price_quotation_revision_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.quotation_revision_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.project_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.project_schedule_revision_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.project_schedule_completion_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.project_edit_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.lead_change_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.lead_unendorsement_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_management_approvals + count(*) into v_management_approvals
    from public.approval_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending'
      and (request.resource_type is null or request.resource_type::text <> 'quotation');

    select count(*) into v_pdf_costing
    from public.costing_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';
  elsif v_is_pricing then
    select count(*) into v_pdf_costing
    from public.costing_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'needs_revision'
      and request.prepared_by = (select auth.uid());
  end if;

  if v_is_pricing then
    select count(*) into v_pricing_review
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.document_type::text = 'price_quotation'
      and quotation.costing_source_id is null
      and (
        quotation.status::text = 'pending'
        or (
          quotation.status::text = 'needs_revision'
          and quotation.revision_requested_to = 'pricing_officer'
        )
      )
      and (
        quotation.assigned_pricing_officer_user_id = (select auth.uid())
        or (
          quotation.assigned_pricing_officer_user_id is null
          and (
            quotation.created_by = (select auth.uid())
            or quotation.prepared_by_user_id = (select auth.uid())
            or quotation.submitted_by = (select auth.uid())
          )
        )
      )
      and exists (
        select 1
        from public.pricing_officer_project_types assignment
        where assignment.organization_id = quotation.organization_id
          and assignment.pricing_officer_user_id = (select auth.uid())
          and assignment.project_type = private.normalize_price_quotation_project_type(
            quotation.project_types
          )
      );
  end if;

  if v_is_letter_reviewer then
    select count(*) into v_letter_requests
    from public.employee_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';
  end if;

  if v_is_production_delegate and not v_is_management then
    select count(*) into v_production_approval
    from public.project_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.status::text = 'pending';

    select v_production_approval + count(*) into v_production_approval
    from public.project_schedule_revision_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_production_approval + count(*) into v_production_approval
    from public.project_schedule_completion_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';
  end if;

  if v_is_internal then
    select count(distinct payment.quotation_id) into v_quotation_payments
    from public.quotation_payment_records payment
    join public.quotations quotation
      on quotation.id = payment.quotation_id
     and quotation.organization_id = payment.organization_id
    where payment.organization_id = p_organization_id
      and payment.status::text = 'pending'
      and quotation.status::text = 'approved'
      and quotation.document_type::text = 'price_quotation'
      and quotation.costing_source_id is null;

    select count(*) into v_finance
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and not transaction.is_voided
      and transaction.transaction_type::text = 'expense'
      and transaction.payment_status::text = 'unpaid'
      and (
        transaction.approval_status::text = 'pending'
        or (
          transaction.approval_status::text = 'approved'
          and transaction.commission_allocation_id is null
        )
      );

    select v_finance + count(*) into v_finance
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and not transaction.is_voided
      and transaction.transaction_type::text = 'income'
      and transaction.income_source = 'manual'
      and transaction.income_review_status = 'pending'
      and transaction.payment_status::text = 'unpaid';

    select v_finance + count(*) into v_finance
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status::text = 'pending';

    select v_finance + count(*) into v_finance
    from public.supplier_payables payable
    where payable.organization_id = p_organization_id
      and coalesce(payable.status::text, '') not in ('paid', 'cancelled');

    select v_finance + count(*) into v_finance
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
  elsif v_is_external then
    select count(*) into v_finance
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and not transaction.is_voided
      and transaction.payment_status::text = 'unpaid'
      and (
        (
          transaction.transaction_type::text = 'expense'
          and transaction.approval_status::text = 'revision_requested'
        )
        or (
          transaction.transaction_type::text = 'income'
          and transaction.income_source = 'manual'
          and transaction.income_review_status = 'revision_requested'
        )
      );

    select v_finance + count(*) into v_finance
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.requested_by = (select auth.uid())
      and request.status::text = 'revision_requested';
  end if;

  return jsonb_build_object(
    'management_approvals', greatest(v_management_approvals, 0),
    'pdf_costing', greatest(v_pdf_costing, 0),
    'pricing_review', greatest(v_pricing_review, 0),
    'production_approval', greatest(v_production_approval, 0),
    'letter_requests', greatest(v_letter_requests, 0),
    'quotation_payments', greatest(v_quotation_payments, 0),
    'finance', greatest(v_finance, 0)
  );
end;
$$;

revoke all on function public.sidebar_queue_counts(uuid) from public, anon, authenticated;
grant execute on function public.sidebar_queue_counts(uuid) to authenticated;

commit;
