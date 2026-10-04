-- Link new Print Costing requests to Leads
-- Run after 187_require_costing_production_assumptions.sql and before
-- deploying the matching Lead-first Print Costing workspace update.
--
-- New requests must identify an eligible Lead. Existing standalone costing
-- records remain readable; their saved client fields are preserved for
-- history. The selected Lead is authoritative for new saves and the current
-- client details are snapshotted on the costing request.

begin;

alter table public.costing_requests
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists client_email text;

create index if not exists costing_requests_lead_idx
  on public.costing_requests (organization_id, lead_id, updated_at desc);

do $$
begin
  if to_regprocedure('public.save_costing_request(uuid,uuid,jsonb)') is not null
     and to_regprocedure('public.save_costing_request_with_confirmation(uuid,uuid,jsonb)') is null then
    alter function public.save_costing_request(uuid, uuid, jsonb)
      rename to save_costing_request_with_confirmation;
  end if;
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
  v_id uuid;
  v_lead_id uuid;
  v_existing_lead_id uuid;
  v_lead public.leads%rowtype;
begin
  if p_request_id is not null then
    select lead_id into v_existing_lead_id
    from public.costing_requests
    where id = p_request_id
      and organization_id = p_organization_id;
  end if;

  if nullif(trim(coalesce(p_payload->>'lead_id', '')), '') is not null then
    v_lead_id := (p_payload->>'lead_id')::uuid;
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
    p_payload
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
      when p_payload ? 'client_email' then nullif(p_payload->>'client_email', '')
      else client_email
    end,
    updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_costing_request_with_confirmation(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_costing_request(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_costing_request(uuid, uuid, jsonb) to authenticated;

do $$
begin
  if to_regprocedure('public.create_costing_request_revision(uuid)') is not null
     and to_regprocedure('public.create_costing_request_revision_legacy(uuid)') is null then
    alter function public.create_costing_request_revision(uuid)
      rename to create_costing_request_revision_legacy;
  end if;
end;
$$;

create or replace function public.create_costing_request_revision(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_revision_id uuid;
  v_lead_id uuid;
  v_client_email text;
begin
  select lead_id, client_email
    into v_lead_id, v_client_email
  from public.costing_requests
  where id = p_request_id;

  v_revision_id := public.create_costing_request_revision_legacy(p_request_id);

  update public.costing_requests
  set lead_id = v_lead_id,
      client_email = v_client_email,
      updated_at = now()
  where id = v_revision_id;

  return v_revision_id;
end;
$$;

revoke execute on function public.create_costing_request_revision_legacy(uuid) from public, anon, authenticated;
revoke execute on function public.create_costing_request_revision(uuid) from public, anon;
grant execute on function public.create_costing_request_revision(uuid) to authenticated;

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
  if not v_request.production_assumptions_confirmed then
    raise exception 'Confirm the production assumptions before submitting this costing request';
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
    raise exception 'Enter positive production assumptions for every material used by this costing request';
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

revoke execute on function public.submit_costing_request(uuid) from public, anon;
grant execute on function public.submit_costing_request(uuid) to authenticated;

commit;
