-- Add the controlled lead-unendorsement workflow.
--
-- An endorsement remains permanent history: once a lead has ever been
-- endorsed, endorsement_history_locked stays true, even after an approved
-- unendorsement clears the active recipient columns. This prevents a lead
-- from being endorsed repeatedly and avoids ownership/visibility drift.
-- Run after 148_endorsed_lead_quotation_workflow.sql and before deploying the
-- matching Leads workspace update. Safe to re-run.

begin;

alter table public.leads
  add column if not exists endorsement_history_locked boolean not null default false;

-- Preserve the history lock for existing active endorsements and for every
-- future endorsement. The approved unendorsement RPC only clears active
-- recipient metadata; it never clears this lock.
update public.leads
set endorsement_history_locked = true
where endorsed_by is not null
   or endorsed_to is not null
   or endorsed_at is not null;

create or replace function private.preserve_lead_endorsement_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and coalesce(old.endorsement_history_locked, false)
    and not coalesce(new.endorsement_history_locked, false) then
    new.endorsement_history_locked := true;
  end if;
  if new.endorsed_by is not null
    or new.endorsed_to is not null
    or new.endorsed_at is not null then
    new.endorsement_history_locked := true;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_preserve_endorsement_history on public.leads;
create trigger leads_preserve_endorsement_history
before insert or update on public.leads
for each row execute function private.preserve_lead_endorsement_history();

create table if not exists public.lead_unendorsement_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  endorsed_by uuid not null references auth.users(id) on delete restrict,
  endorsed_to uuid not null references auth.users(id) on delete restrict,
  status public.approval_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_unendorsement_requests_org_status_idx
  on public.lead_unendorsement_requests (organization_id, status, requested_at desc);
create unique index if not exists lead_unendorsement_requests_one_pending_idx
  on public.lead_unendorsement_requests (lead_id)
  where status = 'pending';

drop trigger if exists lead_unendorsement_requests_updated_at
  on public.lead_unendorsement_requests;
create trigger lead_unendorsement_requests_updated_at
before update on public.lead_unendorsement_requests
for each row execute function public.set_updated_at();

alter table public.lead_unendorsement_requests enable row level security;
drop policy if exists "lead unendorsement requests: workflow read"
  on public.lead_unendorsement_requests;
create policy "lead unendorsement requests: workflow read"
on public.lead_unendorsement_requests for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or requested_by = (select auth.uid())
  or endorsed_to = (select auth.uid())
);

-- All writes to the request table go through the two security-definer
-- workflow functions below. No authenticated client can alter a decision or
-- manufacture a request for a different organization.
revoke all on public.lead_unendorsement_requests from authenticated;
grant select on public.lead_unendorsement_requests to authenticated;

create or replace function public.endorse_lead(
  p_lead_id uuid,
  p_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_endorsed_at timestamptz := now();
begin
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select another Sales & Pricing Officer recipient';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;

  if coalesce(v_lead.evaluation_number, 0) = 7 then
    raise exception 'Only Leads can be endorsed';
  end if;

  if coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid())
    or not private.has_text_role(v_lead.organization_id, array['project_manager']) then
    raise exception 'Only the owning Sales Officer can endorse this lead';
  end if;

  if coalesce(v_lead.endorsement_history_locked, false)
    or v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead has already been endorsed and cannot be endorsed again';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;

  update public.leads
  set endorsed_by = (select auth.uid()),
      endorsed_to = p_recipient_user_id,
      endorsed_at = v_endorsed_at,
      endorsement_history_locked = true
  where id = v_lead.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'endorsed',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at,
      'endorsement_history_locked', v_lead.endorsement_history_locked
    ),
    jsonb_build_object(
      'endorsed_by', (select auth.uid()),
      'endorsed_to', p_recipient_user_id,
      'endorsed_at', v_endorsed_at,
      'endorsement_history_locked', true
    )
  );

  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead(uuid, uuid) from public;
grant execute on function public.endorse_lead(uuid, uuid) to authenticated;

create or replace function public.request_lead_unendorsement(
  p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_request_id uuid;
begin
  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;
  if v_lead.endorsed_by is null
    or v_lead.endorsed_to is null
    or v_lead.endorsed_at is null then
    raise exception 'This lead does not have an active endorsement';
  end if;
  if v_lead.endorsed_by is distinct from (select auth.uid())
    or not private.has_text_role(v_lead.organization_id, array['project_manager']) then
    raise exception 'Only the original lead owner can request unendorsement';
  end if;
  if exists (
    select 1
    from public.lead_unendorsement_requests request
    where request.lead_id = v_lead.id
      and request.status = 'pending'
  ) then
    raise exception 'An unendorsement request is already pending for this lead';
  end if;

  insert into public.lead_unendorsement_requests (
    organization_id,
    lead_id,
    requested_by,
    endorsed_by,
    endorsed_to
  ) values (
    v_lead.organization_id,
    v_lead.id,
    (select auth.uid()),
    v_lead.endorsed_by,
    v_lead.endorsed_to
  ) returning id into v_request_id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'unendorsement_requested',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at
    ),
    jsonb_build_object('request_id', v_request_id, 'status', 'pending')
  );

  return v_request_id;
exception
  when unique_violation then
    raise exception 'An unendorsement request is already pending for this lead';
end;
$$;

revoke all on function public.request_lead_unendorsement(uuid) from public;
grant execute on function public.request_lead_unendorsement(uuid) to authenticated;

create or replace function public.review_lead_unendorsement(
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
  v_request public.lead_unendorsement_requests%rowtype;
  v_lead public.leads%rowtype;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported lead unendorsement decision';
  end if;

  select *
    into v_request
  from public.lead_unendorsement_requests
  where id = p_request_id
  for update;

  if not found or v_request.status::text <> 'pending' then
    raise exception 'This unendorsement request is no longer pending';
  end if;

  if not (
    (select private.has_text_role(
      v_request.organization_id,
      array['super_admin', 'owner', 'admin']
    ))
    or (
      v_request.endorsed_to = (select auth.uid())
      and (select private.has_text_role(
        v_request.organization_id,
        array['pricing_officer']
      ))
    )
  ) then
    raise exception 'Only the endorsed Pricing Officer or General Manager can review this request';
  end if;

  select *
    into v_lead
  from public.leads
  where id = v_request.lead_id
  for update;

  if not found
    or v_lead.organization_id is distinct from v_request.organization_id
    or v_lead.endorsed_by is distinct from v_request.endorsed_by
    or v_lead.endorsed_to is distinct from v_request.endorsed_to
    or v_lead.endorsed_at is null then
    raise exception 'The active lead endorsement no longer matches this request';
  end if;

  if p_decision = 'approved' then
    update public.leads
    set endorsed_by = null,
        endorsed_to = null,
        endorsed_at = null
    where id = v_lead.id;

    insert into public.activity_log (
      organization_id,
      actor_id,
      resource_type,
      resource_id,
      action,
      before_data,
      after_data
    ) values (
      v_lead.organization_id,
      (select auth.uid()),
      'lead',
      v_lead.id,
      'unendorsed',
      jsonb_build_object(
        'endorsed_by', v_lead.endorsed_by,
        'endorsed_to', v_lead.endorsed_to,
        'endorsed_at', v_lead.endorsed_at,
        'endorsement_history_locked', v_lead.endorsement_history_locked
      ),
      jsonb_build_object(
        'endorsed_by', null,
        'endorsed_to', null,
        'endorsed_at', null,
        'endorsement_history_locked', true,
        'request_id', v_request.id
      )
    );
  end if;

  update public.lead_unendorsement_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.review_lead_unendorsement(uuid, text, text) from public;
grant execute on function public.review_lead_unendorsement(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lead_unendorsement_requests'
  ) then
    alter publication supabase_realtime
      add table public.lead_unendorsement_requests;
  end if;
end;
$$;

commit;
