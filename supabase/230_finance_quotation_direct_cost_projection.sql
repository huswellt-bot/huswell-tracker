-- Expose aggregate direct-cost totals to authorized internal Finance roles.
-- Run after 229_fix_quotation_payment_reviewer_rls.sql and before the matching
-- Finance workspace update.

begin;

create or replace function public.finance_quotation_direct_cost_rows(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  total_direct_cost numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ]) then
    raise exception 'Only internal Finance can read quotation direct costs';
  end if;

  return query
  select
    quotation.id,
    round(coalesce(sum(
      case
        when costing_line.calculation_type = 'fixed_amount'
          then round(costing_line.unit_cost, 2)
        else round(costing_line.quantity * costing_line.unit_cost, 2)
      end
    ), 0), 2)
  from public.quotations quotation
  left join public.price_quotation_product_costings product_costing
    on product_costing.quotation_id = quotation.id
  left join public.price_quotation_costing_lines costing_line
    on costing_line.product_costing_id = product_costing.id
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved'
  group by quotation.id;
end;
$$;

revoke all on function public.finance_quotation_direct_cost_rows(uuid)
  from public, anon;
grant execute on function public.finance_quotation_direct_cost_rows(uuid)
  to authenticated;

commit;
