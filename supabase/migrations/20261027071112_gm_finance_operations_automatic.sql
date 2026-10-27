-- Make the General Manager role an automatic Finance operations fallback.
-- The application role admin is the General Manager role. Keep the
-- internal_finance capability for non-GM accounts such as Sales & Pricing
-- Officers that need Finance access without changing their primary role.

begin;

create or replace function private.finance_is_internal(
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
  )
  or private.has_member_capability(p_organization_id, 'internal_finance');
$$;

revoke all on function private.finance_is_internal(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_internal(uuid)
to authenticated;

commit;
