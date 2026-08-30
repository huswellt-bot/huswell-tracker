-- Reserve each organization due date for one non-rejected project schedule at a time.
-- This applies to new schedules, rejected-schedule resubmissions, and
-- General Manager-approved schedule revisions without changing old records.

create or replace function public.assert_project_schedule_due_date_available(
  p_organization_id uuid,
  p_due_date date,
  p_exclude_schedule_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_due_date is null then
    return;
  end if;

  -- Serializing each organization/date pair also protects against two users
  -- selecting the same available date at the same time.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_due_date::text, 0)
  );

  if exists (
    select 1
    from public.project_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.due_date = p_due_date
      and schedule.id is distinct from p_exclude_schedule_id
      and schedule.status <> 'rejected'::public.approval_status
  ) then
    raise exception 'This due date is already assigned to another project';
  end if;
end;
$$;

create or replace function public.enforce_unique_project_schedule_due_date()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- Rejected submissions do not reserve production capacity. They are checked
  -- again automatically if they are resubmitted as pending.
  if new.status = 'rejected'::public.approval_status then
    return new;
  end if;

  perform public.assert_project_schedule_due_date_available(
    new.organization_id,
    new.due_date,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists project_schedules_unique_due_date
  on public.project_schedules;
create trigger project_schedules_unique_due_date
before insert or update of organization_id, due_date, status
on public.project_schedules
for each row execute function public.enforce_unique_project_schedule_due_date();

-- Catch an unavailable date while the requester submits a revision instead of
-- making the General Manager discover it only when reviewing the request.
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

  perform public.assert_project_schedule_due_date_available(
    v_schedule.organization_id,
    p_due_date,
    v_schedule.id
  );

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

revoke all on function public.assert_project_schedule_due_date_available(uuid, date, uuid) from public;
revoke all on function public.enforce_unique_project_schedule_due_date() from public;
revoke all on function public.request_project_schedule_revision(uuid, date, date) from public;
grant execute on function public.request_project_schedule_revision(uuid, date, date) to authenticated;
