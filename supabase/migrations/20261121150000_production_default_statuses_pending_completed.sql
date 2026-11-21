-- Keep only Pending and Completed as built-in Production statuses.
-- Existing status rows remain for historical display and legacy compatibility,
-- but the old built-in choices are inactive and hidden from the status picker.

begin;

update public.production_status_types
set is_active = true,
    updated_at = now()
where is_system
  and legacy_status in ('queued'::public.production_status, 'completed'::public.production_status);

update public.production_status_types
set is_active = false,
    updated_at = now()
where is_system
  and legacy_status in (
    'in_production'::public.production_status,
    'delivered'::public.production_status,
    'artwork_approval'::public.production_status,
    'materials_ready'::public.production_status,
    'quality_check'::public.production_status,
    'cancelled'::public.production_status
  );

create or replace function public.seed_production_status_types_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.production_status_types
    (organization_id, name, legacy_status, sort_order, is_system)
  values
    (new.id, 'Pending', 'queued', 10, true),
    (new.id, 'Completed', 'completed', 20, true)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.seed_production_status_types_for_organization() from public, anon, authenticated;

commit;
