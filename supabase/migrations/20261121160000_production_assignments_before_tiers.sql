-- Box Maker assignments may be created before project tier percentages.
-- Tiers are shared by all assignments and can be added afterward.

create or replace function public.create_production_box_maker_assignment(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_labor_cost numeric(14,2) := round(coalesce(p_labor_cost, 0), 2);
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_labor_cost < 0 then
    raise exception 'Total labor cost cannot be negative';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;
  if not exists (
    select 1
    from public.production_box_makers maker
    where maker.id = p_box_maker_id
      and maker.organization_id = p_organization_id
      and maker.is_active
  ) then
    raise exception 'Select an active Box Maker';
  end if;
  if exists (
    select 1
    from public.production_box_maker_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.production_job_id = p_production_job_id
      and assignment.box_maker_id = p_box_maker_id
      and assignment.is_active
  ) then
    raise exception 'This Box Maker is already assigned to the Production project';
  end if;

  insert into public.production_box_maker_assignments (
    organization_id, production_job_id, box_maker_id,
    labor_cost, cash_advance, due_date, created_by, updated_by
  )
  values (
    p_organization_id, p_production_job_id, p_box_maker_id,
    v_labor_cost, 0, p_due_date,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
