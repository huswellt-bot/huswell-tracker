-- Remove the legacy explicit anon grant from the Commissions RPC.
-- Run after 252_commission_summary_production_visibility.sql.

begin;

revoke all on function public.commission_summary_rows_v3(uuid) from public, anon;
grant execute on function public.commission_summary_rows_v3(uuid) to authenticated;

commit;
