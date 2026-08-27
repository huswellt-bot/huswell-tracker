-- Fix enum comparison in the shared role-sensitive trigger.
-- The trigger runs on quotations, expenses, invoices, payroll, and cash flow.
-- Status comparisons must use text so an expense-only value such as
-- `unfulfilled` is never cast to the quotation_status enum.

create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare current_role text;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  select role::text into current_role
  from public.organization_members
  where organization_id = new.organization_id
    and user_id = auth.uid();

  if current_role in ('owner', 'admin') then return new; end if;

  if tg_table_name = 'quotations'
    and (new.status::text not in ('draft', 'needs_revision', 'pending')
      or (tg_op = 'UPDATE' and old.status::text not in ('draft', 'needs_revision')))
  then raise exception 'Only an administrator can approve or finalize a quotation'; end if;

  if tg_table_name = 'expenses'
    and (new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval')
      or (tg_op = 'UPDATE' and old.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval')))
  then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;

  if tg_table_name = 'invoices'
    and (new.status::text not in ('draft', 'issued', 'partial')
      or (tg_op = 'UPDATE' and old.status::text not in ('draft', 'issued', 'partial')))
  then raise exception 'Only an administrator can set this invoice status directly'; end if;

  if tg_table_name = 'payroll_periods'
    and (new.status::text not in ('draft', 'in_review')
      or (tg_op = 'UPDATE' and old.status::text not in ('draft', 'in_review')))
  then raise exception 'Only an administrator can approve or mark payroll paid'; end if;

  if tg_table_name = 'cash_flow_entries'
    and (new.status::text not in ('draft', 'pending')
      or (tg_op = 'UPDATE' and old.status::text not in ('draft', 'pending')))
  then raise exception 'Only an administrator can approve cash flow'; end if;

  return new;
end;
$$;
