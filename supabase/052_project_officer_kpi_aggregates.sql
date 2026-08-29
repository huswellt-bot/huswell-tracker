-- Adds per-project-officer KPI aggregates alongside the existing organization
-- totals. This returns counts only and never exposes another officer's records.
-- Run after 048_shared_open_costings_kpi.sql.

create or replace function public.shared_kpi_dashboard(
  p_organization_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  v_next_month date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_year_start date := date_trunc('year', p_month)::date;
  v_quarter_start date := date_trunc('quarter', p_month)::date;
  v_quarter_end date := (date_trunc('quarter', p_month) + interval '3 months')::date;
  v_series jsonb;
begin
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
  ) then
    raise exception 'Not authorized for this organization';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'label', to_char(month_start, 'Mon'),
    'revenue', coalesce((select sum(invoice.total_amount) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text <> 'void' and invoice.issue_date >= month_start and invoice.issue_date < (month_start + interval '1 month')::date), 0),
    'expense', coalesce((select sum(payment.amount) from public.payments payment where payment.organization_id = p_organization_id and payment.reversed_at is null and payment.paid_at >= month_start and payment.paid_at < (month_start + interval '1 month')::date), 0)
  ) order by month_start), '[]'::jsonb)
  into v_series
  from generate_series(v_year_start, (v_year_start + interval '11 months')::date, interval '1 month') month_start;

  return jsonb_build_object(
    'total_sales', coalesce((select sum(invoice.total_amount) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text <> 'void' and invoice.issue_date >= v_month_start and invoice.issue_date < v_next_month), 0),
    'collections', coalesce((select sum(payment.amount) from public.payments payment where payment.organization_id = p_organization_id and payment.reversed_at is null and payment.paid_at >= v_month_start and payment.paid_at < v_next_month), 0),
    'receivables', coalesce((select sum(greatest(invoice.total_amount - coalesce((select sum(payment.amount) from public.payments payment where payment.invoice_id = invoice.id and payment.reversed_at is null), 0), 0)) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text <> 'void'), 0),
    'overdue_receivables', coalesce((select sum(greatest(invoice.total_amount - coalesce((select sum(payment.amount) from public.payments payment where payment.invoice_id = invoice.id and payment.reversed_at is null), 0), 0)) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text <> 'void' and invoice.due_date < current_date), 0),
    'leads_generated', (select count(*) from public.leads lead where lead.organization_id = p_organization_id and coalesce(lead.date_sent, lead.created_at::date) >= v_month_start and coalesce(lead.date_sent, lead.created_at::date) < v_next_month),
    'officer_leads_generated', (select count(*) from public.leads lead where lead.organization_id = p_organization_id and coalesce(lead.date_sent, lead.created_at::date) >= v_month_start and coalesce(lead.date_sent, lead.created_at::date) < v_next_month and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())),
    'price_quotations', (select count(*) from public.quotations quotation where quotation.organization_id = p_organization_id and quotation.document_type = 'price_quotation' and quotation.issue_date >= v_month_start and quotation.issue_date < v_next_month and quotation.status::text in ('sent', 'approved')),
    'officer_price_quotations', (select count(*) from public.quotations quotation where quotation.organization_id = p_organization_id and quotation.document_type = 'price_quotation' and quotation.issue_date >= v_month_start and quotation.issue_date < v_next_month and quotation.status::text in ('sent', 'approved') and coalesce(quotation.prepared_by_user_id, quotation.created_by) = (select auth.uid())),
    'open_costings', (select count(*) from public.quotations quotation where quotation.organization_id = p_organization_id and quotation.document_type = 'costing_breakdown' and quotation.created_at >= v_month_start and quotation.created_at < v_next_month and quotation.status::text in ('draft', 'needs_revision', 'pending')),
    'paid_clients', (select count(distinct invoice.customer_id) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text = 'paid' and invoice.issue_date >= v_month_start and invoice.issue_date < v_next_month),
    'quarter_sales', coalesce((select sum(invoice.total_amount) from public.invoices invoice where invoice.organization_id = p_organization_id and invoice.status::text <> 'void' and invoice.issue_date >= v_quarter_start and invoice.issue_date < v_quarter_end), 0),
    'quarter_target', coalesce((select goal.target_value from public.target_goals goal where goal.organization_id = p_organization_id and goal.goal_type = 'quarterly_sales' and goal.period_start >= v_quarter_start and goal.period_start < v_quarter_end order by goal.created_at desc limit 1), 0),
    'monthly_performance', v_series
  );
end;
$$;

revoke all on function public.shared_kpi_dashboard(uuid, date) from public;
grant execute on function public.shared_kpi_dashboard(uuid, date) to authenticated;
