-- Leads and done-deal projects are visible only to the user who created them.
-- Existing records are preserved. Re-running this migration safely replaces the
-- prior workspace-wide read policy.

alter table public.leads enable row level security;

drop policy if exists "leads: workspace read" on public.leads;
drop policy if exists "leads: creator read" on public.leads;

create policy "leads: creator read"
on public.leads for select to authenticated
using (
  created_by = (select auth.uid())
  and (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'project_manager']
  ))
);
