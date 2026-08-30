-- An approved direct Price Quotation may be reopened only after the General
-- Manager approves a revision request from its Sales Project Officer.
begin;

create table if not exists public.price_quotation_revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_quotation_revision_requests_org_status_idx
  on public.price_quotation_revision_requests (organization_id, status, submitted_at desc);
create unique index if not exists price_quotation_revision_requests_one_pending_per_quote_idx
  on public.price_quotation_revision_requests (quotation_id)
  where status = 'pending';

drop trigger if exists price_quotation_revision_requests_updated_at on public.price_quotation_revision_requests;
create trigger price_quotation_revision_requests_updated_at
before update on public.price_quotation_revision_requests
for each row execute function public.set_updated_at();

alter table public.price_quotation_revision_requests enable row level security;
drop policy if exists "price quotation revision requests: read" on public.price_quotation_revision_requests;
create policy "price quotation revision requests: read"
on public.price_quotation_revision_requests for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or submitted_by = (select auth.uid())
);

create or replace function public.request_price_quotation_revision(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_request_id uuid;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved Price Quotation can be requested for revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) then
    raise exception 'Only a Sales Project Officer can request a Price Quotation revision';
  end if;
  if v_quote.prepared_by_user_id is distinct from (select auth.uid())
    and v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Project Officer who prepared this Price Quotation can request a revision';
  end if;

  insert into public.price_quotation_revision_requests (organization_id, quotation_id, submitted_by)
  values (v_quote.organization_id, v_quote.id, (select auth.uid()))
  returning id into v_request_id;
  return v_request_id;
exception
  when unique_violation then
    raise exception 'A Price Quotation revision request is already awaiting General Manager approval';
end;
$$;

create or replace function public.review_price_quotation_revision(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.price_quotation_revision_requests%rowtype;
  v_quote public.quotations%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported Price Quotation revision decision';
  end if;

  select * into v_request from public.price_quotation_revision_requests where id = p_request_id for update;
  if not found or v_request.status::text <> 'pending' then
    raise exception 'Price Quotation revision request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can review Price Quotation revisions';
  end if;

  select * into v_quote from public.quotations where id = v_request.quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'This Price Quotation is no longer available for revision';
  end if;

  if p_decision = 'approved' then
    update public.quotations
    set status = 'needs_revision',
        approved_by = null,
        approved_at = null,
        revision_note = 'Revision request approved. Update the Price Quotation and submit it for review.',
        revision_requested_by = (select auth.uid()),
        revision_requested_at = now()
    where id = v_quote.id;
  end if;

  update public.price_quotation_revision_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = v_request.id;

  return v_quote.id;
end;
$$;

revoke all on function public.request_price_quotation_revision(uuid) from public;
grant execute on function public.request_price_quotation_revision(uuid) to authenticated;
revoke all on function public.review_price_quotation_revision(uuid, text) from public;
grant execute on function public.review_price_quotation_revision(uuid, text) to authenticated;

commit;
