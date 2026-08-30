-- Project progress fields and the protected Project Officer update workflow.
-- Run after migration 071.

begin;

alter table public.project_schedules
  add column if not exists progress_percentage numeric(5,2) not null default 0,
  add column if not exists progress_remark text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_schedules_progress_percentage_check'
      and conrelid = 'public.project_schedules'::regclass
  ) then
    alter table public.project_schedules
      add constraint project_schedules_progress_percentage_check
      check (progress_percentage >= 0 and progress_percentage <= 100);
  end if;
end;
$$;

create or replace function public.update_project_schedule_progress(
  p_schedule_id uuid,
  p_progress_percentage numeric,
  p_progress_remark text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_remark text := nullif(btrim(coalesce(p_progress_remark, '')), '');
begin
  if p_progress_percentage is null or p_progress_percentage < 0 or p_progress_percentage > 100 then
    raise exception 'Progress percentage must be between 0 and 100';
  end if;
  if length(coalesce(v_remark, '')) > 1000 then
    raise exception 'Progress remark must be 1,000 characters or fewer';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found or v_schedule.status::text <> 'approved' or v_schedule.completed_at is not null then
    raise exception 'Only an active approved project can be updated';
  end if;
  if not private.has_text_role(v_schedule.organization_id, array['project_manager'])
    or v_schedule.assigned_to is distinct from (select auth.uid())
    or v_schedule.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the assigned Sales Project Officer can update project progress';
  end if;

  update public.project_schedules
  set progress_percentage = round(p_progress_percentage, 2),
      progress_remark = v_remark
  where id = v_schedule.id;
end;
$$;

revoke all on function public.update_project_schedule_progress(uuid, numeric, text) from public;
grant execute on function public.update_project_schedule_progress(uuid, numeric, text) to authenticated;

commit;
