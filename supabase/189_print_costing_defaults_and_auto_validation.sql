-- GM-managed Print Costing defaults and system validation.
-- Run after 188_link_print_costing_to_leads.sql and before deploying the
-- matching Print Costing workspace update.
--
-- The defaults are seeded from Project_Costing_HP_Latex_700W.xlsx. The
-- required-roll and linear-meter values remain job-specific; they are never
-- used as organization-wide defaults.

begin;

create or replace function private.default_print_costing_defaults()
returns jsonb
language sql
immutable
as $$
  select '{
    "hp_latex_rate": 99.19,
    "waste_allowance": 0.05,
    "formula_version": "hp-latex-700w-v1",
    "materials": {
      "PP White": {
        "display_name": "PP White Self-Adhesive",
        "roll_width_m": 1.27,
        "roll_length_m": 30,
        "roll_cost": 2200
      },
      "Vinyl Glossy": {
        "display_name": "Vinyl Glossy",
        "roll_width_m": 1.37,
        "roll_length_m": 50,
        "roll_cost": 3300
      },
      "Vinyl Matte": {
        "display_name": "Vinyl Matte",
        "roll_width_m": 1.37,
        "roll_length_m": 50,
        "roll_cost": 3300
      }
    }
  }'::jsonb;
$$;

alter table public.business_settings
  add column if not exists print_costing_defaults jsonb
    not null default private.default_print_costing_defaults();

update public.business_settings
set print_costing_defaults = private.default_print_costing_defaults()
where print_costing_defaults is null
   or jsonb_typeof(print_costing_defaults) <> 'object';

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
  v_id uuid;
  v_lead_id uuid;
  v_existing_lead_id uuid;
  v_lead public.leads%rowtype;
  v_request public.costing_requests%rowtype;
  v_defaults jsonb;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_materials jsonb := '[]'::jsonb;
  v_input jsonb;
  v_default jsonb;
  v_required jsonb;
  v_linear jsonb;
  v_category text;
  v_sort_order integer := 0;
  v_saved public.costing_request_materials%rowtype;
  v_saved_found boolean;
begin
  if not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'sales_pricing_officer']) then
    raise exception 'You are not authorized to prepare PDF Costing requests';
  end if;

  select coalesce(print_costing_defaults, private.default_print_costing_defaults())
    into v_defaults
  from public.business_settings
  where organization_id = p_organization_id;
  v_defaults := coalesce(v_defaults, private.default_print_costing_defaults());

  if p_request_id is not null then
    select * into v_request
    from public.costing_requests
    where id = p_request_id
      and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'Costing request not found';
    end if;
  end if;

  if p_request_id is null then
    v_payload := jsonb_set(v_payload, '{hp_latex_rate}', coalesce(v_defaults->'hp_latex_rate', '99.19'::jsonb), true);
    v_payload := jsonb_set(v_payload, '{waste_allowance}', coalesce(v_defaults->'waste_allowance', '0.05'::jsonb), true);
    v_payload := jsonb_set(v_payload, '{formula_version}', coalesce(v_defaults->'formula_version', '"hp-latex-700w-v1"'::jsonb), true);
  else
    -- Existing drafts and revisions retain the settings snapshot used when
    -- they were created, even if the GM later changes organization defaults.
    v_payload := jsonb_set(v_payload, '{hp_latex_rate}', to_jsonb(v_request.hp_latex_rate), true);
    v_payload := jsonb_set(v_payload, '{waste_allowance}', to_jsonb(v_request.waste_allowance), true);
    v_payload := jsonb_set(v_payload, '{formula_version}', to_jsonb(v_request.formula_version), true);
  end if;

  -- Rates and stock specifications are server-authoritative. Job-specific
  -- meters and rolls are preserved from the payload or existing request.
  foreach v_category in array array['PP White', 'Vinyl Glossy', 'Vinyl Matte'] loop
    v_sort_order := v_sort_order + 1;
    v_input := '{}'::jsonb;
    if jsonb_typeof(v_payload->'materials') = 'array' then
      select value into v_input
      from jsonb_array_elements(v_payload->'materials')
      where value->>'material_category' = v_category
      limit 1;
      if not found then
        v_input := '{}'::jsonb;
      end if;
    end if;

    v_saved := null;
    select * into v_saved
    from public.costing_request_materials
    where request_id = p_request_id
      and material_category = v_category;
    v_saved_found := found;

    if v_saved_found then
      v_default := jsonb_build_object(
        'display_name', v_saved.display_name,
        'roll_width_m', v_saved.roll_width_m,
        'roll_length_m', v_saved.roll_length_m,
        'roll_cost', v_saved.roll_cost
      );
    else
      v_default := coalesce(
        v_defaults->'materials'->v_category,
        (private.default_print_costing_defaults())->'materials'->v_category
      );
    end if;

    v_required := case
      when jsonb_typeof(v_input->'required_rolls') = 'number'
        and (v_input->>'required_rolls')::numeric >= 0 then v_input->'required_rolls'
      when v_saved_found and v_saved.required_rolls is not null then to_jsonb(v_saved.required_rolls)
      else 'null'::jsonb
    end;
    v_linear := case
      when jsonb_typeof(v_input->'linear_meters_used') = 'number'
        and (v_input->>'linear_meters_used')::numeric >= 0 then v_input->'linear_meters_used'
      when v_saved_found and v_saved.linear_meters_used is not null then to_jsonb(v_saved.linear_meters_used)
      else 'null'::jsonb
    end;

    v_materials := v_materials || jsonb_build_array(jsonb_build_object(
      'material_category', v_category,
      'display_name', coalesce(nullif(v_default->>'display_name', ''), v_category),
      'roll_width_m', coalesce(v_default->'roll_width_m', '0'::jsonb),
      'roll_length_m', coalesce(v_default->'roll_length_m', '0'::jsonb),
      'roll_cost', coalesce(v_default->'roll_cost', '0'::jsonb),
      'required_rolls', v_required,
      'linear_meters_used', v_linear,
      'sort_order', v_sort_order
    ));
  end loop;
  v_payload := jsonb_set(v_payload, '{materials}', v_materials, true);

  if p_request_id is not null then
    select lead_id into v_existing_lead_id
    from public.costing_requests
    where id = p_request_id
      and organization_id = p_organization_id;
  end if;

  if nullif(trim(coalesce(v_payload->>'lead_id', '')), '') is not null then
    v_lead_id := (v_payload->>'lead_id')::uuid;
  else
    v_lead_id := v_existing_lead_id;
  end if;

  if p_request_id is null and v_lead_id is null then
    raise exception 'Select a Lead before creating a costing request';
  end if;

  if v_lead_id is not null then
    select * into v_lead
    from public.leads
    where id = v_lead_id
      and organization_id = p_organization_id;
    if not found then
      raise exception 'The selected Lead is not available in this organization';
    end if;
    if not (
      private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin'])
      or private.can_prepare_endorsed_lead(
        v_lead.organization_id,
        v_lead.assigned_to,
        v_lead.endorsed_to
      )
    ) then
      raise exception 'You are not authorized to prepare a costing for this Lead';
    end if;
  end if;

  v_id := public.save_costing_request_with_confirmation(
    p_organization_id,
    p_request_id,
    v_payload
  );

  if v_lead_id is not null then
    update public.costing_requests
    set lead_id = v_lead_id,
        client_name = nullif(v_lead.client_name, ''),
        client_contact_name = nullif(v_lead.contact_name, ''),
        client_phone = nullif(v_lead.phone, ''),
        client_email = nullif(v_lead.email, ''),
        project_name = nullif(v_lead.project_name, ''),
        updated_at = now()
    where id = v_id;
  else
    update public.costing_requests
    set client_email = case
      when v_payload ? 'client_email' then nullif(v_payload->>'client_email', '')
      else client_email
    end,
    updated_at = now()
    where id = v_id;
  end if;

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
  if v_request.status not in ('draft', 'needs_revision') then
    raise exception 'Only a draft or returned costing request can be submitted';
  end if;
  if v_request.lead_id is null
     or not exists (
       select 1
       from public.leads lead
       where lead.id = v_request.lead_id
         and lead.organization_id = v_request.organization_id
     ) then
    raise exception 'Select a valid Lead before submitting this costing request';
  end if;
  if not exists (
    select 1 from public.costing_request_items item
    where item.request_id = p_request_id
      and item.width_mm > 0 and item.height_mm > 0 and item.quantity > 0
  ) then
    raise exception 'Add at least one costing item with width, height, and quantity before submitting';
  end if;
  if exists (
    select 1
    from (
      select item.material_category
      from public.costing_request_items item
      where item.request_id = p_request_id
        and item.net_print_area_sqm > 0
      group by item.material_category
    ) used_material
    left join public.costing_request_materials material
      on material.request_id = p_request_id
     and material.material_category = used_material.material_category
    where material.id is null
       or coalesce(material.roll_width_m, 0) <= 0
       or coalesce(material.roll_length_m, 0) <= 0
       or coalesce(material.roll_cost, 0) <= 0
       or material.required_rolls is null
       or material.required_rolls <= 0
       or material.linear_meters_used is null
       or material.linear_meters_used <= 0
  ) then
    raise exception 'Material usage could not be calculated for every material used by this costing request';
  end if;

  perform private.refresh_costing_request_calculation(p_request_id);
  update public.costing_requests
  set production_assumptions_confirmed = true,
      status = 'pending', submitted_by = (select auth.uid()), submitted_at = now(),
      decided_by = null, decided_at = null, decision_note = null, updated_at = now()
  where id = p_request_id;
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id)
  values
    (v_request.organization_id, p_request_id, 'submitted', v_request.status, 'pending', (select auth.uid()));
end;
$$;

revoke execute on function public.save_costing_request(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.submit_costing_request(uuid) from public, anon;
grant execute on function public.save_costing_request(uuid, uuid, jsonb) to authenticated;
grant execute on function public.submit_costing_request(uuid) to authenticated;

commit;
