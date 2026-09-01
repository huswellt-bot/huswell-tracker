-- Standalone mockup tracker for pre-quotation client work.
-- Sales Project Officers create and maintain mockups for leads assigned to
-- them; General Managers have organization-wide, read-only oversight.
-- Run after 087_preserve_price_quotation_revision_items.sql. Safe to re-run.

begin;

create table if not exists public.mockup_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  mockup_name text not null,
  client_name text,
  company_name text,
  project_name text,
  pieces numeric(14,3) not null check (pieces > 0),
  due_date date not null,
  status text not null default 'requested' check (
    status in (
      'requested', 'in_progress', 'sent_to_client', 'revision_requested',
      'client_approved', 'cancelled'
    )
  ),
  notes text,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mockup_tasks_org_due_date_idx
  on public.mockup_tasks (organization_id, due_date, status);
create index if not exists mockup_tasks_assigned_to_idx
  on public.mockup_tasks (assigned_to, updated_at desc);

-- Snapshot display data from the selected lead. The browser cannot forge the
-- organization, assignment, client, company, or project shown to the GM.
create or replace function public.populate_mockup_task_from_lead()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_lead
    from public.leads
    where id = new.lead_id
    for share;

    if not found then
      raise exception 'Lead not found';
    end if;
    if not private.has_text_role(v_lead.organization_id, array['project_manager'])
      or v_lead.assigned_to is distinct from auth.uid() then
      raise exception 'Only the assigned Sales Project Officer can create a mockup';
    end if;

    new.organization_id := v_lead.organization_id;
    new.assigned_to := auth.uid();
    new.created_by := auth.uid();
    new.client_name := nullif(btrim(v_lead.contact_name), '');
    new.company_name := nullif(btrim(v_lead.client_name), '');
    new.project_name := coalesce(
      nullif(btrim(v_lead.project_name), ''),
      nullif(btrim(v_lead.client_name), ''),
      nullif(btrim(v_lead.contact_name), ''),
      'Untitled project'
    );
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.lead_id is distinct from old.lead_id
    or new.client_name is distinct from old.client_name
    or new.company_name is distinct from old.company_name
    or new.project_name is distinct from old.project_name
    or new.assigned_to is distinct from old.assigned_to
    or new.created_by is distinct from old.created_by then
    raise exception 'Lead and assignment details for a mockup cannot be changed';
  end if;

  if not private.has_text_role(old.organization_id, array['project_manager'])
    or old.assigned_to is distinct from auth.uid()
    or old.created_by is distinct from auth.uid() then
    raise exception 'Only the assigned Sales Project Officer can update this mockup';
  end if;

  return new;
end;
$$;

drop trigger if exists mockup_tasks_populate_from_lead on public.mockup_tasks;
create trigger mockup_tasks_populate_from_lead
before insert or update on public.mockup_tasks
for each row execute function public.populate_mockup_task_from_lead();

drop trigger if exists mockup_tasks_updated_at on public.mockup_tasks;
create trigger mockup_tasks_updated_at
before update on public.mockup_tasks
for each row execute function public.set_updated_at();

alter table public.mockup_tasks enable row level security;

drop policy if exists "mockup tasks: read" on public.mockup_tasks;
drop policy if exists "mockup tasks: officer insert" on public.mockup_tasks;
drop policy if exists "mockup tasks: officer update" on public.mockup_tasks;

-- General Managers only receive SELECT access. Operational changes remain
-- owned by the Project Officer assigned to the originating lead.
create policy "mockup tasks: read"
on public.mockup_tasks for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or (
    assigned_to = auth.uid()
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "mockup tasks: officer insert"
on public.mockup_tasks for insert to authenticated
with check (
  assigned_to = auth.uid()
  and created_by = auth.uid()
  and (select private.has_text_role(organization_id, array['project_manager']))
);

create policy "mockup tasks: officer update"
on public.mockup_tasks for update to authenticated
using (
  assigned_to = auth.uid()
  and created_by = auth.uid()
  and (select private.has_text_role(organization_id, array['project_manager']))
)
with check (
  assigned_to = auth.uid()
  and created_by = auth.uid()
  and (select private.has_text_role(organization_id, array['project_manager']))
);

grant select, insert, update on public.mockup_tasks to authenticated;
revoke all on function public.populate_mockup_task_from_lead() from public;

-- Existing workspace subscriptions refresh this table as soon as an officer
-- creates or updates a mockup. Realtime still enforces the SELECT policy.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mockup_tasks'
  ) then
    alter publication supabase_realtime add table public.mockup_tasks;
  end if;
end;
$$;

commit;
