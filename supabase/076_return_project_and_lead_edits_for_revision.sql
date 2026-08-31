-- Project and lead edits follow a draft-review-revision workflow.
-- A returned request leaves the live record unchanged. The Project Officer can
-- edit the current record and submit a new request after addressing the note.

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
    delete from public.leads where id = v_lead_id;
  end if;

  return v_lead_id;
end;
$$;
revoke all on function public.review_lead_change(uuid, text, text) from public;
grant execute on function public.review_lead_change(uuid, text, text) to authenticated;
