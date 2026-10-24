-- Allow capability-enabled Internal Finance users to read quotations needed
-- to reconcile the organization-wide project-payment approval queue.
-- Run after 241_quotation_payment_capability_read.sql.

begin;

drop policy if exists "price quotation submissions: own officer read"
  on public.quotations;
create policy "price quotation submissions: own officer read"
on public.quotations as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or private.finance_is_internal(organization_id)
  or created_by = (select auth.uid())
  or prepared_by_user_id = (select auth.uid())
  or submitted_by = (select auth.uid())
  or private.is_assigned_pricing_officer_quotation_visible(
    assigned_pricing_officer_user_id,
    status::text,
    revision_requested_to
  )
  or (
    assigned_pricing_officer_user_id is null
    and private.is_pricing_officer_assigned(
      organization_id,
      (select auth.uid()),
      project_types
    )
  )
);

commit;
