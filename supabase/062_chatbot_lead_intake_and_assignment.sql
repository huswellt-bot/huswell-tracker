-- Chatbot lead intake and Sales Project Officer assignment.
-- Run after 061_project_completion_approvals.sql. This is additive, preserves
-- existing leads, and is safe to re-run.

alter table public.leads
  add column if not exists lead_source text not null default 'manual',
  add column if not exists external_lead_id text,
  add column if not exists source_captured_at timestamptz;

alter table public.leads
  drop constraint if exists leads_lead_source_check,
  add constraint leads_lead_source_check
  check (lead_source in ('manual', 'chatbot'));

-- A confirmed chatbot lead can be delivered more than once without creating a
-- duplicate record. NULL external IDs remain valid for manually added leads.
create unique index if not exists leads_chatbot_external_id_idx
  on public.leads (organization_id, lead_source, external_lead_id)
  where external_lead_id is not null;

create index if not exists leads_org_source_created_idx
  on public.leads (organization_id, lead_source, created_at desc);

-- Manual leads stay owned by the Sales Project Officer who creates them.
-- General Managers may now change assigned_to so they can route chatbot leads.
create or replace function public.assign_lead_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.outbound_caller := old.outbound_caller;
    return new;
  end if;

  if actor_id is not null then
    new.created_by := actor_id;
    new.assigned_to := actor_id;
    select nullif(btrim(full_name), '')
      into actor_name
      from public.profiles
      where id = actor_id;
    new.outbound_caller := actor_name;
  end if;

  return new;
end;
$$;
revoke all on function public.assign_lead_creator() from public;

-- General Managers can read every lead. Sales Project Officers see only leads
-- assigned to them, including chatbot leads that were not created by a user.
drop policy if exists "leads: workflow read" on public.leads;
create policy "leads: workflow read"
on public.leads for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or (
    assigned_to = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

-- Assigned Sales Project Officers submit edits for review; General Managers
-- continue to approve or reject the resulting requests.
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
  else
    v_changes := '{}'::jsonb;
  end if;

  insert into public.lead_change_requests (
    organization_id, lead_id, change_type, proposed_changes, submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;
revoke all on function public.request_lead_change(uuid, text, jsonb) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb) to authenticated;
