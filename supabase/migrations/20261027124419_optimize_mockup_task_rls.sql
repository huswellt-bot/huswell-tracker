-- Evaluate auth.uid() once per statement instead of once per mockup_tasks row.
drop policy if exists "mockup tasks: officer insert" on public.mockup_tasks;
create policy "mockup tasks: officer insert"
  on public.mockup_tasks
  for insert
  to authenticated
  with check (
    assigned_to = (select auth.uid())
    and created_by = (select auth.uid())
    and (select private.has_text_role(mockup_tasks.organization_id, array['project_manager']))
  );

drop policy if exists "mockup tasks: officer revise and resubmit" on public.mockup_tasks;
create policy "mockup tasks: officer revise and resubmit"
  on public.mockup_tasks
  for update
  to authenticated
  using (
    approval_status = 'needs_revision'
    and assigned_to = (select auth.uid())
    and created_by = (select auth.uid())
    and (select private.has_text_role(mockup_tasks.organization_id, array['project_manager']))
  )
  with check (
    approval_status = 'pending'
    and assigned_to = (select auth.uid())
    and created_by = (select auth.uid())
    and (select private.has_text_role(mockup_tasks.organization_id, array['project_manager']))
  );

drop policy if exists "mockup tasks: read" on public.mockup_tasks;
create policy "mockup tasks: read"
  on public.mockup_tasks
  for select
  to authenticated
  using (
    (select private.has_text_role(mockup_tasks.organization_id, array['super_admin', 'owner', 'admin']))
    or (
      assigned_to = (select auth.uid())
      and (select private.has_text_role(mockup_tasks.organization_id, array['project_manager']))
    )
  );
