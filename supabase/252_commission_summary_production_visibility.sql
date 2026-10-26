-- Restrict the Commissions page RPC to quotations already confirmed in Production.
-- Run after 251_production_confirmed_commission_payables.sql.

begin;

drop function if exists public.commission_summary_rows_v3(uuid);

create function public.commission_summary_rows_v3(
  p_organization_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  grand_total numeric,
  client_payment_status text,
  client_paid_amount numeric,
  client_pending_payment_amount numeric,
  client_remaining_balance numeric,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  my_commission_type text,
  my_commission_amount numeric,
  my_officer_name text,
  allocations jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
with access as (
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance']
  ) as can_view_all
),
payment_totals as (
  select
    payment.quotation_id,
    round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2) as verified_paid,
    round(coalesce(sum(payment.amount) filter (where payment.status = 'pending'), 0), 2) as pending_paid
  from public.quotation_payment_records payment
  where payment.organization_id = p_organization_id
  group by payment.quotation_id
)
select
  summary.id,
  summary.organization_id,
  summary.quotation_id,
  summary.quotation_no,
  summary.project_name,
  summary.client_name,
  summary.grand_total,
  case
    when coalesce(summary.grand_total, 0) > 0
      and coalesce(payment.verified_paid, 0) >= coalesce(summary.grand_total, 0) then 'fully_paid'
    when coalesce(payment.verified_paid, 0) > 0 then 'partially_paid'
    when coalesce(payment.pending_paid, 0) > 0 then 'pending_review'
    else 'unpaid'
  end,
  round(coalesce(payment.verified_paid, 0), 2),
  round(coalesce(payment.pending_paid, 0), 2),
  round(greatest(coalesce(summary.grand_total, 0) - coalesce(payment.verified_paid, 0), 0), 2),
  summary.status,
  summary.created_at,
  summary.updated_at,
  visible.my_type,
  coalesce(visible.my_amount, 0),
  visible.my_name,
  visible.allocation_rows
from public.commission_summaries summary
cross join access
left join payment_totals payment
  on payment.quotation_id = summary.quotation_id
left join lateral (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', allocation.id,
          'commission_summary_id', allocation.commission_summary_id,
          'quotation_id', allocation.quotation_id,
          'recipient_user_id', allocation.recipient_user_id,
          'recipient_name', coalesce(profile.full_name, 'Sales & Pricing Officer'),
          'allocation_role', allocation.allocation_role,
          'share_rate', allocation.share_rate,
          'amount', allocation.amount,
          'status', allocation.status,
          'eligible_at', allocation.eligible_at,
          'paid_at', allocation.paid_at,
          'paid_by', allocation.paid_by
        ) order by allocation.allocation_role
      ),
      '[]'::jsonb
    ) as allocation_rows,
    round(coalesce(sum(allocation.amount) filter (
      where allocation.recipient_user_id = (select auth.uid())
    ), 0), 2) as my_amount,
    string_agg(
      case allocation.allocation_role
        when 'originating_se' then 'S.E. Origin'
        when 'costing_se' then 'Co-Worker'
        when 'self_handled_se' then 'Self-handled'
        else allocation.allocation_role
      end,
      ', ' order by allocation.allocation_role
    ) filter (where allocation.recipient_user_id = (select auth.uid())) as my_type,
    max(profile.full_name) filter (where allocation.recipient_user_id = (select auth.uid())) as my_name
  from public.commission_summary_allocations allocation
  left join public.profiles profile on profile.id = allocation.recipient_user_id
  where allocation.commission_summary_id = summary.id
    and (
      access.can_view_all
      or allocation.recipient_user_id = (select auth.uid())
    )
) visible on true
where summary.organization_id = p_organization_id
  and private.commission_quotation_is_production_confirmed(
    summary.organization_id,
    summary.quotation_id
  )
  and exists (
    select 1
    from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = summary.id
  )
  and (
    access.can_view_all
    or exists (
      select 1
      from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = summary.id
        and allocation.recipient_user_id = (select auth.uid())
    )
  )
  and (
    access.can_view_all
    or exists (
      select 1
      from public.quotation_payment_records payment
      where payment.organization_id = summary.organization_id
        and payment.quotation_id = summary.quotation_id
        and payment.status = 'verified'
    )
  )
order by summary.created_at desc, summary.quotation_no asc;
$$;

revoke all on function public.commission_summary_rows_v3(uuid) from public, anon;
grant execute on function public.commission_summary_rows_v3(uuid) to authenticated;

commit;
