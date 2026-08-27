-- Project Officer ownership and Owner / General Manager submission workspace.
-- Run after 015_apply_revised_workflow.sql (or migrations 001 through 014).

-- Project Officers may work only with quotations/costings they created.
-- Owner / General Manager retains full access within the organization.
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

-- Leads / Projects are shared within the workspace, so team members may see
-- the basic profile name of the colleague who added each lead.
alter table public.profiles enable row level security;
drop policy if exists "profiles: workspace owners read staff" on public.profiles;
drop policy if exists "profiles: workspace members read staff" on public.profiles;
create policy "profiles: workspace members read staff"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1
    from public.organization_members current_member
    join public.organization_members staff_member
      on staff_member.organization_id = current_member.organization_id
    where current_member.user_id = (select auth.uid())
      and staff_member.user_id = profiles.id
  )
);

drop policy if exists "quotations: role read" on public.quotations;
drop policy if exists "quotations: role insert" on public.quotations;
drop policy if exists "quotations: role update" on public.quotations;
drop policy if exists "quotations: role delete" on public.quotations;
drop policy if exists "quotations: creator or owner read" on public.quotations;
drop policy if exists "quotations: creator or owner insert" on public.quotations;
drop policy if exists "quotations: creator or owner update" on public.quotations;
drop policy if exists "quotations: creator or owner delete" on public.quotations;

create policy "quotations: creator or owner read" on public.quotations
for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or created_by = (select auth.uid())
);

create policy "quotations: creator or owner insert" on public.quotations
for insert to authenticated with check (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    (select private.has_text_role(organization_id, array['project_manager']))
    and created_by = (select auth.uid())
  )
);

create policy "quotations: creator or owner update" on public.quotations
for update to authenticated
using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or created_by = (select auth.uid())
)
with check (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "quotations: creator or owner delete" on public.quotations
for delete to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

drop policy if exists "quotation items: role read" on public.quotation_items;
drop policy if exists "quotation items: role insert" on public.quotation_items;
drop policy if exists "quotation items: role update" on public.quotation_items;
drop policy if exists "quotation items: role delete" on public.quotation_items;
drop policy if exists "quotation items: creator or owner read" on public.quotation_items;
drop policy if exists "quotation items: creator or owner insert" on public.quotation_items;
drop policy if exists "quotation items: creator or owner update" on public.quotation_items;
drop policy if exists "quotation items: creator or owner delete" on public.quotation_items;

create policy "quotation items: creator or owner read" on public.quotation_items
for select to authenticated using (
  exists (
    select 1 from public.quotations q
    where q.id = quotation_id
      and (
        (select private.has_text_role(q.organization_id, array['owner','admin']))
        or q.created_by = (select auth.uid())
      )
  )
);

create policy "quotation items: creator or owner insert" on public.quotation_items
for insert to authenticated with check (
  exists (
    select 1 from public.quotations q
    where q.id = quotation_id
      and q.status::text in ('draft','needs_revision')
      and (
        (select private.has_text_role(q.organization_id, array['owner','admin']))
        or (
          q.created_by = (select auth.uid())
          and (select private.has_text_role(q.organization_id, array['project_manager']))
        )
      )
  )
);

create policy "quotation items: creator or owner update" on public.quotation_items
for update to authenticated
using (
  exists (
    select 1 from public.quotations q
    where q.id = quotation_id
      and q.status::text in ('draft','needs_revision')
      and (
        (select private.has_text_role(q.organization_id, array['owner','admin']))
        or q.created_by = (select auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.quotations q
    where q.id = quotation_id
      and q.status::text in ('draft','needs_revision')
      and (
        (select private.has_text_role(q.organization_id, array['owner','admin']))
        or (
          q.created_by = (select auth.uid())
          and (select private.has_text_role(q.organization_id, array['project_manager']))
        )
      )
  )
);

create policy "quotation items: creator or owner delete" on public.quotation_items
for delete to authenticated using (
  exists (
    select 1 from public.quotations q
    where q.id = quotation_id
      and q.status::text in ('draft','needs_revision')
      and (
        (select private.has_text_role(q.organization_id, array['owner','admin']))
        or (
          q.created_by = (select auth.uid())
          and (select private.has_text_role(q.organization_id, array['project_manager']))
        )
      )
  )
);
