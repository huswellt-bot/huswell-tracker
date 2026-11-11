-- mark_finance_transaction_paid is the controlled External Finance release
-- path for an approved Cash Out. Tell the submission guard that this paid
-- update has already passed the RPC's role, approval, account, and fund checks.
create or replace function public.mark_finance_transaction_paid(
  p_transaction_id uuid,
  p_paid_at timestamptz default now()
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_fund_id uuid;
  v_available numeric(14,2);
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or not private.finance_is_external_or_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  if v_transaction.transaction_type <> 'expense' or v_transaction.approval_status <> 'approved' then
    raise exception 'Only an approved Cash Out can be released';
  end if;
  if v_transaction.account_id is null or not exists (
    select 1 from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Assign an active Finance payment account before releasing this Cash Out';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));
  if v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    v_fund_id := v_transaction.project_fund_id;
    if v_fund_id is null and v_transaction.quotation_id is not null then
      select fund.id into v_fund_id
      from public.project_funds fund
      where fund.organization_id = v_transaction.organization_id
        and fund.quotation_id = v_transaction.quotation_id
      limit 1;
    end if;
    if v_fund_id is not null then
      perform 1
      from public.project_funds fund
      where fund.id = v_fund_id
        and fund.organization_id = v_transaction.organization_id
        and fund.status = 'open'
      for update;
      if not found then
        raise exception 'The Project Fund for this Cash Out is not open';
      end if;
      select summary.available_balance into v_available
      from public.finance_project_fund_summary summary
      where summary.id = v_fund_id;
      if coalesce(v_available, 0) < v_transaction.amount - 0.001 then
        raise exception 'Project Fund does not have enough available money for this Cash Out';
      end if;
    end if;
  end if;

  if private.has_text_role(v_transaction.organization_id, array['external_finance'])
    and v_transaction.supplier_payable_id is null
    and v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    null;
  elsif not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Only External Finance can release this Cash Out';
  end if;

  perform set_config('huswell.allow_foundation_release', 'on', true);
  update public.finance_transactions
  set payment_status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      paid_by = (select auth.uid())
  where id = v_transaction.id;
  perform private.sync_paid_finance_source(v_transaction.id);
  return v_transaction.id;
end;
$$;
