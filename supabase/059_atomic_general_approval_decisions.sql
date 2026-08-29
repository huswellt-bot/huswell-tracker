-- Apply general approval decisions and their related record changes in one
-- transaction. Costing Breakdown approvals remain in review_costing_breakdown
-- because they also create or refresh a linked Price Quotation.
-- Run after 058_fix_costing_revision_reopen_order.sql.

create or replace function public.review_approval_request(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.approval_requests%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported approval decision';
  end if;

  select * into v_request
  from public.approval_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending'::public.approval_status then
    raise exception 'This approval request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can decide approval requests';
  end if;

  case v_request.resource_type
    when 'quotation' then
      raise exception 'Review Costing Breakdown submissions through the Costing Review workflow';
    when 'expense' then
      update public.expenses
      set status = p_decision
      where id = v_request.resource_id
        and organization_id = v_request.organization_id;
    when 'cash_flow' then
      update public.cash_flow_entries
      set status = p_decision::public.approval_status,
          approved_by = (select auth.uid()),
          approved_at = now()
      where id = v_request.resource_id
        and organization_id = v_request.organization_id;
    when 'payroll' then
      update public.payroll_periods
      set status = (case when p_decision = 'approved' then 'approved' else 'cancelled' end)::public.payroll_status,
          approved_by = (select auth.uid()),
          approved_at = now()
      where id = v_request.resource_id
        and organization_id = v_request.organization_id;
    when 'invoice_void' then
      if p_decision = 'approved' then
        update public.invoices
        set status = 'void',
            voided_by = (select auth.uid()),
            voided_at = now()
        where id = v_request.resource_id
          and organization_id = v_request.organization_id;
      end if;
    when 'payment_reversal' then
      if p_decision = 'approved' then
        update public.payments
        set reversed_at = now(),
            reversed_by = (select auth.uid())
        where id = v_request.resource_id
          and organization_id = v_request.organization_id;
      end if;
    when 'inventory_adjustment' then
      -- Inventory adjustments are already applied as movements. This request
      -- records the General Manager's decision without repeating the movement.
      null;
    else
      raise exception 'Unsupported approval request type';
  end case;

  if v_request.resource_type not in ('inventory_adjustment', 'invoice_void', 'payment_reversal')
    or p_decision = 'approved' then
    if not found then
      raise exception 'The record for this approval request was not found';
    end if;
  end if;

  update public.approval_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.review_approval_request(uuid, text) from public;
grant execute on function public.review_approval_request(uuid, text) to authenticated;
