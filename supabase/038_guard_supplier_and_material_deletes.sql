-- Guarded deletion for supplier and material master data.
-- Deploy after migration 037. Records with dependent business history must be
-- made unavailable rather than deleted so links and audit history are retained.

create or replace function public.prevent_supplier_delete_with_dependencies()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.inventory_items item
    where item.supplier_id = old.id
  ) then
    raise exception 'This supplier has linked catalog items and cannot be deleted. Mark it unavailable instead.';
  end if;

  if exists (
    select 1
    from public.expenses expense
    where expense.supplier_id = old.id
  ) or exists (
    select 1
    from public.supplier_payables payable
    where payable.supplier_id = old.id
  ) then
    raise exception 'This supplier has linked financial records and cannot be deleted. Mark it unavailable instead.';
  end if;

  return old;
end;
$$;

drop trigger if exists suppliers_prevent_delete_with_dependencies on public.suppliers;
create trigger suppliers_prevent_delete_with_dependencies
before delete on public.suppliers
for each row execute function public.prevent_supplier_delete_with_dependencies();

create or replace function public.prevent_material_delete_with_dependencies()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.inventory_movements movement
    where movement.item_id = old.id
  ) or exists (
    select 1
    from public.production_material_usage usage
    where usage.item_id = old.id
  ) or exists (
    select 1
    from public.finished_product_stock_ins stock_in
    where stock_in.item_id = old.id
  ) then
    raise exception 'This material has linked stock or production records and cannot be deleted. Mark it unavailable instead.';
  end if;

  if exists (
    select 1
    from public.quotation_items quotation_item
    where quotation_item.inventory_item_id = old.id
  ) or exists (
    select 1
    from public.invoice_items invoice_item
    where invoice_item.inventory_item_id = old.id
  ) then
    raise exception 'This material has linked quotation or invoice records and cannot be deleted. Mark it unavailable instead.';
  end if;

  return old;
end;
$$;

drop trigger if exists inventory_items_prevent_material_delete_with_dependencies on public.inventory_items;
create trigger inventory_items_prevent_material_delete_with_dependencies
before delete on public.inventory_items
for each row
when (old.item_type = 'material')
execute function public.prevent_material_delete_with_dependencies();

-- General Managers may delete only suppliers that pass the dependency guard.
drop policy if exists "suppliers: general manager delete" on public.suppliers;
create policy "suppliers: general manager delete"
on public.suppliers for delete to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['owner', 'admin', 'super_admin']
  ))
);
