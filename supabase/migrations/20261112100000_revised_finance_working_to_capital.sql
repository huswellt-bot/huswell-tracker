-- Allow the GM to return a chosen, currently available Working Funds amount
-- to Capital Funds. This is a direct audited ledger transfer, not a deletion.

alter table public.finance_revised_transactions
  drop constraint if exists finance_revised_transactions_transaction_kind_check;

alter table public.finance_revised_transactions
  add constraint finance_revised_transactions_transaction_kind_check
  check (transaction_kind in (
    'capital_contribution',
    'capital_to_working',
    'working_to_capital',
    'project_cash_in',
    'project_cash_out',
    'working_fund_support',
    'working_fund_repayment',
    'operating_cash_out',
    'daily_fund_allocation',
    'daily_fund_return',
    'commission_payout',
    'adjustment'
  ));

alter table public.finance_revised_ledger_entries
  drop constraint if exists finance_revised_ledger_entries_entry_type_check;

alter table public.finance_revised_ledger_entries
  add constraint finance_revised_ledger_entries_entry_type_check
  check (entry_type in (
    'capital_contribution',
    'capital_to_working',
    'working_to_capital',
    'project_cash_in',
    'project_cash_out',
    'working_fund_support',
    'working_fund_repayment',
    'operating_cash_out',
    'daily_fund_allocation',
    'daily_fund_return',
    'commission_payout',
    'adjustment'
  ));

create or replace function public.create_finance_revised_working_to_capital(
  p_organization_id uuid,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_actor uuid := (select auth.uid());
  v_amount numeric := round(p_amount, 2);
  v_working_balance numeric;
  v_business_date date := private.finance_revised_business_date();
begin
  if v_actor is null
    or not private.finance_revised_is_gm(p_organization_id) then
    raise exception 'Only the GM can return Working Funds to Capital Funds';
  end if;
  if p_amount is null or p_amount <= 0 or v_amount <= 0 then
    raise exception 'Working Funds return amount must be greater than zero';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));

  v_working_balance := private.finance_revised_balance(p_organization_id, 'working');
  if v_working_balance + 0.001 < v_amount then
    raise exception 'Working Funds balance is not enough for this return';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    status,
    submitted_by,
    approved_by,
    approved_at,
    decision_note
  )
  values (
    p_organization_id,
    'working_to_capital',
    v_amount,
    v_business_date,
    'Working to Capital Funds',
    null,
    null,
    'approved',
    v_actor,
    v_actor,
    now(),
    'GM Working Funds return to Capital Funds'
  )
  returning id into v_id;

  perform private.finance_revised_add_entry(
    p_organization_id,
    v_id,
    'working',
    null,
    'working_to_capital',
    'out',
    v_amount,
    v_business_date,
    null,
    v_actor
  );
  perform private.finance_revised_add_entry(
    p_organization_id,
    v_id,
    'capital',
    null,
    'working_to_capital',
    'in',
    v_amount,
    v_business_date,
    null,
    v_actor
  );

  return v_id;
end;
$$;

revoke all on function public.create_finance_revised_working_to_capital(uuid, numeric) from public, anon;
grant execute on function public.create_finance_revised_working_to_capital(uuid, numeric) to authenticated;
