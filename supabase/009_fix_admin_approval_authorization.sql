-- Use the same organization-admin check for approval triggers and RLS.
-- This prevents the approval trigger from disagreeing with the authenticated
-- admin/owner role that the application has already verified.

create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- Allow updates made by controlled workflow triggers.
  if pg_trigger_depth() > 1 then return new; end if;

  -- owner and admin roles may make final decisions.
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

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
