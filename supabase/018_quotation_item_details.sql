-- Optional multi-line customer-facing description for each quotation item.
alter table public.quotation_items
  add column if not exists details text;
