-- Monthly activity aggregates for the management KPI graphs.
-- Run after 189_print_costing_defaults_and_auto_validation.sql and before deploying the
-- matching workspace update. This migration is safe to re-run.
--
-- The function returns counts only. Financial monthly values continue to come
-- from shared_kpi_dashboard, while this function keeps the activity graph
-- payload separate from the existing financial KPI payload.

create or replace function public.shared_kpi_monthly_activity(
  p_organization_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_year_start date := date_trunc('year', coalesce(p_month, current_date))::date;
  v_next_year date := (date_trunc('year', coalesce(p_month, current_date)) + interval '1 year')::date;
  v_series jsonb;
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Not authorized for management KPI activity';
  end if;

  with months as (
    select generate_series(
      v_year_start::timestamp,
      (v_year_start + interval '11 months')::timestamp,
      interval '1 month'
    )::date as month_start
  ),
  base_leads as (
    select
      lead.id,
      lead.date_contacted,
      coalesce(
        lead.date_sent,
        (lead.created_at at time zone 'Asia/Manila')::date
      ) as generated_on
    from public.leads lead
    where lead.organization_id = p_organization_id
  ),
  lead_monthly as (
    select
      date_trunc('month', lead.generated_on)::date as month_start,
      count(*) as leads_generated,
      count(*) filter (where lead.date_contacted is not null) as leads_contacted
    from base_leads lead
    where lead.generated_on >= v_year_start
      and lead.generated_on < v_next_year
    group by date_trunc('month', lead.generated_on)::date
  ),
  quotation_monthly as (
    select
      date_trunc('month', quotation.issue_date)::date as month_start,
      count(*) as price_quotations
    from public.quotations quotation
    where quotation.organization_id = p_organization_id
      and quotation.document_type::text = 'price_quotation'
      and quotation.issue_date >= v_year_start
      and quotation.issue_date < v_next_year
      and quotation.status::text in ('sent', 'approved')
    group by date_trunc('month', quotation.issue_date)::date
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
      payment.paid_on,
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
      (payment.paid_at at time zone 'Asia/Manila')::date as paid_on,
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
  paid_monthly as (
    select
      date_trunc('month', payment_event.paid_on)::date as month_start,
      count(distinct payment_event.customer_id) filter (
        where payment_event.customer_id is not null
      ) as paid_clients
    from payment_events payment_event
    where payment_event.paid_on >= v_year_start
      and payment_event.paid_on < v_next_year
    group by date_trunc('month', payment_event.paid_on)::date
  ),
  completed_monthly as (
    select
      date_trunc(
        'month',
        (schedule.completed_at at time zone 'Asia/Manila')::date
      )::date as month_start,
      count(distinct schedule.id) as completed_projects
    from public.project_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.completed_at is not null
      and (schedule.completed_at at time zone 'Asia/Manila')::date >= v_year_start
      and (schedule.completed_at at time zone 'Asia/Manila')::date < v_next_year
    group by date_trunc(
      'month',
      (schedule.completed_at at time zone 'Asia/Manila')::date
    )::date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', to_char(months.month_start, 'Mon'),
        'month', to_char(months.month_start, 'YYYY-MM'),
        'leads_generated', coalesce(lead_monthly.leads_generated, 0),
        'leads_contacted', coalesce(lead_monthly.leads_contacted, 0),
        'price_quotations', coalesce(quotation_monthly.price_quotations, 0),
        'paid_clients', coalesce(paid_monthly.paid_clients, 0),
        'completed_projects', coalesce(completed_monthly.completed_projects, 0)
      )
      order by months.month_start
    ),
    '[]'::jsonb
  )
  into v_series
  from months
  left join lead_monthly on lead_monthly.month_start = months.month_start
  left join quotation_monthly on quotation_monthly.month_start = months.month_start
  left join paid_monthly on paid_monthly.month_start = months.month_start
  left join completed_monthly on completed_monthly.month_start = months.month_start;

  return jsonb_build_object(
    'kpi_version', 1,
    'reporting_month', v_month,
    'monthly_activity', v_series
  );
end;
$$;

revoke all on function public.shared_kpi_monthly_activity(uuid, date) from public;
grant execute on function public.shared_kpi_monthly_activity(uuid, date) to authenticated;
