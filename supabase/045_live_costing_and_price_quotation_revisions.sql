-- Live revision workflow for approved Costing Breakdowns and their linked
-- Price Quotations. Run after 044_sales_project_officer_lead_change_approvals.sql.
-- This keeps one live Costing Breakdown and one live Price Quotation; it does
-- not create or retain historical document revisions or PDF snapshots.

create table if not exists public.quotation_revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  costing_id uuid not null references public.quotations(id) on delete cascade,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotation_revision_requests_org_status_idx
  on public.quotation_revision_requests (organization_id, status, submitted_at desc);
create unique index if not exists quotation_revision_requests_one_pending_per_costing_idx
  on public.quotation_revision_requests (costing_id)
  where status = 'pending';

drop trigger if exists quotation_revision_requests_updated_at on public.quotation_revision_requests;
create trigger quotation_revision_requests_updated_at
before update on public.quotation_revision_requests
for each row execute function public.set_updated_at();

alter table public.quotation_revision_requests enable row level security;
drop policy if exists "quotation revision requests: workflow read" on public.quotation_revision_requests;
drop policy if exists "quotation revision requests: workflow insert" on public.quotation_revision_requests;
drop policy if exists "quotation revision requests: general manager decide" on public.quotation_revision_requests;
create policy "quotation revision requests: workflow read"
on public.quotation_revision_requests for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or submitted_by = (select auth.uid())
);
create policy "quotation revision requests: workflow insert"
on public.quotation_revision_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.has_text_role(organization_id, array['project_manager']))
  and exists (
    select 1
    from public.quotations costing
    where costing.id = quotation_revision_requests.costing_id
      and costing.organization_id = quotation_revision_requests.organization_id
      and costing.document_type = 'costing_breakdown'
      and costing.status::text = 'approved'
      and costing.created_by = (select auth.uid())
  )
);
create policy "quotation revision requests: general manager decide"
on public.quotation_revision_requests for update to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
) with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Project Officers may edit only Costing Breakdowns that are intentionally
-- open for editing. General Managers retain full workspace access.
drop policy if exists "quotations: workflow update" on public.quotations;
create policy "quotations: workflow update"
on public.quotations for update to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and document_type = 'costing_breakdown'
    and status::text in ('draft', 'needs_revision')
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
) with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and document_type = 'costing_breakdown'
    and status::text in ('draft', 'needs_revision')
    and (select private.has_text_role(organization_id, array['project_manager']))
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
  if v_costing.created_by is distinct from (select auth.uid())
    or not private.has_text_role(v_costing.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who created this Costing Breakdown can request a revision';
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

create or replace function public.review_quotation_revision(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.quotation_revision_requests%rowtype;
  v_costing public.quotations%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported quotation revision decision';
  end if;

  select * into v_request
  from public.quotation_revision_requests
  where id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Quotation revision request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review quotation revisions';
  end if;

  select * into v_costing
  from public.quotations
  where id = v_request.costing_id
  for update;
  if not found
    or v_costing.document_type <> 'costing_breakdown'
    or v_costing.status::text <> 'approved' then
    raise exception 'This Costing Breakdown is no longer available for revision';
  end if;

  if p_decision = 'approved' then
    update public.quotations
    set status = 'needs_revision',
        revision_note = 'Revision approved. Update the Costing Breakdown and submit it for review.',
        revision_requested_by = (select auth.uid()),
        revision_requested_at = now(),
        approved_by = null,
        approved_at = null
    where id = v_costing.id;

    update public.quotations
    set status = 'needs_revision'
    where costing_source_id = v_costing.id
      and document_type = 'price_quotation';
  end if;

  update public.quotation_revision_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = v_request.id;

  return v_costing.id;
end;
$$;
revoke all on function public.review_quotation_revision(uuid, text) from public;
grant execute on function public.review_quotation_revision(uuid, text) to authenticated;

-- A re-approved Costing Breakdown refreshes the same linked Price Quotation.
-- The existing quotation number is retained and its current line items are
-- replaced with the approved costing lines.
create or replace function public.review_costing_breakdown(
  p_costing_id uuid,
  p_decision text,
  p_profit_margin_rate numeric,
  p_overhead_rate numeric,
  p_buffer_margin_rate numeric,
  p_commission_rate numeric,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_revision_note text default null
)
returns table (costing_id uuid, price_quotation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_price_id uuid;
  v_price_no text;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Costing Breakdown decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter revision notes before returning this Costing Breakdown';
  end if;

  select * into v_costing from public.quotations where id = p_costing_id for update;
  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;
  if not private.has_text_role(v_costing.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Costing Breakdowns';
  end if;
  if v_costing.status::text <> 'pending' then
    raise exception 'Only submitted Costing Breakdowns can be reviewed';
  end if;

  update public.quotations
  set profit_margin_rate = coalesce(p_profit_margin_rate, profit_margin_rate),
      overhead_rate = coalesce(p_overhead_rate, overhead_rate),
      buffer_margin_rate = coalesce(p_buffer_margin_rate, buffer_margin_rate),
      commission_rate = coalesce(p_commission_rate, commission_rate),
      vat_rate = coalesce(p_vat_rate, vat_rate),
      terms_conditions = coalesce(p_terms_conditions, terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      status = p_decision::public.quotation_status,
      revision_note = case when p_decision = 'needs_revision' then v_note else null end,
      revision_requested_by = case when p_decision = 'needs_revision' then (select auth.uid()) else null end,
      revision_requested_at = case when p_decision = 'needs_revision' then now() else null end,
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end
  where id = v_costing.id returning * into v_costing;

  perform private.refresh_quotation_totals(v_costing.id);
  select * into v_costing from public.quotations where id = v_costing.id;

  update public.approval_requests
  set status = (case when p_decision = 'approved' then 'approved' else 'needs_revision' end)::public.approval_status,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where organization_id = v_costing.organization_id and resource_type = 'quotation'
    and resource_id = v_costing.id;

  if p_decision = 'needs_revision' then
    return query select v_costing.id, null::uuid;
    return;
  end if;

  select id into v_price_id from public.quotations
  where costing_source_id = v_costing.id and document_type = 'price_quotation'
  for update;
  if v_price_id is null then
    v_price_no := format('QT-%s-%s', to_char(current_date, 'YYYY'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    insert into public.quotations (
      organization_id, quotation_no, document_type, costing_source_id, customer_id,
      lead_id, client_name, client_contact_name, client_phone, size_details,
      project_quantity, delivery_date, project_types, project_name, representative,
      prepared_by_user_id, prepared_by_signature_url,
      profit_margin_rate, overhead_rate, buffer_margin_rate, commission_rate, vat_rate,
      terms_conditions, bank_details, issue_date, valid_until, notes, status, created_by
    ) values (
      v_costing.organization_id, v_price_no, 'price_quotation', v_costing.id,
      v_costing.customer_id, v_costing.lead_id, v_costing.client_name,
      v_costing.client_contact_name, v_costing.client_phone, v_costing.size_details,
      v_costing.project_quantity, v_costing.delivery_date, v_costing.project_types,
      v_costing.project_name, v_costing.representative,
      v_costing.prepared_by_user_id, v_costing.prepared_by_signature_url,
      v_costing.profit_margin_rate, v_costing.overhead_rate, v_costing.buffer_margin_rate,
      v_costing.commission_rate, v_costing.vat_rate, v_costing.terms_conditions,
      v_costing.bank_details, current_date, v_costing.valid_until, v_costing.notes,
      'sent', (select auth.uid())
    ) returning id into v_price_id;
  else
    update public.quotations
    set customer_id = v_costing.customer_id,
        lead_id = v_costing.lead_id,
        client_name = v_costing.client_name,
        client_contact_name = v_costing.client_contact_name,
        client_phone = v_costing.client_phone,
        size_details = v_costing.size_details,
        project_quantity = v_costing.project_quantity,
        delivery_date = v_costing.delivery_date,
        project_types = v_costing.project_types,
        project_name = v_costing.project_name,
        representative = v_costing.representative,
        prepared_by_user_id = v_costing.prepared_by_user_id,
        prepared_by_signature_url = v_costing.prepared_by_signature_url,
        profit_margin_rate = v_costing.profit_margin_rate,
        overhead_rate = v_costing.overhead_rate,
        buffer_margin_rate = v_costing.buffer_margin_rate,
        commission_rate = v_costing.commission_rate,
        vat_rate = v_costing.vat_rate,
        terms_conditions = v_costing.terms_conditions,
        bank_details = v_costing.bank_details,
        issue_date = current_date,
        valid_until = v_costing.valid_until,
        notes = v_costing.notes,
        status = 'sent'
    where id = v_price_id;

    delete from public.quotation_items where quotation_id = v_price_id;
  end if;

  insert into public.quotation_items (
    quotation_id, inventory_item_id, description, details, image_url, quantity, unit_cost, sort_order
  ) select v_price_id, item.inventory_item_id, item.description, item.details,
      item.image_url, item.quantity, item.unit_cost, item.sort_order
  from public.quotation_items item where item.quotation_id = v_costing.id
  order by item.sort_order, item.created_at;

  perform private.refresh_quotation_totals(v_price_id);
  return query select v_costing.id, v_price_id;
end;
$$;
revoke all on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text) from public;
grant execute on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text) to authenticated;
