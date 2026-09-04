-- Restores the shared financial-status guard overwritten by 106, while adding
-- the Pricing Officer -> General Manager quotation paths.
begin;
create or replace function public.enforce_role_sensitive_transitions()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' then
    if tg_op = 'INSERT' and new.status::text not in ('draft','needs_revision','pending') then
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.document_type = 'price_quotation' and new.costing_source_id is null and (
        (old.status::text='draft' and new.status::text='pending' and new.created_by=(select auth.uid()) and private.has_text_role(new.organization_id,array['project_manager'])) or
        (old.status::text='needs_revision' and new.status::text='pending' and new.created_by=(select auth.uid()) and private.has_text_role(new.organization_id,array['project_manager'])) or
        (old.status::text='pending' and new.status::text='draft' and (new.created_by=(select auth.uid()) or new.prepared_by_user_id=(select auth.uid())) and private.has_text_role(new.organization_id,array['project_manager'])) or
        (old.status::text='pending' and new.status::text='needs_revision' and private.has_text_role(new.organization_id,array['pricing_officer'])) or
        (old.status::text='pending' and new.status::text='pending_gm_approval' and private.has_text_role(new.organization_id,array['pricing_officer'])) or
        (old.status::text='approved' and new.status::text='needs_revision' and new.created_by=(select auth.uid()) and private.has_text_role(new.organization_id,array['project_manager']))
      ) then return new; end if;
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;
  end if;

  if tg_table_name='expenses' and ((tg_op='INSERT' and new.status::text not in ('unfulfilled','fulfilled','pending_approval')) or (tg_op='UPDATE' and new.status is distinct from old.status and (new.status::text not in ('unfulfilled','fulfilled','pending_approval') or old.status::text not in ('unfulfilled','fulfilled')))) then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;
  if tg_table_name='invoices' and ((tg_op='INSERT' and new.status::text not in ('draft','issued','partial')) or (tg_op='UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft','issued','partial') or old.status::text not in ('draft','issued','partial')))) then raise exception 'Only an administrator can set this invoice status directly'; end if;
  if tg_table_name='payroll_periods' and ((tg_op='INSERT' and new.status::text not in ('draft','in_review')) or (tg_op='UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft','in_review') or old.status::text not in ('draft','in_review')))) then raise exception 'Only an administrator can approve or mark payroll paid'; end if;
  if tg_table_name='cash_flow_entries' and ((tg_op='INSERT' and new.status::text not in ('draft','pending')) or (tg_op='UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft','pending') or old.status::text not in ('draft','pending')))) then raise exception 'Only an administrator can approve cash flow'; end if;
  return new;
end; $$;
commit;
