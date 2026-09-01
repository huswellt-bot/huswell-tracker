-- Preserve General Manager-set prices when a Sales Project Officer revises a
-- direct Price Quotation. Existing item records are updated in place instead
-- of being deleted and recreated, so an officer never writes a selling price.
-- New items start at zero and must still be priced by the General Manager.
--
-- Run after 086_fix_price_quotation_resubmission_prices.sql. Safe to re-run.

begin;

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
  if v_lead.assigned_to is distinct from (select auth.uid()) then
    raise exception 'Project Officers can prepare quotations only for their assigned leads';
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

commit;
