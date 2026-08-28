-- Sales Project Officer lead-change approvals. Run after
-- 043_restrict_lead_reads_to_creators.sql. This migration is additive,
-- preserves existing leads, and is safe to re-run.

-- General Managers can review all organization leads; Sales Project Officers
-- remain limited to leads they created.
alter table public.leads enable row level security;

drop policy if exists "leads: creator read" on public.leads;
drop policy if exists "leads: workflow read" on public.leads;
create policy "leads: workflow read"
on public.leads for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

-- Project Officers submit proposed changes. The source lead is retained for
-- audit when a deletion is approved, so lead_id becomes null after deletion.
create table if not exists public.lead_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  change_type text not null check (change_type in ('update', 'delete')),
  proposed_changes jsonb not null default '{}'::jsonb,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (change_type = 'update'
      and jsonb_typeof(proposed_changes) = 'object'
      and proposed_changes <> '{}'::jsonb)
    or (change_type = 'delete' and proposed_changes = '{}'::jsonb)
  )
);

create index if not exists lead_change_requests_org_status_idx
  on public.lead_change_requests (organization_id, status, submitted_at desc);
create unique index if not exists lead_change_requests_one_pending_per_lead_idx
  on public.lead_change_requests (lead_id)
  where status = 'pending';

drop trigger if exists lead_change_requests_updated_at on public.lead_change_requests;
create trigger lead_change_requests_updated_at
before update on public.lead_change_requests
for each row execute function public.set_updated_at();

alter table public.lead_change_requests enable row level security;
drop policy if exists "lead change requests: workflow read" on public.lead_change_requests;
drop policy if exists "lead change requests: workflow insert" on public.lead_change_requests;
drop policy if exists "lead change requests: general manager decide" on public.lead_change_requests;
create policy "lead change requests: workflow read"
on public.lead_change_requests for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or submitted_by = (select auth.uid())
);
create policy "lead change requests: workflow insert"
on public.lead_change_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.has_text_role(organization_id, array['project_manager']))
  and exists (
    select 1
    from public.leads lead
    where lead.id = lead_change_requests.lead_id
      and lead.organization_id = lead_change_requests.organization_id
      and lead.created_by = (select auth.uid())
  )
);
create policy "lead change requests: general manager decide"
on public.lead_change_requests for update to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
) with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Project Officers cannot update a Lead directly; the controlled review
-- function below is the only way their requested updates take effect.
drop policy if exists "leads: creator or owner update" on public.leads;
drop policy if exists "leads: general manager update" on public.leads;
create policy "leads: general manager update"
on public.leads for update to authenticated
using ((select private.has_text_role(organization_id, array['owner', 'admin'])))
with check ((select private.has_text_role(organization_id, array['owner', 'admin'])));

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
  if v_lead.created_by is distinct from (select auth.uid())
    or not private.has_text_role(v_lead.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who created this lead can request a change';
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
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported lead change decision';
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
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;

  if p_decision = 'approved' and v_request.change_type = 'delete' then
    delete from public.leads where id = v_lead_id;
  end if;

  return v_lead_id;
end;
$$;
revoke all on function public.review_lead_change(uuid, text, text) from public;
grant execute on function public.review_lead_change(uuid, text, text) to authenticated;
