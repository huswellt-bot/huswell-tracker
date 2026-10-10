-- Add Lead Coordinator-owned lead deletion and a read-only transferred-leads
-- history query.
-- Run after 198_bulk_lead_coordinator_transfer.sql and before deploying the
-- matching Lead Coordinator workspace update.

begin;

-- Keep the existing General Manager deletion RPC and table DELETE policy
-- unchanged. This separate RPC permits only the original Lead Coordinator
-- owner to remove a lead that has never entered the transfer history.
create or replace function public.delete_lead_as_lead_coordinator(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.has_text_role(v_lead.organization_id, array['lead_coordinator']) then
    raise exception 'Only the Lead Coordinator can use this deletion path';
  end if;
  if v_lead.created_by is distinct from (select auth.uid())
    or v_lead.assigned_to is distinct from (select auth.uid()) then
    raise exception 'Only an untransferred lead added by the current Lead Coordinator can be deleted';
  end if;
  if exists (
    select 1
    from public.lead_transfer_history history
    where history.lead_id = v_lead.id
  ) then
    raise exception 'Transferred leads cannot be deleted by a Lead Coordinator';
  end if;

  perform set_config('huswell.allow_lead_cascade', 'on', true);
  perform private.delete_lead_linked_records(v_lead.id);
  delete from public.leads where id = v_lead.id;

  return v_lead.id;
end;
$$;

revoke all on function public.delete_lead_as_lead_coordinator(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_lead_as_lead_coordinator(uuid)
  to authenticated;

-- Return only transfer events where the current Lead Coordinator was the
-- previous owner. The join supplies the lead details and receiving officer
-- name without widening the active Lead RLS policy to transferred records.
create or replace function public.lead_coordinator_transferred_leads(
  p_organization_id uuid
)
returns table (
  transfer_id uuid,
  lead_id uuid,
  organization_id uuid,
  project_name text,
  contact_name text,
  client_name text,
  evaluation_number integer,
  transferred_to_id uuid,
  transferred_to_name text,
  transferred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if p_organization_id is null
    or not private.has_text_role(p_organization_id, array['lead_coordinator']) then
    raise exception 'Only the Lead Coordinator can view transferred leads';
  end if;

  return query
  select
    history.id,
    history.lead_id,
    history.organization_id,
    lead_row.project_name,
    lead_row.contact_name,
    lead_row.client_name,
    lead_row.evaluation_number,
    history.new_owner_id,
    nullif(btrim(profile.full_name), ''),
    history.transferred_at
  from public.lead_transfer_history history
  join public.leads lead_row
    on lead_row.id = history.lead_id
   and lead_row.organization_id = history.organization_id
  left join public.profiles profile on profile.id = history.new_owner_id
  where history.organization_id = p_organization_id
    and history.previous_owner_id = (select auth.uid())
  order by history.transferred_at desc, history.id desc;
end;
$$;

revoke all on function public.lead_coordinator_transferred_leads(uuid)
  from public, anon, authenticated;
grant execute on function public.lead_coordinator_transferred_leads(uuid)
  to authenticated;

commit;
