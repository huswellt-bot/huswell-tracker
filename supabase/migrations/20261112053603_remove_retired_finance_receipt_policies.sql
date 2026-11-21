-- Remove the retired generic Finance receipt policies.
--
-- These policies still reference the retired finance_transactions and related
-- tables. Because they are policies on storage.objects, their expressions can
-- be evaluated during unrelated quotation-images uploads and fail after the
-- legacy Finance table privileges were revoked. Revised Finance receipts and
-- foundation-release receipts use separate policies and remain intact.

begin;

drop policy if exists "finance receipts: authorized read" on storage.objects;
drop policy if exists "finance receipts: finance delete" on storage.objects;
drop policy if exists "finance receipts: finance upload" on storage.objects;

commit;
