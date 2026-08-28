-- Requires General Manager approval before a Project Officer schedule appears
-- in the production calendar. Run after 050_project_calendar.sql.
-- This migration is additive and safe to re-run.

alter table public.project_schedules
  add column if not exists status public.approval_status,
  add column if not exists submitted_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

-- Schedules that were created before this approval workflow must stay visible.
update public.project_schedules
set
  status = 'approved'::public.approval_status,
  submitted_at = coalesce(submitted_at, created_at)
where status is null;

alter table public.project_schedules
  alter column status set default 'pending'::public.approval_status,
  alter column status set not null,
  alter column submitted_at set default now(),
  alter column submitted_at set not null;

-- Preserve the fields entered by the Project Officer, falling back to values
-- on the approved Price Quotation only when a field has not been supplied.
create or replace function public.populate_project_schedule_from_quotation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
begin
  select * into v_quotation
  from public.quotations
  where id = new.quotation_id;

  if not found
    or v_quotation.organization_id is distinct from new.organization_id
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved Price Quotation';
  end if;

  new.quotation_no := coalesce(v_quotation.quotation_no, '');
  new.project_name := coalesce(
    nullif(btrim(new.project_name), ''),
    nullif(v_quotation.project_name, ''),
    v_quotation.quotation_no,
    'Untitled project'
  );
  new.client_name := coalesce(
    nullif(btrim(new.client_name), ''),
    nullif(v_quotation.client_name, '')
  );
  new.product_name := coalesce(
    nullif(btrim(new.product_name), ''),
    nullif(v_quotation.project_types, '')
  );
  new.quantity := coalesce(new.quantity, v_quotation.project_quantity);
  return new;
end;
$$;

-- Project Officers may submit only their own pending schedules. General
-- Managers review all schedules and are the only role allowed to decide them.
drop policy if exists "project schedules: role read" on public.project_schedules;
drop policy if exists "project schedules: role insert" on public.project_schedules;
drop policy if exists "project schedules: owner manage" on public.project_schedules;
drop policy if exists "project schedules: General Manager review" on public.project_schedules;
drop policy if exists "project schedules: project officer submit" on public.project_schedules;
drop policy if exists "project schedules: General Manager delete" on public.project_schedules;

create policy "project schedules: role read"
on public.project_schedules for select to authenticated
using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    assigned_to = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "project schedules: project officer submit"
on public.project_schedules for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'pending'::public.approval_status
  and (select private.has_text_role(organization_id, array['project_manager']))
);

create policy "project schedules: General Manager delete"
on public.project_schedules for delete to authenticated
using ((select private.has_text_role(organization_id, array['owner', 'admin'])));

-- Review through a narrowly scoped function so the browser cannot change
-- approved schedule details or make its own approval decision.
create or replace function public.review_project_schedule(
  p_schedule_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public
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

  if not private.has_text_role(v_schedule.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project schedules';
  end if;

  if v_schedule.status <> 'pending'::public.approval_status then
    raise exception 'This project schedule has already been reviewed';
  end if;

  update public.project_schedules
  set
    status = p_decision::public.approval_status,
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_schedule_id
  returning * into v_schedule;

  return v_schedule;
end;
$$;

-- A rejected schedule stays linked to its quotation and can be corrected and
-- re-submitted by the same Project Officer without creating a duplicate.
create or replace function public.resubmit_project_schedule(
  p_schedule_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_quotation public.quotations%rowtype;
begin
  if p_due_date < p_start_date then
    raise exception 'The deadline cannot be before the start date';
  end if;

  if nullif(btrim(p_project_name), '') is null
    or nullif(btrim(p_client_name), '') is null
    or nullif(btrim(p_product_name), '') is null
    or p_quantity is null
    or p_quantity <= 0 then
    raise exception 'Project, client, product, and a positive quantity are required';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found
    or v_schedule.assigned_to is distinct from auth.uid()
    or v_schedule.created_by is distinct from auth.uid()
    or not private.has_text_role(v_schedule.organization_id, array['project_manager']) then
    raise exception 'Only the submitting Project Officer can resubmit this project';
  end if;

  if v_schedule.status <> 'rejected'::public.approval_status then
    raise exception 'Only rejected project schedules can be resubmitted';
  end if;

  select * into v_quotation
  from public.quotations
  where id = v_schedule.quotation_id;

  if not found
    or v_quotation.organization_id is distinct from v_schedule.organization_id
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved Price Quotation';
  end if;

  update public.project_schedules
  set
    quotation_no = coalesce(v_quotation.quotation_no, ''),
    project_name = btrim(p_project_name),
    client_name = btrim(p_client_name),
    product_name = btrim(p_product_name),
    quantity = p_quantity,
    start_date = p_start_date,
    due_date = p_due_date,
    status = 'pending'::public.approval_status,
    submitted_at = now(),
    decided_by = null,
    decided_at = null,
    decision_note = null
  where id = p_schedule_id
  returning * into v_schedule;

  return v_schedule;
end;
$$;

revoke update on public.project_schedules from authenticated;
grant select, insert, delete on public.project_schedules to authenticated;
revoke all on function public.review_project_schedule(uuid, text, text) from public;
grant execute on function public.review_project_schedule(uuid, text, text) to authenticated;
revoke all on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date) from public;
grant execute on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date) to authenticated;
