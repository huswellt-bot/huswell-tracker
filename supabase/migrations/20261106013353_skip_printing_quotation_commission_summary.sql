-- Printing quotations use GM markups but are prepared by the Lead & Costing
-- Coordinator. They do not enter the standard Sales & Pricing commission
-- summary workflow.
create or replace function private.create_commission_summary_on_quotation_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status::text = 'approved'
    and new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and coalesce(new.quotation_source, 'standard') <> 'lead_costing_printing' then
    if tg_op = 'INSERT' then
      perform private.ensure_commission_summary_from_approved_quotation(new.id, 0);
    elsif tg_op = 'UPDATE' and old.status::text is distinct from 'approved' then
      perform private.ensure_commission_summary_from_approved_quotation(new.id, 0);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.create_commission_summary_on_quotation_approval() from public;
