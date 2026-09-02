-- Allow the Pricing Officer to approve and revise Price Quotations.
--
-- The review RPCs already authorize the 'pricing_officer' role (see 097), but two
-- PL/pgSQL guards still blocked the role's final status transitions:
--
--   1. enforce_role_sensitive_transitions() only let 'is_org_admin' (super_admin,
--      owner, admin) move a quotation into the terminal 'approved' state, and only
--      let the preparer Project Manager move it back via 'approved' ->
--      'needs_revision'. The Pricing Officer could not approve (pending -> approved)
--      nor revise an already-approved Price Quotation.
--
--   2. begin_price_quotation_revision() restricted revision to the Project Manager
--      who prepared the quotation.
--
-- This migration reproduces the current bodies verbatim (their latest definitions
-- live in 071_price_quotation_illustrations_and_resubmission.sql) and adds the
-- 'pricing_officer' enablements. All other behavior is unchanged.

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
            old.status::text = 'approved'
            and new.status::text = 'needs_revision'
            and private.has_text_role(new.organization_id, array['pricing_officer'])
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

create or replace function public.begin_price_quotation_revision(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved Price Quotation can be revised';
  end if;
  if not (
    private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or (
      private.has_text_role(v_quote.organization_id, array['project_manager'])
      and (v_quote.created_by is distinct from (select auth.uid())
        and v_quote.prepared_by_user_id is distinct from (select auth.uid()))
    )
  ) then
    raise exception 'Only the Project Officer who prepared this Price Quotation can revise it';
  end if;

  update public.quotations
  set status = 'needs_revision',
      revision_note = 'Revision in progress. Update the Price Quotation and submit it for General Manager review.',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now()
  where id = v_quote.id;
end;
$$;
