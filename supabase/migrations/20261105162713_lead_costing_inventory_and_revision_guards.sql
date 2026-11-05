begin;

-- Printing quotation revisions belong back with the Lead Coordinator who
-- prepared the quotation. Keep the existing targets for standard quotations.
alter table public.quotations
  drop constraint if exists quotations_revision_requested_to_check;

alter table public.quotations
  add constraint quotations_revision_requested_to_check
  check (
    revision_requested_to is null
    or revision_requested_to in ('project_officer', 'pricing_officer', 'lead_coordinator')
  );

create or replace function private.route_lead_costing_printing_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $function$
begin
  if new.quotation_source = 'lead_costing_printing'
     and old.status::text = 'pending_gm_approval'
     and new.status::text = 'needs_revision' then
    new.revision_requested_to := 'lead_coordinator';
  end if;
  return new;
end;
$function$;

drop trigger if exists lead_costing_printing_revision_target on public.quotations;
create trigger lead_costing_printing_revision_target
before update of status on public.quotations
for each row
execute function private.route_lead_costing_printing_revision();

-- The calculator's inventory panel must be authoritative at submission time.
-- This helper is deliberately separate from the direct-cost validator so the
-- existing cost formula remains unchanged while the stock guard is reusable
-- by the quotation status trigger.
create or replace function private.validate_lead_costing_printing_inventory(
  p_organization_id uuid,
  p_metadata jsonb,
  p_quantity numeric
)
returns void
language plpgsql
stable
security definer
set search_path = public, private
as $function$
declare
  v_material_id uuid;
  v_material public.lead_costing_materials%rowtype;
  v_inventory public.lead_costing_inventory%rowtype;
  v_width numeric;
  v_height numeric;
  v_dpi numeric;
  v_factor numeric;
  v_width_m numeric;
  v_height_m numeric;
  v_roll_width numeric;
  v_roll_length numeric;
  v_best_length numeric := null;
  v_best_sheets numeric := null;
  v_available_meters numeric;
  v_required_length numeric;
  v_across numeric;
  v_rows numeric;
  v_orientation record;
  v_manual_stock_confirmed boolean;
begin
  if coalesce(jsonb_typeof(p_metadata), '') <> 'object' then
    raise exception 'Each printing line must include calculator data';
  end if;

  begin
    v_material_id := nullif(btrim(p_metadata ->> 'materialId'), '')::uuid;
    v_width := nullif(btrim(p_metadata ->> 'width'), '')::numeric;
    v_height := nullif(btrim(p_metadata ->> 'height'), '')::numeric;
    v_dpi := nullif(btrim(p_metadata ->> 'dpi'), '')::numeric;
    v_manual_stock_confirmed := coalesce(
      nullif(btrim(p_metadata ->> 'manual_stock_confirmed'), '')::boolean,
      nullif(btrim(p_metadata ->> 'manualStockConfirmed'), '')::boolean,
      false
    );
  exception when others then
    raise exception 'Printing line has invalid inventory input values';
  end;

  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity)
     or v_material_id is null or v_width is null or v_height is null
     or v_width <= 0 or v_height <= 0 then
    raise exception 'Printing line needs a material, positive dimensions, and a whole-number quantity';
  end if;

  if coalesce(p_metadata ->> 'unit', '') not in ('ft', 'in', 'm', 'px') then
    raise exception 'Printing line has an unsupported measurement unit';
  end if;
  if p_metadata ->> 'unit' = 'px' and (v_dpi is null or v_dpi <= 0) then
    raise exception 'DPI is required for pixel dimensions';
  end if;

  select * into v_material
  from public.lead_costing_materials
  where id = v_material_id
    and organization_id = p_organization_id
    and is_active
    and not coalesce(is_finishing, false);
  if not found then
    raise exception 'Select an active printable material before submitting';
  end if;

  select * into v_inventory
  from public.lead_costing_inventory
  where organization_id = p_organization_id
    and material_id = v_material_id;
  if not found then
    raise exception 'Enter inventory for the selected material before submitting';
  end if;

  v_roll_width := v_material.roll_width_m;
  v_roll_length := v_material.roll_length_m;

  if coalesce(v_material.is_sheet, false)
     and (v_roll_width is null or v_roll_length is null) then
    if v_inventory.available_sheets is null or v_inventory.available_sheets <= 0 then
      raise exception 'No sheet stock is available for the selected material';
    end if;
    if not v_manual_stock_confirmed then
      raise exception 'Confirm the available sheet stock manually';
    end if;
    return;
  end if;

  if v_roll_width is null or v_roll_length is null then
    raise exception 'Selected material has no configured stock dimensions';
  end if;

  v_factor := case p_metadata ->> 'unit'
    when 'ft' then 0.3048
    when 'in' then 0.0254
    when 'px' then 0.0254 / v_dpi
    else 1
  end;
  v_width_m := v_width * v_factor;
  v_height_m := v_height * v_factor;

  for v_orientation in
    select *
    from (values (v_width_m, v_height_m), (v_height_m, v_width_m)) as orientations(across_width, along_length)
  loop
    v_across := floor((v_roll_width + 0.000000001) / v_orientation.across_width);
    if v_across >= 1 then
      v_rows := ceil(p_quantity / v_across);
      if v_rows * v_orientation.along_length <= v_roll_length + 0.000000001 then
        if v_best_length is null or v_rows * v_orientation.along_length < v_best_length then
          v_best_length := v_rows * v_orientation.along_length;
        end if;
        if v_best_sheets is null or v_rows < v_best_sheets then
          v_best_sheets := v_rows;
        end if;
      end if;
    end if;
  end loop;

  if coalesce(v_material.is_sheet, false) then
    if v_best_sheets is null then
      raise exception 'Printing line does not fit the selected sheet dimensions';
    end if;
    if v_inventory.available_sheets is null then
      raise exception 'Enter available sheets for the selected material before submitting';
    end if;
    if v_inventory.available_sheets + 0.0001 < v_best_sheets then
      raise exception 'Insufficient sheet inventory: % sheet(s) required, % available', v_best_sheets, v_inventory.available_sheets;
    end if;
    return;
  end if;

  if v_inventory.full_rolls_on_hand is null and v_inventory.remaining_meters is null then
    raise exception 'Enter full rolls or remaining meters for the selected material before submitting';
  end if;
  if v_best_length is null then
    raise exception 'Printing line does not fit the selected roll dimensions';
  end if;

  v_required_length := v_best_length * 1.1;
  v_available_meters := coalesce(v_inventory.full_rolls_on_hand, 0) * v_roll_length
    + coalesce(v_inventory.remaining_meters, 0);
  if v_available_meters + 0.0001 < v_required_length then
    raise exception 'Insufficient roll inventory: % m required, % m available', round(v_required_length, 2), round(v_available_meters, 2);
  end if;
end;
$function$;

revoke all on function private.validate_lead_costing_printing_inventory(uuid, jsonb, numeric) from public, anon, authenticated;

create or replace function private.enforce_lead_costing_printing_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_item record;
begin
  if new.quotation_source = 'lead_costing_printing'
     and old.status::text in ('draft', 'needs_revision')
     and new.status::text = 'pending_gm_approval' then
    if not exists (select 1 from public.quotation_items where quotation_id = new.id) then
      raise exception 'Add at least one printing line before submitting';
    end if;
    for v_item in
      select quantity, costing_metadata
      from public.quotation_items
      where quotation_id = new.id
      order by sort_order, created_at
    loop
      perform private.validate_lead_costing_printing_inventory(new.organization_id, v_item.costing_metadata, v_item.quantity);
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists lead_costing_printing_inventory_guard on public.quotations;
create trigger lead_costing_printing_inventory_guard
before update of status on public.quotations
for each row
execute function private.enforce_lead_costing_printing_inventory();

revoke all on function private.enforce_lead_costing_printing_inventory() from public, anon, authenticated;

-- Direct costing must not persist a job that cannot fit the configured stock.
-- Inventory availability remains a quotation-submission requirement; this
-- helper only enforces the physical layout for the standalone calculator.
create or replace function private.validate_lead_costing_direct_layout(
  p_organization_id uuid,
  p_material_id uuid,
  p_width numeric,
  p_height numeric,
  p_measurement_unit text,
  p_resolution_dpi numeric,
  p_quantity integer
)
returns void
language plpgsql
stable
security definer
set search_path = public, private
as $function$
declare
  v_material public.lead_costing_materials%rowtype;
  v_factor numeric;
  v_width_m numeric;
  v_height_m numeric;
  v_best_length numeric := null;
  v_across numeric;
  v_rows numeric;
  v_orientation record;
begin
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0
     or p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
    raise exception 'Dimensions and quantity must be positive whole-number inputs';
  end if;
  if p_measurement_unit not in ('ft', 'in', 'm', 'px') then
    raise exception 'Unsupported measurement unit';
  end if;
  if p_measurement_unit = 'px' and (p_resolution_dpi is null or p_resolution_dpi <= 0) then
    raise exception 'DPI is required for pixel dimensions';
  end if;

  select * into v_material
  from public.lead_costing_materials
  where id = p_material_id
    and organization_id = p_organization_id
    and is_active
    and not coalesce(is_finishing, false);
  if not found then
    raise exception 'Select an active printable material before saving the direct costing';
  end if;
  if v_material.roll_width_m is null or v_material.roll_length_m is null then
    raise exception 'Selected material has no configured stock dimensions';
  end if;

  v_factor := case p_measurement_unit
    when 'ft' then 0.3048
    when 'in' then 0.0254
    when 'px' then 0.0254 / p_resolution_dpi
    else 1
  end;
  v_width_m := p_width * v_factor;
  v_height_m := p_height * v_factor;

  for v_orientation in
    select *
    from (values (v_width_m, v_height_m), (v_height_m, v_width_m)) as orientations(across_width, along_length)
  loop
    v_across := floor((v_material.roll_width_m + 0.000000001) / v_orientation.across_width);
    if v_across >= 1 then
      v_rows := ceil(p_quantity::numeric / v_across);
      if v_rows * v_orientation.along_length <= v_material.roll_length_m + 0.000000001
         and (v_best_length is null or v_rows * v_orientation.along_length < v_best_length) then
        v_best_length := v_rows * v_orientation.along_length;
      end if;
    end if;
  end loop;

  if v_best_length is null then
    raise exception 'Direct-cost job does not fit the selected stock dimensions';
  end if;
end;
$function$;

revoke all on function private.validate_lead_costing_direct_layout(uuid, uuid, numeric, numeric, text, numeric, integer) from public, anon, authenticated;

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
security definer
set search_path = public, private
as $function$
declare
  v_row public.lead_costing_orders%rowtype;
  v_width numeric := p_width;
  v_height numeric := p_height;
  v_unit text := p_measurement_unit;
  v_dpi numeric := nullif(p_resolution_dpi, 0);
begin
  if not private.lead_costing_is_operator(p_organization_id) then
    raise exception 'Only a Lead & Costing Coordinator can create costing orders';
  end if;
  if p_measurement_unit not in ('ft', 'in', 'm', 'px') then
    raise exception 'Unsupported measurement unit';
  end if;
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0
     or p_quantity is null or p_quantity <= 0 then
    raise exception 'Dimensions and quantity must be positive';
  end if;
  if p_quantity <> trunc(p_quantity) then
    raise exception 'Quantity must be a whole number';
  end if;
  if p_media_rate is null or p_print_rate is null or p_waste_allowance_per_project is null
     or p_media_rate < 0 or p_print_rate < 0 or p_waste_allowance_per_project < 0 then
    raise exception 'Direct-cost rates must be zero or greater';
  end if;
  if p_measurement_unit = 'px' and (v_dpi is null or v_dpi <= 0) then
    raise exception 'DPI is required for pixel dimensions';
  end if;
  if p_measurement_unit <> 'px' and p_resolution_dpi is not null and p_resolution_dpi <= 0 then
    raise exception 'DPI must be positive when provided';
  end if;
  if p_lamination_type not in ('none', 'matte', 'glossy') then
    raise exception 'Unsupported lamination type';
  end if;

  perform private.validate_lead_costing_direct_layout(
    p_organization_id,
    p_material_id,
    p_width,
    p_height,
    p_measurement_unit,
    v_dpi,
    p_quantity
  );

  if p_measurement_unit = 'px' then
    v_width := p_width * 0.0254 / v_dpi;
    v_height := p_height * 0.0254 / v_dpi;
    v_unit := 'm';
  end if;

  select * into v_row
  from public.create_lead_costing_order_from_index(
    p_organization_id, p_customer_id, p_service_id, p_material_id,
    p_order_date, p_customer_name, p_order_description, 'Not applicable', 0,
    v_width, v_height, v_unit, p_quantity, p_media_rate, p_print_rate,
    p_waste_allowance_per_project, p_lamination_type, null
  );

  update public.lead_costing_orders
  set costing_mode = 'direct_printing',
      width = p_width,
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
