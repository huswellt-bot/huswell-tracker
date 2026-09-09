-- Allow the General Manager to delete approved production schedules from the
-- Active and Completed Project Calendar views without exposing pending or
-- rejected production requests to the direct delete path.
-- Run after 141_fix_business_settings_pricing_default.sql. Safe to re-run.

begin;

drop policy if exists "project schedules: General Manager delete"
  on public.project_schedules;

create policy "project schedules: General Manager delete"
on public.project_schedules for delete to authenticated
using (
  status = 'approved'::public.approval_status
  and (select private.has_text_role(organization_id, array['owner', 'admin']))
);

grant delete on public.project_schedules to authenticated;

commit;
