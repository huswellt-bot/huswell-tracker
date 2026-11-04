-- Printing quotations reuse the existing quotation_items/PDF/GM review path,
-- while keeping Lead Costing preparation and source records distinguishable.

begin;

alter table public.quotations
  add column if not exists quotation_source text not null default 'standard';

alter table public.quotations
  drop constraint if exists quotations_quotation_source_check;

alter table public.quotations
  add constraint quotations_quotation_source_check
  check (quotation_source in ('standard', 'lead_costing_printing'));

alter table public.quotation_items
  add column if not exists costing_metadata jsonb not null default '{}'::jsonb;

create index if not exists quotations_printing_source_idx
  on public.quotations (organization_id, quotation_source, status, created_at desc);

create or replace function private.lead_costing_can_manage_printing_quotation(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(
    p_organization_id,
    array['lead_coordinator', 'super_admin', 'owner', 'admin']
  );
$$;

-- The existing quotation transition guard remains authoritative for every
-- standard quotation. Printing quotations have a narrower direct path:
-- Lead Coordinator -> GM, with the GM still owning approval/finalization.
create or replace function public.enforce_price_quotation_role_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if new.quotation_source = 'lead_costing_printing' then
    if tg_op = 'INSERT' then
      if new.document_type = 'price_quotation'
        and new.status::text = 'draft'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['lead_coordinator']) then
        return new;
      end if;
      raise exception 'Only an authorized Lead Coordinator can create a printing quotation draft';
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if old.status::text in ('draft', 'needs_revision')
        and new.status::text in ('draft', 'pending_gm_approval')
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['lead_coordinator']) then
        return new;
      end if;
      raise exception 'Only the General Manager can approve or finalize this printing quotation';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT'
    and new.status::text not in ('draft', 'needs_revision', 'pending') then
    raise exception 'Only an administrator can approve or finalize a quotation';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.document_type = 'mockup_quotation' then
      if old.status::text in ('draft', 'needs_revision')
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
        and new.status::text = 'pending'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then
        if private.normalize_price_quotation_project_type(new.project_types) is null
          or not exists (
            select 1 from public.pricing_officer_project_types assignment
            where assignment.organization_id = new.organization_id
              and assignment.project_type = private.normalize_price_quotation_project_type(new.project_types)
          ) then
          raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
        end if;
        return new;
      end if;
      if old.status::text = 'needs_revision'
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
        and new.status::text = 'draft'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'pending'
        and new.status::text = 'draft'
        and (new.created_by = (select auth.uid()) or new.prepared_by_user_id = (select auth.uid()))
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'approved'
        and new.status::text = 'needs_revision'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'needs_revision'
        and old.revision_requested_to = 'pricing_officer'
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type'; end if;
        new.pricing_reviewed_by := (select auth.uid()); new.pricing_reviewed_at := now(); return new;
      end if;
      if old.status::text = 'pending'
        and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type'; end if;
        if new.status::text = 'approved' then new.status := 'pending_gm_approval'; new.approved_by := null; new.approved_at := null; new.pricing_reviewed_by := (select auth.uid()); new.pricing_reviewed_at := now(); end if;
        return new;
      end if;
    elsif new.document_type = 'price_quotation' and new.costing_source_id is null then
      if old.status::text in ('draft', 'needs_revision')
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
        and new.status::text = 'pending'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then
        if private.normalize_price_quotation_project_type(new.project_types) is null
          or not exists (
            select 1 from public.pricing_officer_project_types assignment
            where assignment.organization_id = new.organization_id
              and assignment.project_type = private.normalize_price_quotation_project_type(new.project_types)
          ) then raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet'; end if;
        return new;
      end if;
      if old.status::text = 'needs_revision'
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
        and new.status::text = 'draft'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'pending'
        and new.status::text = 'draft'
        and (new.created_by = (select auth.uid()) or new.prepared_by_user_id = (select auth.uid()))
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'approved'
        and new.status::text = 'needs_revision'
        and new.created_by = (select auth.uid())
        and private.has_text_role(new.organization_id, array['project_manager']) then return new; end if;
      if old.status::text = 'needs_revision'
        and old.revision_requested_to = 'pricing_officer'
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type'; end if;
        new.pricing_reviewed_by := (select auth.uid()); new.pricing_reviewed_at := now(); return new;
      end if;
      if old.status::text = 'pending'
        and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type'; end if;
        if new.status::text = 'approved' then new.status := 'pending_gm_approval'; new.approved_by := null; new.approved_at := null; new.pricing_reviewed_by := (select auth.uid()); new.pricing_reviewed_at := now(); end if;
        return new;
      end if;
    end if;
    raise exception 'Only an administrator can approve or finalize a quotation';
  end if;
  return new;
end;
$$;

create or replace function public.save_lead_costing_printing_quotation(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_name text,
  p_issue_date date,
  p_items jsonb,
  p_terms_conditions text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_quote public.quotations%rowtype;
  v_item jsonb;
  v_index integer := 0;
  v_subtotal numeric(14,2) := 0;
  v_production_cost numeric(14,2) := 0;
  v_vat_rate numeric(5,2) := 0;
begin
  select * into v_lead from public.leads where id = p_lead_id for share;
  if not found then raise exception 'Lead not found'; end if;
  if not private.has_text_role(v_lead.organization_id, array['lead_coordinator', 'super_admin', 'owner', 'admin']) then raise exception 'Only a Lead Coordinator can prepare a printing quotation'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one printing line before saving'; end if;

  if p_quotation_id is null then
    insert into public.quotations (
      organization_id, quotation_no, quotation_source, document_type, lead_id,
      client_name, client_contact_name, client_phone, client_address,
      project_name, project_types, representative, prepared_by_user_id,
      created_by, issue_date, status, vat_rate, profit_margin_rate,
      overhead_rate, buffer_margin_rate, commission_rate, shipping_handling,
      terms_conditions, bank_details
    )
    select v_lead.organization_id,
      format('PQ-%s', lpad(nextval('public.price_quotation_number_seq')::text, 5, '0')),
      'lead_costing_printing', 'price_quotation', v_lead.id,
      v_lead.client_name, v_lead.contact_name, v_lead.phone, v_lead.address,
      coalesce(nullif(btrim(p_project_name), ''), v_lead.project_name, 'Printing collateral quotation'),
      'Printing', coalesce((select full_name from public.profiles where id = (select auth.uid())), 'Lead & Costing Coordinator'),
      (select auth.uid()), (select auth.uid()), coalesce(p_issue_date, current_date), 'draft', 0, 0,
      0, 0, 0, 0, coalesce(nullif(btrim(p_terms_conditions), ''), ''),
      coalesce((select default_bank_details from public.business_settings where organization_id = v_lead.organization_id limit 1), '[]'::jsonb)
    returning * into v_quote;
  else
    select * into v_quote from public.quotations where id = p_quotation_id for update;
    if not found or v_quote.quotation_source <> 'lead_costing_printing' or v_quote.organization_id <> v_lead.organization_id then raise exception 'Printing quotation not found'; end if;
    if v_quote.status::text not in ('draft', 'needs_revision') then raise exception 'Only draft or returned printing quotations can be edited'; end if;
    if v_quote.created_by is distinct from (select auth.uid()) and not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then raise exception 'Only the coordinator who prepared this quotation can edit it'; end if;
    update public.quotations set lead_id = v_lead.id, client_name = v_lead.client_name, client_contact_name = v_lead.contact_name, client_phone = v_lead.phone, client_address = v_lead.address, project_name = coalesce(nullif(btrim(p_project_name), ''), v_lead.project_name, project_name), issue_date = coalesce(p_issue_date, issue_date), status = 'draft', revision_note = null, revision_requested_to = null, revision_requested_by = null, revision_requested_at = null, decision_note = null, terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions) where id = v_quote.id returning * into v_quote;
    delete from public.quotation_items where quotation_id = v_quote.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(v_item ->> 'description'), '') is null or coalesce((v_item ->> 'quantity')::numeric, 0) <= 0 then raise exception 'Each printing line needs a description and positive quantity'; end if;
    insert into public.quotation_items (quotation_id, description, quantity, unit_cost, sort_order, costing_metadata)
    values (v_quote.id, btrim(v_item ->> 'description'), (v_item ->> 'quantity')::numeric, 0, v_index, coalesce(v_item -> 'costing_metadata', '{}'::jsonb));
    v_index := v_index + 1;
  end loop;

  select coalesce(sum(line_total), 0), coalesce(sum((nullif(costing_metadata ->> 'production_cost', '')::numeric) * quantity), 0)
    into v_subtotal, v_production_cost
    from public.quotation_items where quotation_id = v_quote.id;
  select coalesce(v_quote.vat_rate, 0) into v_vat_rate;
  update public.quotations
  set total_cost = round(v_production_cost, 2), subtotal = round(v_subtotal, 2), vat_amount = round(v_subtotal * v_vat_rate / 100, 2), total_amount = round(v_subtotal + (v_subtotal * v_vat_rate / 100) + coalesce(shipping_handling, 0), 2), updated_at = now()
  where id = v_quote.id;
  return v_quote.id;
end;
$$;

create or replace function public.submit_lead_costing_printing_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.quotation_source <> 'lead_costing_printing' then raise exception 'Printing quotation not found'; end if;
  if not private.has_text_role(v_quote.organization_id, array['lead_coordinator']) or v_quote.created_by is distinct from (select auth.uid()) then raise exception 'Only the coordinator who prepared this quotation can submit it'; end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then raise exception 'Only draft or returned printing quotations can be submitted'; end if;
  if not exists (select 1 from public.quotation_items where quotation_id = v_quote.id) then raise exception 'Add at least one printing line before submitting'; end if;
  if exists (select 1 from public.quotation_items where quotation_id = v_quote.id and (costing_metadata ->> 'unit') = 'px') then raise exception 'Provide physical dimensions before submitting a pixel-sized line'; end if;
  update public.quotations set status = 'pending_gm_approval', submitted_by = (select auth.uid()), submitted_at = now(), revision_requested_to = null where id = v_quote.id;
  insert into public.approval_requests (organization_id, resource_type, resource_id, status, submitted_by, submitted_at)
  values (v_quote.organization_id, 'quotation', v_quote.id, 'pending', (select auth.uid()), now())
  on conflict (resource_type, resource_id) do update set status = 'pending', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at, decided_by = null, decided_at = null, decision_note = null;
end;
$$;

revoke all on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) from public;
revoke all on function public.submit_lead_costing_printing_quotation(uuid) from public;
grant execute on function public.save_lead_costing_printing_quotation(uuid, uuid, text, date, jsonb, text) to authenticated;
grant execute on function public.submit_lead_costing_printing_quotation(uuid) to authenticated;

drop policy if exists "lead costing printing quotations read" on public.quotations;
create policy "lead costing printing quotations read"
on public.quotations for select to authenticated
using (
  quotation_source = 'lead_costing_printing'
  and (
    created_by = (select auth.uid())
    or prepared_by_user_id = (select auth.uid())
    or private.has_text_role(organization_id, array['super_admin', 'owner', 'admin'])
  )
);

drop policy if exists "lead costing printing quotation items read" on public.quotation_items;
create policy "lead costing printing quotation items read"
on public.quotation_items for select to authenticated
using (exists (select 1 from public.quotations quote where quote.id = quotation_id and quote.quotation_source = 'lead_costing_printing' and (quote.created_by = (select auth.uid()) or quote.prepared_by_user_id = (select auth.uid()) or private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))));

commit;
