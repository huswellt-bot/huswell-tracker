-- Expose Finance actor names on request feeds while preserving the existing
-- authenticated, organization-scoped security-invoker views. The underlying
-- requested_by and approved_by UUIDs remain available for audit integrity.

begin;

create or replace view public.finance_revised_working_fund_request_feed
with (security_invoker = true)
as
select
  request.id,
  request.organization_id,
  request.project_fund_id,
  request.requested_amount,
  request.approved_amount,
  request.status,
  request.purpose,
  request.note,
  request.requested_by,
  request.requested_at,
  request.approved_by,
  request.approved_at,
  request.decision_note,
  request.support_transaction_id,
  request.created_at,
  request.updated_at,
  fund.project_name,
  fund.client_name,
  quotation.quotation_no,
  coalesce(line_summary.breakdown_total, 0) as breakdown_total,
  coalesce(line_summary.breakdown_line_count, 0)::integer as breakdown_line_count,
  coalesce(support_summary.outstanding_amount, 0) as outstanding_amount,
  coalesce(requested_profile.full_name, request.requested_by::text) as requested_by_name,
  coalesce(approved_profile.full_name, request.approved_by::text) as approved_by_name
from public.finance_working_fund_requests request
join public.project_funds fund
  on fund.id = request.project_fund_id
left join public.quotations quotation
  on quotation.id = fund.quotation_id
left join lateral (
  select
    sum(line.amount) as breakdown_total,
    count(*) as breakdown_line_count
  from public.finance_working_fund_request_lines line
  where line.request_id = request.id
) line_summary on true
left join lateral (
  select round(coalesce(sum(
    case
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'in' then entry.amount
      when entry.entry_type in ('working_fund_support', 'working_fund_repayment')
        and entry.direction = 'out' then -entry.amount
      else 0
    end
  ), 0), 2) as outstanding_amount
  from public.finance_revised_ledger_entries entry
  join public.finance_revised_transactions transaction
    on transaction.id = entry.transaction_id
  where entry.organization_id = request.organization_id
    and entry.project_fund_id = request.project_fund_id
    and entry.ledger_type = 'project'
    and transaction.working_fund_request_id = request.id
) support_summary on true
left join public.profiles requested_profile
  on requested_profile.id = request.requested_by
left join public.profiles approved_profile
  on approved_profile.id = request.approved_by;

create or replace view public.finance_revised_daily_fund_request_feed
with (security_invoker = true)
as
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
  coalesce(
    greatest(request.approved_amount - coalesce(spending.spent_amount, 0) - request.returned_amount, 0),
    0
  ) as unused_amount,
  coalesce(requested_profile.full_name, request.requested_by::text) as requested_by_name,
  coalesce(approved_profile.full_name, request.approved_by::text) as approved_by_name
from public.finance_daily_fund_requests request
left join lateral (
  select private.finance_revised_daily_fund_spent(request.organization_id, request.id) as spent_amount
) spending on true
left join public.profiles requested_profile
  on requested_profile.id = request.requested_by
left join public.profiles approved_profile
  on approved_profile.id = request.approved_by;

commit;
