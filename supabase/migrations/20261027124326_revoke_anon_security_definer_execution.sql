-- Remove explicit anonymous EXECUTE grants left on public SECURITY DEFINER RPCs.
-- Authenticated application users and server-side service-role callers remain
-- authorized by the preceding hardening migration.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from anon', routine.signature);
  end loop;
end
$$;
