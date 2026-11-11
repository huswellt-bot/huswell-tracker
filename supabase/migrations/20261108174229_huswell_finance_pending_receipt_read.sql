-- Storage remove/list operations need row visibility for a pending object.
-- Keep that visibility limited to the authenticated uploader until the
-- transaction row is created.
drop policy if exists "finance receipts: pending transaction read" on storage.objects;
create policy "finance receipts: pending transaction read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1
    from public.finance_transactions transaction
    where transaction.receipt_storage_path = storage.objects.name
  )
);
