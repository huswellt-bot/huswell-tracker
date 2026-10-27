-- Harden the public RPC surface without changing authenticated application access.
-- SECURITY DEFINER routines remain available to the authenticated and service_role
-- roles, while anonymous clients no longer inherit EXECUTE through PUBLIC.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', routine.signature);
    execute format('grant execute on function %s to authenticated, service_role', routine.signature);
  end loop;
end
$$;

-- Pin search paths for routines identified by the Supabase advisor. Every object
-- referenced by these routines is schema-qualified or provided by pg_catalog.
alter function public.set_updated_at()
  set search_path = pg_catalog, private, public;
alter function public.apply_inventory_movement()
  set search_path = pg_catalog, private, public;
alter function public.recalculate_invoice_totals()
  set search_path = pg_catalog, private, public;
alter function public.set_approval_updated_at()
  set search_path = pg_catalog, private, public;
alter function public.queue_cash_flow_approval()
  set search_path = pg_catalog, private, public;
alter function public.recalculate_quotation_totals()
  set search_path = pg_catalog, private, public;
alter function private.is_valid_assigned_box_makers(text[])
  set search_path = pg_catalog, private, public;
alter function private.effective_assigned_box_makers(text[], text)
  set search_path = pg_catalog, private, public;
alter function private.same_assigned_box_maker_set(text[], text[])
  set search_path = pg_catalog, private, public;
alter function private.canonical_pricing_markup_key(text)
  set search_path = pg_catalog, private, public;
alter function private.default_print_costing_defaults()
  set search_path = pg_catalog, private, public;
alter function private.preserve_lead_endorsement_history()
  set search_path = pg_catalog, private, public;

-- Keep the budget summary available to budget viewers without making the public
-- view itself SECURITY DEFINER. The private helper performs the same explicit
-- organization-level authorization while the exposed view runs as its caller.
create or replace function private.finance_account_budget_summary_rows()
returns table (
  organization_id uuid,
  id uuid,
  period_id uuid,
  period_start date,
  period_end date,
  period_status text,
  account_id uuid,
  account_name text,
  is_active boolean,
  allocated_amount numeric(14,2),
  returned_amount numeric(14,2),
  used_amount numeric,
  committed_amount numeric,
  available_amount numeric
)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select
    allocation.organization_id,
    allocation.id,
    allocation.period_id,
    period.period_start,
    period.period_end,
    period.status::text,
    allocation.account_id,
    account.account_name,
    account.is_active,
    allocation.allocated_amount,
    allocation.returned_amount,
    round(coalesce(sum(
      case
        when transaction.id is not null
          and not transaction.is_voided
          and transaction.transaction_type = 'expense'
          and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          and transaction.payment_status = 'paid'
          and transaction.approval_status = 'approved'
        then transaction.amount
        else 0
      end
    ), 0), 2),
    round(coalesce(sum(
      case
        when transaction.id is not null
          and not transaction.is_voided
          and transaction.transaction_type = 'expense'
          and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          and not (transaction.payment_status = 'paid' and transaction.approval_status = 'approved')
        then transaction.amount
        else 0
      end
    ), 0), 2),
    round(greatest(
      allocation.allocated_amount - coalesce(sum(
        case
          when transaction.id is not null
            and not transaction.is_voided
            and transaction.transaction_type = 'expense'
            and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
          then transaction.amount
          else 0
        end
      ), 0),
      0
    ), 2)
  from public.finance_account_budget_allocations as allocation
  join public.finance_budget_periods as period on period.id = allocation.period_id
  join public.finance_accounts as account on account.id = allocation.account_id
  left join public.finance_transactions as transaction
    on transaction.account_budget_allocation_id = allocation.id
  where private.finance_is_budget_viewer(allocation.organization_id)
  group by
    allocation.organization_id,
    allocation.id,
    allocation.period_id,
    period.period_start,
    period.period_end,
    period.status,
    allocation.account_id,
    account.account_name,
    account.is_active,
    allocation.allocated_amount,
    allocation.returned_amount;
$$;

revoke all on function private.finance_account_budget_summary_rows() from public;
grant execute on function private.finance_account_budget_summary_rows() to authenticated, service_role;

create or replace view public.finance_account_budget_summary
with (security_invoker = true)
as
select
  organization_id,
  id,
  period_id,
  period_start,
  period_end,
  period_status,
  account_id,
  account_name,
  is_active,
  allocated_amount::numeric(14,2) as allocated_amount,
  returned_amount::numeric(14,2) as returned_amount,
  used_amount,
  committed_amount,
  available_amount
from private.finance_account_budget_summary_rows();

revoke all on table public.finance_account_budget_summary from public, anon;
grant select on table public.finance_account_budget_summary to authenticated, service_role;
