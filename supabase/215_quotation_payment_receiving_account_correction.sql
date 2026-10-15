-- Allow Internal Finance to correct the receiving account on a pending
-- quotation payment before it is verified and posted to Money In.
-- The exact selected account remains authoritative; legacy default-account
-- fallback behavior is preserved for older account-less receipts.
-- Run after 214_backfill_quotation_commission_divisions.sql and before the
-- matching payment-monitoring workspace update. Do not execute from the app.

begin;

create or replace function public.update_pending_quotation_payment_account(
  p_payment_id uuid,
  p_finance_account_id uuid
)
returns public.quotation_payment_records
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payment public.quotation_payment_records%rowtype;
  v_quote public.quotations%rowtype;
  v_previous_account public.finance_accounts%rowtype;
  v_selected_account public.finance_accounts%rowtype;
  v_previous_method public.payment_method;
begin
  select * into v_payment
  from public.quotation_payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Quotation payment was not found';
  end if;
  v_previous_method := v_payment.method;
  if not private.has_text_role(v_payment.organization_id, array[
    'accountant', 'internal_finance'
  ]) then
    raise exception 'Only Internal Finance can change the receiving account';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'Only pending quotation payments can change receiving accounts';
  end if;
  if p_finance_account_id is null then
    raise exception 'Choose the Finance account that received the client payment';
  end if;

  select * into v_quote
  from public.quotations quote
  where quote.id = v_payment.quotation_id
    and quote.organization_id = v_payment.organization_id
  for share;

  if not found then
    raise exception 'The quotation linked to this payment was not found';
  end if;

  if v_payment.finance_account_id is not null then
    select * into v_previous_account
    from public.finance_accounts account
    where account.id = v_payment.finance_account_id
      and account.organization_id = v_payment.organization_id;
  end if;

  select * into v_selected_account
  from public.finance_accounts account
  where account.id = p_finance_account_id
    and account.organization_id = v_payment.organization_id
    and account.is_active
  for share;

  if not found then
    raise exception 'Choose an active Finance account';
  end if;

  if v_payment.payment_kind = 'full_payment'
    and coalesce(v_quote.payment_terms_option, 'completion_50_50') = 'pdc_50_50'
    and v_selected_account.payment_method is distinct from 'check'::public.payment_method then
    raise exception 'The remaining balance for this term must be recorded through a check (PDC) account';
  end if;

  if v_payment.finance_account_id is not distinct from v_selected_account.id
    and v_payment.method is not distinct from v_selected_account.payment_method then
    return v_payment;
  end if;

  update public.quotation_payment_records
  set finance_account_id = v_selected_account.id,
      method = v_selected_account.payment_method
  where id = v_payment.id
  returning * into v_payment;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  )
  values (
    v_payment.organization_id,
    (select auth.uid()),
    'quotation_payment',
    v_payment.id,
    'receiving_account_changed',
    jsonb_build_object(
      'quotation_id', v_payment.quotation_id,
      'finance_account_id', v_previous_account.id,
      'account_name', v_previous_account.account_name,
      'payment_method', v_previous_method::text
    ),
    jsonb_build_object(
      'quotation_id', v_payment.quotation_id,
      'finance_account_id', v_selected_account.id,
      'account_name', v_selected_account.account_name,
      'payment_method', v_selected_account.payment_method::text
    ),
    'Internal Finance corrected the receiving account before payment verification.'
  );

  return v_payment;
end;
$$;

revoke all on function public.update_pending_quotation_payment_account(uuid, uuid) from public;
grant execute on function public.update_pending_quotation_payment_account(uuid, uuid) to authenticated;

commit;
