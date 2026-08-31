-- Retire the legacy Costing Breakdown workflow without deleting historical
-- Costing Breakdown or linked Price Quotation records. Run after migration 074.

begin;

create or replace function public.prevent_costing_breakdown_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' and new.document_type = 'costing_breakdown' then
    raise exception 'Costing Breakdowns are no longer available. Create a direct Price Quotation instead.';
  end if;

  if tg_op = 'UPDATE' and old.document_type = 'costing_breakdown' then
    raise exception 'Historical Costing Breakdowns are read-only.';
  end if;

  if tg_op = 'DELETE' and old.document_type = 'costing_breakdown' then
    raise exception 'Historical Costing Breakdowns cannot be deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_retire_costing_breakdown_workflow on public.quotations;
create trigger quotations_retire_costing_breakdown_workflow
before insert or update or delete on public.quotations
for each row execute function public.prevent_costing_breakdown_workflow();

revoke all on function public.submit_costing_breakdown(uuid) from public, authenticated;
revoke all on function public.request_quotation_revision(uuid) from public, authenticated;
revoke all on function public.review_quotation_revision(uuid, text) from public, authenticated;
revoke all on function public.delete_costing_breakdown(uuid) from public, authenticated;
revoke all on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text) from public, authenticated;

commit;
