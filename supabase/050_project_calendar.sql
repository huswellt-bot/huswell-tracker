-- Adds schedules for approved Price Quotations shown in the read-only Project Calendar.
-- Run after 049_expand_done_deal_statuses.sql. This migration is safe to re-run.

create table if not exists public.project_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  quotation_no text not null default '',
  project_name text not null default '',
  client_name text,
  product_name text,
  quantity numeric(14,3),
  start_date date not null,
  due_date date not null,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_schedules_dates_check check (due_date >= start_date),
  constraint project_schedules_organization_quotation_key unique (organization_id, quotation_id)
);

create index if not exists project_schedules_org_dates_idx
  on public.project_schedules(organization_id, start_date, due_date);
create index if not exists project_schedules_assigned_to_idx
  on public.project_schedules(assigned_to);

-- Snapshot approved quotation details when a schedule is created. Client-supplied
-- table labels cannot be forged or drift from the selected quotation.
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
  new.project_name := coalesce(nullif(v_quotation.project_name, ''), v_quotation.quotation_no, 'Untitled project');
  new.client_name := nullif(v_quotation.client_name, '');
  new.product_name := nullif(v_quotation.project_types, '');
  new.quantity := v_quotation.project_quantity;
  return new;
end;
$$;

drop trigger if exists project_schedules_populate_from_quotation on public.project_schedules;
create trigger project_schedules_populate_from_quotation
before insert on public.project_schedules
for each row execute function public.populate_project_schedule_from_quotation();

drop trigger if exists project_schedules_updated_at on public.project_schedules;
create trigger project_schedules_updated_at
before update on public.project_schedules
for each row execute function public.set_updated_at();

alter table public.project_schedules enable row level security;

drop policy if exists "project schedules: role read" on public.project_schedules;
drop policy if exists "project schedules: role insert" on public.project_schedules;
drop policy if exists "project schedules: owner manage" on public.project_schedules;

create policy "project schedules: role read"
on public.project_schedules for select to authenticated
using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    assigned_to = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "project schedules: role insert"
on public.project_schedules for insert to authenticated
with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    assigned_to = (select auth.uid())
    and created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "project schedules: owner manage"
on public.project_schedules for all to authenticated
using ((select private.has_text_role(organization_id, array['owner', 'admin'])))
with check ((select private.has_text_role(organization_id, array['owner', 'admin'])));

grant select, insert, update, delete on public.project_schedules to authenticated;
