-- Allow Project Managers to edit and archive customers.
-- Safe to run after 003_complete_workflows.sql or 004_project_manager_customer_access.sql.

create or replace function private.can_access(target_organization_id uuid, resource text, action text)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(
    select 1 from public.organization_members m
    where m.organization_id=target_organization_id and m.user_id=(select auth.uid()) and (
      m.role::text in ('owner','admin') or
      (m.role::text='project_manager' and (
        (action='read' and resource=any(array['business_settings','customers','suppliers','employees','inventory_items','inventory_movements','quotations','quotation_items','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins','invoices','invoice_items','payments','expenses'])) or
        (action='create' and resource=any(array['customers','quotations','quotation_items','production_material_usage','expenses'])) or
        (action='update' and resource=any(array['customers','quotations','production_jobs','expenses'])) or
        (action='delete' and resource='expenses')
      )) or
      (m.role::text='sales' and (
        (action='read' and resource=any(array['business_settings','customers','suppliers','employees','inventory_items','quotations','quotation_items','invoices','invoice_items','payments'])) or
        (action='create' and resource=any(array['quotations','quotation_items','invoices','invoice_items','payments'])) or
        (action='update' and resource=any(array['quotations','invoices','invoice_items','payments','customers']))
      )) or
      (m.role::text='warehouse' and (
        (action='read' and resource=any(array['customers','employees','inventory_items','inventory_movements','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins'])) or
        (action='create' and resource=any(array['inventory_items','inventory_movements','finished_product_stock_ins','production_material_usage'])) or
        (action='update' and resource=any(array['inventory_items','production_jobs','finished_product_stock_ins']))
      )) or
      (m.role::text='accountant' and (
        (action='read' and resource=any(array['customers','suppliers','employees','inventory_items','invoices','invoice_items','payments','expenses','cash_flow_entries'])) or
        (action='create' and resource=any(array['expenses','cash_flow_entries','invoices','invoice_items','payments'])) or
        (action='update' and resource=any(array['expenses','cash_flow_entries','invoices','invoice_items','payments','suppliers'])) or
        (action='delete' and resource='expenses')
      )) or
      (m.role::text='payroll' and (
        (action='read' and resource=any(array['employees','payroll_periods','payroll_entries','leave_requests'])) or
        (action='create' and resource=any(array['payroll_periods','payroll_entries','leave_requests'])) or
        (action='update' and resource=any(array['payroll_periods','payroll_entries','leave_requests']))
      )) or
      (m.role::text='production' and (
        (action='read' and resource=any(array['customers','employees','inventory_items','inventory_movements','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins'])) or
        (action='create' and resource=any(array['production_material_usage','finished_product_stock_ins','inventory_movements'])) or
        (action='update' and resource=any(array['production_jobs','finished_product_stock_ins']))
      )) or
      (m.role::text='viewer' and action='read' and resource=any(array['customers','suppliers','employees','inventory_items','inventory_movements','quotations','quotation_items','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins','invoices','invoice_items','payments','expenses','target_goals']))
    )
  );
$$;

grant execute on function private.can_access(uuid,text,text) to authenticated;
