begin;

create index if not exists lead_costing_services_created_by_idx
  on public.lead_costing_services(created_by);
create index if not exists lead_costing_materials_created_by_idx
  on public.lead_costing_materials(created_by);
create index if not exists lead_costing_inventory_updated_by_idx
  on public.lead_costing_inventory(updated_by);
create index if not exists lead_costing_printer_costs_created_by_idx
  on public.lead_costing_printer_costs(created_by);
create index if not exists lead_costing_customers_created_by_idx
  on public.lead_costing_customers(created_by);
create index if not exists lead_costing_orders_created_by_idx
  on public.lead_costing_orders(created_by);
create index if not exists lead_costing_orders_customer_id_idx
  on public.lead_costing_orders(customer_id);
create index if not exists lead_costing_orders_service_id_idx
  on public.lead_costing_orders(service_id);
create index if not exists lead_costing_orders_material_id_idx
  on public.lead_costing_orders(material_id);

commit;
