-- Require a reason when a Sales Project Officer changes a Lead to Dropped
-- Client, and retain that reason for the General Manager's approval review.
-- Run after 090_add_lead_deletion_request_notes.sql.

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
  if v_lead.assigned_to is distinct from (select auth.uid())
    or not private.has_text_role(v_lead.organization_id, array['project_manager']) then
    raise exception 'Only the assigned Sales Project Officer can request a change';
  end if;

  if p_change_type = 'update' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
    from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
    where key = any (array[
      'project_name', 'contact_name', 'client_name', 'email', 'phone',
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
    organization_id, lead_id, change_type, proposed_changes, request_note, submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes, v_request_note,
    (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_lead_change(uuid, text, jsonb, text) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb, text) to authenticated;
