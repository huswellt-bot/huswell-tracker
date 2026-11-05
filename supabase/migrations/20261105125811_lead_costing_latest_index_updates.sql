begin;

alter table public.lead_costing_orders
  add column if not exists resolution_dpi numeric(8,2);

alter table public.lead_costing_orders
  drop constraint if exists lead_costing_orders_measurement_unit_check;

alter table public.lead_costing_orders
  add constraint lead_costing_orders_measurement_unit_check
  check (measurement_unit in ('ft', 'in', 'm', 'px'));

alter table public.lead_costing_orders
  drop constraint if exists lead_costing_orders_resolution_dpi_check;

alter table public.lead_costing_orders
  add constraint lead_costing_orders_resolution_dpi_check
  check (resolution_dpi is null or resolution_dpi > 0);

create or replace function public.create_lead_costing_order_from_index_v2(
  p_organization_id uuid,
  p_customer_id uuid,
  p_service_id uuid,
  p_material_id uuid,
  p_order_date date,
  p_customer_name text,
  p_order_description text,
  p_payment_mode text,
  p_amount_paid numeric,
  p_width numeric,
  p_height numeric,
  p_measurement_unit text,
  p_resolution_dpi numeric,
  p_quantity integer,
  p_media_rate numeric,
  p_print_rate numeric,
  p_waste_allowance_per_project numeric,
  p_lamination_type text,
  p_target_margin numeric,
  p_policy_text text
)
returns public.lead_costing_orders
language plpgsql
security invoker
set search_path = public, private
as $function$
declare
  v_row public.lead_costing_orders%rowtype;
  v_width numeric := p_width;
  v_height numeric := p_height;
  v_unit text := p_measurement_unit;
  v_dpi numeric := nullif(p_resolution_dpi, 0);
  v_margin numeric;
  v_selling_per_item numeric;
  v_total_quotation numeric;
  v_amount_paid numeric;
  v_balance numeric;
  v_payment_status text;
begin
  if p_measurement_unit not in ('ft', 'in', 'm', 'px') then
    raise exception 'Unsupported measurement unit';
  end if;
  if p_measurement_unit = 'px' and (v_dpi is null or v_dpi <= 0) then
    raise exception 'DPI is required for pixel dimensions';
  end if;
  if p_target_margin is null or p_target_margin < 0 or p_target_margin >= 95 then
    raise exception 'Target margin must be between 0 and 95 percent';
  end if;

  -- Reuse the existing server-side costing and stock calculations. Pixel
  -- dimensions are converted to meters for that calculation, then the
  -- original pixel inputs and DPI are restored on the saved order.
  if p_measurement_unit = 'px' then
    v_width := p_width * 0.0254 / v_dpi;
    v_height := p_height * 0.0254 / v_dpi;
    v_unit := 'm';
  end if;

  select * into v_row
  from public.create_lead_costing_order_from_index(
    p_organization_id,
    p_customer_id,
    p_service_id,
    p_material_id,
    p_order_date,
    p_customer_name,
    p_order_description,
    p_payment_mode,
    p_amount_paid,
    v_width,
    v_height,
    v_unit,
    p_quantity,
    p_media_rate,
    p_print_rate,
    p_waste_allowance_per_project,
    p_lamination_type,
    p_policy_text
  );

  v_margin := p_target_margin / 100;
  v_selling_per_item := case
    when v_margin < 1 then v_row.total_production_cost / v_row.quantity / (1 - v_margin)
    else 0
  end;
  v_total_quotation := v_selling_per_item * v_row.quantity;
  v_amount_paid := least(greatest(0, coalesce(p_amount_paid, 0)), v_total_quotation);
  v_balance := greatest(0, v_total_quotation - v_amount_paid);
  v_payment_status := case
    when v_balance <= 0.009 then 'Paid in full'
    when v_amount_paid > 0 then 'Partially paid'
    else 'Unpaid'
  end;

  update public.lead_costing_orders
  set width = p_width,
      height = p_height,
      measurement_unit = p_measurement_unit,
      resolution_dpi = case when p_measurement_unit = 'px' then v_dpi else null end,
      target_margin = p_target_margin,
      selling_price_per_item = v_selling_per_item,
      total_quotation = v_total_quotation,
      estimated_profit = v_total_quotation - total_production_cost,
      amount_paid = v_amount_paid,
      balance_due = v_balance,
      payment_status = v_payment_status,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_lead_costing_order_from_index_v2(
  uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric,
  text, numeric, integer, numeric, numeric, numeric, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_lead_costing_order_from_index_v2(
  uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric,
  text, numeric, integer, numeric, numeric, numeric, text, numeric, text
) to authenticated;

-- The calculator is a direct-cost engine. Selling prices, markup, profit,
-- payment, and customer-facing quotation data belong to public.quotations and
-- the existing GM pricing workflow, not to lead_costing_orders.
revoke all on function public.create_lead_costing_order_from_index_v2(
  uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric,
  text, numeric, integer, numeric, numeric, numeric, text, numeric, text
) from public, anon, authenticated;
drop function if exists public.create_lead_costing_order_from_index_v2(
  uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric,
  text, numeric, integer, numeric, numeric, numeric, text, numeric, text
);

create or replace function public.create_lead_costing_order_from_index_direct(
  p_organization_id uuid,
  p_customer_id uuid,
  p_service_id uuid,
  p_material_id uuid,
  p_order_date date,
  p_customer_name text,
  p_order_description text,
  p_width numeric,
  p_height numeric,
  p_measurement_unit text,
  p_resolution_dpi numeric,
  p_quantity integer,
  p_media_rate numeric,
  p_print_rate numeric,
  p_waste_allowance_per_project numeric,
  p_lamination_type text
)
returns public.lead_costing_orders
language plpgsql
security invoker
set search_path = public, private
as $function$
declare
  v_row public.lead_costing_orders%rowtype;
  v_width numeric := p_width;
  v_height numeric := p_height;
  v_unit text := p_measurement_unit;
  v_dpi numeric := nullif(p_resolution_dpi, 0);
begin
  if p_measurement_unit not in ('ft', 'in', 'm', 'px') then
    raise exception 'Unsupported measurement unit';
  end if;
  if p_measurement_unit = 'px' and (v_dpi is null or v_dpi <= 0) then
    raise exception 'DPI is required for pixel dimensions';
  end if;

  if p_measurement_unit = 'px' then
    v_width := p_width * 0.0254 / v_dpi;
    v_height := p_height * 0.0254 / v_dpi;
    v_unit := 'm';
  end if;

  select * into v_row
  from public.create_lead_costing_order_from_index(
    p_organization_id,
    p_customer_id,
    p_service_id,
    p_material_id,
    p_order_date,
    p_customer_name,
    p_order_description,
    'Not applicable',
    0,
    v_width,
    v_height,
    v_unit,
    p_quantity,
    p_media_rate,
    p_print_rate,
    p_waste_allowance_per_project,
    p_lamination_type,
    null
  );

  update public.lead_costing_orders
  set width = p_width,
      height = p_height,
      measurement_unit = p_measurement_unit,
      resolution_dpi = case when p_measurement_unit = 'px' then v_dpi else null end,
      target_margin = 0,
      selling_price_per_item = 0,
      total_quotation = 0,
      estimated_profit = 0,
      amount_paid = 0,
      balance_due = 0,
      payment_status = 'Unpaid',
      policy_text = null,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_lead_costing_order_from_index_direct(
  uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, text, numeric,
  integer, numeric, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_lead_costing_order_from_index_direct(
  uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, text, numeric,
  integer, numeric, numeric, numeric, text
) to authenticated;

commit;
