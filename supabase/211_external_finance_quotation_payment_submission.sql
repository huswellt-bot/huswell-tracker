-- Move quotation payment receipt submission to External Finance.
-- Run after 210_finance_account_directory_crud.sql and before the matching
-- application update. Safe to re-run.

begin;

-- External Finance records the client's receipt for an approved direct Price
-- Quotation. This remains separate from Internal Finance verification.
create or replace function private.can_submit_quotation_payment(
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
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'approved'
      and private.has_text_role(quote.organization_id, array['external_finance'])
  );
$$;

-- The payment form exposes only active accounts maintained by Internal
-- Finance. Account identifiers and balances remain hidden from the client.
create or replace function public.list_quotation_payment_accounts(
  p_organization_id uuid
)
returns table (
  id uuid,
  account_name text,
  account_type text,
  payment_method public.payment_method
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array[
      'super_admin',
      'owner',
      'admin',
      'accountant',
      'internal_finance',
      'external_finance'
    ]) then
    raise exception 'You are not authorized to view quotation receiving accounts';
  end if;

  return query
  select
    account.id,
    account.account_name,
    account.account_type,
    account.payment_method
  from public.finance_accounts account
  where account.organization_id = p_organization_id
    and account.is_active
  order by account.account_name, account.id;
end;
$$;

revoke all on function public.list_quotation_payment_accounts(uuid) from public;
grant execute on function public.list_quotation_payment_accounts(uuid) to authenticated;

-- The legacy registration signature has no receiving-account parameter and
-- still accepts partial_payment. Disable it so callers cannot bypass the
-- account-aware submission flow and the fixed 50/50 payment terms.
revoke all on function public.register_quotation_payment(
  uuid, uuid, text, numeric, date, public.payment_method,
  text, text, text, text, text, bigint
) from public, authenticated;

commit;
