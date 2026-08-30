-- Price Quotation preparation workflow.
-- Run after migration 062. This migration is additive and leaves historical
-- Costing Breakdowns and their generated Price Quotations unchanged.

begin;

alter table public.leads
  add column if not exists address text;

alter table public.quotations
  add column if not exists client_address text,
  add column if not exists shipping_handling numeric(14,2) not null default 0
    check (shipping_handling >= 0);

create sequence if not exists public.price_quotation_number_seq;

-- Permit an officer to withdraw only their own new-format quotation from the
-- review queue; all other protected status transitions remain unchanged.
create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'needs_revision', 'pending'))
    or (
      tg_op = 'UPDATE'
      and new.status is distinct from old.status
      and not (
        new.document_type = 'price_quotation'
        and new.costing_source_id is null
        and old.status::text = 'pending'
        and new.status::text = 'draft'
      )
      and (
        new.status::text not in ('draft', 'needs_revision', 'pending')
        or old.status::text not in ('draft', 'needs_revision')
      )
    )
  ) then
    raise exception 'Only an administrator can approve or finalize a quotation';
  end if;

  if tg_table_name = 'expenses' and (
    (tg_op = 'INSERT' and new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval') or old.status::text not in ('unfulfilled', 'fulfilled')))
  ) then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;
  if tg_table_name = 'invoices' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'issued', 'partial'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'issued', 'partial') or old.status::text not in ('draft', 'issued', 'partial')))
  ) then raise exception 'Only an administrator can set this invoice status directly'; end if;
  if tg_table_name = 'payroll_periods' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'in_review'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'in_review') or old.status::text not in ('draft', 'in_review')))
  ) then raise exception 'Only an administrator can approve or mark payroll paid'; end if;
  if tg_table_name = 'cash_flow_entries' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'pending'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'pending') or old.status::text not in ('draft', 'pending')))
  ) then raise exception 'Only an administrator can approve cash flow'; end if;
  return new;
end;
$$;

-- RLS protects rows; these triggers additionally prevent a Project Officer
-- from writing GM-only monetary fields through a direct API request.
create or replace function public.enforce_price_quotation_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and private.has_text_role(new.organization_id, array['project_manager']) then
    if tg_op = 'INSERT' and (
      coalesce(new.vat_rate, 0) <> 0 or coalesce(new.shipping_handling, 0) <> 0
      or coalesce(new.total_cost, 0) <> 0 or coalesce(new.subtotal, 0) <> 0
      or coalesce(new.vat_amount, 0) <> 0 or coalesce(new.total_amount, 0) <> 0
    ) then
      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
    -- Item changes recalculate quotation totals through the existing nested
    -- quotation-items trigger. This is not a manual officer price update.
    if tg_op = 'UPDATE' and pg_trigger_depth() = 1 and (
      new.vat_rate is distinct from old.vat_rate
      or new.shipping_handling is distinct from old.shipping_handling
      or new.total_cost is distinct from old.total_cost
      or new.subtotal is distinct from old.subtotal
      or new.vat_amount is distinct from old.vat_amount
      or new.total_amount is distinct from old.total_amount
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    ) then
      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_price_quotation_item_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = new.quotation_id;
  if v_quote.document_type = 'price_quotation'
    and v_quote.costing_source_id is null
    and private.has_text_role(v_quote.organization_id, array['project_manager'])
    and coalesce(new.unit_cost, 0) <> 0 then
    raise exception 'Only the General Manager can set Selling Price / Unit';
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_preparation_guard on public.quotations;
create trigger price_quotation_preparation_guard
before insert or update on public.quotations
for each row execute function public.enforce_price_quotation_preparation();
drop trigger if exists price_quotation_item_preparation_guard on public.quotation_items;
create trigger price_quotation_item_preparation_guard
before insert or update on public.quotation_items
for each row execute function public.enforce_price_quotation_item_preparation();

-- New quotations are created directly from a Lead. Legacy price quotations
-- remain valid because they retain their existing costing_source_id.
create or replace function public.validate_quotation_document_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  source_status text;
  source_type text;
begin
  if new.document_type = 'costing_breakdown' and new.lead_id is null then
    raise exception 'A Costing Breakdown must be created from a Lead / Project';
  end if;

  if new.document_type = 'price_quotation' and new.costing_source_id is null and new.lead_id is null then
    raise exception 'A Price Quotation must be created from a Lead / Project';
  end if;

  if new.document_type = 'price_quotation' and new.costing_source_id is not null then
    select status::text, document_type
      into source_status, source_type
      from public.quotations
      where id = new.costing_source_id
        and organization_id = new.organization_id;
    if source_type is distinct from 'costing_breakdown' or source_status is distinct from 'approved' then
      raise exception 'A legacy Price Quotation requires an approved Costing Breakdown';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_quote public.quotations%rowtype;
  v_signature text;
  v_quote_id uuid;
  v_terms text := 'Production Lead Time: 2-3 weeks upon receipt of the approved artwork and downpayment.
Prices: All prices quoted are VAT INCLUSIVE.
Delivery: Pickup or delivery via a third-party courier. Delivery charges shall be shouldered by the client.
Payment Terms: 50% downpayment is required upon approval of the quotation. The Purchase Order (PO) plus 50% downpayment is required before production. The remaining 50% balance must be settled before delivery/release of the order. Production will commence only upon receipt of the required downpayment. PO alone will not be considered as payment assurance.
Cancellations: Orders cannot be cancelled once production has started.
Artwork Revisions: Any revisions or changes requested after the artwork has been approved may result in an adjustment of the production lead time. The revised delivery schedule will be based on the scope and timing of the requested changes.';
  v_banks jsonb;
begin
  if not private.has_text_role((select organization_id from public.leads where id = p_lead_id), array['project_manager', 'super_admin', 'owner', 'admin']) then
    raise exception 'You do not have permission to prepare a Price Quotation';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for share;
  if not found then
    raise exception 'Lead not found';
  end if;

  if private.has_text_role(v_lead.organization_id, array['project_manager'])
    and v_lead.assigned_to is distinct from (select auth.uid()) then
    raise exception 'Project Officers can prepare quotations only for their assigned leads';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item before saving the quotation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(description text, quantity numeric)
    where nullif(btrim(item.description), '') is null or coalesce(item.quantity, 0) <= 0
  ) then
    raise exception 'Each item needs a description and quantity greater than zero';
  end if;

  select signature_url into v_signature from public.profiles where id = (select auth.uid());
  select coalesce(default_bank_details, '[]'::jsonb) into v_banks
    from public.business_settings
    where organization_id = v_lead.organization_id
    limit 1;
  v_banks := coalesce(v_banks, '[]'::jsonb);

  if p_quotation_id is null then
    insert into public.quotations (
      organization_id, quotation_no, document_type, lead_id, client_name,
      client_contact_name, client_phone, client_address, project_name,
      representative, prepared_by_user_id, prepared_by_signature_url,
      terms_conditions, bank_details, vat_rate, shipping_handling, status,
      created_by, issue_date
    ) values (
      v_lead.organization_id,
      format('QTN-%s', lpad(nextval('public.price_quotation_number_seq')::text, 4, '0')),
      'price_quotation', v_lead.id, v_lead.client_name,
      v_lead.contact_name, v_lead.phone, v_lead.address, v_lead.project_name,
      coalesce((select full_name from public.profiles where id = (select auth.uid())), 'Sales Project Officer'),
      (select auth.uid()), v_signature, v_terms, v_banks, 0, 0,
      'draft', (select auth.uid()), current_date
    ) returning * into v_quote;
  else
    select * into v_quote from public.quotations where id = p_quotation_id for update;
    if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
      raise exception 'Price Quotation not found';
    end if;
    if v_quote.status::text not in ('draft', 'needs_revision') then
      raise exception 'Only draft or returned quotations can be edited';
    end if;
    if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
      and v_quote.created_by is distinct from (select auth.uid()) then
      raise exception 'Only the Project Officer who prepared this quotation can edit it';
    end if;

    update public.quotations
    set lead_id = v_lead.id,
        client_name = v_lead.client_name,
        client_contact_name = v_lead.contact_name,
        client_phone = v_lead.phone,
        client_address = v_lead.address,
        project_name = v_lead.project_name,
        status = 'draft',
        revision_note = null,
        revision_requested_by = null,
        revision_requested_at = null
    where id = v_quote.id
    returning * into v_quote;

    delete from public.quotation_items where quotation_id = v_quote.id;
  end if;

  insert into public.quotation_items (quotation_id, description, quantity, unit_cost, sort_order)
  select v_quote.id,
         btrim(item.value ->> 'description'),
         (item.value ->> 'quantity')::numeric,
         0,
         item.ordinality - 1
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality);

  return v_quote.id;
end;
$$;

create or replace function public.submit_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
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
  set status = 'pending', submitted_by = (select auth.uid()), submitted_at = now()
  where id = v_quote.id;

  insert into public.approval_requests (organization_id, resource_type, resource_id, status, submitted_by, submitted_at)
  values (v_quote.organization_id, 'quotation', v_quote.id, 'pending', (select auth.uid()), now())
  on conflict (resource_type, resource_id) do update
    set status = 'pending', submitted_by = excluded.submitted_by,
        submitted_at = excluded.submitted_at, decided_by = null, decided_at = null,
        decision_note = null;
end;
$$;

create or replace function public.unsubmit_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only submitted Price Quotations can be unsubmitted';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) then
    raise exception 'Only a Sales Project Officer can unsubmit a Price Quotation';
  end if;
  if v_quote.prepared_by_user_id is distinct from (select auth.uid())
    and v_quote.created_by is distinct from (select auth.uid())
    and v_quote.submitted_by is distinct from (select auth.uid()) then
    raise exception 'Only the Project Officer who prepared this quotation can unsubmit it';
  end if;

  update public.quotations
  set status = 'draft', submitted_by = null, submitted_at = null
  where id = v_quote.id;
  delete from public.approval_requests
  where organization_id = v_quote.organization_id
    and resource_type = 'quotation' and resource_id = v_quote.id
    and status::text = 'pending';
end;
$$;

create or replace function public.review_price_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_shipping_handling numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_line_prices jsonb,
  p_revision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;

  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can review Price Quotations';
  end if;
  if v_quote.status::text not in ('pending', 'draft') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;

  if p_decision = 'approved' then
    if jsonb_typeof(p_line_prices) <> 'array'
      or (select count(*) from jsonb_array_elements(p_line_prices)) <> (select count(*) from public.quotation_items where quotation_id = v_quote.id)
      or exists (
        select 1 from public.quotation_items item
        where item.quotation_id = v_quote.id
          and not exists (
            select 1 from jsonb_to_recordset(p_line_prices) as price(id uuid, unit_cost numeric)
            where price.id = item.id
          )
      ) then
      raise exception 'Enter a selling price for every quotation item';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(p_line_prices) as price(id uuid, unit_cost numeric)
      where price.id is null or coalesce(price.unit_cost, -1) < 0
    ) then
      raise exception 'Selling prices cannot be negative';
    end if;
    update public.quotation_items item
    set unit_cost = price.unit_cost
    from jsonb_to_recordset(p_line_prices) as price(id uuid, unit_cost numeric)
    where item.id = price.id and item.quotation_id = v_quote.id;
    if (select count(*) from public.quotation_items where quotation_id = v_quote.id and unit_cost is null) > 0 then
      raise exception 'Enter a selling price for every quotation item';
    end if;
  end if;

  update public.quotations
  set vat_rate = greatest(coalesce(p_vat_rate, 0), 0),
      shipping_handling = greatest(coalesce(p_shipping_handling, 0), 0),
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      status = p_decision::public.quotation_status,
      issue_date = case when p_decision = 'approved' then current_date else issue_date end,
      revision_note = case when p_decision = 'needs_revision' then v_note else null end,
      revision_requested_by = case when p_decision = 'needs_revision' then (select auth.uid()) else null end,
      revision_requested_at = case when p_decision = 'needs_revision' then now() else null end,
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end
  where id = v_quote.id;

  update public.quotations quote
  set total_cost = totals.subtotal,
      subtotal = totals.subtotal,
      vat_amount = round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2),
      total_amount = totals.subtotal + round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2) + greatest(coalesce(p_shipping_handling, 0), 0)
  from (
    select coalesce(round(sum(line_total), 2), 0) as subtotal
    from public.quotation_items
    where quotation_id = v_quote.id
  ) totals
  where quote.id = v_quote.id;

  update public.approval_requests
  set status = (case when p_decision = 'approved' then 'approved' else 'needs_revision' end)::public.approval_status,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where organization_id = v_quote.organization_id
    and resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

-- Project Officers prepare only their assigned-lead quotations. General
-- Managers retain organization-wide review access. Historical costings remain
-- readable by their creator and are never rewritten by this migration.
drop policy if exists "quotations: workflow read" on public.quotations;
drop policy if exists "quotations: workflow insert" on public.quotations;
drop policy if exists "quotations: workflow update" on public.quotations;
drop policy if exists "quotations: workflow delete" on public.quotations;
drop policy if exists "quotations: price workflow read" on public.quotations;
drop policy if exists "quotations: price workflow insert" on public.quotations;
drop policy if exists "quotations: price workflow update" on public.quotations;
drop policy if exists "quotations: price workflow delete" on public.quotations;
create policy "quotations: price workflow read" on public.quotations for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or created_by = (select auth.uid())
  or (prepared_by_user_id = (select auth.uid()) and document_type = 'price_quotation')
);
create policy "quotations: price workflow insert" on public.quotations for insert to authenticated with check (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or (document_type = 'price_quotation' and created_by = (select auth.uid())
      and (select private.has_text_role(organization_id, array['project_manager']))
      and exists (select 1 from public.leads lead where lead.id = lead_id and lead.assigned_to = (select auth.uid())))
);
create policy "quotations: price workflow update" on public.quotations for update to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or (document_type = 'price_quotation' and created_by = (select auth.uid())
      and status::text in ('draft', 'needs_revision')
      and (select private.has_text_role(organization_id, array['project_manager'])))
) with check (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or (document_type = 'price_quotation' and created_by = (select auth.uid())
      and status::text in ('draft', 'needs_revision')
      and (select private.has_text_role(organization_id, array['project_manager'])))
);
create policy "quotations: price workflow delete" on public.quotations for delete to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or (document_type = 'price_quotation' and created_by = (select auth.uid())
      and status::text in ('draft', 'needs_revision')
      and (select private.has_text_role(organization_id, array['project_manager'])))
);

drop policy if exists "quotation items: workflow read" on public.quotation_items;
drop policy if exists "quotation items: role read" on public.quotation_items;
drop policy if exists "quotation items: role insert" on public.quotation_items;
drop policy if exists "quotation items: role update" on public.quotation_items;
drop policy if exists "quotation items: role delete" on public.quotation_items;
drop policy if exists "quotation items: price workflow read" on public.quotation_items;
drop policy if exists "quotation items: price workflow write" on public.quotation_items;
create policy "quotation items: price workflow read" on public.quotation_items for select to authenticated using (
  exists (select 1 from public.quotations quote where quote.id = quotation_id and (
    (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
    or quote.created_by = (select auth.uid())
    or quote.prepared_by_user_id = (select auth.uid())
  ))
);
create policy "quotation items: price workflow write" on public.quotation_items for all to authenticated using (
  exists (select 1 from public.quotations quote where quote.id = quotation_id and (
    (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
    or (quote.document_type = 'price_quotation' and quote.created_by = (select auth.uid())
        and quote.status::text in ('draft', 'needs_revision')
        and (select private.has_text_role(quote.organization_id, array['project_manager'])))
  ))
) with check (
  exists (select 1 from public.quotations quote where quote.id = quotation_id and (
    (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
    or (quote.document_type = 'price_quotation' and quote.created_by = (select auth.uid())
        and quote.status::text in ('draft', 'needs_revision')
        and (select private.has_text_role(quote.organization_id, array['project_manager'])))
  ))
);

revoke all on function public.save_price_quotation_draft(uuid, uuid, jsonb) from public;
revoke all on function public.submit_price_quotation(uuid) from public;
revoke all on function public.unsubmit_price_quotation(uuid) from public;
revoke all on function public.review_price_quotation(uuid, text, numeric, numeric, text, jsonb, jsonb, text) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, jsonb) to authenticated;
grant execute on function public.submit_price_quotation(uuid) to authenticated;
grant execute on function public.unsubmit_price_quotation(uuid) to authenticated;
grant execute on function public.review_price_quotation(uuid, text, numeric, numeric, text, jsonb, jsonb, text) to authenticated;

commit;
