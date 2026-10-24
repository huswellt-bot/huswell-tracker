-- Extend the Finance quotation read policy to capability-enabled Internal
-- Finance users, such as a Sales & Pricing Officer with Internal Finance
-- access. Preserve the existing management, Accountant, and Finance role
-- access. Run after 239_commission_visibility_after_verified_payment.sql.

begin;

drop policy if exists "quotations: finance read" on public.quotations;
create policy "quotations: finance read"
on public.quotations for select to authenticated
using (
  private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant'
  ])
  or private.finance_is_external_or_internal(organization_id)
);

commit;
