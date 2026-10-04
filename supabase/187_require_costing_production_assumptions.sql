-- Print Costing production-assumption confirmation
-- Run after 186_allow_docx_costing_sources.sql and before deploying the
-- matching workspace update.
--
-- The costing engine can estimate linear metres and rolls from print area,
-- but the supplied HP Latex workbook uses job-specific production inputs.
-- This migration stores the Pricing Officer's confirmation and enforces it
-- at submission while keeping the existing approval/revision workflow.

begin;

alter table public.costing_requests
  add column if not exists production_assumptions_confirmed boolean not null default false;

-- Keep the long-established save implementation as an internal helper. The
-- public wrapper below adds the new confirmation value without changing the
-- existing RPC signature or payload shape for older callers.
do $$
begin
  if to_regprocedure('public.save_costing_request(uuid,uuid,jsonb)') is not null
     and to_regprocedure('public.save_costing_request_legacy(uuid,uuid,jsonb)') is null then
    alter function public.save_costing_request(uuid, uuid, jsonb)
      rename to save_costing_request_legacy;
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
begin
  v_id := public.save_costing_request_legacy(
    p_organization_id,
    p_request_id,
    p_payload
  );

  update public.costing_requests
  set production_assumptions_confirmed =
        lower(coalesce(p_payload->>'production_assumptions_confirmed', 'false')) = 'true',
      updated_at = now()
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.save_costing_request_legacy(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_costing_request(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_costing_request(uuid, uuid, jsonb) to authenticated;

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

-- The existing revision function omits the new column, so the column default
-- intentionally makes every new revision unconfirmed while preserving the
-- copied material assumptions for the officer to review again.

commit;
