-- Treat the selected Sales & Pricing Officer as an alternate assignee for the
-- same lead and quotation workflow as an assigned Sales Project Officer. The
-- original assigned owner and GM approval boundary remain unchanged; the
-- endorsement columns remain audit/display metadata.
-- Run after 147_lead_endorsements.sql and before deploying the matching
-- quotation workspace update. Safe to re-run.

begin;

create or replace function private.can_prepare_endorsed_lead(
  target_organization_id uuid,
  target_assigned_to uuid,
  target_endorsed_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(target_organization_id, array['project_manager'])
    and (
      target_assigned_to = (select auth.uid())
      or (
        target_endorsed_to = (select auth.uid())
        and exists (
          select 1
          from public.organization_members member
          where member.organization_id = target_organization_id
            and member.user_id = (select auth.uid())
            and member.role::text = 'sales_pricing_officer'
        )
      )
    );
$$;

revoke all on function private.can_prepare_endorsed_lead(uuid, uuid, uuid) from public;
grant execute on function private.can_prepare_endorsed_lead(uuid, uuid, uuid) to authenticated;

-- Keep the original three-argument save path authoritative for new direct
-- Price Quotations, including calls made through the later project-type and
-- illustration wrappers.
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
    and not private.can_prepare_endorsed_lead(
      v_lead.organization_id,
      v_lead.assigned_to,
      v_lead.endorsed_to
    ) then
    raise exception 'Project Officers can prepare quotations only for their assigned or endorsed leads';
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

-- Preserve GM-approved line prices and the current five-argument edit path,
-- while allowing the endorsed officer to revise their own quotation.
create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_lead public.leads%rowtype;
  v_quote_id uuid;
  v_illustration_count integer;
begin
  if nullif(btrim(coalesce(p_project_type, '')), '') is null then
    raise exception 'Enter the project type before saving the quotation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item before saving the quotation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(description text, quantity numeric)
    where nullif(btrim(item.description), '') is null
      or coalesce(item.quantity, 0) <= 0
  ) then
    raise exception 'Each item needs a description and quantity greater than zero';
  end if;

  select count(*) into v_illustration_count
  from jsonb_array_elements(p_items) as item(value)
  where nullif(btrim(coalesce(item.value ->> 'image_url', '')), '') is not null;

  if v_illustration_count > 5 then
    raise exception 'A Price Quotation can have a maximum of five illustrations';
  end if;
  if p_has_illustrations and v_illustration_count = 0 then
    raise exception 'Illustration upload did not complete. Try saving again.';
  end if;

  -- New quotations retain the established creation path.
  if p_quotation_id is null then
    v_quote_id := public.save_price_quotation_draft(
      null,
      p_lead_id,
      p_project_type,
      p_items
    );

    update public.quotation_items quotation_item
    set image_url = nullif(btrim(item.value ->> 'image_url'), '')
    from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
    where quotation_item.quotation_id = v_quote_id
      and quotation_item.sort_order = item.ordinality - 1;

    return v_quote_id;
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned quotations can be edited';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Project Officer who prepared this quotation can edit it';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id = v_quote.organization_id
  for share;

  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.can_prepare_endorsed_lead(
    v_lead.organization_id,
    v_lead.assigned_to,
    v_lead.endorsed_to
  ) then
    raise exception 'Project Officers can prepare quotations only for their assigned or endorsed leads';
  end if;

  -- An item identifier may appear only once. This prevents a malformed client
  -- payload from applying two updates to the same protected item.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where coalesce(item.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    group by item.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'A quotation item can only be included once';
  end if;

  update public.quotations
  set lead_id = v_lead.id,
      client_name = v_lead.client_name,
      client_contact_name = v_lead.contact_name,
      client_phone = v_lead.phone,
      client_address = v_lead.address,
      project_name = v_lead.project_name,
      project_types = btrim(p_project_type),
      status = 'draft',
      revision_note = null,
      revision_requested_by = null,
      revision_requested_at = null
  where id = v_quote.id;

  -- Remove only omitted old items. Kept items remain the same records, which
  -- retains their GM-approved unit_cost without giving the officer price write
  -- access.
  delete from public.quotation_items existing_item
  where existing_item.quotation_id = v_quote.id
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as item(value)
      where coalesce(item.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (item.value ->> 'id')::uuid = existing_item.id
    );

  update public.quotation_items existing_item
  set description = btrim(item.value ->> 'description'),
      quantity = (item.value ->> 'quantity')::numeric,
      sort_order = item.ordinality - 1,
      image_url = nullif(btrim(item.value ->> 'image_url'), '')
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  where existing_item.quotation_id = v_quote.id
    and coalesce(item.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and existing_item.id = (item.value ->> 'id')::uuid;

  -- Items without a valid ID are new. They are intentionally unpriced.
  insert into public.quotation_items (
    quotation_id, description, quantity, unit_cost, sort_order, image_url
  )
  select v_quote.id,
         btrim(item.value ->> 'description'),
         (item.value ->> 'quantity')::numeric,
         0,
         item.ordinality - 1,
         nullif(btrim(item.value ->> 'image_url'), '')
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  left join public.quotation_items existing_item
    on existing_item.quotation_id = v_quote.id
    and coalesce(item.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and existing_item.id = (item.value ->> 'id')::uuid
  where existing_item.id is null;

  return v_quote.id;
end;
$$;

revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) to authenticated;

-- Extend the existing lead-change request paths to the same authorized
-- assigned/endorsed officer boundary. The three-argument overload remains
-- compatible with older clients; the four-argument overload retains the
-- dropped-client and deletion-note checks used by the current workspace.
create or replace function public.request_lead_change(
  p_lead_id uuid,
  p_change_type text,
  p_proposed_changes jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_changes jsonb;
  v_request_id uuid;
begin
  if p_change_type not in ('update', 'delete') then
    raise exception 'Unsupported lead change type';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.has_text_role(v_lead.organization_id, array['project_manager'])
    or (
      v_lead.created_by is distinct from (select auth.uid())
      and not private.can_prepare_endorsed_lead(
        v_lead.organization_id,
        v_lead.assigned_to,
        v_lead.endorsed_to
      )
    ) then
    raise exception 'Only the authorized Sales Project Officer can request a change';
  end if;

  if p_change_type = 'update' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
    from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
    where key = any (array[
      'project_name', 'contact_name', 'client_name', 'email', 'phone',
      'date_sent', 'date_contacted', 'contact_method', 'evaluation_number',
      'done_deal_status'
    ]);
    if v_changes = '{}'::jsonb then
      raise exception 'Include at least one lead field to edit';
    end if;
  else
    v_changes := '{}'::jsonb;
  end if;

  insert into public.lead_change_requests (
    organization_id, lead_id, change_type, proposed_changes, submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes,
    (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_lead_change(uuid, text, jsonb) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb) to authenticated;

create or replace function public.request_lead_change(
  p_lead_id uuid,
  p_change_type text,
  p_proposed_changes jsonb,
  p_request_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_changes jsonb;
  v_request_note text := nullif(btrim(coalesce(p_request_note, '')), '');
  v_request_id uuid;
begin
  if p_change_type not in ('update', 'delete') then
    raise exception 'Unsupported lead change type';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.can_prepare_endorsed_lead(
    v_lead.organization_id,
    v_lead.assigned_to,
    v_lead.endorsed_to
  ) then
    raise exception 'Only the authorized Sales Project Officer can request a change';
  end if;

  if p_change_type = 'update' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
    from jsonb_each(coalesce(p_proposed_changes, '{}'::jsonb))
    where key = any (array[
      'project_name', 'contact_name', 'client_name', 'email', 'phone',
      'date_sent', 'date_contacted', 'contact_method', 'evaluation_number',
      'done_deal_status'
    ]);
    if v_changes = '{}'::jsonb then
      raise exception 'Include at least one lead field to edit';
    end if;
    if (v_changes ->> 'evaluation_number') = '3'
      and coalesce(v_lead.evaluation_number, 0) <> 3
      and v_request_note is null then
      raise exception 'A dropped client reason is required';
    end if;
  else
    if v_request_note is null then
      raise exception 'A deletion reason is required';
    end if;
    v_changes := '{}'::jsonb;
  end if;

  insert into public.lead_change_requests (
    organization_id, lead_id, change_type, proposed_changes, request_note,
    submitted_by
  ) values (
    v_lead.organization_id, v_lead.id, p_change_type, v_changes,
    v_request_note, (select auth.uid())
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'A lead change request is already awaiting General Manager approval';
end;
$$;

revoke all on function public.request_lead_change(uuid, text, jsonb, text) from public;
grant execute on function public.request_lead_change(uuid, text, jsonb, text) to authenticated;

-- Done Deal projects use the same General Manager review request, but the
-- assigned or endorsed officer must be able to submit it as the active lead
-- officer. Project creators retain their existing path.
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
  if not private.has_text_role(v_project.organization_id, array['project_manager'])
    or (
      v_project.created_by is distinct from (select auth.uid())
      and not private.can_prepare_endorsed_lead(
        v_project.organization_id,
        v_project.assigned_to,
        v_project.endorsed_to
      )
    ) then
    raise exception 'Only the authorized Sales Project Officer can request an edit';
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

revoke all on function public.request_project_edit(uuid, jsonb) from public;
grant execute on function public.request_project_edit(uuid, jsonb) to authenticated;

-- Keep direct inserts and the security-definer RPC on the same assigned or
-- endorsed officer boundary.
drop policy if exists "lead change requests: workflow insert" on public.lead_change_requests;
create policy "lead change requests: workflow insert"
on public.lead_change_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.has_text_role(organization_id, array['project_manager']))
  and exists (
    select 1
    from public.leads lead_row
    where lead_row.id = lead_change_requests.lead_id
      and lead_row.organization_id = lead_change_requests.organization_id
      and (
        lead_row.created_by = (select auth.uid())
        or private.can_prepare_endorsed_lead(
          lead_row.organization_id,
          lead_row.assigned_to,
          lead_row.endorsed_to
        )
      )
  )
);

drop policy if exists "project edit requests: workflow insert" on public.project_edit_requests;
create policy "project edit requests: workflow insert"
on public.project_edit_requests for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and (select private.has_text_role(organization_id, array['project_manager']))
  and exists (
    select 1
    from public.leads project
    where project.id = project_edit_requests.project_id
      and project.organization_id = project_edit_requests.organization_id
      and project.evaluation_number = 7
      and (
        project.created_by = (select auth.uid())
        or private.can_prepare_endorsed_lead(
          project.organization_id,
          project.assigned_to,
          project.endorsed_to
        )
      )
  )
);

drop policy if exists "quotations: price workflow insert" on public.quotations;
create policy "quotations: price workflow insert"
on public.quotations for insert to authenticated with check (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or (
    document_type = 'price_quotation'
    and created_by = (select auth.uid())
    and (select private.has_text_role(organization_id, array['project_manager']))
    and exists (
      select 1
      from public.leads lead_row
      where lead_row.id = public.quotations.lead_id
        and lead_row.organization_id = public.quotations.organization_id
        and private.can_prepare_endorsed_lead(
          lead_row.organization_id,
          lead_row.assigned_to,
          lead_row.endorsed_to
        )
    )
  )
);

commit;
