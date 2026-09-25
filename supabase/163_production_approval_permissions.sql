-- Let a Super Admin designate one or more Sales & Pricing Officers as
-- production approvers without widening their other approval capabilities.
-- Run after 162_supplier_country_and_products_services.sql and before
-- deploying the matching application update. Safe to re-run.

begin;

create table if not exists public.production_approval_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint production_approval_permissions_active_state_check
    check ((is_active and revoked_at is null) or not is_active)
);

create index if not exists production_approval_permissions_active_idx
  on public.production_approval_permissions (organization_id, is_active, user_id);

alter table public.production_approval_permissions enable row level security;

drop policy if exists "production approval permissions: self or admin read"
  on public.production_approval_permissions;
create policy "production approval permissions: self or admin read"
on public.production_approval_permissions for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_org_admin(organization_id))
);

-- The Super Admin API uses the server-only service role for writes. Browser
-- sessions receive read access only to their own active permission, or to all
-- permissions when they are an organization administrator.
revoke all on public.production_approval_permissions from public;
grant select on public.production_approval_permissions to authenticated;

create or replace function private.is_production_approval_delegate(
  target_organization_id uuid
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
    join public.production_approval_permissions permission
      on permission.organization_id = member.organization_id
     and permission.user_id = member.user_id
     and permission.is_active
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.role::text = 'sales_pricing_officer'
  );
$$;

create or replace function private.can_approve_production(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select (select private.is_org_admin(target_organization_id))
    or (select private.is_production_approval_delegate(target_organization_id));
$$;

revoke all on function private.is_production_approval_delegate(uuid) from public;
revoke all on function private.can_approve_production(uuid) from public;
grant execute on function private.can_approve_production(uuid) to authenticated;

create or replace function private.enforce_production_approval_permission()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.is_active and not exists (
    select 1
    from public.organization_members member
    where member.organization_id = new.organization_id
      and member.user_id = new.user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'Production approval can only be assigned to a Sales & Pricing Officer';
  end if;
  return new;
end;
$$;

drop trigger if exists production_approval_permissions_role_guard
  on public.production_approval_permissions;
create trigger production_approval_permissions_role_guard
before insert or update on public.production_approval_permissions
for each row execute function private.enforce_production_approval_permission();

drop trigger if exists production_approval_permissions_updated_at
  on public.production_approval_permissions;
create trigger production_approval_permissions_updated_at
before update on public.production_approval_permissions
for each row execute function public.set_updated_at();

drop trigger if exists production_approval_permissions_activity_log
  on public.production_approval_permissions;
create trigger production_approval_permissions_activity_log
after insert or update or delete on public.production_approval_permissions
for each row execute function public.log_activity();

drop policy if exists "project schedules: production approver read"
  on public.project_schedules;
create policy "project schedules: production approver read"
on public.project_schedules for select to authenticated
using (
  (select private.can_approve_production(organization_id))
  and (
    status = 'pending'::public.approval_status
    or exists (
      select 1
      from public.project_schedule_revision_requests request
      where request.schedule_id = project_schedules.id
        and request.status = 'pending'::public.approval_status
    )
    or exists (
      select 1
      from public.project_schedule_completion_requests request
      where request.schedule_id = project_schedules.id
        and request.status = 'pending'::public.approval_status
    )
  )
);

drop policy if exists "project schedule revisions: production approver read"
  on public.project_schedule_revision_requests;
create policy "project schedule revisions: production approver read"
on public.project_schedule_revision_requests for select to authenticated
using (
  (select private.can_approve_production(organization_id))
  and status = 'pending'::public.approval_status
);

drop policy if exists "project schedule completions: production approver read"
  on public.project_schedule_completion_requests;
create policy "project schedule completions: production approver read"
on public.project_schedule_completion_requests for select to authenticated
using (
  (select private.can_approve_production(organization_id))
  and status = 'pending'::public.approval_status
);

-- The production approval queue can show the approved direct Price Quotation
-- used by each request. Drafts, costing breakdowns, and pending quotations
-- remain outside this additional read boundary.
drop policy if exists "quotations: production approver read" on public.quotations;
create policy "quotations: production approver read"
on public.quotations for select to authenticated
using (
  (select private.can_approve_production(organization_id))
  and document_type = 'price_quotation'
  and costing_source_id is null
  and status::text = 'approved'
);

drop policy if exists "quotation items: production approver read"
  on public.quotation_items;
create policy "quotation items: production approver read"
on public.quotation_items for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (select private.can_approve_production(quote.organization_id))
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'approved'
  )
);

drop policy if exists "price quotation illustrations: production approver read"
  on public.price_quotation_illustrations;
create policy "price quotation illustrations: production approver read"
on public.price_quotation_illustrations for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (select private.can_approve_production(quote.organization_id))
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'approved'
  )
);

create or replace function public.review_project_schedule(
  p_schedule_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project schedule decision';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Project schedule was not found';
  end if;

  if not private.can_approve_production(v_schedule.organization_id) then
    raise exception 'Only the General Manager or designated Production Approver can review production schedules';
  end if;

  if not private.is_org_admin(v_schedule.organization_id)
    and (
      v_schedule.created_by = (select auth.uid())
      or v_schedule.assigned_to = (select auth.uid())
    ) then
    raise exception 'The submitting Project Officer cannot approve their own production request';
  end if;

  if v_schedule.status <> 'pending'::public.approval_status then
    raise exception 'This project schedule has already been reviewed';
  end if;

  update public.project_schedules
  set
    status = p_decision::public.approval_status,
    decided_by = (select auth.uid()),
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_schedule_id
  returning * into v_schedule;

  if p_decision = 'approved' then
    perform public.ensure_production_job_for_project_schedule(v_schedule.id);
    select * into v_schedule
    from public.project_schedules
    where id = v_schedule.id;
  end if;

  return v_schedule;
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

  if not private.can_approve_production(v_request.organization_id) then
    raise exception 'Only the General Manager or designated Production Approver can review project schedule revisions';
  end if;

  if not private.is_org_admin(v_request.organization_id)
    and v_request.submitted_by = (select auth.uid()) then
    raise exception 'The submitting Project Officer cannot approve their own schedule revision';
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

    update public.production_jobs
    set due_date = v_request.proposed_due_date
    where organization_id = v_schedule.organization_id
      and (
        project_schedule_id = v_schedule.id
        or (
          project_schedule_id is null
          and quotation_id = v_schedule.quotation_id
        )
      );
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

  if not private.can_approve_production(v_request.organization_id) then
    raise exception 'Only the General Manager or designated Production Approver can review project completion requests';
  end if;

  if not private.is_org_admin(v_request.organization_id)
    and v_request.submitted_by = (select auth.uid()) then
    raise exception 'The submitting Project Officer cannot approve their own completion request';
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

revoke all on function public.review_project_schedule(uuid, text, text) from public;
grant execute on function public.review_project_schedule(uuid, text, text) to authenticated;
revoke all on function public.review_project_schedule_revision(uuid, text, text) from public;
grant execute on function public.review_project_schedule_revision(uuid, text, text) to authenticated;
revoke all on function public.review_project_schedule_completion(uuid, text, text) from public;
grant execute on function public.review_project_schedule_completion(uuid, text, text) to authenticated;

commit;
