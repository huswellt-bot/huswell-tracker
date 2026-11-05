begin;

-- Keep the direct calculator rows distinguishable from the older costing
-- workflow. Existing zero-markup rows are the direct rows created by the
-- earlier calculator release; future rows are tagged explicitly.
alter table public.lead_costing_orders
  add column if not exists costing_mode text not null default 'legacy';

update public.lead_costing_orders
set costing_mode = 'direct_printing'
where costing_mode = 'legacy'
  and coalesce(target_margin, 0) = 0
  and coalesce(selling_price_per_item, 0) = 0
  and coalesce(total_quotation, 0) = 0;

alter table public.lead_costing_orders
  drop constraint if exists lead_costing_orders_costing_mode_check;

alter table public.lead_costing_orders
  add constraint lead_costing_orders_costing_mode_check
  check (costing_mode in ('legacy', 'direct_printing'));

create index if not exists lead_costing_orders_direct_mode_idx
  on public.lead_costing_orders(organization_id, costing_mode, order_date desc, created_at desc);

-- SECURITY DEFINER quotation RPCs must apply the same Lead assignment boundary
-- as the Lead Coordinator's normal leads SELECT policy.
create or replace function private.lead_costing_can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $function$
  select exists (
    select 1
    from public.leads lead_row
    where lead_row.id = p_lead_id
      and (
        private.has_text_role(lead_row.organization_id, array['super_admin', 'owner', 'admin'])
        or (
          lead_row.assigned_to = (select auth.uid())
          and private.has_text_role(lead_row.organization_id, array['lead_coordinator'])
        )
      )
  );
$function$;

revoke all on function private.lead_costing_can_access_lead(uuid) from public, anon, authenticated;

-- Recompute a submitted printing line on the server. Drafts may be incomplete,
-- but submission must contain an active printable material, valid direct-cost
-- inputs, a matching client-side cost, and a physically possible roll layout
-- unless the selected sheet material has no configured stock dimensions.
create or replace function private.validate_lead_costing_printing_item(
  p_organization_id uuid,
  p_metadata jsonb,
  p_quantity numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, private
as $function$
declare
  v_material_id uuid;
  v_material public.lead_costing_materials%rowtype;
  v_item_quantity numeric;
  v_width numeric;
  v_height numeric;
  v_dpi numeric;
  v_media_rate numeric;
  v_print_rate numeric;
  v_waste_rate numeric;
  v_production_cost numeric;
  v_width_m numeric;
  v_height_m numeric;
  v_area numeric;
  v_factor numeric;
  v_lamination_type text;
  v_lamination_cost numeric;
  v_expected_cost numeric;
  v_manual_stock_confirmed boolean;
  v_roll_width numeric;
  v_roll_length numeric;
  v_best_length numeric := null;
  v_across numeric;
  v_rows numeric;
  v_orientation record;
begin
  if coalesce(jsonb_typeof(p_metadata), '') <> 'object' then
    raise exception 'Each printing line must include calculator data';
  end if;

  begin
    v_material_id := nullif(btrim(p_metadata ->> 'materialId'), '')::uuid;
    v_item_quantity := nullif(btrim(p_metadata ->> 'quantity'), '')::numeric;
    v_width := nullif(btrim(p_metadata ->> 'width'), '')::numeric;
    v_height := nullif(btrim(p_metadata ->> 'height'), '')::numeric;
    v_dpi := nullif(btrim(p_metadata ->> 'dpi'), '')::numeric;
    v_media_rate := nullif(btrim(p_metadata ->> 'mediaRate'), '')::numeric;
    v_print_rate := coalesce(
      nullif(btrim(p_metadata ->> 'inkRate'), '')::numeric,
      nullif(btrim(p_metadata ->> 'printRate'), '')::numeric
    );
    v_waste_rate := nullif(btrim(p_metadata ->> 'wasteRate'), '')::numeric;
    v_production_cost := nullif(btrim(p_metadata ->> 'production_cost'), '')::numeric;
    v_manual_stock_confirmed := coalesce(
      nullif(btrim(p_metadata ->> 'manual_stock_confirmed'), '')::boolean,
      nullif(btrim(p_metadata ->> 'manualStockConfirmed'), '')::boolean,
      false
    );
  exception when others then
    raise exception 'Printing line has invalid input values';
  end;

  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity)
     or v_item_quantity is null or v_item_quantity <= 0
     or v_item_quantity <> trunc(v_item_quantity)
     or v_item_quantity <> p_quantity then
    raise exception 'Printing line quantity must be a positive whole number';
  end if;
  if v_material_id is null or v_width is null or v_height is null
     or v_width <= 0 or v_height <= 0 then
    raise exception 'Printing line needs a material and positive dimensions';
  end if;
  if v_media_rate is null or v_print_rate is null or v_waste_rate is null
     or v_media_rate < 0 or v_print_rate < 0 or v_waste_rate < 0
     or v_production_cost is null or v_production_cost < 0 then
    raise exception 'Printing line direct-cost rates must be zero or greater';
  end if;

  if coalesce(p_metadata ->> 'unit', '') not in ('ft', 'in', 'm', 'px') then
    raise exception 'Printing line has an unsupported measurement unit';
  end if;
  if coalesce(p_metadata ->> 'lamination', 'none') not in ('none', 'matte', 'glossy') then
    raise exception 'Printing line has an unsupported lamination type';
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

  v_factor := case p_metadata ->> 'unit'
    when 'ft' then 0.3048
    when 'in' then 0.0254
    when 'px' then 0.0254 / v_dpi
    else 1
  end;
  v_width_m := v_width * v_factor;
  v_height_m := v_height * v_factor;
  v_area := case when p_metadata ->> 'unit' = 'px' then v_width_m * v_height_m else v_width * v_height end;
  v_lamination_type := coalesce(p_metadata ->> 'lamination', 'none');
  v_lamination_cost := (v_width_m / 0.0254) * (v_height_m / 0.0254) * case v_lamination_type
    when 'matte' then 0.008
    when 'glossy' then 0.0755
    else 0
  end;
  v_expected_cost := v_area * (v_media_rate + v_print_rate)
    + v_lamination_cost
    + (v_waste_rate / p_quantity);

  if abs(round(v_production_cost, 2) - round(v_expected_cost, 2)) > 0.01 then
    raise exception 'Printing line direct cost is out of date; recalculate before submitting';
  end if;

  v_roll_width := v_material.roll_width_m;
  v_roll_length := v_material.roll_length_m;
  if coalesce(v_material.is_sheet, false)
     and (v_roll_width is null or v_roll_length is null) then
    if not v_manual_stock_confirmed then
      raise exception 'Confirm the available sheet stock before submitting';
    end if;
    return round(v_expected_cost, 2);
  end if;
  if v_roll_width is null or v_roll_length is null then
    raise exception 'Selected material has no configured roll dimensions';
  end if;

  for v_orientation in
    select *
    from (values (v_width_m, v_height_m), (v_height_m, v_width_m)) as orientations(across_width, along_length)
  loop
    v_across := floor((v_roll_width + 0.000000001) / v_orientation.across_width);
    if v_across >= 1 then
      v_rows := ceil(p_quantity / v_across);
      if v_rows * v_orientation.along_length <= v_roll_length + 0.000000001
         and (v_best_length is null or v_rows * v_orientation.along_length < v_best_length) then
        v_best_length := v_rows * v_orientation.along_length;
      end if;
    end if;
  end loop;

  if v_best_length is null then
    raise exception 'Printing line does not fit the selected roll dimensions';
  end if;
  return round(v_expected_cost, 2);
end;
$function$;

revoke all on function private.validate_lead_costing_printing_item(uuid, jsonb, numeric) from public, anon, authenticated;

-- Preserve draft editing, but bind the Lead to the coordinator's assigned
-- Lead boundary before a SECURITY DEFINER function reads it.
create or replace function public.save_lead_costing_printing_quotation(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_name text,
  p_issue_date date,
  p_items jsonb,
  p_terms_conditions text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_lead public.leads%rowtype;
  v_quote public.quotations%rowtype;
  v_item jsonb;
  v_index integer := 0;
  v_subtotal numeric(14,2) := 0;
  v_production_cost numeric(14,2) := 0;
  v_vat_rate numeric(5,2) := 0;
begin
  if not private.lead_costing_can_access_lead(p_lead_id) then
    raise exception 'You are not authorized to prepare a printing quotation for this Lead';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for share;
  if not found then raise exception 'Lead not found'; end if;
  if not private.has_text_role(v_lead.organization_id, array['lead_coordinator', 'super_admin', 'owner', 'admin']) then raise exception 'Only a Lead Coordinator can prepare a printing quotation'; end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or coalesce(jsonb_array_length(p_items), 0) = 0 then raise exception 'Add at least one printing line before saving'; end if;

  if p_quotation_id is null then
    insert into public.quotations (
      organization_id, quotation_no, quotation_source, document_type, lead_id,
      client_name, client_contact_name, client_phone, client_address,
      project_name, project_types, representative, prepared_by_user_id,
      created_by, issue_date, status, vat_rate, profit_margin_rate,
      overhead_rate, buffer_margin_rate, commission_rate, shipping_handling,
      terms_conditions, bank_details
    )
    select v_lead.organization_id,
      format('PQ-%s', lpad(nextval('public.price_quotation_number_seq')::text, 5, '0')),
      'lead_costing_printing', 'price_quotation', v_lead.id,
      v_lead.client_name, v_lead.contact_name, v_lead.phone, v_lead.address,
      coalesce(nullif(btrim(p_project_name), ''), v_lead.project_name, 'Printing collateral quotation'),
      'Printing', coalesce((select full_name from public.profiles where id = (select auth.uid())), 'Lead & Costing Coordinator'),
      (select auth.uid()), (select auth.uid()), coalesce(p_issue_date, current_date), 'draft', 0, 0,
      0, 0, 0, 0, coalesce(nullif(btrim(p_terms_conditions), ''), ''),
      coalesce((select default_bank_details from public.business_settings where organization_id = v_lead.organization_id limit 1), '[]'::jsonb)
    returning * into v_quote;
  else
    select * into v_quote from public.quotations where id = p_quotation_id for update;
    if not found or v_quote.quotation_source <> 'lead_costing_printing' or v_quote.organization_id <> v_lead.organization_id then raise exception 'Printing quotation not found'; end if;
    if v_quote.status::text not in ('draft', 'needs_revision') then raise exception 'Only draft or returned printing quotations can be edited'; end if;
    if v_quote.created_by is distinct from (select auth.uid()) and not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then raise exception 'Only the coordinator who prepared this quotation can edit it'; end if;
    update public.quotations set lead_id = v_lead.id, client_name = v_lead.client_name, client_contact_name = v_lead.contact_name, client_phone = v_lead.phone, client_address = v_lead.address, project_name = coalesce(nullif(btrim(p_project_name), ''), v_lead.project_name, project_name), issue_date = coalesce(p_issue_date, issue_date), status = 'draft', revision_note = null, revision_requested_to = null, revision_requested_by = null, revision_requested_at = null, decision_note = null, terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions) where id = v_quote.id returning * into v_quote;
    delete from public.quotation_items where quotation_id = v_quote.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(v_item ->> 'description'), '') is null or coalesce((v_item ->> 'quantity')::numeric, 0) <= 0 then raise exception 'Each printing line needs a description and positive quantity'; end if;
    if coalesce(nullif(v_item ->> 'production_cost', '')::numeric, 0) < 0 then raise exception 'Printing direct cost cannot be negative'; end if;
    insert into public.quotation_items (quotation_id, description, quantity, unit_cost, sort_order, costing_metadata)
    values (v_quote.id, btrim(v_item ->> 'description'), (v_item ->> 'quantity')::numeric, 0, v_index, coalesce(v_item -> 'costing_metadata', '{}'::jsonb));
    v_index := v_index + 1;
  end loop;

  select coalesce(sum(line_total), 0), coalesce(sum((nullif(costing_metadata ->> 'production_cost', '')::numeric) * quantity), 0)
    into v_subtotal, v_production_cost
    from public.quotation_items where quotation_id = v_quote.id;
  select coalesce(v_quote.vat_rate, 0) into v_vat_rate;
  update public.quotations
  set total_cost = round(v_production_cost, 2), subtotal = round(v_subtotal, 2), vat_amount = round(v_subtotal * v_vat_rate / 100, 2), total_amount = round(v_subtotal + (v_subtotal * v_vat_rate / 100) + coalesce(shipping_handling, 0), 2), updated_at = now()
  where id = v_quote.id;
  return v_quote.id;
end;
$function$;

-- Revalidate every line immediately before the direct-cost costing snapshot is
-- created. This prevents a caller from bypassing the UI and submitting stale
-- or fabricated production costs.
create or replace function private.seed_lead_costing_printing_product_costings(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_quote public.quotations%rowtype;
  v_item public.quotation_items%rowtype;
  v_costings jsonb;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
    and quotation_source = 'lead_costing_printing'
  for update;

  if not found then raise exception 'Printing quotation not found'; end if;
  if not private.has_text_role(v_quote.organization_id, array['lead_coordinator', 'super_admin', 'owner', 'admin']) then raise exception 'You are not authorized to prepare this printing quotation'; end if;
  if v_quote.created_by is distinct from (select auth.uid()) and not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then raise exception 'Only the coordinator who prepared this quotation can prepare its costing'; end if;
  if not exists (select 1 from public.quotation_items where quotation_id = p_quotation_id) then raise exception 'Add at least one printing line before submitting'; end if;

  for v_item in
    select * from public.quotation_items
    where quotation_id = p_quotation_id
    order by sort_order, created_at
  loop
    if nullif(btrim(v_item.description), '') is null
       or v_item.quantity is null
       or v_item.quantity <= 0
       or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Each printing line needs a description and positive whole-number quantity';
    end if;
    perform private.validate_lead_costing_printing_item(v_quote.organization_id, v_item.costing_metadata, v_item.quantity);
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'quotation_item_id', item.id,
      'pricing_model', 'target_margin',
      'internal_vat_rate', 0,
      'vat_locked', true,
      'vat_inclusive', false,
      'vat_rate_snapshot', 0,
      'cost_lines', jsonb_build_array(jsonb_build_object(
        'description', 'Direct printing production cost',
        'calculation_type', 'fixed_amount',
        'quantity', 1,
        'unit_cost', round((item.costing_metadata ->> 'production_cost')::numeric * item.quantity, 2),
        'amount', round((item.costing_metadata ->> 'production_cost')::numeric * item.quantity, 2)
      )),
      'markups', '[]'::jsonb
    ) order by item.sort_order
  ), '[]'::jsonb)
  into v_costings
  from public.quotation_items item
  where item.quotation_id = p_quotation_id;

  perform private.apply_product_costings_before_va_scope(v_quote.organization_id, p_quotation_id, v_costings, null);
end;
$function$;

revoke all on function private.seed_lead_costing_printing_product_costings(uuid) from public, anon, authenticated;

create or replace function public.submit_lead_costing_printing_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_quote public.quotations%rowtype;
  v_item public.quotation_items%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.quotation_source <> 'lead_costing_printing' then raise exception 'Printing quotation not found'; end if;
  if not private.has_text_role(v_quote.organization_id, array['lead_coordinator']) or v_quote.created_by is distinct from (select auth.uid()) then raise exception 'Only the coordinator who prepared this quotation can submit it'; end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then raise exception 'Only draft or returned printing quotations can be submitted'; end if;
  if not exists (select 1 from public.quotation_items where quotation_id = v_quote.id) then raise exception 'Add at least one printing line before submitting'; end if;

  for v_item in select * from public.quotation_items where quotation_id = v_quote.id order by sort_order, created_at loop
    if nullif(btrim(v_item.description), '') is null or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Each printing line needs a description and positive whole-number quantity';
    end if;
    perform private.validate_lead_costing_printing_item(v_quote.organization_id, v_item.costing_metadata, v_item.quantity);
  end loop;

  perform private.seed_lead_costing_printing_product_costings(v_quote.id);

  update public.quotations
  set status = 'pending_gm_approval', submitted_by = (select auth.uid()), submitted_at = now(), revision_requested_to = null
  where id = v_quote.id;

  insert into public.approval_requests (organization_id, resource_type, resource_id, status, submitted_by, submitted_at)
  values (v_quote.organization_id, 'quotation', v_quote.id, 'pending', (select auth.uid()), now())
  on conflict (resource_type, resource_id) do update
  set status = 'pending', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
      decided_by = null, decided_at = null, decision_note = null;
end;
$function$;

-- Pricing Officers may reuse only explicitly direct-printing computations.
create or replace function public.list_lead_costing_print_computations(p_organization_id uuid)
returns table (
  id uuid,
  order_no text,
  order_date date,
  customer_name text,
  order_description text,
  width numeric,
  height numeric,
  measurement_unit text,
  resolution_dpi numeric,
  quantity integer,
  direct_cost_per_item numeric,
  total_production_cost numeric,
  stock_fit_status text
)
language sql
stable
security definer
set search_path = public, private
as $function$
  select costing.id, costing.order_no, costing.order_date, costing.customer_name,
    costing.order_description, costing.width, costing.height, costing.measurement_unit,
    costing.resolution_dpi, costing.quantity, costing.direct_cost_per_item,
    costing.total_production_cost, costing.stock_fit_status
  from public.lead_costing_orders costing
  where costing.organization_id = p_organization_id
    and private.has_text_role(p_organization_id, array['lead_coordinator', 'pricing_officer', 'sales_pricing_officer', 'super_admin', 'owner', 'admin'])
    and costing.costing_mode = 'direct_printing'
    and coalesce(costing.direct_cost_per_item, 0) >= 0
  order by costing.order_date desc, costing.created_at desc
  limit 250;
$function$;

revoke all on function public.list_lead_costing_print_computations(uuid) from public, anon, authenticated;
grant execute on function public.list_lead_costing_print_computations(uuid) to authenticated;

-- The direct calculator is still area-based, but its server wrapper must not
-- accept finishing materials or silently clamp invalid cost inputs.
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
  if p_measurement_unit not in ('ft', 'in', 'm', 'px') then raise exception 'Unsupported measurement unit'; end if;
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0 or p_quantity is null or p_quantity <= 0 then raise exception 'Dimensions and quantity must be positive'; end if;
  if p_quantity <> trunc(p_quantity) then raise exception 'Quantity must be a whole number'; end if;
  if p_media_rate is null or p_print_rate is null or p_waste_allowance_per_project is null or p_media_rate < 0 or p_print_rate < 0 or p_waste_allowance_per_project < 0 then raise exception 'Direct-cost rates must be zero or greater'; end if;
  if p_measurement_unit = 'px' and (v_dpi is null or v_dpi <= 0) then raise exception 'DPI is required for pixel dimensions'; end if;
  if p_measurement_unit <> 'px' and p_resolution_dpi is not null and p_resolution_dpi <= 0 then raise exception 'DPI must be positive when provided'; end if;
  if p_lamination_type not in ('none', 'matte', 'glossy') then raise exception 'Unsupported lamination type'; end if;
  if not exists (
    select 1 from public.lead_costing_materials
    where id = p_material_id and organization_id = p_organization_id and is_active and not coalesce(is_finishing, false)
  ) then
    raise exception 'Select an active printable material before saving the direct costing';
  end if;

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

-- The hardened direct wrapper is the only calculator entry point. The older
-- lower-level function remains callable by that wrapper but is not exposed as
-- a client RPC where its weaker material validation could be bypassed.
revoke all on function public.create_lead_costing_order_from_index(
  uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric,
  text, integer, numeric, numeric, numeric, text, text
) from public, anon, authenticated;

revoke all on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) to authenticated;
revoke all on function public.submit_lead_costing_printing_quotation(uuid) from public, anon;
grant execute on function public.submit_lead_costing_printing_quotation(uuid) to authenticated;

commit;
