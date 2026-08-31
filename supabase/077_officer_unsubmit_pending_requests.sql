-- Project Officers may withdraw only their own pending requests. Requests are
-- retained as cancelled for audit history; the live record is never changed.

create or replace function public.unsubmit_project_edit(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_edit_requests%rowtype;
begin
  select * into v_request from public.project_edit_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only pending project edit requests can be unsubmitted';
  end if;
  if v_request.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_request.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who submitted this project edit can unsubmit it';
  end if;

  update public.project_edit_requests
  set status = 'cancelled', decision_note = 'Unsubmitted by the Project Officer.',
      decided_by = null, decided_at = null
  where id = v_request.id;
  return v_request.project_id;
end;
$$;
revoke all on function public.unsubmit_project_edit(uuid) from public;
grant execute on function public.unsubmit_project_edit(uuid) to authenticated;

create or replace function public.unsubmit_lead_change(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.lead_change_requests%rowtype;
begin
  select * into v_request from public.lead_change_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only pending lead change requests can be unsubmitted';
  end if;
  if v_request.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_request.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who submitted this lead change can unsubmit it';
  end if;

  update public.lead_change_requests
  set status = 'cancelled', decision_note = 'Unsubmitted by the Project Officer.',
      decided_by = null, decided_at = null
  where id = v_request.id;
  return v_request.lead_id;
end;
$$;
revoke all on function public.unsubmit_lead_change(uuid) from public;
grant execute on function public.unsubmit_lead_change(uuid) to authenticated;

create or replace function public.unsubmit_price_quotation_revision(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.price_quotation_revision_requests%rowtype;
begin
  select * into v_request from public.price_quotation_revision_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only pending Price Quotation revision requests can be unsubmitted';
  end if;
  if v_request.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_request.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who submitted this Price Quotation revision can unsubmit it';
  end if;

  update public.price_quotation_revision_requests
  set status = 'cancelled', decided_by = null, decided_at = null
  where id = v_request.id;
  return v_request.quotation_id;
end;
$$;
revoke all on function public.unsubmit_price_quotation_revision(uuid) from public;
grant execute on function public.unsubmit_price_quotation_revision(uuid) to authenticated;

create or replace function public.unsubmit_project_schedule_revision(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_schedule_revision_requests%rowtype;
begin
  select * into v_request from public.project_schedule_revision_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only pending project schedule revisions can be unsubmitted';
  end if;
  if v_request.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_request.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who submitted this schedule revision can unsubmit it';
  end if;

  update public.project_schedule_revision_requests
  set status = 'cancelled', decision_note = 'Unsubmitted by the Project Officer.',
      decided_by = null, decided_at = null
  where id = v_request.id;
  return v_request.schedule_id;
end;
$$;
revoke all on function public.unsubmit_project_schedule_revision(uuid) from public;
grant execute on function public.unsubmit_project_schedule_revision(uuid) to authenticated;

create or replace function public.unsubmit_project_schedule_completion(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_schedule_completion_requests%rowtype;
begin
  select * into v_request from public.project_schedule_completion_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only pending project completion requests can be unsubmitted';
  end if;
  if v_request.submitted_by is distinct from (select auth.uid())
    or not private.has_text_role(v_request.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who submitted this project completion can unsubmit it';
  end if;

  update public.project_schedule_completion_requests
  set status = 'cancelled', decision_note = 'Unsubmitted by the Project Officer.',
      decided_by = null, decided_at = null
  where id = v_request.id;
  return v_request.schedule_id;
end;
$$;
revoke all on function public.unsubmit_project_schedule_completion(uuid) from public;
grant execute on function public.unsubmit_project_schedule_completion(uuid) to authenticated;
