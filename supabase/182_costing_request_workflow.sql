-- Run after 181_mark_lead_contacted.sql and before deploying the matching
-- PDF Costing workspace update.
--
-- This is a new, standalone PDF costing workflow. It does not reopen the
-- retired quotations.document_type = 'costing_breakdown' workflow.
-- Re-running this migration is safe for the same schema: tables and indexes
-- are additive, policies/functions are replaced with the current definitions,
-- and the storage bucket is updated in place.

begin;

create table if not exists public.costing_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_no text not null,
  source_file_name text,
  source_storage_path text,
  source_mime_type text not null default 'application/pdf',
  source_file_size bigint,
  client_name text,
  client_contact_name text,
  client_phone text,
  project_name text,
  notes text,
  hp_latex_rate numeric(12,4) not null default 99.19,
  waste_allowance numeric(8,6) not null default 0.05,
  formula_version text not null default 'hp-latex-700w-v1',
  extraction_json jsonb not null default '{}'::jsonb,
  calculation jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'needs_revision', 'approved', 'rejected')),
  prepared_by uuid references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  decision_note text,
  revision_of uuid references public.costing_requests(id) on delete set null,
  revision_number integer not null default 1 check (revision_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, request_no),
  check (source_file_size is null or source_file_size between 1 and 15728640),
  check (hp_latex_rate >= 0),
  check (waste_allowance between 0 and 1)
);

create table if not exists public.costing_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.costing_requests(id) on delete cascade,
  material_category text not null check (material_category in ('PP White', 'Vinyl Glossy', 'Vinyl Matte')),
  item_description text not null default '',
  width_mm numeric(14,4) not null default 0 check (width_mm >= 0),
  height_mm numeric(14,4) not null default 0 check (height_mm >= 0),
  quantity numeric(14,4) not null default 0 check (quantity >= 0),
  net_print_area_sqm numeric(18,8) generated always as ((width_mm * height_mm * quantity) / 1000000.0) stored,
  finish text not null default '',
  extraction_confidence numeric(5,4) check (extraction_confidence between 0 and 1),
  source_page integer check (source_page is null or source_page > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.costing_request_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.costing_requests(id) on delete cascade,
  material_category text not null check (material_category in ('PP White', 'Vinyl Glossy', 'Vinyl Matte')),
  display_name text not null,
  roll_width_m numeric(12,4) not null default 0 check (roll_width_m >= 0),
  roll_length_m numeric(12,4) not null default 0 check (roll_length_m >= 0),
  roll_cost numeric(14,2) not null default 0 check (roll_cost >= 0),
  required_rolls numeric(14,4) check (required_rolls is null or required_rolls >= 0),
  linear_meters_used numeric(14,4) check (linear_meters_used is null or linear_meters_used >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (request_id, material_category)
);

create table if not exists public.costing_request_additional_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.costing_requests(id) on delete cascade,
  label text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.costing_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.costing_requests(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists costing_requests_org_updated_idx
  on public.costing_requests (organization_id, updated_at desc);
create index if not exists costing_request_items_request_idx
  on public.costing_request_items (request_id, sort_order);
create index if not exists costing_request_materials_request_idx
  on public.costing_request_materials (request_id, sort_order);
create index if not exists costing_request_additional_costs_request_idx
  on public.costing_request_additional_costs (request_id, sort_order);
create index if not exists costing_request_events_request_idx
  on public.costing_request_events (request_id, created_at desc);

alter table public.costing_requests enable row level security;
alter table public.costing_request_items enable row level security;
alter table public.costing_request_materials enable row level security;
alter table public.costing_request_additional_costs enable row level security;
alter table public.costing_request_events enable row level security;

drop policy if exists "costing requests: authorized read" on public.costing_requests;
create policy "costing requests: authorized read"
on public.costing_requests for select to authenticated
using (
  private.has_text_role(organization_id, array['super_admin', 'owner', 'admin'])
  or (
    prepared_by = (select auth.uid())
    and private.has_text_role(organization_id, array['super_admin', 'sales_pricing_officer', 'owner', 'admin'])
  )
);

drop policy if exists "costing request items: authorized read" on public.costing_request_items;
create policy "costing request items: authorized read"
on public.costing_request_items for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        or request.prepared_by = (select auth.uid())
      )
  )
);

drop policy if exists "costing request materials: authorized read" on public.costing_request_materials;
create policy "costing request materials: authorized read"
on public.costing_request_materials for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        or request.prepared_by = (select auth.uid())
      )
  )
);

drop policy if exists "costing request additional costs: authorized read" on public.costing_request_additional_costs;
create policy "costing request additional costs: authorized read"
on public.costing_request_additional_costs for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        or request.prepared_by = (select auth.uid())
      )
  )
);

drop policy if exists "costing request events: authorized read" on public.costing_request_events;
create policy "costing request events: authorized read"
on public.costing_request_events for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        or request.prepared_by = (select auth.uid())
      )
  )
);

grant select on public.costing_requests,
  public.costing_request_items,
  public.costing_request_materials,
  public.costing_request_additional_costs,
  public.costing_request_events to authenticated;

create or replace function private.refresh_costing_request_calculation(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
  v_material_rows jsonb;
  v_additional_rows jsonb;
  v_total_area numeric := 0;
  v_total_quantity numeric := 0;
  v_material_consumption numeric := 0;
  v_full_roll_purchase numeric := 0;
  v_net_print_cost numeric := 0;
  v_printing_with_allowance numeric := 0;
  v_additional_costs numeric := 0;
  v_direct_consumption numeric := 0;
  v_direct_procurement numeric := 0;
  v_project_consumption numeric := 0;
  v_project_procurement numeric := 0;
  v_cost_per_piece numeric := 0;
begin
  select * into v_request
  from public.costing_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Costing request not found';
  end if;

  with base as (
    select
      material.material_category,
      material.display_name,
      material.roll_width_m,
      material.roll_length_m,
      material.roll_cost,
      material.required_rolls as manual_required_rolls,
      material.linear_meters_used as manual_linear_meters,
      coalesce(sum(item.net_print_area_sqm), 0)::numeric as total_area,
      coalesce(sum(item.quantity), 0)::numeric as total_quantity
    from public.costing_request_materials material
    left join public.costing_request_items item
      on item.request_id = material.request_id
     and item.material_category = material.material_category
    where material.request_id = p_request_id
    group by material.material_category, material.display_name,
      material.roll_width_m, material.roll_length_m, material.roll_cost,
      material.required_rolls, material.linear_meters_used, material.sort_order
    order by material.sort_order, material.material_category
  ), values_calculated as (
    select
      base.*,
      case
        when base.manual_linear_meters is not null then base.manual_linear_meters
        when base.roll_width_m > 0 then base.total_area / base.roll_width_m
        else 0
      end as linear_meters,
      case
        when base.manual_required_rolls is not null then base.manual_required_rolls
        when base.roll_length_m > 0 then ceil(
          (case
            when base.manual_linear_meters is not null then base.manual_linear_meters
            when base.roll_width_m > 0 then base.total_area / base.roll_width_m
            else 0
          end) / base.roll_length_m
        )
        else 0
      end as required_rolls
    from base
  ), costs as (
    select
      values_calculated.*,
      case when roll_length_m > 0 then round(linear_meters * roll_cost / roll_length_m, 2) else 0 end as allocated_material_cost,
      round(required_rolls * roll_cost, 2) as full_roll_purchase_cost,
      round(total_area * v_request.hp_latex_rate, 2) as net_print_cost,
      round(round(total_area * v_request.hp_latex_rate, 2) * (1 + v_request.waste_allowance), 2) as printing_with_allowance
    from values_calculated
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'material_category', material_category,
      'display_name', display_name,
      'roll_width_m', round(roll_width_m, 4),
      'roll_length_m', round(roll_length_m, 4),
      'roll_cost', round(roll_cost, 2),
      'total_area_sqm', round(total_area, 6),
      'total_quantity', total_quantity,
      'linear_meters_used', round(linear_meters, 4),
      'required_rolls', round(required_rolls, 4),
      'allocated_material_cost', allocated_material_cost,
      'full_roll_purchase_cost', full_roll_purchase_cost,
      'net_print_cost', net_print_cost,
      'printing_with_allowance', printing_with_allowance,
      'consumption_cost', round(allocated_material_cost + printing_with_allowance, 2),
      'procurement_cost', round(full_roll_purchase_cost + printing_with_allowance, 2)
    ) order by material_category), '[]'::jsonb),
    coalesce(sum(total_area), 0),
    coalesce(sum(total_quantity), 0),
    coalesce(sum(allocated_material_cost), 0),
    coalesce(sum(full_roll_purchase_cost), 0),
    coalesce(sum(net_print_cost), 0),
    coalesce(sum(printing_with_allowance), 0)
  into v_material_rows, v_total_area, v_total_quantity,
    v_material_consumption, v_full_roll_purchase, v_net_print_cost,
    v_printing_with_allowance
  from costs;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'label', label,
      'amount', round(amount, 2),
      'note', note
    ) order by sort_order, id), '[]'::jsonb),
    coalesce(sum(amount), 0)
  into v_additional_rows, v_additional_costs
  from public.costing_request_additional_costs
  where request_id = p_request_id;

  v_material_consumption := round(v_material_consumption, 2);
  v_full_roll_purchase := round(v_full_roll_purchase, 2);
  v_net_print_cost := round(v_net_print_cost, 2);
  v_printing_with_allowance := round(v_printing_with_allowance, 2);
  v_additional_costs := round(v_additional_costs, 2);
  v_direct_consumption := round(v_material_consumption + v_printing_with_allowance, 2);
  v_direct_procurement := round(v_full_roll_purchase + v_printing_with_allowance, 2);
  v_project_consumption := round(v_direct_consumption + v_additional_costs, 2);
  v_project_procurement := round(v_direct_procurement + v_additional_costs, 2);
  if v_total_quantity > 0 then
    v_cost_per_piece := round(v_project_consumption / v_total_quantity, 4);
  end if;

  update public.costing_requests
  set calculation = jsonb_build_object(
    'formula_version', v_request.formula_version,
    'hp_latex_rate', round(v_request.hp_latex_rate, 4),
    'waste_allowance', round(v_request.waste_allowance, 6),
    'total_quantity', v_total_quantity,
    'total_area_sqm', round(v_total_area, 6),
    'material_consumption', v_material_consumption,
    'full_roll_purchase', v_full_roll_purchase,
    'net_print_cost', v_net_print_cost,
    'printing_with_allowance', v_printing_with_allowance,
    'direct_consumption_cost', v_direct_consumption,
    'direct_procurement_cost', v_direct_procurement,
    'additional_costs', v_additional_costs,
    'project_cost_consumption', v_project_consumption,
    'project_cost_procurement', v_project_procurement,
    'cost_per_piece', v_cost_per_piece,
    'material_rows', v_material_rows,
    'additional_cost_rows', v_additional_rows
  ), updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'formula_version', v_request.formula_version,
    'hp_latex_rate', round(v_request.hp_latex_rate, 4),
    'waste_allowance', round(v_request.waste_allowance, 6),
    'total_quantity', v_total_quantity,
    'total_area_sqm', round(v_total_area, 6),
    'material_consumption', v_material_consumption,
    'full_roll_purchase', v_full_roll_purchase,
    'net_print_cost', v_net_print_cost,
    'printing_with_allowance', v_printing_with_allowance,
    'direct_consumption_cost', v_direct_consumption,
    'direct_procurement_cost', v_direct_procurement,
    'additional_costs', v_additional_costs,
    'project_cost_consumption', v_project_consumption,
    'project_cost_procurement', v_project_procurement,
    'cost_per_piece', v_cost_per_piece,
    'material_rows', v_material_rows,
    'additional_cost_rows', v_additional_rows
  );
end;
$$;

create or replace function public.save_costing_request(
  p_organization_id uuid,
  p_request_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
  v_id uuid;
  v_item jsonb;
  v_material jsonb;
  v_additional jsonb;
  v_category text;
  v_number text;
  v_rate numeric;
  v_waste numeric;
  v_status text;
begin
  if not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'sales_pricing_officer']) then
    raise exception 'You are not authorized to prepare PDF Costing requests';
  end if;

  v_rate := case
    when coalesce(p_payload->>'hp_latex_rate', '') ~ '^[0-9]+([.][0-9]+)?$'
      then (p_payload->>'hp_latex_rate')::numeric
    else 99.19
  end;
  v_waste := case
    when coalesce(p_payload->>'waste_allowance', '') ~ '^[0-9]+([.][0-9]+)?$'
      then least(1, (p_payload->>'waste_allowance')::numeric)
    else 0.05
  end;

  if p_request_id is null then
    insert into public.costing_requests (
      organization_id, request_no, source_file_name, source_storage_path,
      source_mime_type, source_file_size, client_name, client_contact_name,
      client_phone, project_name, notes, hp_latex_rate, waste_allowance,
      formula_version, extraction_json, prepared_by
    ) values (
      p_organization_id,
      'CR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      nullif(p_payload->>'source_file_name', ''),
      nullif(p_payload->>'source_storage_path', ''),
      coalesce(nullif(p_payload->>'source_mime_type', ''), 'application/pdf'),
      case when coalesce(p_payload->>'source_file_size', '') ~ '^[0-9]+$' then (p_payload->>'source_file_size')::bigint else null end,
      nullif(p_payload->>'client_name', ''),
      nullif(p_payload->>'client_contact_name', ''),
      nullif(p_payload->>'client_phone', ''),
      nullif(p_payload->>'project_name', ''),
      nullif(p_payload->>'notes', ''),
      greatest(0, v_rate),
      greatest(0, v_waste),
      coalesce(nullif(p_payload->>'formula_version', ''), 'hp-latex-700w-v1'),
      coalesce(p_payload->'extraction_json', '{}'::jsonb),
      (select auth.uid())
    ) returning id into v_id;
    v_status := 'draft';
  else
    select * into v_request
    from public.costing_requests
    where id = p_request_id and organization_id = p_organization_id
    for update;

    if not found then
      raise exception 'Costing request not found';
    end if;
    if v_request.status = 'approved' or v_request.status = 'pending' then
      raise exception 'This costing request is locked while it is pending or approved';
    end if;
    if v_request.prepared_by <> (select auth.uid())
       and not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']) then
      raise exception 'Only the preparer or General Manager can edit this costing request';
    end if;

    update public.costing_requests
    set source_file_name = coalesce(nullif(p_payload->>'source_file_name', ''), source_file_name),
        source_storage_path = coalesce(nullif(p_payload->>'source_storage_path', ''), source_storage_path),
        source_mime_type = coalesce(nullif(p_payload->>'source_mime_type', ''), source_mime_type),
        source_file_size = case when coalesce(p_payload->>'source_file_size', '') ~ '^[0-9]+$' then (p_payload->>'source_file_size')::bigint else source_file_size end,
        client_name = nullif(p_payload->>'client_name', ''),
        client_contact_name = nullif(p_payload->>'client_contact_name', ''),
        client_phone = nullif(p_payload->>'client_phone', ''),
        project_name = nullif(p_payload->>'project_name', ''),
        notes = nullif(p_payload->>'notes', ''),
        hp_latex_rate = greatest(0, v_rate),
        waste_allowance = greatest(0, v_waste),
        formula_version = coalesce(nullif(p_payload->>'formula_version', ''), formula_version),
        extraction_json = coalesce(p_payload->'extraction_json', extraction_json),
        updated_at = now()
    where id = p_request_id;
    v_id := p_request_id;
    v_status := v_request.status;
  end if;

  delete from public.costing_request_items where request_id = v_id;
  delete from public.costing_request_materials where request_id = v_id;
  delete from public.costing_request_additional_costs where request_id = v_id;

  if jsonb_typeof(p_payload->'items') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payload->'items') loop
      v_category := case
        when v_item->>'material_category' in ('PP White', 'Vinyl Glossy', 'Vinyl Matte')
          then v_item->>'material_category'
        else 'PP White'
      end;
      insert into public.costing_request_items (
        organization_id, request_id, material_category, item_description,
        width_mm, height_mm, quantity, finish, extraction_confidence,
        source_page, sort_order
      ) values (
        p_organization_id, v_id, v_category,
        coalesce(v_item->>'item_description', ''),
        case when coalesce(v_item->>'width_mm', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_item->>'width_mm')::numeric else 0 end,
        case when coalesce(v_item->>'height_mm', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_item->>'height_mm')::numeric else 0 end,
        case when coalesce(v_item->>'quantity', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_item->>'quantity')::numeric else 0 end,
        coalesce(v_item->>'finish', ''),
        case when coalesce(v_item->>'extraction_confidence', '') ~ '^[0-9]+([.][0-9]+)?$' then least(1, greatest(0, (v_item->>'extraction_confidence')::numeric)) else null end,
        case when coalesce(v_item->>'source_page', '') ~ '^[0-9]+$' then (v_item->>'source_page')::integer else null end,
        case when coalesce(v_item->>'sort_order', '') ~ '^[0-9]+$' then (v_item->>'sort_order')::integer else 0 end
      );
    end loop;
  end if;

  if jsonb_typeof(p_payload->'materials') = 'array'
     and jsonb_array_length(p_payload->'materials') > 0 then
    for v_material in select value from jsonb_array_elements(p_payload->'materials') loop
      v_category := case
        when v_material->>'material_category' in ('PP White', 'Vinyl Glossy', 'Vinyl Matte')
          then v_material->>'material_category'
        else 'PP White'
      end;
      insert into public.costing_request_materials (
        organization_id, request_id, material_category, display_name,
        roll_width_m, roll_length_m, roll_cost, required_rolls,
        linear_meters_used, sort_order
      ) values (
        p_organization_id, v_id, v_category,
        coalesce(nullif(v_material->>'display_name', ''), v_category),
        case when coalesce(v_material->>'roll_width_m', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_material->>'roll_width_m')::numeric else 0 end,
        case when coalesce(v_material->>'roll_length_m', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_material->>'roll_length_m')::numeric else 0 end,
        case when coalesce(v_material->>'roll_cost', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_material->>'roll_cost')::numeric else 0 end,
        case when coalesce(v_material->>'required_rolls', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_material->>'required_rolls')::numeric else null end,
        case when coalesce(v_material->>'linear_meters_used', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_material->>'linear_meters_used')::numeric else null end,
        case when coalesce(v_material->>'sort_order', '') ~ '^[0-9]+$' then (v_material->>'sort_order')::integer else 0 end
      ) on conflict (request_id, material_category) do update set
        display_name = excluded.display_name,
        roll_width_m = excluded.roll_width_m,
        roll_length_m = excluded.roll_length_m,
        roll_cost = excluded.roll_cost,
        required_rolls = excluded.required_rolls,
        linear_meters_used = excluded.linear_meters_used,
        sort_order = excluded.sort_order;
    end loop;
  end if;

  if not exists (select 1 from public.costing_request_materials where request_id = v_id) then
    insert into public.costing_request_materials
      (organization_id, request_id, material_category, display_name, roll_width_m, roll_length_m, roll_cost, sort_order)
    values
      (p_organization_id, v_id, 'PP White', 'PP White Self-Adhesive', 1.27, 30, 2200, 1),
      (p_organization_id, v_id, 'Vinyl Glossy', 'Vinyl Glossy', 1.37, 50, 3300, 2),
      (p_organization_id, v_id, 'Vinyl Matte', 'Vinyl Matte', 1.37, 50, 3300, 3);
  end if;

  if jsonb_typeof(p_payload->'additional_costs') = 'array' then
    for v_additional in select value from jsonb_array_elements(p_payload->'additional_costs') loop
      insert into public.costing_request_additional_costs (
        organization_id, request_id, label, amount, note, sort_order
      ) values (
        p_organization_id, v_id,
        coalesce(nullif(v_additional->>'label', ''), 'Additional cost'),
        case when coalesce(v_additional->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' then (v_additional->>'amount')::numeric else 0 end,
        coalesce(v_additional->>'note', ''),
        case when coalesce(v_additional->>'sort_order', '') ~ '^[0-9]+$' then (v_additional->>'sort_order')::integer else 0 end
      );
    end loop;
  end if;

  perform private.refresh_costing_request_calculation(v_id);
  insert into public.costing_request_events (
    organization_id, request_id, event_type, from_status, to_status, actor_id, note
  ) values (
    p_organization_id, v_id, case when p_request_id is null then 'created' else 'saved' end,
    v_status, v_status, (select auth.uid()), null
  );
  return v_id;
end;
$$;

create or replace function public.submit_costing_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
begin
  select * into v_request
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if v_request.prepared_by <> (select auth.uid())
     and not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the preparer or General Manager can submit this costing request';
  end if;
  if v_request.status not in ('draft', 'needs_revision', 'rejected') then
    raise exception 'Only an editable costing request can be submitted';
  end if;
  if not exists (
    select 1 from public.costing_request_items item
    where item.request_id = p_request_id
      and item.width_mm > 0 and item.height_mm > 0 and item.quantity > 0
  ) then
    raise exception 'Add at least one costing item with width, height, and quantity before submitting';
  end if;

  perform private.refresh_costing_request_calculation(p_request_id);
  update public.costing_requests
  set status = 'pending', submitted_by = (select auth.uid()), submitted_at = now(),
      decided_by = null, decided_at = null, decision_note = null, updated_at = now()
  where id = p_request_id;
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id)
  values
    (v_request.organization_id, p_request_id, 'submitted', v_request.status, 'pending', (select auth.uid()));
end;
$$;

create or replace function public.review_costing_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
  v_next_status text;
begin
  if p_decision not in ('approved', 'needs_revision', 'rejected') then
    raise exception 'Unsupported costing decision';
  end if;
  if p_decision in ('needs_revision', 'rejected') and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A note is required when returning or rejecting a costing request';
  end if;
  select * into v_request
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only a General Manager can decide a costing request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending costing request can be decided';
  end if;
  v_next_status := p_decision;
  update public.costing_requests
  set status = v_next_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end,
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_request_id;
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id, note)
  values
    (v_request.organization_id, p_request_id, p_decision, v_request.status, v_next_status, (select auth.uid()), nullif(trim(coalesce(p_note, '')), ''));
end;
$$;

create or replace function public.create_costing_request_revision(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_source public.costing_requests%rowtype;
  v_revision_id uuid;
begin
  select * into v_source
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if not (
    private.has_text_role(v_source.organization_id, array['super_admin', 'owner', 'admin'])
    or v_source.prepared_by = (select auth.uid())
  ) then
    raise exception 'Only the preparer or General Manager can create a revision';
  end if;
  if v_source.status <> 'approved' then
    raise exception 'Only an approved costing request can be revised';
  end if;

  insert into public.costing_requests (
    organization_id, request_no, source_file_name, source_storage_path,
    source_mime_type, source_file_size, client_name, client_contact_name,
    client_phone, project_name, notes, hp_latex_rate, waste_allowance,
    formula_version, extraction_json, status, prepared_by, revision_of,
    revision_number
  ) values (
    v_source.organization_id,
    'CR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    v_source.source_file_name, v_source.source_storage_path,
    v_source.source_mime_type, v_source.source_file_size, v_source.client_name,
    v_source.client_contact_name, v_source.client_phone, v_source.project_name,
    v_source.notes, v_source.hp_latex_rate, v_source.waste_allowance,
    v_source.formula_version, v_source.extraction_json, 'draft',
    coalesce(v_source.prepared_by, (select auth.uid())), p_request_id,
    v_source.revision_number + 1
  ) returning id into v_revision_id;

  insert into public.costing_request_items (
    organization_id, request_id, material_category, item_description,
    width_mm, height_mm, quantity, finish, extraction_confidence,
    source_page, sort_order
  ) select organization_id, v_revision_id, material_category, item_description,
    width_mm, height_mm, quantity, finish, extraction_confidence, source_page, sort_order
  from public.costing_request_items
  where request_id = p_request_id;

  insert into public.costing_request_materials (
    organization_id, request_id, material_category, display_name,
    roll_width_m, roll_length_m, roll_cost, required_rolls,
    linear_meters_used, sort_order
  ) select organization_id, v_revision_id, material_category, display_name,
    roll_width_m, roll_length_m, roll_cost, required_rolls,
    linear_meters_used, sort_order
  from public.costing_request_materials
  where request_id = p_request_id;

  insert into public.costing_request_additional_costs
    (organization_id, request_id, label, amount, note, sort_order)
  select organization_id, v_revision_id, label, amount, note, sort_order
  from public.costing_request_additional_costs
  where request_id = p_request_id;

  perform private.refresh_costing_request_calculation(v_revision_id);
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id, note)
  values
    (v_source.organization_id, v_revision_id, 'revision_created', null, 'draft', (select auth.uid()), p_request_id::text);
  return v_revision_id;
end;
$$;

revoke execute on function private.refresh_costing_request_calculation(uuid) from public, anon, authenticated;
revoke execute on function public.save_costing_request(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.submit_costing_request(uuid) from public, anon;
revoke execute on function public.review_costing_request(uuid, text, text) from public, anon;
revoke execute on function public.create_costing_request_revision(uuid) from public, anon;
grant execute on function public.save_costing_request(uuid, uuid, jsonb) to authenticated;
grant execute on function public.submit_costing_request(uuid) to authenticated;
grant execute on function public.review_costing_request(uuid, text, text) to authenticated;
grant execute on function public.create_costing_request_revision(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'costing-source-documents',
  'costing-source-documents',
  false,
  15728640,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "costing source documents: authorized read" on storage.objects;
create policy "costing source documents: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and exists (
    select 1
    from public.costing_requests request
    where request.source_storage_path = storage.objects.name
      and split_part(storage.objects.name, '/', 1) = request.organization_id::text
      and (
        private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        or request.prepared_by = (select auth.uid())
      )
  )
);

drop policy if exists "costing source documents: preparer upload" on storage.objects;
create policy "costing source documents: preparer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id::text = split_part(name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text in ('super_admin', 'owner', 'admin', 'sales_pricing_officer')
  )
);

drop policy if exists "costing source documents: preparer delete" on storage.objects;
create policy "costing source documents: preparer delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id::text = split_part(name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text in ('super_admin', 'owner', 'admin', 'sales_pricing_officer')
      and (
        member.role::text in ('super_admin', 'owner', 'admin')
        or split_part(name, '/', 3) = (select auth.uid())::text
      )
  )
);

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costing_requests') then
    alter publication supabase_realtime add table public.costing_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costing_request_items') then
    alter publication supabase_realtime add table public.costing_request_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costing_request_materials') then
    alter publication supabase_realtime add table public.costing_request_materials;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costing_request_additional_costs') then
    alter publication supabase_realtime add table public.costing_request_additional_costs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costing_request_events') then
    alter publication supabase_realtime add table public.costing_request_events;
  end if;
end;
$$;

commit;
