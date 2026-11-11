-- Simplify the GM fund-entry forms without removing generic ledger metadata
-- columns that are still used by other Finance transaction types and history.
-- The legacy optional arguments remain in the RPC signatures for compatibility,
-- but new Capital and Capital -> Working entries always use the database date
-- and do not accept user-supplied period, reference, or note values.

begin;

create or replace function public.create_finance_revised_capital_contribution(
  p_organization_id uuid,
  p_amount numeric,
  p_period_label text default null,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(p_organization_id) then
    raise exception 'Only the GM can add Capital Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Capital Funds amount must be greater than zero';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    period_label,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'capital_contribution',
    round(p_amount, 2),
    current_date,
    null,
    'Owner investment',
    null,
    null,
    (select auth.uid())
  )
  returning id into v_id;

  perform private.post_finance_revised_transaction(v_id, (select auth.uid()), 'GM capital contribution');
  return v_id;
end;
$$;

create or replace function public.create_finance_revised_capital_to_working(
  p_organization_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_gm(p_organization_id) then
    raise exception 'Only the GM can transfer Capital Funds to Working Funds';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Working Fund transfer amount must be greater than zero';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'capital_to_working',
    round(p_amount, 2),
    current_date,
    'Capital to Working Funds',
    null,
    null,
    (select auth.uid())
  )
  returning id into v_id;

  perform private.post_finance_revised_transaction(v_id, (select auth.uid()), 'GM Working Fund transfer');
  return v_id;
end;
$$;

commit;
