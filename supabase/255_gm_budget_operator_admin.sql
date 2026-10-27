-- Allow the General Manager (admin role) to create, allocate, and reallocate
-- the approved GM budget pool while retaining the Internal Finance path.
-- Run after 254_gm_finance_operations_automatic.sql. Safe to re-run.

begin;

create or replace function private.finance_is_budget_operator(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(
    p_organization_id,
    array['admin', 'internal_finance']
  );
$$;

revoke all on function private.finance_is_budget_operator(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_budget_operator(uuid)
to authenticated;

commit;
