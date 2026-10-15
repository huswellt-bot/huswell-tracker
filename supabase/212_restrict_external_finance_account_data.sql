-- Keep full account, balance, funding, and account-receipt data internal.
-- External Finance continues to use the limited quotation-payment account RPC.
-- Run after 211_external_finance_quotation_payment_submission.sql and before
-- deploying the matching Finance workspace update.

begin;

drop policy if exists "finance accounts: finance read"
  on public.finance_accounts;
create policy "finance accounts: finance read"
on public.finance_accounts for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
]));

drop policy if exists "finance account funding: finance read"
  on public.finance_account_funding_entries;
create policy "finance account funding: finance read"
on public.finance_account_funding_entries for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
]));

-- The security-invoker balance view now returns no account rows to External
-- Finance because its underlying account and funding rows are internal-only.
-- Keep the authenticated grant for Internal Finance and management roles.

drop policy if exists "finance receipts: authorized read" on storage.objects;
create policy "finance receipts: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.finance_transactions transaction
      where transaction.receipt_storage_path = storage.objects.name
        and private.has_text_role(transaction.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
        ])
    )
    or exists (
      select 1 from public.finance_accounts account
      where account.receipt_storage_path = storage.objects.name
        and private.has_text_role(account.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
        ])
    )
    or exists (
      select 1 from public.finance_account_funding_entries funding
      where funding.receipt_storage_path = storage.objects.name
        and private.has_text_role(funding.organization_id, array[
          'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
        ])
    )
  )
);

drop policy if exists "finance receipts: finance upload" on storage.objects;
create policy "finance receipts: finance upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/accounts/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
  )
);

-- Keep deletion aligned with the read/upload boundary. External Finance may
-- manage transaction receipts, but account and account-funding proofs remain
-- Internal Finance and management data.
drop policy if exists "finance receipts: finance delete" on storage.objects;
create policy "finance receipts: finance delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/accounts/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.organization_members member
        where member.organization_id::text = split_part(storage.objects.name, '/', 1)
          and member.user_id = (select auth.uid())
          and member.role::text in ('super_admin', 'owner', 'admin', 'accountant', 'internal_finance')
      )
    )
  )
);

commit;
