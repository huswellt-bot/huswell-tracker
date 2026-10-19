-- Remove the stale reviewer-helper calls from quotation-payment read policies.
-- Internal Finance now reviews the organization-wide confirmation queue, while
-- existing assigned-reviewer access remains available through reviewer_user_id.
-- Run after 228_external_finance_quotation_selector_contact.sql and before
-- deploying the matching Finance workspace update. Safe to re-run.

begin;

create or replace function private.can_view_quotation_payment(
  p_quotation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.quotations quote
    where quote.id = p_quotation_id
      and (
        private.has_text_role(quote.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant',
          'internal_finance', 'external_finance', 'production', 'warehouse'
        ])
        or private.can_submit_quotation_payment(quote.id)
      )
  );
$$;

drop policy if exists "quotation payment records: authorized read"
  on public.quotation_payment_records;
create policy "quotation payment records: authorized read"
on public.quotation_payment_records for select to authenticated
using (
  private.can_view_quotation_payment(quotation_id)
  or reviewer_user_id = (select auth.uid())
);

drop policy if exists "quotation payment receipts: authorized read"
  on storage.objects;
create policy "quotation payment receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and exists (
    select 1
    from public.quotation_payment_records payment
    where payment.receipt_storage_path = storage.objects.name
      and (
        private.has_text_role(payment.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant',
          'internal_finance', 'external_finance'
        ])
        or private.can_submit_quotation_payment(payment.quotation_id)
        or payment.reviewer_user_id = (select auth.uid())
      )
  )
);

revoke all on function private.quotation_payment_reviewer(uuid)
  from public, anon, authenticated;

commit;
