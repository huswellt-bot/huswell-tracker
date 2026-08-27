-- Add the Done Deal workflow status used by the Outbound Tracker's separate
-- Done Deal tab. Values 1–9 match the supplied Google Sheet.

alter table public.leads
  add column if not exists done_deal_status integer;

alter table public.leads
  drop constraint if exists leads_done_deal_status_check,
  add constraint leads_done_deal_status_check
  check (done_deal_status is null or done_deal_status between 1 and 9);

create index if not exists leads_org_done_deal_status_idx
  on public.leads (organization_id, done_deal_status)
  where evaluation_number = 7;
