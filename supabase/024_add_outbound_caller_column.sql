-- Catch-up migration for databases where the first Lead Tracker migration was
-- applied before Outbound Caller was introduced.

alter table public.leads
  add column if not exists outbound_caller text;
