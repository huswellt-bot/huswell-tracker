-- Finance Monitoring reads the submitted Pricing Officer direct-cost payload.
-- Keep GM pricing markups, selling price, VAT, commission, and profit outside
-- this report. They are not part of Total Direct Cost.

begin;

create or replace function public.list_finance_revised_costing_breakdown(
  p_organization_id uuid,
  p_project_fund_id uuid
)
returns table (
  line_id uuid,
  quotation_id uuid,
  quotation_item_id uuid,
  product_description text,
  product_quantity numeric,
  description text,
  quantity numeric,
  unit_cost numeric,
  calculation_type text,
  line_total numeric,
  product_total_direct_cost numeric,
  total_direct_cost numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view costing details';
  end if;

  select fund.quotation_id
  into v_quotation_id
  from public.project_funds fund
  where fund.id = p_project_fund_id
    and fund.organization_id = p_organization_id;

  if not found then
    raise exception 'Project fund not found';
  end if;

  return query
  with costing_lines as (
    select
      line.id as line_id,
      v_quotation_id as quotation_id,
      item.id as quotation_item_id,
      item.description as product_description,
      item.quantity as product_quantity,
      item.sort_order as product_sort_order,
      product_costing.id as product_costing_id,
      line.description,
      line.quantity,
      line.unit_cost,
      line.calculation_type,
      line.sort_order as line_sort_order,
      case
        when line.calculation_type = 'fixed_amount'
          then round(line.unit_cost, 2)
        else round(line.quantity * line.unit_cost, 2)
      end as line_total
    from public.price_quotation_product_costings product_costing
    join public.quotation_items item
      on item.id = product_costing.quotation_item_id
      and item.quotation_id = product_costing.quotation_id
    join public.price_quotation_costing_lines line
      on line.product_costing_id = product_costing.id
      and line.organization_id = p_organization_id
    where product_costing.organization_id = p_organization_id
      and product_costing.quotation_id = v_quotation_id
  )
  select
    costing.line_id,
    costing.quotation_id,
    costing.quotation_item_id,
    costing.product_description,
    costing.product_quantity,
    costing.description,
    costing.quantity,
    costing.unit_cost,
    costing.calculation_type,
    costing.line_total,
    round(sum(costing.line_total) over (partition by costing.product_costing_id), 2),
    round(sum(costing.line_total) over (), 2)
  from costing_lines costing
  order by costing.product_sort_order, costing.product_description, costing.line_sort_order, costing.line_id;
end;
$$;

revoke all on function public.list_finance_revised_costing_breakdown(uuid, uuid) from public, anon;
grant execute on function public.list_finance_revised_costing_breakdown(uuid, uuid) to authenticated;

commit;
