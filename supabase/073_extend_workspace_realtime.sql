-- Complete Realtime publication coverage for workflow tables introduced after
-- migration 064. Existing RLS SELECT policies continue to control delivery.
-- Run after migrations 064 through 072.

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'price_quotation_revision_requests'
  ) then
    alter publication supabase_realtime
      add table public.price_quotation_revision_requests;
  end if;
end;
$$;
