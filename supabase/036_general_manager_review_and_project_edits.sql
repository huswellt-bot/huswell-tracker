-- General Manager review refinements, client snapshots, and Project Officer
-- project-edit approval requests. Run after 035_fix_costing_approval_status_enum.sql.
-- This migration is additive and preserves all existing quotations and leads.

alter table public.quotations
  add column if not exists client_contact_name text,
  add column if not exists revision_note text,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists revision_requested_by uuid references auth.users(id);

-- Preserve the client contact on existing records wherever its source record
-- still exists. New records receive this snapshot at creation time.
update public.quotations quotation
set client_contact_name = coalesce(
  nullif(btrim((
    select customer.contact_name
    from public.customers customer
    where customer.id = quotation.customer_id
  )), ''),
  nullif(btrim(lead.contact_name), '')
)
from public.leads lead
where lead.id = quotation.lead_id
  and quotation.status::text in ('draft', 'needs_revision')
  and nullif(btrim(coalesce(quotation.client_contact_name, '')), '') is null;

update public.quotations quotation
set client_contact_name = nullif(btrim(customer.contact_name), '')
from public.customers customer
where customer.id = quotation.customer_id
  and quotation.status::text in ('draft', 'needs_revision')
  and nullif(btrim(coalesce(quotation.client_contact_name, '')), '') is null;

create table if not exists public.project_edit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.leads(id) on delete cascade,
  proposed_changes jsonb not null,
  status public.approval_status not null default 'pending',
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(proposed_changes) = 'object')
);

create index if not exists project_edit_requests_org_status_idx
  on public.project_edit_requests (organization_id, status, submitted_at desc);
create unique index if not exists project_edit_requests_one_pending_per_project_idx
  on public.project_edit_requests (project_id)
  where status = 'pending';

drop trigger if exists project_edit_requests_updated_at on public.project_edit_requests;
create trigger project_edit_requests_updated_at
before update on public.project_edit_requests
for each row execute function public.set_updated_at();

alter table public.project_edit_requests enable row level security;
drop policy if exists "project edit requests: workflow read" on public.project_edit_requests;
drop policy if exists "project edit requests: workflow insert" on public.project_edit_requests;
drop policy if exists "project edit requests: general manager decide" on public.project_edit_requests;
create policy "project edit requests: workflow read"
on public.project_edit_requests for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or submitted_by = (select auth.uid())
);
create policy "project edit requests: workflow insert"
on public.project_edit_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.has_text_role(organization_id, array['project_manager']))
  and exists (
    select 1 from public.leads project
    where project.id = project_id
      and project.organization_id = project_edit_requests.organization_id
      and project.created_by = (select auth.uid())
      and project.evaluation_number = 7
  )
);
create policy "project edit requests: general manager decide"
on public.project_edit_requests for update to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
) with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Project Officers retain normal lead updates, but updates to Done Deal projects
-- must go through request_project_edit. General Managers retain direct access.
drop policy if exists "leads: creator or owner update" on public.leads;
create policy "leads: creator or owner update"
on public.leads for update to authenticated
using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and evaluation_number is distinct from 7
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
) with check (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
  or (
    created_by = (select auth.uid())
    and evaluation_number is distinct from 7
    and (select private.has_text_role(organization_id, array['project_manager']))
  )
);

-- Deletion is reserved for the General Manager. This also removes the current
-- Project Officer delete path for consistency and data preservation.
drop policy if exists "leads: creator or owner delete" on public.leads;
drop policy if exists "leads: general manager delete" on public.leads;
create policy "leads: general manager delete"
on public.leads for delete to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
);

-- Price Quotations and Costing Breakdowns are deletable only by the General
-- Manager. Project Officers retain no deletion path.
drop policy if exists "quotations: workflow delete" on public.quotations;
drop policy if exists "quotations: general manager delete" on public.quotations;
create policy "quotations: general manager delete"
on public.quotations for delete to authenticated using (
  (select private.has_text_role(organization_id, array['owner', 'admin']))
);

create or replace function public.request_project_edit(
  p_project_id uuid,
  p_proposed_changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_project public.leads%rowtype;
  v_changes jsonb;
  v_request_id uuid;
begin
  select * into v_project from public.leads where id = p_project_id for update;
  if not found or v_project.evaluation_number is distinct from 7 then
    raise exception 'Project not found';
  end if;
  if v_project.created_by is distinct from (select auth.uid())
    or not private.has_text_role(v_project.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who created this project can request an edit';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_changes
  from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
  where key = any (array[
    'project_name', 'contact_name', 'client_name', 'email', 'phone',
    'date_sent', 'date_contacted', 'contact_method', 'outbound_caller',
    'done_deal_status'
  ]);

  if v_changes = '{}'::jsonb then
    raise exception 'Include at least one project field to edit';
  end if;

  insert into public.project_edit_requests (
    organization_id, project_id, proposed_changes, submitted_by
  ) values (
    v_project.organization_id, v_project.id, v_changes, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A project edit request is already awaiting General Manager approval';
end;
$$;
grant execute on function public.request_project_edit(uuid, jsonb) to authenticated;

create or replace function public.review_project_edit(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_edit_requests%rowtype;
  v_changes jsonb;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project edit decision';
  end if;
  select * into v_request from public.project_edit_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Project edit request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project edits';
  end if;

  v_changes := v_request.proposed_changes;
  if p_decision = 'approved' then
    update public.leads project
    set project_name = case when v_changes ? 'project_name' then nullif(btrim(v_changes->>'project_name'), '') else project.project_name end,
        contact_name = case when v_changes ? 'contact_name' then nullif(btrim(v_changes->>'contact_name'), '') else project.contact_name end,
        client_name = case when v_changes ? 'client_name' then nullif(btrim(v_changes->>'client_name'), '') else project.client_name end,
        email = case when v_changes ? 'email' then nullif(btrim(v_changes->>'email'), '') else project.email end,
        phone = case when v_changes ? 'phone' then nullif(btrim(v_changes->>'phone'), '') else project.phone end,
        date_sent = case when v_changes ? 'date_sent' then nullif(v_changes->>'date_sent', '')::date else project.date_sent end,
        date_contacted = case when v_changes ? 'date_contacted' then nullif(v_changes->>'date_contacted', '')::date else project.date_contacted end,
        contact_method = case when v_changes ? 'contact_method' then nullif(btrim(v_changes->>'contact_method'), '') else project.contact_method end,
        outbound_caller = case when v_changes ? 'outbound_caller' then nullif(btrim(v_changes->>'outbound_caller'), '') else project.outbound_caller end,
        done_deal_status = case when v_changes ? 'done_deal_status' then nullif(v_changes->>'done_deal_status', '')::integer else project.done_deal_status end
    where project.id = v_request.project_id;
  end if;

  update public.project_edit_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_request.id;

  return v_request.project_id;
end;
$$;
grant execute on function public.review_project_edit(uuid, text, text) to authenticated;

-- Preserve revision instructions while the Project Officer revises and
-- resubmits the Costing Breakdown.
create or replace function public.submit_costing_breakdown(p_costing_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
begin
  select * into v_costing from public.quotations where id = p_costing_id for update;
  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;
  if v_costing.created_by is distinct from (select auth.uid())
    and not private.has_text_role(v_costing.organization_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to submit this Costing Breakdown';
  end if;
  if v_costing.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Costing Breakdowns can be submitted';
  end if;

  update public.quotations
  set status = 'pending', submitted_at = now(), submitted_by = (select auth.uid()),
      approved_at = null, approved_by = null
  where id = v_costing.id;

  insert into public.approval_requests (
    organization_id, resource_type, resource_id, status, submitted_by, submitted_at
  ) values (
    v_costing.organization_id, 'quotation', v_costing.id, 'pending', (select auth.uid()), now()
  ) on conflict (resource_type, resource_id) do update
  set status = 'pending', submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at, decided_by = null, decided_at = null;
end;
$$;
grant execute on function public.submit_costing_breakdown(uuid) to authenticated;

-- Cost line triggers recalculate totals when lines change. GM review changes
-- percentage rates, so refresh totals explicitly before creating the linked
-- Price Quotation.
create or replace function private.refresh_quotation_totals(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_cost numeric(14,2);
begin
  select coalesce(sum(line_total), 0) into v_cost
  from public.quotation_items where quotation_id = p_quotation_id;

  update public.quotations quotation
  set total_cost = v_cost,
      subtotal = round(v_cost * (
        1 + quotation.profit_margin_rate / 100 + quotation.overhead_rate / 100
          + quotation.buffer_margin_rate / 100 + quotation.commission_rate / 100
      ), 2),
      vat_amount = round(v_cost * (
        1 + quotation.profit_margin_rate / 100 + quotation.overhead_rate / 100
          + quotation.buffer_margin_rate / 100 + quotation.commission_rate / 100
      ) * quotation.vat_rate / 100, 2),
      total_amount = round(v_cost * (
        1 + quotation.profit_margin_rate / 100 + quotation.overhead_rate / 100
          + quotation.buffer_margin_rate / 100 + quotation.commission_rate / 100
      ) * (1 + quotation.vat_rate / 100), 2)
  where quotation.id = p_quotation_id;
end;
$$;

drop function if exists public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text);
create or replace function public.review_costing_breakdown(
  p_costing_id uuid,
  p_decision text,
  p_profit_margin_rate numeric,
  p_overhead_rate numeric,
  p_buffer_margin_rate numeric,
  p_commission_rate numeric,
  p_vat_rate numeric,
  p_terms_conditions text,
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
  where costing_source_id = v_costing.id and document_type = 'price_quotation';
  if v_price_id is null then
    v_price_no := format('QT-%s-%s', to_char(current_date, 'YYYY'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    insert into public.quotations (
      organization_id, quotation_no, document_type, costing_source_id, customer_id,
      lead_id, client_name, client_contact_name, client_phone, size_details,
      project_quantity, delivery_date, project_types, project_name, representative,
      profit_margin_rate, overhead_rate, buffer_margin_rate, commission_rate, vat_rate,
      terms_conditions, issue_date, valid_until, notes, status, created_by
    ) values (
      v_costing.organization_id, v_price_no, 'price_quotation', v_costing.id,
      v_costing.customer_id, v_costing.lead_id, v_costing.client_name,
      v_costing.client_contact_name, v_costing.client_phone, v_costing.size_details,
      v_costing.project_quantity, v_costing.delivery_date, v_costing.project_types,
      v_costing.project_name, v_costing.representative, v_costing.profit_margin_rate,
      v_costing.overhead_rate, v_costing.buffer_margin_rate, v_costing.commission_rate,
      v_costing.vat_rate, v_costing.terms_conditions, current_date, v_costing.valid_until,
      v_costing.notes, 'sent', (select auth.uid())
    ) returning id into v_price_id;
    insert into public.quotation_items (
      quotation_id, inventory_item_id, description, details, image_url, quantity, unit_cost, sort_order
    ) select v_price_id, item.inventory_item_id, item.description, item.details,
      item.image_url, item.quantity, item.unit_cost, item.sort_order
    from public.quotation_items item where item.quotation_id = v_costing.id
    order by item.sort_order, item.created_at;
  end if;
  return query select v_costing.id, v_price_id;
end;
$$;
grant execute on function public.review_costing_breakdown(uuid, text, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
