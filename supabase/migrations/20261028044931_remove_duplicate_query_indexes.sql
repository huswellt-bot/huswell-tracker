begin;

-- The preceding hardening migration added equivalent names where these
-- organization/status indexes already existed. Keep the original indexes and
-- remove only the redundant copies.
drop index if exists public.commission_allocations_org_status_created_idx;
drop index if exists public.finance_budget_allocations_org_period_account_idx;
drop index if exists public.supplier_payables_org_status_due_idx;

commit;
