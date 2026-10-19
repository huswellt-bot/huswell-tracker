-- Allow External Finance to upload quotation receipts without exposing full
-- quotation rows through the Storage policy query.
-- Run after 224_price_quotation_costing_query_indexes.sql. Safe to re-run.

begin;

-- External Finance is intentionally denied direct SELECT access to the full
-- quotations row. The previous Storage policies queried public.quotations
-- directly, so RLS filtered the policy's EXISTS check before
-- can_submit_quotation_payment() could authorize the upload. Evaluate the
-- complete quote/path check inside a security-definer helper instead.
create or replace function private.can_upload_quotation_payment_receipt(
  p_object_name text
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
    where quote.organization_id::text = split_part(p_object_name, '/', 1)
      and quote.id::text = split_part(p_object_name, '/', 2)
      and private.can_submit_quotation_payment(quote.id)
  );
$$;

revoke all on function private.can_upload_quotation_payment_receipt(text)
  from public, anon, authenticated;
grant execute on function private.can_upload_quotation_payment_receipt(text)
  to authenticated;

drop policy if exists "quotation payment receipts: submit" on storage.objects;
create policy "quotation payment receipts: submit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotation-payment-receipts'
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.can_upload_quotation_payment_receipt(name)
);

-- Let the authorized submitter remove an orphan if registration fails. Keep
-- the existing management deletion paths unchanged.
drop policy if exists "quotation payment receipts: submitter cleanup"
  on storage.objects;
create policy "quotation payment receipts: submitter cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quotation-payment-receipts'
  and (
    (
      (
        not exists (
          select 1
          from public.quotation_payment_records payment
          where payment.receipt_storage_path = storage.objects.name
        )
        or exists (
          select 1
          from public.quotation_payment_records payment
          where payment.receipt_storage_path = storage.objects.name
            and payment.submitted_by = (select auth.uid())
            and payment.status in ('pending', 'rejected')
        )
      )
      and private.can_upload_quotation_payment_receipt(name)
    )
    or exists (
      select 1
      from public.quotation_payment_records payment
      where payment.receipt_storage_path = storage.objects.name
        and private.has_text_role(
          payment.organization_id,
          array['super_admin', 'owner', 'admin']
        )
    )
    or (
      not exists (
        select 1
        from public.quotation_payment_records payment
        where payment.receipt_storage_path = storage.objects.name
      )
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin')
      )
    )
  )
);

commit;
