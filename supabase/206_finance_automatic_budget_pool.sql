-- Make the approved budget pool the automatic source for External Finance
-- Money Out submissions. The request rows remain separate for audit history,
-- while each new expense is assigned to an approved request with capacity.
-- Run after 205_finance_account_funding_and_cash_guard.sql and before the
-- matching Finance workspace update. Safe to re-run.

begin;

create or replace function private.finance_allocate_external_budget(
  p_organization_id uuid,
  p_amount numeric,
  p_exclude_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_budget public.finance_budget_requests%rowtype;
  v_committed numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The Money Out amount must be greater than zero';
  end if;

  if not private.has_text_role(p_organization_id, array['external_finance'])
    or private.finance_is_internal(p_organization_id) then
    raise exception 'Only External Finance can use the operating budget pool';
  end if;

  -- Lock approved requests in a stable order. This makes the available budget
  -- calculation safe when two External Finance submissions arrive together.
  for v_budget in
    select request.*
    from public.finance_budget_requests request
    where request.organization_id = p_organization_id
      and request.status = 'approved'
      and request.requested_by = (select auth.uid())
    order by request.requested_at, request.id
    for update
  loop
    select coalesce(sum(transaction.amount), 0)
    into v_committed
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.budget_request_id = v_budget.id
      and transaction.id is distinct from p_exclude_transaction_id
      and transaction.transaction_type = 'expense'
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'cancelled');

    if round(v_committed + round(p_amount, 2), 2) <= round(v_budget.amount, 2) then
      return v_budget.id;
    end if;
  end loop;

  raise exception 'No approved budget has enough remaining capacity. Request a new budget before submitting Money Out';
end;
$$;

revoke all on function private.finance_allocate_external_budget(uuid, numeric, uuid) from public, authenticated;

-- The existing trigger remains the authoritative assignment point so the
-- original transaction RPC and the older compatibility RPC cannot bypass the
-- automatic budget rule. Internal commission payouts remain outside it.
create or replace function private.finance_budget_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_budget public.finance_budget_requests%rowtype;
  v_committed numeric;
  v_amount numeric;
  v_external boolean;
begin
  v_external := private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id);

  if v_external and new.transaction_type = 'expense' then
    if tg_op = 'INSERT' then
      -- Ignore any client-supplied selector. The database chooses the first
      -- approved request with enough capacity from the user's budget pool.
      new.budget_request_id := private.finance_allocate_external_budget(
        new.organization_id,
        new.amount,
        null
      );
    elsif old.budget_request_id is null then
      new.budget_request_id := private.finance_allocate_external_budget(
        new.organization_id,
        new.amount,
        new.id
      );
    else
      -- Once assigned, an External Finance expense cannot be moved to another
      -- request or detached from the approved budget pool.
      new.budget_request_id := old.budget_request_id;
    end if;
  end if;

  if new.budget_request_id is null then
    return new;
  end if;
  if new.transaction_type <> 'expense' then
    raise exception 'Only Money Out can be linked to a budget request';
  end if;

  select * into v_budget
  from public.finance_budget_requests request
  where request.id = new.budget_request_id
  for update;

  if not found or v_budget.organization_id is distinct from new.organization_id then
    raise exception 'The selected budget request does not belong to this workspace';
  end if;
  if v_budget.status <> 'approved' then
    raise exception 'Only an approved budget request can be used for Money Out';
  end if;
  if v_external and v_budget.requested_by is distinct from (select auth.uid()) then
    raise exception 'External Finance can use only its own approved budget requests';
  end if;

  select coalesce(sum(transaction.amount), 0)
  into v_committed
  from public.finance_transactions transaction
  where transaction.organization_id = new.organization_id
    and transaction.budget_request_id = new.budget_request_id
    and transaction.id is distinct from new.id
    and transaction.transaction_type = 'expense'
    and not transaction.is_voided
    and transaction.approval_status not in ('rejected', 'cancelled');

  v_amount := case when coalesce(new.is_voided, false) then 0 else new.amount end;
  if round(v_committed + coalesce(v_amount, 0), 2) > round(v_budget.amount, 2) then
    raise exception 'This expense exceeds the remaining approved budget of %',
      round(greatest(v_budget.amount - v_committed, 0), 2);
  end if;
  return new;
end;
$$;

commit;
