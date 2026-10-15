-- Run after 218_finance_budget_revision_workflow.sql and before deploying the
-- matching Finance workspace update. Safe to re-run.

begin;

-- Commission allocation payouts represent an actual commission release. They
-- must be recorded as paid so the selected Finance account is deducted and the
-- allocation is synchronized immediately. Ordinary Money Out rows retain their
-- unpaid workflow.
create or replace function private.commission_allocation_payment_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.commission_allocation_id is not null
    and new.payment_status is distinct from 'paid' then
    raise exception 'Commission payouts must be recorded as paid';
  end if;
  return new;
end;
$$;

drop trigger if exists commission_allocation_payment_status_guard
  on public.finance_transactions;
create trigger commission_allocation_payment_status_guard
before insert or update of commission_allocation_id, payment_status
on public.finance_transactions
for each row execute function private.commission_allocation_payment_status_guard();

commit;
