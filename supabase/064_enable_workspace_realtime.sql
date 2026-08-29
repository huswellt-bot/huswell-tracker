-- Enable real-time refreshes for every data table loaded by the workspace.
-- Run after 063_enable_realtime_leads.sql. This is additive and safe to
-- re-run. Realtime delivery remains subject to each table's existing RLS
-- SELECT policy, so users receive only changes they are already allowed to read.

do $$
declare
  workspace_table text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach workspace_table in array array[
    'profiles',
    'business_settings',
    'customers',
    'suppliers',
    'employees',
    'inventory_items',
    'inventory_movements',
    'quotations',
    'quotation_items',
    'production_jobs',
    'production_material_usage',
    'production_job_activity',
    'finished_product_stock_ins',
    'invoices',
    'invoice_items',
    'payments',
    'expenses',
    'cash_flow_entries',
    'payroll_periods',
    'payroll_entries',
    'leave_requests',
    'target_goals',
    'approval_requests',
    'project_edit_requests',
    'project_schedule_revision_requests',
    'project_schedule_completion_requests',
    'lead_change_requests',
    'quotation_revision_requests',
    'project_schedules',
    'activity_log',
    'leads',
    'supplier_payables',
    'organization_members'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = workspace_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        workspace_table
      );
    end if;
  end loop;
end;
$$;
