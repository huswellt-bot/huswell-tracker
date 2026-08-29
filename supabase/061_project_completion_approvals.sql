-- General Manager-approved completion for Project Calendar schedules.
-- Run after 060_project_schedule_revisions.sql.
-- A completion approval marks the project finished, delivers its production job,
-- and keeps the linked Lead at the Completed Project stage.

alter table public.project_schedules
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

create table if not exists public.project_schedule_completion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.project_schedules(id) on delete cascade,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_schedule_completion_requests_org_status_idx
  on public.project_schedule_completion_requests (organization_id, status, submitted_at desc);

create unique index if not exists project_schedule_completion_requests_one_pending_per_schedule_idx
  on public.project_schedule_completion_requests (schedule_id)
  where status = 'pending'::public.approval_status;

drop trigger if exists project_schedule_completion_requests_updated_at
  on public.project_schedule_completion_requests;
create trigger project_schedule_completion_requests_updated_at
before update on public.project_schedule_completion_requests
for each row execute function public.set_updated_at();

alter table public.project_schedule_completion_requests enable row level security;

drop policy if exists "project schedule completions: workflow read"
  on public.project_schedule_completion_requests;
create policy "project schedule completions: workflow read"
on public.project_schedule_completion_requests for select to authenticated
using (
  submitted_by = (select auth.uid())
  or (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Browser users may only read request records. Creation and review happen
-- through narrowly scoped security-definer functions below.
revoke all on public.project_schedule_completion_requests from public;
grant select on public.project_schedule_completion_requests to authenticated;

create or replace function public.request_project_schedule_completion(
  p_schedule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_request_id uuid;
begin
  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found or v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'Only an approved project schedule can be completed';
  end if;

  if v_schedule.completed_at is not null then
    raise exception 'This project has already been completed';
  end if;

  if exists (
    select 1
    from public.project_schedule_revision_requests
    where schedule_id = v_schedule.id
      and status = 'pending'::public.approval_status
  ) then
    raise exception 'Review the pending project schedule revision before requesting completion';
  end if;

  if not (
    private.has_text_role(v_schedule.organization_id, array['owner', 'admin'])
    or (
      private.has_text_role(v_schedule.organization_id, array['project_manager'])
      and v_schedule.assigned_to = (select auth.uid())
      and v_schedule.created_by = (select auth.uid())
    )
  ) then
    raise exception 'Only the assigned Project Officer or General Manager can request project completion';
  end if;

  insert into public.project_schedule_completion_requests (
    organization_id,
    schedule_id,
    submitted_by
  ) values (
    v_schedule.organization_id,
    v_schedule.id,
    (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A project completion request is already awaiting General Manager approval';
end;
$$;

create or replace function public.review_project_schedule_completion(
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
  v_request public.project_schedule_completion_requests%rowtype;
  v_schedule public.project_schedules%rowtype;
  v_quotation public.quotations%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project completion decision';
  end if;

  select * into v_request
  from public.project_schedule_completion_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending'::public.approval_status then
    raise exception 'Project completion request is no longer pending';
  end if;

  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project completion requests';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = v_request.schedule_id
  for update;

  if not found or v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'This project schedule is no longer available for completion';
  end if;

  if v_schedule.completed_at is not null then
    raise exception 'This project has already been completed';
  end if;

  if p_decision = 'approved' then
    select * into v_quotation
    from public.quotations
    where id = v_schedule.quotation_id
      and organization_id = v_schedule.organization_id;

    if not found or v_quotation.document_type is distinct from 'price_quotation' then
      raise exception 'The project schedule no longer has a valid Price Quotation';
    end if;

    update public.project_schedules
    set
      completed_at = now(),
      completed_by = (select auth.uid())
    where id = v_schedule.id;

    -- A Production Job normally exists when the Price Quotation was approved.
    -- If an older record has none, the completion still remains valid and is
    -- recorded on the project schedule and linked Lead.
    update public.production_jobs
    set
      status = 'delivered'::public.production_status,
      completed_at = coalesce(completed_at, now()),
      delivered_at = coalesce(delivered_at, now())
    where organization_id = v_schedule.organization_id
      and quotation_id = v_schedule.quotation_id
      and status <> 'cancelled'::public.production_status;

    update public.leads
    set done_deal_status = greatest(coalesce(done_deal_status, 0), 12)
    where id = v_quotation.lead_id
      and organization_id = v_schedule.organization_id
      and evaluation_number = 7;
  end if;

  update public.project_schedule_completion_requests
  set
    status = p_decision::public.approval_status,
    decided_by = (select auth.uid()),
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;

  return v_schedule.id;
end;
$$;

-- Completed schedules cannot be reopened for a date revision. A pending
-- completion request also blocks new revision requests so the General Manager
-- always decides one project state change at a time.
create or replace function public.request_project_schedule_revision(
  p_schedule_id uuid,
  p_start_date date,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_request_id uuid;
begin
  if p_start_date is null or p_due_date is null or p_due_date < p_start_date then
    raise exception 'Enter a valid start date and due date';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found
    or v_schedule.status <> 'approved'::public.approval_status
    or v_schedule.completed_at is not null then
    raise exception 'Only an incomplete, approved project schedule can be revised';
  end if;

  if exists (
    select 1
    from public.project_schedule_completion_requests
    where schedule_id = v_schedule.id
      and status = 'pending'::public.approval_status
  ) then
    raise exception 'A project completion request is already awaiting General Manager approval';
  end if;

  if not (
    private.has_text_role(v_schedule.organization_id, array['owner', 'admin'])
    or (
      private.has_text_role(v_schedule.organization_id, array['project_manager'])
      and v_schedule.assigned_to = (select auth.uid())
      and v_schedule.created_by = (select auth.uid())
    )
  ) then
    raise exception 'Only the assigned Project Officer or General Manager can request a project schedule revision';
  end if;

  insert into public.project_schedule_revision_requests (
    organization_id,
    schedule_id,
    proposed_start_date,
    proposed_due_date,
    submitted_by
  ) values (
    v_schedule.organization_id,
    v_schedule.id,
    p_start_date,
    p_due_date,
    (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A project schedule revision is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_project_schedule_completion(uuid) from public;
grant execute on function public.request_project_schedule_completion(uuid) to authenticated;
revoke all on function public.review_project_schedule_completion(uuid, text, text) from public;
grant execute on function public.review_project_schedule_completion(uuid, text, text) to authenticated;
revoke all on function public.request_project_schedule_revision(uuid, date, date) from public;
grant execute on function public.request_project_schedule_revision(uuid, date, date) to authenticated;
