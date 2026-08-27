-- Only the lead creator may delete their own Lead / Project.
-- Owner / General Manager and Admin may delete any lead in their organization.

alter table public.leads enable row level security;

drop policy if exists "leads: project officers manage" on public.leads;
drop policy if exists "leads: workspace read" on public.leads;
drop policy if exists "leads: creator insert" on public.leads;
drop policy if exists "leads: project officers update" on public.leads;
drop policy if exists "leads: creator or owner update" on public.leads;
drop policy if exists "leads: creator or owner delete" on public.leads;

create policy "leads: workspace read"
on public.leads for select to authenticated
using ((select private.has_text_role(organization_id, array['owner', 'admin', 'project_manager'])));

create policy "leads: creator insert"
on public.leads for insert to authenticated
with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "leads: creator or owner update"
on public.leads for update to authenticated
using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
)
with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

create policy "leads: creator or owner delete"
on public.leads for delete to authenticated
using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);
