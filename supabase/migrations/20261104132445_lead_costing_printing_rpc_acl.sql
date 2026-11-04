-- Restrict Lead Costing printing quotation RPCs to signed-in users.
-- The functions still perform their own organization and role checks.

begin;

revoke all on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) from public, anon;
revoke all on function public.submit_lead_costing_printing_quotation(uuid) from public, anon;
grant execute on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) to authenticated;
grant execute on function public.submit_lead_costing_printing_quotation(uuid) to authenticated;

commit;
