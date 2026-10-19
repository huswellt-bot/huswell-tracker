-- Allow External Finance to read submitted quotation payment records while
-- preserving the management-only draft visibility boundary.
-- Run after 225_fix_external_finance_receipt_storage_rls.sql. Safe to re-run.

begin;

-- The restrictive draft-hiding policy previously queried public.quotations
-- directly. External Finance is denied direct quotation-row reads, so the
-- policy returned false for every payment record before the permissive finance
-- read policy could expose an approved receipt.
create or replace function private.can_read_quotation_payment_record(
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
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          ),
          false
        )
      )
  );
$$;

revoke all on function private.can_read_quotation_payment_record(uuid)
  from public, anon, authenticated;
grant execute on function private.can_read_quotation_payment_record(uuid)
  to authenticated;

drop policy if exists "quotation payment records: management hidden drafts"
  on public.quotation_payment_records;
create policy "quotation payment records: management hidden drafts"
on public.quotation_payment_records as restrictive
for select to authenticated
using (private.can_read_quotation_payment_record(quotation_id));

commit;
