-- General Managers manage and review; Sales Project Officers prepare and submit
-- operational work. This migration keeps the existing GM lead-management access
-- (including lead creation and assignment) while preventing GM accounts from
-- creating officer-owned quotations, schedules, schedule revisions, or
-- completion requests.
--
-- Run after 077_officer_unsubmit_pending_requests.sql. Safe to re-run.

begin;

-- Migration 053 temporarily allowed General Managers to submit schedules.
-- Restore the Project Officer-only submission boundary.
drop policy if exists "project schedules: role insert" on public.project_schedules;
drop policy if exists "project schedules: Project Officer or General Manager submit" on public.project_schedules;
drop policy if exists "project schedules: project officer submit" on public.project_schedules;
create policy "project schedules: project officer submit"
on public.project_schedules for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'pending'::public.approval_status
  and (select private.has_text_role(organization_id, array['project_manager']))
);

-- Security-definer request functions insert into these tables. The trigger
-- evaluates the authenticated caller, so a GM cannot bypass the officer-only
-- request boundary by calling an RPC directly.
create or replace function public.enforce_project_officer_schedule_request()
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

  if not found
    or not private.has_text_role(new.organization_id, array['project_manager'])
    or new.submitted_by is distinct from (select auth.uid())
    or v_schedule.assigned_to is distinct from (select auth.uid())
    or v_schedule.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the assigned Project Officer can submit this request';
  end if;

  return new;
end;
$$;

drop trigger if exists project_schedule_revisions_project_officer_only
  on public.project_schedule_revision_requests;
create trigger project_schedule_revisions_project_officer_only
before insert on public.project_schedule_revision_requests
for each row execute function public.enforce_project_officer_schedule_request();

drop trigger if exists project_schedule_completions_project_officer_only
  on public.project_schedule_completion_requests;
create trigger project_schedule_completions_project_officer_only
before insert on public.project_schedule_completion_requests
for each row execute function public.enforce_project_officer_schedule_request();

-- A General Manager still sets prices and commercial terms during review, but
-- only an assigned Project Officer can create or change quotation content.
create or replace function public.enforce_project_officer_price_quotation_content()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and not private.has_text_role(new.organization_id, array['project_manager']) then
    if tg_op = 'INSERT' then
      raise exception 'Only a Sales Project Officer can prepare a Price Quotation';
    end if;

    if new.lead_id is distinct from old.lead_id
      or new.client_name is distinct from old.client_name
      or new.client_contact_name is distinct from old.client_contact_name
      or new.client_phone is distinct from old.client_phone
      or new.client_address is distinct from old.client_address
      or new.project_name is distinct from old.project_name
      or new.project_types is distinct from old.project_types
      or new.representative is distinct from old.representative
      or new.prepared_by_user_id is distinct from old.prepared_by_user_id
      or new.prepared_by_signature_url is distinct from old.prepared_by_signature_url then
      raise exception 'Only a Sales Project Officer can change Price Quotation content';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists price_quotation_project_officer_content_only
  on public.quotations;
create trigger price_quotation_project_officer_content_only
before insert or update on public.quotations
for each row execute function public.enforce_project_officer_price_quotation_content();

create or replace function public.enforce_project_officer_price_quotation_items()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_quotation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_quotation_id := old.quotation_id;
  else
    v_quotation_id := new.quotation_id;
  end if;

  select * into v_quotation
  from public.quotations
  where id = v_quotation_id;

  if found
    and v_quotation.document_type = 'price_quotation'
    and v_quotation.costing_source_id is null
    and not private.has_text_role(v_quotation.organization_id, array['project_manager']) then
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'Only a Sales Project Officer can change Price Quotation items';
    end if;

    if new.description is distinct from old.description
      or new.quantity is distinct from old.quantity
      or new.sort_order is distinct from old.sort_order
      or new.image_url is distinct from old.image_url then
      raise exception 'Only a Sales Project Officer can change Price Quotation items';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_items_project_officer_only
  on public.quotation_items;
create trigger price_quotation_items_project_officer_only
before insert or update or delete on public.quotation_items
for each row execute function public.enforce_project_officer_price_quotation_items();

revoke all on function public.enforce_project_officer_schedule_request() from public;
revoke all on function public.enforce_project_officer_price_quotation_content() from public;
revoke all on function public.enforce_project_officer_price_quotation_items() from public;

commit;
