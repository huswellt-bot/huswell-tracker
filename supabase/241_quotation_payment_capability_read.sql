-- Allow capability-enabled Internal Finance users to review the organization-wide
-- quotation payment queue while preserving Sales & Pricing Officer row scoping.
-- Run after 240_quotation_finance_capability_read.sql.

begin;

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.quotation_payment_records;
create policy "price quotation submissions: child exact reviewer read"
on public.quotation_payment_records as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or private.finance_is_internal(organization_id)
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

commit;
