begin;

-- Lead & Costing Coordinator owns a separate calculator data boundary. It does
-- not reuse the Pricing Officer quotation workflow or its RLS policies.
create table if not exists public.lead_costing_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  examples text,
  material_guidance text,
  pricing_basis text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.lead_costing_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_source text not null check (btrim(supplier_source) <> ''),
  name text not null check (btrim(name) <> ''),
  product_code text,
  roll_width_m numeric(10,4) check (roll_width_m is null or roll_width_m > 0),
  roll_length_m numeric(10,4) check (roll_length_m is null or roll_length_m > 0),
  roll_price numeric(14,2) check (roll_price is null or roll_price >= 0),
  cost_per_m2 numeric(14,6) check (cost_per_m2 is null or cost_per_m2 >= 0),
  source_note text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index if not exists lead_costing_materials_identity_idx
  on public.lead_costing_materials(organization_id, supplier_source, name, coalesce(product_code, ''));

create table if not exists public.lead_costing_inventory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null,
  full_rolls_on_hand numeric(12,2) check (full_rolls_on_hand is null or full_rolls_on_hand >= 0),
  remaining_meters numeric(12,3) check (remaining_meters is null or remaining_meters >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, material_id),
  foreign key (organization_id, material_id)
    references public.lead_costing_materials(organization_id, id)
    on delete cascade
);

create table if not exists public.lead_costing_printer_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item text not null check (btrim(item) <> ''),
  unit text,
  listed_cost numeric(14,2) check (listed_cost is null or listed_cost >= 0),
  cost_per_unit numeric(14,6) check (cost_per_unit is null or cost_per_unit >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, item)
);

create table if not exists public.lead_costing_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  contact_details text,
  inquiry text,
  inquiry_status text not null default 'New inquiry' check (inquiry_status in (
    'New inquiry', 'Replied', 'Awaiting customer', 'Follow-up needed',
    'Quoted', 'Confirmed order', 'In production', 'Ready for pickup',
    'Completed', 'Cancelled / lost'
  )),
  follow_up_date date,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_costing_customers_org_updated_idx
  on public.lead_costing_customers(organization_id, updated_at desc);

create table if not exists public.lead_costing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_no text not null,
  customer_id uuid references public.lead_costing_customers(id) on delete set null,
  service_id uuid references public.lead_costing_services(id) on delete set null,
  material_id uuid references public.lead_costing_materials(id) on delete set null,
  order_date date not null default current_date,
  customer_name text not null check (btrim(customer_name) <> ''),
  order_description text not null check (btrim(order_description) <> ''),
  payment_mode text not null default 'Cash',
  payment_status text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Deposit paid', 'Partially paid', 'Paid in full')),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(14,2) not null default 0 check (balance_due >= 0),
  width numeric(12,4) not null check (width > 0),
  height numeric(12,4) not null check (height > 0),
  measurement_unit text not null check (measurement_unit in ('ft', 'in', 'm')),
  quantity integer not null check (quantity > 0),
  media_rate numeric(14,6) not null default 0 check (media_rate >= 0),
  ink_rate numeric(14,6) not null default 0 check (ink_rate >= 0),
  lamination_type text not null default 'none' check (lamination_type in ('none', 'matte', 'glossy')),
  labor_per_order numeric(14,2) not null default 0 check (labor_per_order >= 0),
  other_costs_per_order numeric(14,2) not null default 0 check (other_costs_per_order >= 0),
  target_margin numeric(6,3) not null default 30 check (target_margin >= 0 and target_margin < 95),
  policy_text text,
  printed_area_m2 numeric(14,6) not null default 0,
  required_length_m numeric(14,6) not null default 0,
  waste_percent numeric(8,4) not null default 0,
  cost_allowance_percent numeric(8,4) not null default 0,
  material_cost_per_item numeric(14,2) not null default 0,
  ink_cost_per_item numeric(14,2) not null default 0,
  lamination_cost_per_item numeric(14,2) not null default 0,
  direct_cost_per_item numeric(14,2) not null default 0,
  waste_cost_per_item numeric(14,2) not null default 0,
  total_production_cost numeric(14,2) not null default 0,
  selling_price_per_item numeric(14,2) not null default 0,
  total_quotation numeric(14,2) not null default 0,
  estimated_profit numeric(14,2) not null default 0,
  stock_fit_status text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_no)
);

create index if not exists lead_costing_orders_org_date_idx
  on public.lead_costing_orders(organization_id, order_date desc, created_at desc);
create index if not exists lead_costing_orders_org_payment_idx
  on public.lead_costing_orders(organization_id, payment_status, created_at desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'lead_costing_services',
    'lead_costing_materials',
    'lead_costing_inventory',
    'lead_costing_printer_costs',
    'lead_costing_customers',
    'lead_costing_orders'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', v_table, v_table);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', v_table, v_table);
  end loop;
end;
$$;

create or replace function private.lead_costing_is_operator(p_organization_id uuid)
returns boolean
language sql
stable
as $$
  select private.has_text_role(p_organization_id, array['lead_coordinator']);
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'lead_costing_services',
    'lead_costing_materials',
    'lead_costing_inventory',
    'lead_costing_printer_costs',
    'lead_costing_customers',
    'lead_costing_orders'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_lead_costing_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_lead_costing_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_lead_costing_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_lead_costing_delete', v_table);
    execute format('create policy %I on public.%I for select to authenticated using (private.lead_costing_is_operator(organization_id))', v_table || '_lead_costing_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.lead_costing_is_operator(organization_id))', v_table || '_lead_costing_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (private.lead_costing_is_operator(organization_id)) with check (private.lead_costing_is_operator(organization_id))', v_table || '_lead_costing_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (private.lead_costing_is_operator(organization_id))', v_table || '_lead_costing_delete', v_table);
  end loop;
end;
$$;

create or replace function public.create_lead_costing_order(
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
  p_quantity integer,
  p_media_rate numeric,
  p_ink_rate numeric,
  p_lamination_type text,
  p_labor_per_order numeric,
  p_other_costs_per_order numeric,
  p_target_margin numeric,
  p_policy_text text
)
returns public.lead_costing_orders
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_material public.lead_costing_materials%rowtype;
  v_inventory public.lead_costing_inventory%rowtype;
  v_row public.lead_costing_orders%rowtype;
  v_unit_factor numeric;
  v_w_m numeric;
  v_h_m numeric;
  v_area_m2 numeric;
  v_area_input numeric;
  v_roll_width numeric;
  v_roll_length numeric;
  v_across numeric;
  v_rows numeric;
  v_length numeric;
  v_best_length numeric := null;
  v_used_area numeric := 0;
  v_printed_area numeric;
  v_waste_area numeric := 0;
  v_waste_percent numeric := 0;
  v_cost_allowance numeric := 0;
  v_lamination numeric := 0;
  v_variable_per_item numeric;
  v_waste_order numeric;
  v_fixed_order numeric;
  v_total_cost numeric;
  v_cost_per_item numeric;
  v_margin numeric;
  v_sell_per_item numeric;
  v_sell_total numeric;
  v_profit numeric;
  v_amount_paid numeric;
  v_balance numeric;
  v_payment_status text;
  v_stock_fit_status text;
begin
  if not private.lead_costing_is_operator(p_organization_id) then
    raise exception 'Only a Lead & Costing Coordinator can create costing orders';
  end if;
  if nullif(btrim(coalesce(p_customer_name, '')), '') is null
     or nullif(btrim(coalesce(p_order_description, '')), '') is null then
    raise exception 'Customer name and order description are required';
  end if;
  if p_width is null or p_height is null or p_width <= 0 or p_height <= 0
     or p_quantity is null or p_quantity <= 0 then
    raise exception 'Dimensions and quantity must be positive';
  end if;
  if p_measurement_unit not in ('ft', 'in', 'm') then
    raise exception 'Unsupported measurement unit';
  end if;
  if p_lamination_type not in ('none', 'matte', 'glossy') then
    raise exception 'Unsupported lamination type';
  end if;
  if p_target_margin is null or p_target_margin < 0 or p_target_margin >= 95 then
    raise exception 'Target margin must be between 0 and 95 percent';
  end if;

  if p_service_id is null or not exists (
    select 1
    from public.lead_costing_services
    where id = p_service_id and organization_id = p_organization_id and is_active
  ) then
    raise exception 'Select an active service before saving the order';
  end if;
  if p_customer_id is not null and not exists (
    select 1
    from public.lead_costing_customers
    where id = p_customer_id and organization_id = p_organization_id
  ) then
    raise exception 'The selected customer does not belong to this organization';
  end if;

  select * into v_material
  from public.lead_costing_materials
  where id = p_material_id and organization_id = p_organization_id and is_active;
  if not found then
    raise exception 'Select an active material before saving the order';
  end if;

  v_unit_factor := case p_measurement_unit when 'ft' then 0.3048 when 'in' then 0.0254 else 1 end;
  v_w_m := p_width * v_unit_factor;
  v_h_m := p_height * v_unit_factor;
  v_area_input := p_width * p_height;
  v_area_m2 := v_w_m * v_h_m;
  v_printed_area := v_area_m2 * p_quantity;
  v_roll_width := v_material.roll_width_m;
  v_roll_length := v_material.roll_length_m;
  v_stock_fit_status := 'Material roll dimensions unavailable';

  if v_roll_width is not null and v_roll_length is not null then
    foreach v_length in array array[v_h_m, v_w_m] loop
      v_across := floor((v_roll_width + 0.000000001) / case when v_length = v_h_m then v_w_m else v_h_m end);
      if v_across >= 1 then
        v_rows := ceil(p_quantity::numeric / v_across);
        if v_best_length is null or (v_rows * v_length) < v_best_length then
          v_best_length := v_rows * v_length;
        end if;
      end if;
    end loop;
    if v_best_length is not null then
      v_used_area := v_roll_width * v_best_length;
      v_waste_area := greatest(0, v_used_area - v_printed_area);
      v_waste_percent := case when v_used_area > 0 then v_waste_area / v_used_area * 100 else 0 end;
      v_cost_allowance := case when v_printed_area > 0 then v_waste_area / v_printed_area * 100 else 0 end;
      select * into v_inventory
      from public.lead_costing_inventory
      where organization_id = p_organization_id and material_id = p_material_id;
      if not found then
        v_stock_fit_status := 'Stock not entered';
      elsif (coalesce(v_inventory.full_rolls_on_hand, 0) * v_roll_length + coalesce(v_inventory.remaining_meters, 0)) >= v_best_length * 1.1 then
        v_stock_fit_status := 'In stock';
      else
        v_stock_fit_status := 'Insufficient stock';
      end if;
    end if;
  end if;

  v_lamination := case p_lamination_type
    when 'matte' then (v_w_m / 0.0254) * (v_h_m / 0.0254) * 0.008
    when 'glossy' then (v_w_m / 0.0254) * (v_h_m / 0.0254) * 0.0755
    else 0
  end;
  v_variable_per_item := v_area_input
    * (greatest(0, coalesce(p_media_rate, 0)) + greatest(0, coalesce(p_ink_rate, 0))) + v_lamination;
  v_waste_order := v_variable_per_item * p_quantity * (v_cost_allowance / 100);
  v_fixed_order := greatest(0, coalesce(p_labor_per_order, 0)) + greatest(0, coalesce(p_other_costs_per_order, 0));
  v_total_cost := v_variable_per_item * p_quantity + v_waste_order + v_fixed_order;
  v_cost_per_item := v_total_cost / p_quantity;
  v_margin := p_target_margin / 100;
  v_sell_per_item := case when v_margin < 1 then v_cost_per_item / (1 - v_margin) else 0 end;
  v_sell_total := v_sell_per_item * p_quantity;
  v_profit := v_sell_total - v_total_cost;
  v_amount_paid := least(greatest(0, coalesce(p_amount_paid, 0)), v_sell_total);
  v_balance := greatest(0, v_sell_total - v_amount_paid);
  v_payment_status := case when v_balance <= 0.009 then 'Paid in full' when v_amount_paid > 0 then 'Partially paid' else 'Unpaid' end;

  insert into public.lead_costing_orders (
    organization_id, order_no, customer_id, service_id, material_id, order_date,
    customer_name, order_description, payment_mode, payment_status, amount_paid, balance_due,
    width, height, measurement_unit, quantity, media_rate, ink_rate, lamination_type,
    labor_per_order, other_costs_per_order, target_margin, policy_text,
    printed_area_m2, required_length_m, waste_percent, cost_allowance_percent,
    material_cost_per_item, ink_cost_per_item, lamination_cost_per_item, direct_cost_per_item,
    waste_cost_per_item, total_production_cost, selling_price_per_item, total_quotation,
    estimated_profit, stock_fit_status, created_by
  ) values (
    p_organization_id,
    'LC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    p_customer_id, p_service_id, p_material_id, coalesce(p_order_date, current_date),
    btrim(p_customer_name), btrim(p_order_description), coalesce(nullif(btrim(p_payment_mode), ''), 'Cash'),
    v_payment_status, v_amount_paid, v_balance,
    p_width, p_height, p_measurement_unit, p_quantity, greatest(0, coalesce(p_media_rate, 0)),
    greatest(0, coalesce(p_ink_rate, 0)), p_lamination_type, greatest(0, coalesce(p_labor_per_order, 0)),
    greatest(0, coalesce(p_other_costs_per_order, 0)), p_target_margin, p_policy_text,
    v_printed_area, coalesce(v_best_length, 0), v_waste_percent, v_cost_allowance,
    v_area_input * greatest(0, coalesce(p_media_rate, 0)),
    v_area_input * greatest(0, coalesce(p_ink_rate, 0)),
    v_lamination, v_variable_per_item + v_fixed_order / p_quantity, v_waste_order / p_quantity,
    v_total_cost, v_sell_per_item, v_sell_total, v_profit,
    v_stock_fit_status,
    (select auth.uid())
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_lead_costing_order(uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric, text, integer, numeric, numeric, text, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.create_lead_costing_order(uuid, uuid, uuid, uuid, date, text, text, text, numeric, numeric, numeric, text, integer, numeric, numeric, text, numeric, numeric, numeric, text) to authenticated;

-- Public defaults are copied as starting reference data; saved business records
-- remain empty and are created by the Lead & Costing Coordinator.
insert into public.lead_costing_services (organization_id, name, examples, material_guidance, pricing_basis, notes)
select org.id, seed.name, seed.examples, seed.material_guidance, seed.pricing_basis, seed.notes
from public.organizations as org
cross join (values
  ('Tarpaulin / Banner', 'Promotional and event banners', 'Banner media', 'Per sq ft / sq m', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Vinyl Stickers / Decals', 'Logo stickers, product decals', 'Adhesive vinyl', 'Per sq ft / sheet / piece', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Storefront & Window Graphics', 'Window promos, glass door graphics', 'Adhesive / perforated / frosted vinyl', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Wall Graphics / Murals', 'Office and interior wall graphics', 'Compatible wall media', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Vehicle Graphics / Partial Wraps', 'Vehicle logos and partial wraps', 'Vehicle-wrap vinyl', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Roll-up / Event Displays', 'Roll-up and trade show displays', 'Display media', 'Per piece / package', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Poster Printing', 'Retail and promotional posters', 'Photo paper / poster media', 'Per piece / sq ft', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Backlit Lightbox Graphics', 'Illuminated sign graphics', 'Backlit film / translucent media', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Canvas / Art Prints', 'Decorative art and photo prints', 'Polyester/cotton canvas', 'Per piece / sq ft', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Floor Graphics', 'Floor decals with anti-slip laminate', 'Compatible vinyl + floor laminate', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Rough-Surface Graphics', 'Graphics for semi-rough concrete', 'WW 100 rough-surface vinyl', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('One-Way Vision', 'Perforated window graphics', 'OWV001 One Way Vision', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements'),
  ('Frosted Glass Graphics', 'Privacy and decorative film', 'JT5796 MBF Frosted', 'Per sq ft / project', 'Check media compatibility, finishing equipment, and installation requirements')
) as seed(name, examples, material_guidance, pricing_basis, notes)
on conflict (organization_id, name) do nothing;

insert into public.lead_costing_printer_costs (organization_id, item, unit, listed_cost, cost_per_unit, notes)
select org.id, seed.item, seed.unit, seed.listed_cost, seed.cost_per_unit, seed.notes
from public.organizations as org
cross join (values
  ('Magenta ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Light Magenta ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Light Cyan ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Cyan ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Yellow ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Black ink', '1,000 ml', 6250::numeric, 6.25::numeric, 'As shown'),
  ('Optimizer', '1,000 ml', 750::numeric, 0.75::numeric, 'As shown'),
  ('Overcoat', '1,000 ml', 750::numeric, 0.75::numeric, 'As shown'),
  ('Average total print cost / sq ft', 'Source total', null::numeric, 9.27::numeric, 'Normalized reference rate; confirm approved base rate before quoting')
) as seed(item, unit, listed_cost, cost_per_unit, notes)
on conflict (organization_id, item) do nothing;

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array[
    'lead_costing_services',
    'lead_costing_materials',
    'lead_costing_inventory',
    'lead_costing_printer_costs',
    'lead_costing_customers',
    'lead_costing_orders'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

commit;
