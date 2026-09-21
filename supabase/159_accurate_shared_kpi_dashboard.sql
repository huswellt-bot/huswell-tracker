-- Make every dashboard KPI use the same month-aware, receipt-aware source.
-- Run after 158_unlimited_gm_target_budget_markup.sql and before deploying the
-- matching workspace code. This migration is safe to re-run.

create or replace function public.shared_kpi_dashboard(
  p_organization_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_next_month date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  v_year_start date := date_trunc('year', coalesce(p_month, current_date))::date;
  v_quarter_start date := date_trunc('quarter', coalesce(p_month, current_date))::date;
  v_quarter_end date := (date_trunc('quarter', coalesce(p_month, current_date)) + interval '3 months')::date;
  v_previous_month_start date := (date_trunc('month', coalesce(p_month, current_date)) - interval '1 month')::date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_series jsonb;
begin
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
  ) then
    raise exception 'Not authorized for this organization';
  end if;

  with verified_receipts as (
    select
      payment.id,
      payment.organization_id,
      payment.quotation_id,
      payment.invoice_id,
      payment.amount,
      payment.paid_at as paid_on
    from public.quotation_payment_records payment
    where payment.organization_id = p_organization_id
      and payment.status = 'verified'
      and payment.reversed_at is null
  ),
  receipt_quotes as (
    select distinct payment.quotation_id
    from verified_receipts payment
  ),
  payment_events as (
    select
      payment.id as event_id,
      payment.amount,
      payment.paid_on,
      payment.quotation_id,
      payment.invoice_id,
      coalesce(invoice.customer_id, quotation.customer_id) as customer_id
    from verified_receipts payment
    left join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.organization_id = p_organization_id
    left join public.quotations quotation
      on quotation.id = payment.quotation_id
     and quotation.organization_id = p_organization_id

    union all

    select
      payment.id as event_id,
      payment.amount,
      (payment.paid_at at time zone 'Asia/Manila')::date as paid_on,
      invoice.quotation_id,
      payment.invoice_id,
      coalesce(payment.customer_id, invoice.customer_id) as customer_id
    from public.payments payment
    left join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.organization_id = p_organization_id
    where payment.organization_id = p_organization_id
      and payment.reversed_at is null
      and not exists (
        select 1
        from receipt_quotes receipt
        where receipt.quotation_id = invoice.quotation_id
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', to_char(series.month_start::date, 'Mon'),
        'revenue', coalesce((
          select sum(invoice.total_amount)
          from public.invoices invoice
          where invoice.organization_id = p_organization_id
            and invoice.status::text in ('issued', 'partial', 'paid', 'overdue')
            and invoice.issue_date >= series.month_start::date
            and invoice.issue_date < (series.month_start + interval '1 month')::date
        ), 0),
        'collections', coalesce((
          select sum(payment_event.amount)
          from payment_events payment_event
          where payment_event.paid_on >= series.month_start::date
            and payment_event.paid_on < (series.month_start + interval '1 month')::date
        ), 0)
      )
      order by series.month_start
    ),
    '[]'::jsonb
  )
  into v_series
  from generate_series(
    v_year_start::timestamp,
    (v_year_start + interval '11 months')::timestamp,
    interval '1 month'
  ) as series(month_start);

  with eligible_invoices as (
    select invoice.*
    from public.invoices invoice
    where invoice.organization_id = p_organization_id
      and invoice.status::text in ('issued', 'partial', 'paid', 'overdue')
  ),
  verified_receipts as (
    select
      payment.id,
      payment.organization_id,
      payment.quotation_id,
      payment.invoice_id,
      payment.amount,
      payment.paid_at as paid_on
    from public.quotation_payment_records payment
    where payment.organization_id = p_organization_id
      and payment.status = 'verified'
      and payment.reversed_at is null
  ),
  receipt_quotes as (
    select distinct payment.quotation_id
    from verified_receipts payment
  ),
  payment_events as (
    select
      payment.id as event_id,
      payment.amount,
      payment.paid_on,
      payment.quotation_id,
      payment.invoice_id,
      coalesce(invoice.customer_id, quotation.customer_id) as customer_id
    from verified_receipts payment
    left join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.organization_id = p_organization_id
    left join public.quotations quotation
      on quotation.id = payment.quotation_id
     and quotation.organization_id = p_organization_id

    union all

    select
      payment.id as event_id,
      payment.amount,
      (payment.paid_at at time zone 'Asia/Manila')::date as paid_on,
      invoice.quotation_id,
      payment.invoice_id,
      coalesce(payment.customer_id, invoice.customer_id) as customer_id
    from public.payments payment
    left join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.organization_id = p_organization_id
    where payment.organization_id = p_organization_id
      and payment.reversed_at is null
      and not exists (
        select 1
        from receipt_quotes receipt
        where receipt.quotation_id = invoice.quotation_id
      )
  ),
  invoice_balances as (
    select
      invoice.id,
      greatest(
        invoice.total_amount - coalesce(sum(payment_event.amount), 0),
        0
      ) as balance
    from eligible_invoices invoice
    left join payment_events payment_event
      on payment_event.invoice_id = invoice.id
      or (
        payment_event.invoice_id is null
        and invoice.quotation_id is not null
        and payment_event.quotation_id = invoice.quotation_id
      )
    group by invoice.id, invoice.total_amount
  ),
  previous_invoice_balances as (
    select
      invoice.id,
      greatest(
        invoice.total_amount - coalesce(sum(payment_event.amount), 0),
        0
      ) as balance
    from eligible_invoices invoice
    left join payment_events payment_event
      on (
        payment_event.invoice_id = invoice.id
        or (
          payment_event.invoice_id is null
          and invoice.quotation_id is not null
          and payment_event.quotation_id = invoice.quotation_id
        )
      )
      and (payment_event.paid_on is null or payment_event.paid_on < v_month_start)
    where invoice.issue_date < v_month_start
    group by invoice.id, invoice.total_amount
  ),
  base_leads as (
    select
      lead.id,
      lead.date_contacted,
      lead.assigned_to,
      lead.created_by,
      lead.evaluation_number,
      lead.done_deal_status,
      coalesce(lead.date_sent, (lead.created_at at time zone 'Asia/Manila')::date) as generated_on
    from public.leads lead
    where lead.organization_id = p_organization_id
  ),
  qualified_quotes as (
    select
      quotation.id,
      quotation.lead_id,
      coalesce(quotation.prepared_by_user_id, quotation.created_by) as owner_id
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.document_type::text = 'price_quotation'
      and quotation.issue_date >= v_month_start
      and quotation.issue_date < v_next_month
      and quotation.status::text in ('sent', 'approved')
  ),
  all_qualified_quotes as (
    select
      quotation.id,
      quotation.lead_id,
      coalesce(quotation.prepared_by_user_id, quotation.created_by) as owner_id
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.document_type::text = 'price_quotation'
      and quotation.status::text in ('sent', 'approved')
  )
  select jsonb_build_object(
    'kpi_version', 2,
    'reporting_month', v_month_start,
    'total_sales', coalesce((
      select sum(invoice.total_amount)
      from eligible_invoices invoice
      where invoice.issue_date >= v_month_start
        and invoice.issue_date < v_next_month
    ), 0),
    'collections', coalesce((
      select sum(payment_event.amount)
      from payment_events payment_event
      where payment_event.paid_on >= v_month_start
        and payment_event.paid_on < v_next_month
    ), 0),
    'previous_month_sales', coalesce((
      select sum(invoice.total_amount)
      from eligible_invoices invoice
      where invoice.issue_date >= v_previous_month_start
        and invoice.issue_date < v_month_start
    ), 0),
    'previous_month_collections', coalesce((
      select sum(payment_event.amount)
      from payment_events payment_event
      where payment_event.paid_on >= v_previous_month_start
        and payment_event.paid_on < v_month_start
    ), 0),
    'receivables', coalesce((select sum(balance.balance) from invoice_balances balance), 0),
    'overdue_receivables', coalesce((
      select sum(balance.balance)
      from invoice_balances balance
      join eligible_invoices invoice on invoice.id = balance.id
      where balance.balance > 0
        and invoice.due_date < v_today
    ), 0),
    'previous_overdue_receivables', coalesce((
      select sum(balance.balance)
      from previous_invoice_balances balance
      join eligible_invoices invoice on invoice.id = balance.id
      where balance.balance > 0
        and invoice.due_date < v_month_start
    ), 0),
    'leads_generated', (select count(*) from base_leads lead where lead.generated_on >= v_month_start and lead.generated_on < v_next_month),
    'officer_leads_generated', (select count(*) from base_leads lead where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'leads_contacted', (select count(*) from base_leads lead where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and lead.date_contacted is not null),
    'officer_leads_contacted', (select count(*) from base_leads lead where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and lead.date_contacted is not null and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'price_quotations', (select count(*) from qualified_quotes),
    'officer_price_quotations', (select count(*) from qualified_quotes quotation where quotation.owner_id = (select auth.uid())),
    'quoted_leads', (select count(distinct quotation.lead_id) from qualified_quotes quotation join base_leads lead on lead.id = quotation.lead_id where lead.generated_on >= v_month_start and lead.generated_on < v_next_month),
    'officer_quoted_leads', (select count(distinct quotation.lead_id) from qualified_quotes quotation join base_leads lead on lead.id = quotation.lead_id where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid()) and quotation.owner_id = (select auth.uid())),
    'paid_clients', (select count(distinct payment_event.customer_id) from payment_events payment_event where payment_event.customer_id is not null and payment_event.paid_on >= v_month_start and payment_event.paid_on < v_next_month),
    'officer_paid_clients', (select count(distinct payment_event.customer_id) from payment_events payment_event join public.quotations quotation on quotation.id = payment_event.quotation_id and quotation.organization_id = p_organization_id where payment_event.customer_id is not null and payment_event.paid_on >= v_month_start and payment_event.paid_on < v_next_month and coalesce(quotation.prepared_by_user_id, quotation.created_by) = (select auth.uid())),
    'funnel_paid_leads', (select count(distinct lead.id) from base_leads lead join qualified_quotes quotation on quotation.lead_id = lead.id join payment_events payment_event on payment_event.quotation_id = quotation.id where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and payment_event.paid_on >= v_month_start and payment_event.paid_on < v_next_month),
    'officer_funnel_paid_leads', (select count(distinct lead.id) from base_leads lead join qualified_quotes quotation on quotation.lead_id = lead.id join payment_events payment_event on payment_event.quotation_id = quotation.id where lead.generated_on >= v_month_start and lead.generated_on < v_next_month and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid()) and quotation.owner_id = (select auth.uid()) and payment_event.paid_on >= v_month_start and payment_event.paid_on < v_next_month),
    'funnel_all_leads_generated', (select count(*) from base_leads),
    'officer_funnel_all_leads_generated', (select count(*) from base_leads lead where coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'funnel_all_leads_contacted', (select count(*) from base_leads lead where lead.date_contacted is not null),
    'officer_funnel_all_leads_contacted', (select count(*) from base_leads lead where lead.date_contacted is not null and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'funnel_all_quoted_leads', (select count(distinct coalesce(quotation.lead_id, quotation.id)) from all_qualified_quotes quotation),
    'officer_funnel_all_quoted_leads', (select count(distinct coalesce(quotation.lead_id, quotation.id)) from all_qualified_quotes quotation where quotation.owner_id = (select auth.uid())),
    'funnel_all_paid_leads', (select count(*) from base_leads lead where lead.evaluation_number = 7 and lead.done_deal_status >= 6),
    'officer_funnel_all_paid_leads', (select count(*) from base_leads lead where lead.evaluation_number = 7 and lead.done_deal_status >= 6 and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'funnel_all_completed_projects', (select count(*) from public.project_schedules schedule where schedule.organization_id = p_organization_id and schedule.completed_at is not null),
    'officer_funnel_all_completed_projects', (select count(*) from public.project_schedules schedule where schedule.organization_id = p_organization_id and schedule.completed_at is not null and schedule.assigned_to = (select auth.uid())),
    'open_costings', (select count(*) from public.quotations quotation where quotation.organization_id = p_organization_id and quotation.document_type::text = 'costing_breakdown' and (quotation.created_at at time zone 'Asia/Manila')::date >= v_month_start and (quotation.created_at at time zone 'Asia/Manila')::date < v_next_month and quotation.status::text in ('draft', 'needs_revision', 'pending')),
    'quarter_sales', coalesce((
      select sum(invoice.total_amount)
      from eligible_invoices invoice
      where invoice.issue_date >= v_quarter_start
        and invoice.issue_date < v_quarter_end
    ), 0),
    'quarter_target', coalesce((
      select goal.target_value
      from public.target_goals goal
      where goal.organization_id = p_organization_id
        and goal.goal_type::text = 'quarterly_sales'
        and goal.period_start >= v_quarter_start
        and goal.period_start < v_quarter_end
      order by goal.created_at desc
      limit 1
    ), 0),
    'monthly_performance', v_series
  )
  into v_series;

  return v_series;
end;
$$;

revoke all on function public.shared_kpi_dashboard(uuid, date) from public;
grant execute on function public.shared_kpi_dashboard(uuid, date) to authenticated;
