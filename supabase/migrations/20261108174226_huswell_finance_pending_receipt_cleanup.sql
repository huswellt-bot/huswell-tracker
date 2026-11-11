-- A failed transaction submission must be able to remove the receipt it just
-- uploaded. Restrict cleanup to the authenticated uploader and only to an
-- unlinked pending transaction object.
drop policy if exists "finance receipts: pending transaction delete" on storage.objects;
create policy "finance receipts: pending transaction delete"
on storage.objects for delete to authenticated
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
