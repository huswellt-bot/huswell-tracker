-- Allow a specifically delegated Finance operator to retain a non-Finance
-- primary membership role, such as Sales & Pricing Officer. The retired
-- internal_finance capability remains blocked; revised_finance is the only
-- capability used by the revised project-ledger workflow.

begin;

alter table public.organization_member_capabilities
  drop constraint if exists organization_member_capabilities_capability_check;

alter table public.organization_member_capabilities
  add constraint organization_member_capabilities_capability_check
  check (capability in ('internal_finance', 'revised_finance'));

create or replace function private.finance_revised_has_combined_access(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and exists (
      select 1
      from public.organization_member_capabilities capability
      where capability.organization_id = p_organization_id
        and capability.user_id = (select auth.uid())
        and capability.capability = 'revised_finance'
    );
$$;

revoke all on function private.finance_revised_has_combined_access(uuid)
from public, anon, authenticated;
grant execute on function private.finance_revised_has_combined_access(uuid)
to authenticated;

-- Management and Accountant roles retain their existing access. A delegated
-- revised-Finance capability adds the same operational Finance access without
-- changing the user's primary membership role.
create or replace function private.finance_revised_can_operate(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and (
      private.has_text_role(
        p_organization_id,
        array['super_admin', 'owner', 'admin', 'accountant']
      )
      or private.finance_revised_has_combined_access(p_organization_id)
    );
$$;

-- Keep the released function name for the existing guarded RPC wrappers while
-- allowing the explicit combined-role capability to submit operational work.
create or replace function private.finance_revised_is_accountant(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and (
      private.has_text_role(p_organization_id, array['accountant'])
      or private.finance_revised_has_combined_access(p_organization_id)
    );
$$;

revoke all on function private.finance_revised_is_accountant(uuid)
from public, anon, authenticated;
grant execute on function private.finance_revised_is_accountant(uuid)
to authenticated;

-- Dianne keeps her existing Sales & Pricing Officer membership role. The
-- current primary account is identified by email; the display-name fallback
-- supports the requested Dianne Huswell name if that metadata is corrected.
insert into public.organization_member_capabilities
  (organization_id, user_id, capability, granted_by)
select member.organization_id, member.user_id, 'revised_finance', null
from auth.users account
join public.organization_members member
  on member.user_id = account.id
where member.role::text = 'sales_pricing_officer'
  and (
    lower(account.email) = lower('dianne.sale.internal@huswelltrading.com')
    or lower(coalesce(account.raw_user_meta_data->>'full_name', '')) = lower('dianne huswell')
  )
on conflict (organization_id, user_id, capability) do nothing;

commit;
