-- Leads may represent an individual client without a company name.
-- Existing lead records are preserved unchanged.

alter table public.leads
  alter column client_name drop not null;
