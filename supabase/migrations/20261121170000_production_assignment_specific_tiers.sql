-- Store tier percentages per Box Maker assignment instead of per Production project.
-- Existing shared project tiers are copied to each active assignment below so the
-- current Production data remains visible after the new workflow is enabled.

create table if not exists public.production_box_maker_assignment_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  assignment_id uuid not null references public.production_box_maker_assignments(id) on delete cascade,
  tier_number smallint not null check (tier_number between 1 and 4),
  percentage numeric(5,2) not null check (
    percentage >= 1
    and percentage <= 100
    and percentage = trunc(percentage)
  ),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_assignment_tiers_active_state_check
    check ((is_active and archived_at is null) or not is_active)
);

create unique index if not exists production_assignment_tiers_active_number_key
  on public.production_box_maker_assignment_tiers (assignment_id, tier_number)
  where is_active;
create index if not exists production_assignment_tiers_org_job_assignment_idx
  on public.production_box_maker_assignment_tiers (
    organization_id, production_job_id, assignment_id, is_active, tier_number
  );

alter table public.production_box_maker_assignment_tiers enable row level security;

revoke all on public.production_box_maker_assignment_tiers
from public, anon, authenticated;

drop policy if exists "production assignment tiers: operations read"
  on public.production_box_maker_assignment_tiers;
create policy "production assignment tiers: operations read"
on public.production_box_maker_assignment_tiers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop trigger if exists production_assignment_tiers_updated_at
  on public.production_box_maker_assignment_tiers;
create trigger production_assignment_tiers_updated_at
before update on public.production_box_maker_assignment_tiers
for each row execute function public.set_updated_at();

-- The legacy project-level table is retained for rolling-client compatibility,
-- but whole-number percentages are now required everywhere.
do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname = 'production_project_tiers'
      and constraint_row.conname = 'production_project_tiers_whole_percentage_check'
  ) then
    alter table public.production_project_tiers
      add constraint production_project_tiers_whole_percentage_check
      check (percentage = trunc(percentage));
  end if;
end;
$$;

-- Preserve the existing project-level tier values for every active assignment.
-- Legacy fractional values, if present in an older environment, are rounded to
-- the new whole-number rule during this one-time compatibility copy.
insert into public.production_box_maker_assignment_tiers (
  organization_id,
  production_job_id,
  assignment_id,
  tier_number,
  percentage,
  created_by,
  updated_by
)
select
  assignment.organization_id,
  assignment.production_job_id,
  assignment.id,
  tier.tier_number,
  greatest(1::numeric, least(100::numeric, round(tier.percentage)))::numeric(5,2),
  tier.created_by,
  tier.updated_by
from public.production_project_tiers tier
join public.production_box_maker_assignments assignment
  on assignment.organization_id = tier.organization_id
 and assignment.production_job_id = tier.production_job_id
 and assignment.is_active
where tier.is_active
on conflict do nothing;

create or replace function public.get_production_operator_details(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
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

  return jsonb_build_object(
    -- Keep the legacy top-level shape for older clients during rollout.
    'tiers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', tier.id,
            'tier_number', tier.display_number,
            'percentage', tier.percentage
          )
          order by tier.display_number
        )
        from (
          select tier.id,
            tier.percentage,
            row_number() over (order by tier.tier_number, tier.created_at, tier.id) as display_number
          from public.production_project_tiers tier
          where tier.organization_id = p_organization_id
            and tier.production_job_id = p_production_job_id
            and tier.is_active
        ) tier
      ),
      '[]'::jsonb
    ),
    'box_makers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', maker.id,
            'name', maker.name,
            'is_active', maker.is_active
          )
          order by maker.name
        )
        from public.production_box_makers maker
        where maker.organization_id = p_organization_id
      ),
      '[]'::jsonb
    ),
    'assignments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'box_maker_id', assignment.box_maker_id,
            'box_maker_name', maker.name,
            'tiers', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', assignment_tier.id,
                  'tier_number', assignment_tier.tier_number,
                  'percentage', assignment_tier.percentage
                )
                order by assignment_tier.tier_number
              )
              from public.production_box_maker_assignment_tiers assignment_tier
              where assignment_tier.organization_id = p_organization_id
                and assignment_tier.production_job_id = p_production_job_id
                and assignment_tier.assignment_id = assignment.id
                and assignment_tier.is_active
            ), '[]'::jsonb),
            'labor_cost', assignment.labor_cost,
            'cash_advance', assignment.cash_advance,
            'pending_cash_advance', coalesce((
              select sum(request.requested_amount)
              from public.production_cash_advance_requests request
              where request.assignment_id = assignment.id
                and request.status = 'pending'
            ), 0)::numeric(14,2),
            'balance', round(assignment.labor_cost - assignment.cash_advance, 2),
            'due_date', assignment.due_date
          )
          order by maker.name, assignment.created_at, assignment.id
        )
        from public.production_box_maker_assignments assignment
        join public.production_box_makers maker
          on maker.id = assignment.box_maker_id
         and maker.organization_id = p_organization_id
        where assignment.organization_id = p_organization_id
          and assignment.production_job_id = p_production_job_id
          and assignment.is_active
      ),
      '[]'::jsonb
    ),
    'cash_advance_requests', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', request.id,
            'assignment_id', request.assignment_id,
            'requested_amount', request.requested_amount,
            'approved_amount', request.approved_amount,
            'status', request.status,
            'request_note', request.request_note,
            'decision_note', request.decision_note,
            'requested_at', request.requested_at,
            'decided_at', request.decided_at
          )
          order by request.requested_at desc, request.id desc
        )
        from public.production_cash_advance_requests request
        where request.organization_id = p_organization_id
          and request.production_job_id = p_production_job_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.save_production_box_maker_assignment_with_tiers(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_assignment_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_due_date date default null,
  p_tiers jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_assignment public.production_box_maker_assignments%rowtype;
  v_assignment_id uuid := p_assignment_id;
  v_labor_cost numeric(14,2) := round(coalesce(p_labor_cost, 0), 2);
  v_tier record;
  v_existing_tier_number smallint;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if p_tiers is null then
    p_tiers := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_tiers) <> 'array' then
    raise exception 'Tier data must be an array';
  end if;
  if jsonb_array_length(p_tiers) > 4 then
    raise exception 'A Box Maker can have at most four tiers';
  end if;
  if v_labor_cost < 0 then
    raise exception 'Total labor cost cannot be negative';
  end if;
  if exists (
    select 1
    from (
      select item.tier_number
      from jsonb_to_recordset(p_tiers) as item(tier_number integer)
      group by item.tier_number
      having count(*) > 1
    ) duplicate_tier
  ) then
    raise exception 'Each tier number can only be used once';
  end if;

  for v_tier in
    select *
    from jsonb_to_recordset(p_tiers) as item(
      id uuid,
      tier_number integer,
      percentage numeric
    )
  loop
    if v_tier.tier_number is null or v_tier.tier_number < 1 or v_tier.tier_number > 4 then
      raise exception 'Tier number must be between 1 and 4';
    end if;
    if v_tier.percentage is null
      or v_tier.percentage <> trunc(v_tier.percentage)
      or v_tier.percentage < 1
      or v_tier.percentage > 100 then
      raise exception 'Tier percentage must be a whole number between 1 and 100';
    end if;
  end loop;

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

  if p_assignment_id is null then
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
      organization_id,
      production_job_id,
      box_maker_id,
      labor_cost,
      cash_advance,
      due_date,
      created_by,
      updated_by
    )
    values (
      p_organization_id,
      p_production_job_id,
      p_box_maker_id,
      v_labor_cost,
      0,
      p_due_date,
      (select auth.uid()),
      (select auth.uid())
    )
    returning id into v_assignment_id;
  else
    select *
    into v_assignment
    from public.production_box_maker_assignments assignment
    where assignment.id = p_assignment_id
      and assignment.organization_id = p_organization_id
      and assignment.is_active
    for update;
    if not found then
      raise exception 'Box Maker assignment not found or already archived';
    end if;
    if v_assignment.production_job_id <> p_production_job_id then
      raise exception 'The Box Maker assignment is linked to a different Production project';
    end if;
    if v_assignment.cash_advance > v_labor_cost then
      raise exception 'Total labor cost cannot be lower than the approved cash advances';
    end if;
    if v_assignment.box_maker_id <> p_box_maker_id
      and (
        v_assignment.cash_advance > 0
        or exists (
          select 1
          from public.production_cash_advance_requests request
          where request.assignment_id = v_assignment.id
        )
      ) then
      raise exception 'The Box Maker cannot be changed after a cash advance request; remove the assignment and create a new one';
    end if;
    if not exists (
      select 1
      from public.production_box_makers maker
      where maker.id = p_box_maker_id
        and maker.organization_id = p_organization_id
        and (maker.is_active or maker.id = v_assignment.box_maker_id)
    ) then
      raise exception 'Select an active Box Maker';
    end if;
    if exists (
      select 1
      from public.production_box_maker_assignments assignment
      where assignment.organization_id = p_organization_id
        and assignment.production_job_id = v_assignment.production_job_id
        and assignment.box_maker_id = p_box_maker_id
        and assignment.is_active
        and assignment.id <> p_assignment_id
    ) then
      raise exception 'This Box Maker is already assigned to the Production project';
    end if;

    update public.production_box_maker_assignments assignment
    set box_maker_id = p_box_maker_id,
        labor_cost = v_labor_cost,
        due_date = p_due_date,
        updated_by = (select auth.uid())
    where assignment.id = p_assignment_id;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tiers) as item(id uuid)
    where item.id is not null
      and not exists (
        select 1
        from public.production_box_maker_assignment_tiers tier
        where tier.id = item.id
          and tier.organization_id = p_organization_id
          and tier.production_job_id = p_production_job_id
          and tier.assignment_id = v_assignment_id
          and tier.is_active
      )
  ) then
    raise exception 'One or more selected tiers are not part of this Box Maker assignment';
  end if;

  for v_tier in
    select *
    from jsonb_to_recordset(p_tiers) as item(
      id uuid,
      tier_number integer,
      percentage numeric
    )
  loop
    if v_tier.id is not null then
      select tier.tier_number
      into v_existing_tier_number
      from public.production_box_maker_assignment_tiers tier
      where tier.id = v_tier.id
        and tier.assignment_id = v_assignment_id
        and tier.is_active
      for update;
      if v_existing_tier_number <> v_tier.tier_number then
        raise exception 'Existing tier numbers cannot be changed';
      end if;
    end if;
  end loop;

  update public.production_box_maker_assignment_tiers tier
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where tier.organization_id = p_organization_id
    and tier.production_job_id = p_production_job_id
    and tier.assignment_id = v_assignment_id
    and tier.is_active
    and not exists (
      select 1
      from jsonb_to_recordset(p_tiers) as desired(id uuid)
      where desired.id = tier.id
    );

  for v_tier in
    select *
    from jsonb_to_recordset(p_tiers) as item(
      id uuid,
      tier_number integer,
      percentage numeric
    )
  loop
    if v_tier.id is null then
      insert into public.production_box_maker_assignment_tiers (
        organization_id,
        production_job_id,
        assignment_id,
        tier_number,
        percentage,
        created_by,
        updated_by
      )
      values (
        p_organization_id,
        p_production_job_id,
        v_assignment_id,
        v_tier.tier_number,
        v_tier.percentage,
        (select auth.uid()),
        (select auth.uid())
      );
    else
      update public.production_box_maker_assignment_tiers tier
      set percentage = v_tier.percentage,
          updated_by = (select auth.uid())
      where tier.id = v_tier.id
        and tier.assignment_id = v_assignment_id
        and tier.is_active;
    end if;
  end loop;

  return v_assignment_id;
end;
$$;

create or replace function public.archive_production_box_maker_assignment(
  p_organization_id uuid,
  p_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  update public.production_box_maker_assignments assignment
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;

  update public.production_box_maker_assignment_tiers tier
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where tier.organization_id = p_organization_id
    and tier.assignment_id = p_assignment_id
    and tier.is_active;

  update public.production_cash_advance_requests request
  set status = 'cancelled',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = 'Request cancelled because the Box Maker assignment was removed',
      updated_at = now()
  where request.organization_id = p_organization_id
    and request.assignment_id = p_assignment_id
    and request.status = 'pending';
end;
$$;

revoke all on function public.save_production_box_maker_assignment_with_tiers(
  uuid, uuid, uuid, uuid, numeric, date, jsonb
) from public, anon;
grant execute on function public.save_production_box_maker_assignment_with_tiers(
  uuid, uuid, uuid, uuid, numeric, date, jsonb
) to authenticated;
