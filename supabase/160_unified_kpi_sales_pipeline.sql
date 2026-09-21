-- Use one organization-wide, month-aware Sales Pipeline aggregate for every
-- KPI page. Run after 159_accurate_shared_kpi_dashboard.sql and before the
-- matching workspace update. This migration is safe to re-run.

create or replace function public.shared_kpi_sales_pipeline(
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
  v_dashboard jsonb;
  v_result jsonb;
begin
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
  ) then
    raise exception 'Not authorized for this organization';
  end if;

  v_dashboard := public.shared_kpi_dashboard(p_organization_id, p_month);

  with base_leads as (
    select
      lead.id,
      coalesce(lead.date_sent, (lead.created_at at time zone 'Asia/Manila')::date) as generated_on
    from public.leads lead
    where lead.organization_id = p_organization_id
  )
  select jsonb_build_object(
    'kpi_version', coalesce(v_dashboard->'kpi_version', '2'::jsonb),
    'reporting_month', v_month_start,
    'leads_generated', coalesce(v_dashboard->'leads_generated', '0'::jsonb),
    'leads_contacted', coalesce(v_dashboard->'leads_contacted', '0'::jsonb),
    'quoted_leads', coalesce(v_dashboard->'quoted_leads', '0'::jsonb),
    'funnel_paid_leads', coalesce(v_dashboard->'funnel_paid_leads', '0'::jsonb),
    'funnel_completed_projects', coalesce((
      select count(distinct schedule.id)
      from public.project_schedules schedule
      join public.quotations quotation
        on quotation.id = schedule.quotation_id
       and quotation.organization_id = p_organization_id
      join base_leads lead on lead.id = quotation.lead_id
      where schedule.organization_id = p_organization_id
        and schedule.completed_at is not null
        and (schedule.completed_at at time zone 'Asia/Manila')::date >= v_month_start
        and (schedule.completed_at at time zone 'Asia/Manila')::date < v_next_month
        and lead.generated_on >= v_month_start
        and lead.generated_on < v_next_month
    ), 0),
    'pipeline_scope', 'organization'
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.shared_kpi_sales_pipeline(uuid, date) from public;
grant execute on function public.shared_kpi_sales_pipeline(uuid, date) to authenticated;
