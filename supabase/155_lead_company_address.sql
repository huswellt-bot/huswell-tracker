-- Carry the existing Lead Company Address field through every Lead / Project
-- edit path and show it in the generated quotation PDF.
-- Run after migration 154.

begin;

-- Migration 063 introduced these columns. Keep the feature migration safe to
-- re-run on installations whose schema cache is missing either additive field.
alter table public.leads
  add column if not exists address text;

alter table public.quotations
  add column if not exists client_address text;

-- Preserve both request signatures used by older clients and the current
-- workspace while allowing Company Address to pass the officer boundary.
create or replace function public.request_lead_change(
  p_lead_id uuid,
  p_change_type text,
  p_proposed_changes jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_changes jsonb;
  v_request_id uuid;
begin
  if p_change_type not in ('update', 'delete') then
    raise exception 'Unsupported lead change type';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.has_text_role(v_lead.organization_id, array['project_manager'])
    or (
      v_lead.created_by is distinct from (select auth.uid())
      and not private.can_prepare_endorsed_lead(
        v_lead.organization_id,
        v_lead.assigned_to,
        v_lead.endorsed_to
      )
    ) then
    raise exception 'Only the authorized Sales Project Officer can request a change';
  end if;

  if p_change_type = 'update' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
    from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
    where key = any (array[
      'project_name', 'contact_name', 'client_name', 'address', 'email', 'phone',
      'date_sent', 'date_contacted', 'contact_method', 'evaluation_number',
      'done_deal_status'
    ]);
    if v_changes = '{}'::jsonb then
      raise exception 'Include at least one lead field to edit';
    end if;
  else
    v_changes := '{}'::jsonb;
  end if;

  insert into public.lead_change_requests (
    organization_id, lead_id, change_type, proposed_changes, submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes,
    (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_lead_change(uuid, text, jsonb) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb) to authenticated;

create or replace function public.request_lead_change(
  p_lead_id uuid,
  p_change_type text,
  p_proposed_changes jsonb,
  p_request_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_changes jsonb;
  v_request_note text := nullif(btrim(coalesce(p_request_note, '')), '');
  v_request_id uuid;
begin
  if p_change_type not in ('update', 'delete') then
    raise exception 'Unsupported lead change type';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.can_prepare_endorsed_lead(
    v_lead.organization_id,
    v_lead.assigned_to,
    v_lead.endorsed_to
  ) then
    raise exception 'Only the authorized Sales Project Officer can request a change';
  end if;

  if p_change_type = 'update' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
    from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
    where key = any (array[
      'project_name', 'contact_name', 'client_name', 'address', 'email', 'phone',
      'date_sent', 'date_contacted', 'contact_method', 'evaluation_number',
      'done_deal_status'
    ]);
    if v_changes = '{}'::jsonb then
      raise exception 'Include at least one lead field to edit';
    end if;
    if (v_changes ->> 'evaluation_number') = '3'
      and coalesce(v_lead.evaluation_number, 0) <> 3
      and v_request_note is null then
      raise exception 'A dropped client reason is required';
    end if;
  else
    if v_request_note is null then
      raise exception 'A deletion reason is required';
    end if;
    v_changes := '{}'::jsonb;
  end if;

  insert into public.lead_change_requests (
    organization_id, lead_id, change_type, proposed_changes, request_note,
    submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes,
    v_request_note, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_lead_change(uuid, text, jsonb, text) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb, text) to authenticated;

create or replace function public.request_project_edit(
  p_project_id uuid,
  p_proposed_changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_project public.leads%rowtype;
  v_changes jsonb;
  v_request_id uuid;
begin
  select * into v_project from public.leads where id = p_project_id for update;
  if not found or v_project.evaluation_number is distinct from 7 then
    raise exception 'Project not found';
  end if;
  if not private.has_text_role(v_project.organization_id, array['project_manager'])
    or (
      v_project.created_by is distinct from (select auth.uid())
      and not private.can_prepare_endorsed_lead(
        v_project.organization_id,
        v_project.assigned_to,
        v_project.endorsed_to
      )
    ) then
    raise exception 'Only the authorized Sales Project Officer can request an edit';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_changes
  from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
  where key = any (array[
    'project_name', 'contact_name', 'client_name', 'address', 'email', 'phone',
    'date_sent', 'date_contacted', 'contact_method', 'outbound_caller',
    'done_deal_status'
  ]);

  if v_changes = '{}'::jsonb then
    raise exception 'Include at least one project field to edit';
  end if;

  insert into public.project_edit_requests (
    organization_id, project_id, proposed_changes, submitted_by
  ) values (
    v_project.organization_id, v_project.id, v_changes, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A project edit request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_project_edit(uuid, jsonb) from public;
grant execute on function public.request_project_edit(uuid, jsonb) to authenticated;

create or replace function public.review_project_edit(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_edit_requests%rowtype;
  v_changes jsonb;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported project edit decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter a revision note before returning this project edit';
  end if;

  select * into v_request
  from public.project_edit_requests
  where id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Project edit request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project edits';
  end if;

  v_changes := v_request.proposed_changes;
  if p_decision = 'approved' then
    update public.leads project
    set project_name = case when v_changes ? 'project_name' then nullif(btrim(v_changes->>'project_name'), '') else project.project_name end,
        contact_name = case when v_changes ? 'contact_name' then nullif(btrim(v_changes->>'contact_name'), '') else project.contact_name end,
        client_name = case when v_changes ? 'client_name' then nullif(btrim(v_changes->>'client_name'), '') else project.client_name end,
        address = case when v_changes ? 'address' then nullif(btrim(v_changes->>'address'), '') else project.address end,
        email = case when v_changes ? 'email' then nullif(btrim(v_changes->>'email'), '') else project.email end,
        phone = case when v_changes ? 'phone' then nullif(btrim(v_changes->>'phone'), '') else project.phone end,
        date_sent = case when v_changes ? 'date_sent' then nullif(v_changes->>'date_sent', '')::date else project.date_sent end,
        date_contacted = case when v_changes ? 'date_contacted' then nullif(v_changes->>'date_contacted', '')::date else project.date_contacted end,
        contact_method = case when v_changes ? 'contact_method' then nullif(btrim(v_changes->>'contact_method'), '') else project.contact_method end,
        outbound_caller = case when v_changes ? 'outbound_caller' then nullif(btrim(v_changes->>'outbound_caller'), '') else project.outbound_caller end,
        done_deal_status = case when v_changes ? 'done_deal_status' then nullif(v_changes->>'done_deal_status', '')::integer else project.done_deal_status end
    where project.id = v_request.project_id;
  end if;

  update public.project_edit_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where id = v_request.id;

  return v_request.project_id;
end;
$$;

revoke all on function public.review_project_edit(uuid, text, text) from public;
grant execute on function public.review_project_edit(uuid, text, text) to authenticated;

create or replace function public.review_lead_change(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.lead_change_requests%rowtype;
  v_changes jsonb;
  v_lead_id uuid;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision', 'rejected') then
    raise exception 'Unsupported lead change decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter a revision note before returning this lead edit';
  end if;

  select * into v_request
  from public.lead_change_requests
  where id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Lead change request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review lead changes';
  end if;
  if v_request.lead_id is null then
    raise exception 'The lead for this request no longer exists';
  end if;
  if p_decision = 'needs_revision' and v_request.change_type <> 'update' then
    raise exception 'Only lead edits can be returned for revision';
  end if;

  v_lead_id := v_request.lead_id;
  v_changes := v_request.proposed_changes;
  if p_decision = 'approved' and v_request.change_type = 'update' then
    update public.leads lead
    set project_name = case when v_changes ? 'project_name' then nullif(btrim(v_changes->>'project_name'), '') else lead.project_name end,
        contact_name = case when v_changes ? 'contact_name' then nullif(btrim(v_changes->>'contact_name'), '') else lead.contact_name end,
        client_name = case when v_changes ? 'client_name' then nullif(btrim(v_changes->>'client_name'), '') else lead.client_name end,
        address = case when v_changes ? 'address' then nullif(btrim(v_changes->>'address'), '') else lead.address end,
        email = case when v_changes ? 'email' then nullif(btrim(v_changes->>'email'), '') else lead.email end,
        phone = case when v_changes ? 'phone' then nullif(btrim(v_changes->>'phone'), '') else lead.phone end,
        date_sent = case when v_changes ? 'date_sent' then nullif(v_changes->>'date_sent', '')::date else lead.date_sent end,
        date_contacted = case when v_changes ? 'date_contacted' then nullif(v_changes->>'date_contacted', '')::date else lead.date_contacted end,
        contact_method = case when v_changes ? 'contact_method' then nullif(btrim(v_changes->>'contact_method'), '') else lead.contact_method end,
        evaluation_number = case when v_changes ? 'evaluation_number' then nullif(v_changes->>'evaluation_number', '')::integer else lead.evaluation_number end,
        done_deal_status = case when v_changes ? 'done_deal_status' then nullif(v_changes->>'done_deal_status', '')::integer else lead.done_deal_status end
    where lead.id = v_lead_id;
  end if;

  update public.lead_change_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where id = v_request.id;

  if p_decision = 'approved' and v_request.change_type = 'delete' then
    perform public.delete_lead_as_general_manager(v_lead_id);
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.review_lead_change(uuid, text, text) from public;
grant execute on function public.review_lead_change(uuid, text, text) to authenticated;

commit;
