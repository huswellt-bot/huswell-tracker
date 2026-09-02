-- Allow the Pricing Officer to approve Price Quotations.
--
-- The review RPCs already authorize the 'pricing_officer' role (see 097), but the
-- enforce_role_sensitive_transitions() trigger only let 'is_org_admin' (super_admin,
-- owner, admin) move a quotation into the terminal 'approved' state. The Pricing
-- Officer could run the review RPC but was blocked from finalizing the approval.
--
-- This migration reproduces the current body verbatim (latest definition in
-- 071_price_quotation_illustrations_and_resubmission.sql) and adds a single
-- 'pricing_officer' transition: pending -> approved (Approve). Revision of an
-- approved Price Quotation (approved -> needs_revision) remains the sole
-- responsibility of the preparer Sales Project Officer, so begin_price_quotation_revision
-- is left unchanged.

create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'needs_revision', 'pending'))
    or (
      tg_op = 'UPDATE'
      and new.status is distinct from old.status
      and not (
        new.document_type = 'price_quotation'
        and new.costing_source_id is null
        and (
          (old.status::text = 'pending' and new.status::text = 'draft')
          or (
            old.status::text = 'approved'
            and new.status::text = 'needs_revision'
            and new.created_by = (select auth.uid())
            and private.has_text_role(new.organization_id, array['project_manager'])
          )
          or (
            old.status::text = 'pending'
            and new.status::text = 'approved'
            and private.has_text_role(new.organization_id, array['pricing_officer'])
          )
        )
      )
      and (
        new.status::text not in ('draft', 'needs_revision', 'pending')
        or old.status::text not in ('draft', 'needs_revision')
      )
    )
  ) then
    raise exception 'Only an administrator can approve or finalize a quotation';
  end if;

  if tg_table_name = 'expenses' and (
    (tg_op = 'INSERT' and new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval') or old.status::text not in ('unfulfilled', 'fulfilled')))
  ) then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;
  if tg_table_name = 'invoices' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'issued', 'partial'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'issued', 'partial') or old.status::text not in ('draft', 'issued', 'partial')))
  ) then raise exception 'Only an administrator can set this invoice status directly'; end if;
  if tg_table_name = 'payroll_periods' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'in_review'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'in_review') or old.status::text not in ('draft', 'in_review')))
  ) then raise exception 'Only an administrator can approve or mark payroll paid'; end if;
  if tg_table_name = 'cash_flow_entries' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'pending'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'pending') or old.status::text not in ('draft', 'pending')))
  ) then raise exception 'Only an administrator can approve cash flow'; end if;
  return new;
end;
$$;
