-- Enable organization-scoped real-time refreshes for the Leads workspace.
-- Run after 062_chatbot_lead_intake_and_assignment.sql. This is additive and
-- safe to re-run. Realtime delivery remains subject to the existing leads RLS
-- SELECT policy, so users receive only changes to leads they may already read.

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
      and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end;
$$;
