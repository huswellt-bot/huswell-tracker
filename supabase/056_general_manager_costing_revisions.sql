-- Allow General Managers to request revisions for any approved Costing
-- Breakdown in their organization. Project Officers may still request a
-- revision only for Costing Breakdowns they created.
-- Run after 055_delete_linked_price_quotation_with_costing.sql.

drop policy if exists "quotation revision requests: workflow insert" on public.quotation_revision_requests;
create policy "quotation revision requests: workflow insert"
on public.quotation_revision_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (
    (select private.has_text_role(organization_id, array['owner', 'admin']))
    or (
      (select private.has_text_role(organization_id, array['project_manager']))
      and exists (
        select 1
        from public.quotations costing
        where costing.id = quotation_revision_requests.costing_id
          and costing.organization_id = quotation_revision_requests.organization_id
          and costing.document_type = 'costing_breakdown'
          and costing.status::text = 'approved'
          and costing.created_by = (select auth.uid())
      )
    )
  )
);

create or replace function public.request_quotation_revision(p_costing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_request_id uuid;
begin
  select * into v_costing
  from public.quotations
  where id = p_costing_id
  for update;

  if not found
    or v_costing.document_type <> 'costing_breakdown'
    or v_costing.status::text <> 'approved' then
    raise exception 'Only an approved Costing Breakdown can be revised';
  end if;

  if not private.has_text_role(v_costing.organization_id, array['owner', 'admin'])
    and (
      v_costing.created_by is distinct from (select auth.uid())
      or not private.has_text_role(v_costing.organization_id, array['project_manager'])
    ) then
    raise exception 'Only the General Manager or the Project Officer who created this Costing Breakdown can request a revision';
  end if;

  if not exists (
    select 1 from public.quotations price
    where price.costing_source_id = v_costing.id
      and price.document_type = 'price_quotation'
  ) then
    raise exception 'The linked Price Quotation is not available for revision';
  end if;

  insert into public.quotation_revision_requests (
    organization_id, costing_id, submitted_by
  ) values (
    v_costing.organization_id, v_costing.id, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A revision request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_quotation_revision(uuid) from public;
grant execute on function public.request_quotation_revision(uuid) to authenticated;
