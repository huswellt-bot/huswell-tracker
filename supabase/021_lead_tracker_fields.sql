-- Align the Add Lead / Project registration form with the Outbound Tracker.
-- This preserves existing records and does not remove legacy lead information.

alter table public.leads
  add column if not exists date_sent date,
  add column if not exists date_contacted date,
  add column if not exists contact_method text,
  add column if not exists outbound_caller text,
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists evaluation_number integer;

alter table public.leads
  alter column project_name drop not null;

alter table public.leads
  drop constraint if exists leads_contact_method_check,
  add constraint leads_contact_method_check
  check (contact_method is null or lower(contact_method) in ('viber', 'whatsapp', 'messenger', 'phone call', 'email', 'phone_call', 'facebook', 'linkedin', 'walk_in', 'other')),
  drop constraint if exists leads_evaluation_number_check,
  add constraint leads_evaluation_number_check
  check (evaluation_number is null or evaluation_number between 1 and 9);

create index if not exists leads_org_date_contacted_idx
  on public.leads (organization_id, date_contacted);
create index if not exists leads_assigned_to_idx
  on public.leads (assigned_to);
