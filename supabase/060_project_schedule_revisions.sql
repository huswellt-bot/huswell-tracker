-- General Manager-approved revisions for Project Calendar schedules.
-- Run after 059_atomic_general_approval_decisions.sql.
-- Existing approved schedules remain active until a proposed revision is approved.

create table if not exists public.project_schedule_revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.project_schedules(id) on delete cascade,
  proposed_start_date date not null,
  proposed_due_date date not null,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_schedule_revision_requests_dates_check
    check (proposed_due_date >= proposed_start_date)
);

create index if not exists project_schedule_revision_requests_org_status_idx
  on public.project_schedule_revision_requests (organization_id, status, submitted_at desc);

create unique index if not exists project_schedule_revision_requests_one_pending_per_schedule_idx
  on public.project_schedule_revision_requests (schedule_id)
  where status = 'pending'::public.approval_status;

drop trigger if exists project_schedule_revision_requests_updated_at
  on public.project_schedule_revision_requests;
create trigger project_schedule_revision_requests_updated_at
before update on public.project_schedule_revision_requests
for each row execute function public.set_updated_at();

alter table public.project_schedule_revision_requests enable row level security;

drop policy if exists "project schedule revisions: workflow read"
  on public.project_schedule_revision_requests;
create policy "project schedule revisions: workflow read"
on public.project_schedule_revision_requests for select to authenticated
using (
  submitted_by = (select auth.uid())
  or (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Revisions are created through the security-definer function below. Browser
-- users receive read-only access to the request records.
revoke all on public.project_schedule_revision_requests from public;
grant select on public.project_schedule_revision_requests to authenticated;

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

  if not found or v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'Only an approved project schedule can be revised';
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

create or replace function public.review_project_schedule_revision(
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
  v_request public.project_schedule_revision_requests%rowtype;
  v_schedule public.project_schedules%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project schedule revision decision';
  end if;

  select * into v_request
  from public.project_schedule_revision_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending'::public.approval_status then
    raise exception 'Project schedule revision request is no longer pending';
  end if;

  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project schedule revisions';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = v_request.schedule_id
  for update;

  if not found or v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'This project schedule is no longer available for revision';
  end if;

  if p_decision = 'approved' then
    update public.project_schedules
    set
      start_date = v_request.proposed_start_date,
      due_date = v_request.proposed_due_date
    where id = v_schedule.id;
  end if;

  update public.project_schedule_revision_requests
  set
    status = p_decision::public.approval_status,
    decided_by = (select auth.uid()),
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;

  return v_schedule.id;
end;
$$;

revoke all on function public.request_project_schedule_revision(uuid, date, date) from public;
grant execute on function public.request_project_schedule_revision(uuid, date, date) to authenticated;
revoke all on function public.review_project_schedule_revision(uuid, text, text) from public;
grant execute on function public.review_project_schedule_revision(uuid, text, text) to authenticated;
