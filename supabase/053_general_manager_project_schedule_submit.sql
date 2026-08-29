-- Allows General Managers to submit project schedules while preserving the
-- pending-review workflow and creator/assignee audit trail. Run after
-- 051_project_schedule_approvals.sql and 052_project_officer_kpi_aggregates.sql.
-- Safe to re-run.

drop policy if exists "project schedules: project officer submit" on public.project_schedules;
drop policy if exists "project schedules: Project Officer or General Manager submit" on public.project_schedules;

create policy "project schedules: Project Officer or General Manager submit"
on public.project_schedules for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'pending'::public.approval_status
  and (
    select private.has_text_role(
      organization_id,
      array['project_manager', 'admin']
    )
  )
);
