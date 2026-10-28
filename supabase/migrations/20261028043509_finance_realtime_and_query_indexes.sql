begin;

-- Finance UI subscriptions must receive changes from the tables they watch.
do $$
declare
  v_table text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array[
    'finance_transactions',
    'finance_categories',
    'finance_accounts',
    'finance_budget_periods',
    'finance_budget_grants',
    'finance_account_budget_allocations',
    'finance_account_funding_requests',
    'finance_account_budget_allocation_events',
    'commission_summary_allocations'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- Keep the organization/date and queue filters used by Finance and workspace
-- refreshes selective as the organization grows.
create index if not exists finance_transactions_org_date_idx
  on public.finance_transactions (organization_id, transaction_date desc, created_at desc);
create index if not exists finance_transactions_org_status_idx
  on public.finance_transactions (organization_id, approval_status, payment_status);
create index if not exists finance_categories_org_active_direction_idx
  on public.finance_categories (organization_id, is_active, direction, name);
create index if not exists finance_accounts_org_name_idx
  on public.finance_accounts (organization_id, account_name);
create index if not exists finance_budget_periods_org_start_idx
  on public.finance_budget_periods (organization_id, period_start desc);
create index if not exists finance_budget_grants_org_granted_idx
  on public.finance_budget_grants (organization_id, granted_at desc);
create index if not exists finance_budget_allocations_org_period_account_idx
  on public.finance_account_budget_allocations (organization_id, period_id, account_id);
create index if not exists finance_funding_requests_org_status_requested_idx
  on public.finance_account_funding_requests (organization_id, status, requested_at desc);
create index if not exists finance_allocation_events_allocation_created_idx
  on public.finance_account_budget_allocation_events (allocation_id, created_at desc);
create index if not exists commission_allocations_org_status_created_idx
  on public.commission_summary_allocations (organization_id, status, created_at desc);
create index if not exists supplier_payables_org_status_due_idx
  on public.supplier_payables (organization_id, status, due_date);
create index if not exists quotation_payments_org_status_paid_idx
  on public.quotation_payment_records (organization_id, status, paid_at desc, created_at desc);

create index if not exists quotations_org_created_idx
  on public.quotations (organization_id, created_at desc);
create index if not exists quotation_items_quotation_created_idx
  on public.quotation_items (quotation_id, created_at desc);
create index if not exists product_costings_quotation_item_idx
  on public.price_quotation_product_costings (quotation_id, quotation_item_id);
create index if not exists costing_lines_product_costing_idx
  on public.price_quotation_costing_lines (product_costing_id, created_at desc);
create index if not exists costing_markups_product_costing_idx
  on public.price_quotation_costing_markups (product_costing_id, created_at desc);
create index if not exists leads_org_created_idx
  on public.leads (organization_id, created_at desc, id desc);
create index if not exists activity_log_org_created_idx
  on public.activity_log (organization_id, created_at desc);

commit;
