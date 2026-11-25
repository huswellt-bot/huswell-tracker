-- Restore the approved Production access boundary and close lifecycle gaps in
-- project archiving, Box Maker payments, built-in statuses, and legacy tiers.

begin;

create or replace function private.can_view_production(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and (
        member.role::text = any (array['super_admin', 'owner', 'admin', 'accountant'])
        or exists (
          select 1
          from public.organization_member_capabilities capability
          where capability.organization_id = member.organization_id
            and capability.user_id = member.user_id
            and capability.capability::text = 'revised_finance'
        )
        or exists (
          select 1
          from public.production_operations_permissions permission
          where permission.organization_id = member.organization_id
            and permission.user_id = member.user_id
            and permission.is_active
        )
      )
  );
$$;

revoke all on function private.can_view_production(uuid) from public, anon;
grant execute on function private.can_view_production(uuid) to authenticated;

-- Older installations may still contain fractional project-level tiers. Round
-- them before adding the compatibility constraint used by rolling clients.
update public.production_project_tiers
set percentage = greatest(1::numeric, least(100::numeric, round(percentage)))
where percentage <> trunc(percentage);

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

create or replace function public.create_production_project_tier(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_percentage numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_percentage numeric(5,2) := round(p_percentage, 2);
  v_tier_number smallint;
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_percentage is null
    or v_percentage <= 0
    or v_percentage > 100
    or v_percentage <> trunc(v_percentage) then
    raise exception 'Tier percentage must be a whole number greater than 0 and no more than 100';
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

  select min(candidates.tier_number)::smallint
  into v_tier_number
  from generate_series(1, 4) as candidates(tier_number)
  where not exists (
    select 1
    from public.production_project_tiers tier
    where tier.organization_id = p_organization_id
      and tier.production_job_id = p_production_job_id
      and tier.tier_number = candidates.tier_number
      and tier.is_active
  );
  if v_tier_number is null then
    raise exception 'A Production project can have at most four tiers';
  end if;

  insert into public.production_project_tiers (
    organization_id, production_job_id, tier_number, percentage, created_by, updated_by
  )
  values (
    p_organization_id, p_production_job_id, v_tier_number, v_percentage,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_production_project_tier(
  p_organization_id uuid,
  p_tier_id uuid,
  p_percentage numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_percentage numeric(5,2) := round(p_percentage, 2);
  v_tier public.production_project_tiers%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_percentage is null
    or v_percentage <= 0
    or v_percentage > 100
    or v_percentage <> trunc(v_percentage) then
    raise exception 'Tier percentage must be a whole number greater than 0 and no more than 100';
  end if;

  select * into v_tier
  from public.production_project_tiers tier
  where tier.id = p_tier_id
    and tier.organization_id = p_organization_id
    and tier.is_active
  for update;
  if not found then
    raise exception 'Tier not found or already archived';
  end if;

  update public.production_project_tiers tier
  set percentage = v_percentage,
      updated_by = (select auth.uid())
  where tier.id = p_tier_id;
end;
$$;

create or replace function public.update_production_status_type(
  p_organization_id uuid,
  p_status_type_id uuid,
  p_name text,
  p_legacy_status public.production_status
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := btrim(p_name);
  v_status public.production_status_types%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Status type names must be between 1 and 80 characters';
  end if;
  if p_legacy_status is null then
    raise exception 'Choose a valid Production status mapping';
  end if;

  select * into v_status
  from public.production_status_types status_type
  where status_type.id = p_status_type_id
    and status_type.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Production status type not found';
  end if;
  if v_status.is_system then
    raise exception 'Built-in Production statuses cannot be edited';
  end if;
  if exists (
    select 1
    from public.production_status_types status_type
    where status_type.organization_id = p_organization_id
      and lower(status_type.name) = lower(v_name)
      and status_type.id <> p_status_type_id
  ) then
    raise exception 'A Production status type with this name already exists';
  end if;

  if exists (
    select 1
    from public.production_jobs job
    where job.organization_id = p_organization_id
      and job.production_status_type_id = p_status_type_id
      and job.status is distinct from p_legacy_status
  ) then
    raise exception 'This status type is already used by Production projects and its mapped stage cannot be changed';
  end if;

  update public.production_status_types
  set name = v_name,
      legacy_status = p_legacy_status,
      updated_by = (select auth.uid())
  where id = p_status_type_id;
end;
$$;

create or replace function public.archive_production_operator_project(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status in ('completed'::public.production_status, 'delivered'::public.production_status) then
    raise exception 'Completed and Delivered projects are final and cannot be removed';
  end if;

  update public.production_cash_advance_requests request
  set status = 'cancelled',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = 'Request cancelled because the Production project was removed',
      updated_at = now()
  where request.organization_id = p_organization_id
    and request.production_job_id = v_job.id
    and request.status = 'pending';

  update public.production_box_maker_assignment_tiers tier
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where tier.organization_id = p_organization_id
    and tier.production_job_id = v_job.id
    and tier.is_active;

  update public.production_box_maker_assignments assignment
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where assignment.organization_id = p_organization_id
    and assignment.production_job_id = v_job.id
    and assignment.is_active;

  update public.production_jobs job
  set production_archived_at = now(),
      production_archived_by = (select auth.uid())
  where job.id = v_job.id;

  insert into public.production_job_activity
    (organization_id, production_job_id, action, note, actor_id)
  values (
    p_organization_id,
    v_job.id,
    'project_archived',
    'Production project archived by operator; pending payment requests cancelled',
    (select auth.uid())
  );
end;
$$;

create or replace function public.resubmit_production_cash_advance(
  p_request_id uuid,
  p_requested_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.production_cash_advance_requests%rowtype;
  v_assignment public.production_box_maker_assignments%rowtype;
  v_fund public.project_funds%rowtype;
  v_job public.production_jobs%rowtype;
  v_amount numeric(14,2) := round(coalesce(p_requested_amount, 0), 2);
  v_new_request_id uuid;
begin
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Payment request not found';
  end if;
  if not private.has_production_operations(v_request.organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_request.requested_by <> (select auth.uid()) then
    raise exception 'Only the original requester can resubmit this payment request';
  end if;
  if v_request.status <> 'needs_revision' then
    raise exception 'Only a payment request marked for revision can be resubmitted';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = v_request.production_job_id
    and job.organization_id = v_request.organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;

  if exists (
    select 1
    from public.production_cash_advance_requests newer
    where newer.assignment_id = v_request.assignment_id
      and (
        newer.requested_at > v_request.requested_at
        or (newer.requested_at = v_request.requested_at and newer.id > v_request.id)
      )
  ) then
    raise exception 'A newer payment request already exists for this Box Maker';
  end if;

  if v_request.project_fund_id is null then
    return public.request_production_cash_advance(
      v_request.organization_id,
      v_request.assignment_id,
      v_amount,
      p_note
    );
  end if;

  if v_amount <= 0 then
    raise exception 'Payment request must be greater than zero';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null
    or length(btrim(p_note)) > 2000 then
    raise exception 'A payment remark between 1 and 2000 characters is required';
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = v_request.assignment_id
    and assignment.organization_id = v_request.organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'needs_revision' then
    raise exception 'Only a payment request marked for revision can be resubmitted';
  end if;
  if exists (
    select 1
    from public.production_cash_advance_requests request
    where request.assignment_id = v_request.assignment_id
      and request.status = 'pending'
  ) then
    raise exception 'This Box Maker already has a payment request awaiting approval';
  end if;
  if v_amount > round(v_assignment.labor_cost - v_assignment.cash_advance, 2) + 0.001 then
    raise exception 'Payment cannot exceed the Box Maker balance';
  end if;

  select * into v_fund
  from public.project_funds fund
  where fund.id = v_request.project_fund_id
    and fund.organization_id = v_request.organization_id
    and fund.status = 'open'
  for update;
  if not found then
    raise exception 'The historical Project Fund is not open';
  end if;

  insert into public.production_cash_advance_requests (
    organization_id, production_job_id, assignment_id, project_fund_id,
    requested_amount, request_note, requested_by
  )
  values (
    v_request.organization_id, v_request.production_job_id, v_request.assignment_id,
    v_request.project_fund_id, v_amount, btrim(p_note), (select auth.uid())
  )
  returning id into v_new_request_id;
  return v_new_request_id;
end;
$$;

create or replace function public.review_production_cash_advance(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.production_cash_advance_requests%rowtype;
  v_assignment public.production_box_maker_assignments%rowtype;
  v_fund public.project_funds%rowtype;
  v_job public.production_jobs%rowtype;
  v_amount numeric(14,2);
  v_available numeric(14,2);
  v_transaction_id uuid;
begin
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Box Maker payment request not found';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Box Maker payments';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = v_request.production_job_id
    and job.organization_id = v_request.organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if p_decision is null
    or p_decision not in ('approved', 'rejected', 'needs_revision')
    or v_request.status <> 'pending' then
    raise exception 'This payment request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot review your own payment request';
  end if;
  if length(btrim(coalesce(p_decision_note, ''))) > 2000 then
    raise exception 'The decision remark cannot exceed 2000 characters';
  end if;
  if p_decision in ('rejected', 'needs_revision')
    and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'A decision remark is required';
  end if;

  if p_decision in ('rejected', 'needs_revision') then
    select * into v_request
    from public.production_cash_advance_requests request
    where request.id = p_request_id
    for update;
    if not found or v_request.status <> 'pending' then
      raise exception 'This payment request is no longer awaiting approval';
    end if;
    update public.production_cash_advance_requests request
    set status = p_decision,
        decided_by = (select auth.uid()),
        decided_at = now(),
        decision_note = nullif(btrim(p_decision_note), ''),
        updated_at = now()
    where request.id = v_request.id;
    return;
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = v_request.assignment_id
    and assignment.organization_id = v_request.organization_id
    and assignment.production_job_id = v_request.production_job_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'The Box Maker assignment is no longer active';
  end if;

  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'This payment request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot approve your own payment request';
  end if;

  v_amount := round(v_request.requested_amount, 2);
  if v_assignment.cash_advance + v_amount > v_assignment.labor_cost + 0.001 then
    raise exception 'Payment cannot exceed the Box Maker balance';
  end if;

  if v_request.project_fund_id is not null then
    select * into v_fund
    from public.project_funds fund
    where fund.id = v_request.project_fund_id
      and fund.organization_id = v_request.organization_id
    for update;
    if not found or v_fund.status <> 'open' then
      raise exception 'The historical Project Fund is not open';
    end if;
    perform pg_advisory_xact_lock(hashtext(v_fund.id::text));
    select round(coalesce(sum(
      case when entry.direction = 'credit' then entry.amount else -entry.amount end
    ) filter (where not entry.is_voided), 0), 2)
    into v_available
    from public.project_fund_entries entry
    where entry.project_fund_id = v_fund.id;
    if v_amount > greatest(v_available, 0) + 0.001 then
      raise exception 'The historical Project Fund has insufficient available balance for this payment';
    end if;
    if exists (
      select 1 from public.project_fund_entries entry
      where entry.source_production_cash_advance_id = v_request.id
        and not entry.is_voided
    ) then
      raise exception 'This historical payment has already been deducted from the Project Fund';
    end if;

    insert into public.project_fund_entries (
      organization_id, project_fund_id, entry_type, direction, amount,
      entry_date, note, source_production_cash_advance_id, created_by
    ) values (
      v_request.organization_id, v_fund.id, 'project_expense', 'debit', v_amount,
      current_date, 'Historical Production Box Maker payment', v_request.id,
      (select auth.uid())
    );
  else
    perform pg_advisory_xact_lock(hashtext(v_request.organization_id::text));
    v_available := private.production_daily_fund_available(
      v_request.organization_id,
      v_request.id
    );
    if v_available + 0.001 < v_amount then
      raise exception 'Daily Fund has insufficient available balance for this payment';
    end if;
    if exists (
      select 1
      from public.finance_revised_transactions transaction_row
      where transaction_row.source_production_cash_advance_id = v_request.id
    ) then
      raise exception 'This payment has already been posted to the Daily Fund';
    end if;

    insert into public.finance_revised_transactions (
      organization_id,
      transaction_kind,
      amount,
      transaction_date,
      category,
      note,
      source_production_cash_advance_id,
      submitted_by
    )
    values (
      v_request.organization_id,
      'operating_cash_out',
      v_amount,
      current_date,
      'Box Maker Payment - Daily Fund Cash Out',
      v_request.request_note,
      v_request.id,
      v_request.requested_by
    )
    returning id into v_transaction_id;

    perform private.post_finance_revised_transaction_pool_v2(
      v_transaction_id,
      (select auth.uid()),
      nullif(btrim(p_decision_note), '')
    );
  end if;

  update public.production_box_maker_assignments assignment
  set cash_advance = round(assignment.cash_advance + v_amount, 2),
      updated_by = (select auth.uid())
  where assignment.id = v_assignment.id;

  update public.production_cash_advance_requests request
  set status = 'approved',
      approved_amount = v_amount,
      daily_fund_transaction_id = coalesce(v_transaction_id, request.daily_fund_transaction_id),
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(p_decision_note), ''),
      updated_at = now()
  where request.id = v_request.id;
end;
$$;

commit;
