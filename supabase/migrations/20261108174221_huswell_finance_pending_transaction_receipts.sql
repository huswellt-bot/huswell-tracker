-- Allow Finance to upload a transaction receipt before the transaction row
-- exists. The client intentionally uploads the receipt before calling the
-- security-definer transaction RPC, so the existing row-backed policy cannot
-- authorize this short-lived pending object.
drop policy if exists "finance receipts: pending transaction upload" on storage.objects;
create policy "finance receipts: pending transaction upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.finance_is_external_or_internal(
    split_part(name, '/', 1)::uuid
  )
);

drop policy if exists "finance receipts: pending transaction delete" on storage.objects;
create policy "finance receipts: pending transaction delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.finance_is_external_or_internal(
    split_part(name, '/', 1)::uuid
  )
  and not exists (
    select 1
    from public.finance_transactions transaction
    where transaction.receipt_storage_path = storage.objects.name
  )
);
