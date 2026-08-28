-- Expands the Done Deal project workflow from nine to twelve ordered stages.
-- Existing stage values 1–9 remain valid; the migration is safe to re-run.

alter table public.leads
  drop constraint if exists leads_done_deal_status_check,
  add constraint leads_done_deal_status_check
  check (done_deal_status is null or done_deal_status between 1 and 12);
