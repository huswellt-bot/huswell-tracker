-- Keep organization-scoped costing list queries index-backed.
-- Required by the workspace loader and the costing breakdown summary.

begin;

create index if not exists price_quotation_product_costings_organization_created_at_idx
  on public.price_quotation_product_costings (organization_id, created_at desc);

create index if not exists price_quotation_costing_lines_organization_created_at_idx
  on public.price_quotation_costing_lines (organization_id, created_at desc);

create index if not exists price_quotation_costing_markups_organization_created_at_idx
  on public.price_quotation_costing_markups (organization_id, created_at desc);

commit;
