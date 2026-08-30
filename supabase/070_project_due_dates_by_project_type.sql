-- Replace the date-only project calendar guard with a date-and-project-type
-- guard. Different project types may share a due date; a project type may not.
-- Existing schedules are preserved unchanged.

create or replace function public.assert_project_schedule_due_date_available(
  p_organization_id uuid,
  p_due_date date,
  p_project_type text,
  p_exclude_schedule_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_project_type text := coalesce(nullif(btrim(coalesce(p_project_type, '')), ''), 'Unspecified');
begin
  if p_due_date is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_due_date::text || ':' || lower(v_project_type),
      0
    )
  );

  if exists (
    select 1
    from public.project_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.due_date = p_due_date
      and schedule.id is distinct from p_exclude_schedule_id
      and schedule.status <> 'rejected'::public.approval_status
      and lower(coalesce(nullif(btrim(schedule.product_name), ''), 'Unspecified')) = lower(v_project_type)
  ) then
    raise exception 'This Project Type already has a project due on that date';
  end if;

  if exists (
    select 1
    from public.project_schedule_revision_requests request
    join public.project_schedules schedule on schedule.id = request.schedule_id
    where schedule.organization_id = p_organization_id
      and request.proposed_due_date = p_due_date
      and request.schedule_id is distinct from p_exclude_schedule_id
      and request.status = 'pending'::public.approval_status
      and lower(coalesce(nullif(btrim(schedule.product_name), ''), 'Unspecified')) = lower(v_project_type)
  ) then
    raise exception 'This Project Type already has a project due on that date';
  end if;
end;
$$;

-- Compatibility for the revision workflow installed by migration 068. Its
-- current schedule id identifies the project type to check.
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
declare
  v_project_type text;
begin
  select product_name into v_project_type
  from public.project_schedules
  where id = p_exclude_schedule_id;

  perform public.assert_project_schedule_due_date_available(
    p_organization_id,
    p_due_date,
    v_project_type,
    p_exclude_schedule_id
  );
end;
$$;

create or replace function public.enforce_unique_project_schedule_due_date()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'rejected'::public.approval_status then
    return new;
  end if;

  perform public.assert_project_schedule_due_date_available(
    new.organization_id,
    new.due_date,
    new.product_name,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists project_schedules_unique_due_date
  on public.project_schedules;
create trigger project_schedules_unique_due_date
before insert or update of organization_id, due_date, product_name, status
on public.project_schedules
for each row execute function public.enforce_unique_project_schedule_due_date();

-- Reject an unavailable revision date while the request is being created,
-- instead of waiting for General Manager approval.
create or replace function public.enforce_project_schedule_revision_due_date_by_type()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
begin
  select * into v_schedule
  from public.project_schedules
  where id = new.schedule_id;

  if not found then
    raise exception 'Project schedule was not found';
  end if;

  perform public.assert_project_schedule_due_date_available(
    v_schedule.organization_id,
    new.proposed_due_date,
    v_schedule.product_name,
    v_schedule.id
  );
  return new;
end;
$$;

drop trigger if exists project_schedule_revisions_unique_due_date
  on public.project_schedule_revision_requests;
create trigger project_schedule_revisions_unique_due_date
before insert or update of schedule_id, proposed_due_date
on public.project_schedule_revision_requests
for each row execute function public.enforce_project_schedule_revision_due_date_by_type();

revoke all on function public.assert_project_schedule_due_date_available(uuid, date, text, uuid) from public;
revoke all on function public.assert_project_schedule_due_date_available(uuid, date, uuid) from public;
revoke all on function public.enforce_unique_project_schedule_due_date() from public;
revoke all on function public.enforce_project_schedule_revision_due_date_by_type() from public;
