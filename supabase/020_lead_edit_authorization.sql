-- Lead / Project editing follows the same ownership rule as deletion.
-- Owner / General Manager and Admin may edit all leads; Project Officers may
-- edit only the leads they created.

drop policy if exists "leads: project officers update" on public.leads;
drop policy if exists "leads: creator or owner update" on public.leads;

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
