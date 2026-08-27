-- Project Officer details shown on the Costing Breakdown form and PDF.
-- Run after 031_fix_quotation_policy_recursion.sql.

alter table public.quotations
  add column if not exists size_details text,
  add column if not exists project_quantity numeric(14,3),
  add column if not exists delivery_date date,
  add column if not exists project_types text;
