-- Tracks future Sales Project Officer resubmissions for the Pricing Officer queue.
-- Run after 111_pricing_officer_submit_to_gm.sql.

begin;

alter table public.quotations
  add column if not exists resubmission_count integer not null default 0
  check (resubmission_count >= 0);

create or replace function public.submit_price_quotation(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Price Quotations can be submitted';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Project Officer who prepared this quotation can submit it';
  end if;
  if not exists (select 1 from public.quotation_items where quotation_id = v_quote.id) then
    raise exception 'Add at least one item before submitting the quotation';
  end if;
  update public.quotations
  set status = 'pending', submitted_by = (select auth.uid()), submitted_at = now(),
      resubmission_count = case when v_quote.status::text = 'needs_revision' then resubmission_count + 1 else resubmission_count end
  where id = v_quote.id;
  insert into public.approval_requests (organization_id, resource_type, resource_id, status, submitted_by, submitted_at)
  values (v_quote.organization_id, 'quotation', v_quote.id, 'pending', (select auth.uid()), now())
  on conflict (resource_type, resource_id) do update
    set status = 'pending', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
        decided_by = null, decided_at = null, decision_note = null;
end;
$$;

revoke all on function public.submit_price_quotation(uuid) from public;
grant execute on function public.submit_price_quotation(uuid) to authenticated;

commit;
