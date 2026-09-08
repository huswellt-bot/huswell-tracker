-- Give Mockup Quotations the same preparer-controlled draft lifecycle as
-- direct Price Quotations. The source Price Quotation remains read-only;
-- only the independently stored Mockup requirements can be revised.

begin;

create or replace function public.unsubmit_mockup_quotation(p_mockup_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_mockup_quotation_id
  for update;

  if not found or v_quote.document_type <> 'mockup_quotation' then
    raise exception 'Mockup Quotation not found';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only submitted Mockup Quotations can be unsubmitted';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) then
    raise exception 'Only a Sales Executive can unsubmit a Mockup Quotation';
  end if;
  if v_quote.created_by is distinct from (select auth.uid())
    and v_quote.prepared_by_user_id is distinct from (select auth.uid())
    and v_quote.submitted_by is distinct from (select auth.uid()) then
    raise exception 'Only the Sales Executive who prepared this Mockup Quotation can unsubmit it';
  end if;

  update public.quotations
  set status = 'draft',
      submitted_by = null,
      submitted_at = null
  where id = v_quote.id;

  delete from public.approval_requests
  where organization_id = v_quote.organization_id
    and resource_type = 'quotation'
    and resource_id = v_quote.id
    and status::text = 'pending';
end;
$$;

create or replace function public.begin_mockup_quotation_revision(p_mockup_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_mockup_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'mockup_quotation'
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved Mockup Quotation can be revised';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Sales Executive who prepared this Mockup Quotation can revise it';
  end if;

  update public.quotations
  set status = 'needs_revision',
      approved_by = null,
      approved_at = null,
      revision_note = 'Revision in progress. Update the Mockup Quotation and submit it for review.',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now()
  where id = v_quote.id;
end;
$$;

revoke all on function public.unsubmit_mockup_quotation(uuid) from public;
grant execute on function public.unsubmit_mockup_quotation(uuid) to authenticated;
revoke all on function public.begin_mockup_quotation_revision(uuid) from public;
grant execute on function public.begin_mockup_quotation_revision(uuid) to authenticated;

commit;
