begin;

alter table public.lead_costing_inventory
  add column if not exists available_sheets numeric(12,2)
    check (available_sheets is null or available_sheets >= 0);

commit;
