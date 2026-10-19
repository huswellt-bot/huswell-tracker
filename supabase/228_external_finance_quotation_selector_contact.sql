-- Expose the saved quotation contact name in the limited External Finance
-- quotation projection used by the unified Cash In selector. The projection
-- still excludes the full quotations row and all internal costing/commission
-- fields.
-- Run after 227_quotation_payment_revision_workflow.sql and before deploying
-- the matching Finance workspace update. Safe to re-run.

begin;

drop function if exists public.external_finance_quotation_rows(uuid);

create function public.external_finance_quotation_rows(
  p_organization_id uuid
)
returns table (
  id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  client_contact_name text,
  lead_id uuid,
  customer_id uuid,
  document_type text,
  status text,
  total_amount numeric,
  payment_terms_option text,
  pdc_term_days integer
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can read this quotation projection';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    quotation.project_name,
    quotation.client_name,
    quotation.client_contact_name,
    quotation.lead_id,
    quotation.customer_id,
    quotation.document_type::text,
    quotation.status::text,
    quotation.total_amount,
    quotation.payment_terms_option,
    quotation.pdc_term_days
  from public.quotations quotation
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved'
  order by quotation.created_at desc, quotation.id desc;
end;
$$;

revoke all on function public.external_finance_quotation_rows(uuid)
  from public, anon;
grant execute on function public.external_finance_quotation_rows(uuid)
  to authenticated;

commit;
