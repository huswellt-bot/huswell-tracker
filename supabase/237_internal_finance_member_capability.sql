-- Add Internal Finance access without changing a Sales & Pricing Officer's
-- primary membership role. This preserves existing quotation, lead, and
-- commission ownership checks while allowing a specific account to receive
-- the Finance workspace and server-side Finance permissions.
-- Run after 236_finance_category_and_account_type_removal.sql.

begin;

create table if not exists public.organization_member_capabilities (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('internal_finance')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, capability),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id)
    on delete cascade
);

create index if not exists organization_member_capabilities_user_idx
  on public.organization_member_capabilities(user_id, organization_id);

alter table public.organization_member_capabilities enable row level security;
revoke all on public.organization_member_capabilities from anon, authenticated;
grant select on public.organization_member_capabilities to authenticated;

drop policy if exists "member capabilities: self or admin read"
  on public.organization_member_capabilities;
create policy "member capabilities: self or admin read"
on public.organization_member_capabilities for select to authenticated
using (
  user_id = (select auth.uid())
  or private.is_org_admin(organization_id)
);

create or replace function private.has_member_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_member_capabilities capability
    where capability.organization_id = p_organization_id
      and capability.user_id = (select auth.uid())
      and capability.capability = p_capability
  );
$$;

revoke all on function private.has_member_capability(uuid, text)
from public, anon, authenticated;
grant execute on function private.has_member_capability(uuid, text)
to authenticated;

create or replace function private.finance_is_internal(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array['internal_finance'])
    or private.has_member_capability(p_organization_id, 'internal_finance');
$$;

create or replace function private.finance_is_external_or_internal(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array['external_finance'])
    or private.finance_is_internal(p_organization_id);
$$;

create or replace function private.finance_is_budget_operator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.finance_is_internal(p_organization_id);
$$;

create or replace function private.finance_is_budget_viewer(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin'
  ])
    or private.finance_is_internal(p_organization_id);
$$;

revoke all on function private.finance_is_internal(uuid),
  private.finance_is_external_or_internal(uuid),
  private.finance_is_budget_operator(uuid),
  private.finance_is_budget_viewer(uuid)
from public, anon, authenticated;
grant execute on function private.finance_is_internal(uuid),
  private.finance_is_external_or_internal(uuid),
  private.finance_is_budget_operator(uuid),
  private.finance_is_budget_viewer(uuid)
to authenticated;

-- Dianne keeps the existing Sales & Pricing Officer membership role. This
-- grants the additional Finance capability without creating another account
-- or changing ownership of her existing records.
insert into public.organization_member_capabilities
  (organization_id, user_id, capability, granted_by)
select member.organization_id, member.user_id, 'internal_finance', null
from auth.users account
join public.organization_members member
  on member.user_id = account.id
where lower(account.email) = lower('dianne@huswelloffice.com')
  and member.role::text = 'sales_pricing_officer'
on conflict (organization_id, user_id, capability) do nothing;

-- The core Finance policies use the helper functions above. These storage
-- upload paths were the remaining direct role checks in migration 233.
drop policy if exists "finance receipts: finance upload" on storage.objects;
create policy "finance receipts: finance upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/transactions/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1
        from public.finance_transactions transaction
        where transaction.organization_id::text = split_part(storage.objects.name, '/', 1)
          and private.finance_is_external_or_internal(transaction.organization_id)
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/accounts/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1
        from public.finance_accounts account
        where account.organization_id::text = split_part(storage.objects.name, '/', 1)
          and private.finance_is_internal(account.organization_id)
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/account-funding/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1
        from public.finance_account_funding_entries funding
        where funding.organization_id::text = split_part(storage.objects.name, '/', 1)
          and private.finance_is_internal(funding.organization_id)
      )
    )
  )
);

commit;
