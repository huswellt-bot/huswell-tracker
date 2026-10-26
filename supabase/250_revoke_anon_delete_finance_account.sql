-- Restrict the Finance account deletion RPC to authenticated callers.
-- The function still enforces the Internal Finance role inside its body.

begin;

revoke execute on function public.delete_finance_account(uuid)
  from public, anon;
grant execute on function public.delete_finance_account(uuid)
  to authenticated;

commit;
