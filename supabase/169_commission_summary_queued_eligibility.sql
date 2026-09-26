-- Commission Summary eligibility update.
--
-- Migration 168 originally required a linked production job to be exactly
-- `in_production`. The agreed workflow treats a newly created/queued
-- production job as eligible instead. Keep this as a separate migration so
-- databases that already applied 168 receive the same behavior safely.
--
-- Run after 168_commission_summary_and_lead_endorsement_lock.sql and before
-- deploying the matching workspace update.

begin;

do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(function_row.oid)
    into v_definition
  from pg_proc function_row
  join pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname = 'commission_summary_eligible_quotations'
    and oidvectortypes(function_row.proargtypes) = 'uuid';

  if v_definition is null then
    raise exception
      'Migration 168 is required before migration 169: commission_summary_eligible_quotations is missing';
  end if;

  v_old := 'job.status::text = ''in_production''';
  v_new := 'job.status::text = ''queued''';

  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position(v_new in v_definition) = 0 then
    raise exception
      'Unexpected commission_summary_eligible_quotations definition; queued eligibility was not applied';
  end if;

  select pg_get_functiondef(function_row.oid)
    into v_definition
  from pg_proc function_row
  join pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname = 'create_commission_summary'
    and oidvectortypes(function_row.proargtypes) =
      'uuid, numeric, numeric, date, numeric, numeric';

  if v_definition is null then
    raise exception
      'Migration 168 is required before migration 169: create_commission_summary is missing';
  end if;

  v_old := 'v_job.status::text <> ''in_production''';
  v_new := 'v_job.status::text <> ''queued''';

  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position(v_new in v_definition) = 0 then
    raise exception
      'Unexpected create_commission_summary definition; queued eligibility was not applied';
  end if;
end;
$$;

revoke all on function public.commission_summary_eligible_quotations(uuid)
  from public;
grant execute on function public.commission_summary_eligible_quotations(uuid)
  to authenticated;

revoke all on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) from public;
grant execute on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) to authenticated;

commit;
