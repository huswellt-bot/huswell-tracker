-- Mockup Quotation requirements are independent from the selected Price Quotation.
-- The selected approved Price Quotation still supplies client/project metadata,
-- routing ownership, and traceability through source_price_quotation_id.

create or replace function public.save_mockup_quotation_draft(
  p_mockup_quotation_id uuid,
  p_source_price_quotation_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_source public.quotations%rowtype;
  v_quote public.quotations%rowtype;
  v_quote_id uuid;
  v_terms text;
  v_item record;
  v_sort_order integer := 0;
begin
  if p_source_price_quotation_id is null then
    raise exception 'Select an approved Price Quotation first';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array'
    or coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'Add at least one Mockup Quotation item';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_source_price_quotation_id::text, 0)
  );

  select * into v_source
  from public.quotations
  where id = p_source_price_quotation_id
  for share;
  if not found
    or v_source.document_type <> 'price_quotation'
    or v_source.costing_source_id is not null
    or v_source.status::text <> 'approved' then
    raise exception 'Only an approved direct Price Quotation can be used';
  end if;
  if not private.has_text_role(v_source.organization_id, array['project_manager'])
    or (
      v_source.created_by is distinct from (select auth.uid())
      and v_source.prepared_by_user_id is distinct from (select auth.uid())
    ) then
    raise exception 'Only the Sales Project Officer who prepared the Price Quotation can request its Mockup Quotation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(description text, quantity numeric)
    where nullif(btrim(item.description), '') is null
      or coalesce(item.quantity, 0) <= 0
  ) then
    raise exception 'Each Mockup Quotation item needs a description and quantity greater than zero';
  end if;

  if p_mockup_quotation_id is null then
    v_terms := coalesce(
      nullif(btrim(v_source.terms_conditions), ''),
      'Production Lead Time: 2-4 weeks upon receipt of the approved artwork and downpayment.
Prices: All prices quoted are VAT INCLUSIVE.
Delivery: Pickup or delivery via a third-party courier. Delivery charges shall be shouldered by the client.
Payment Terms: 50% downpayment is required upon approval of the quotation. The remaining 50% balance must be paid prior to release or delivery.
Cancellations: Orders cannot be cancelled once production has started
Artwork Revisions: Any revisions or changes requested after the artwork has been approved may result in an adjustment of the production lead time. The revised delivery schedule will be based on the scope and timing of the requested changes.'
    );
    if v_terms !~* '(^|\n)\s*Two revisions only\.\s*$' then
      v_terms := v_terms || E'\nTwo revisions only.';
    end if;

    insert into public.quotations (
      organization_id,
      quotation_no,
      document_type,
      source_price_quotation_id,
      lead_id,
      customer_id,
      client_name,
      client_contact_name,
      client_phone,
      client_address,
      project_name,
      project_types,
      representative,
      prepared_by_user_id,
      prepared_by_signature_url,
      terms_conditions,
      bank_details,
      vat_rate,
      shipping_handling,
      total_cost,
      subtotal,
      vat_amount,
      total_amount,
      status,
      created_by,
      issue_date
    )
    values (
      v_source.organization_id,
      format('MQ-%s-%s', to_char(current_date, 'YYYY'), lpad(nextval('public.mockup_quotation_number_seq')::text, 3, '0')),
      'mockup_quotation',
      v_source.id,
      v_source.lead_id,
      v_source.customer_id,
      v_source.client_name,
      v_source.client_contact_name,
      v_source.client_phone,
      v_source.client_address,
      v_source.project_name,
      v_source.project_types,
      coalesce((select full_name from public.profiles where id = (select auth.uid())), 'Sales Project Officer'),
      (select auth.uid()),
      (select signature_url from public.profiles where id = (select auth.uid())),
      v_terms,
      coalesce(v_source.bank_details, '[]'::jsonb),
      0,
      0,
      0,
      0,
      0,
      0,
      'draft',
      (select auth.uid()),
      current_date
    )
    returning * into v_quote;
    v_quote_id := v_quote.id;
  else
    select * into v_quote
    from public.quotations
    where id = p_mockup_quotation_id
    for update;
    if not found
      or v_quote.document_type <> 'mockup_quotation'
      or v_quote.source_price_quotation_id is distinct from v_source.id
      or v_quote.status::text not in ('draft', 'needs_revision') then
      raise exception 'Mockup Quotation is not editable';
    end if;
    if v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
      raise exception 'Only the Mockup Quotation preparer can edit it';
    end if;
    v_quote_id := v_quote.id;
    v_terms := coalesce(
      nullif(btrim(v_quote.terms_conditions), ''),
      nullif(btrim(v_source.terms_conditions), ''),
      'Two revisions only.'
    );
    if v_terms !~* '(^|\n)\s*Two revisions only\.\s*$' then
      v_terms := v_terms || E'\nTwo revisions only.';
    end if;

    delete from public.price_quotation_product_costings
    where quotation_id = v_quote.id;
    update public.quotations
    set status = 'draft',
        client_name = v_source.client_name,
        client_contact_name = v_source.client_contact_name,
        client_phone = v_source.client_phone,
        client_address = v_source.client_address,
        project_name = v_source.project_name,
        project_types = v_source.project_types,
        lead_id = v_source.lead_id,
        customer_id = v_source.customer_id,
        terms_conditions = v_terms,
        bank_details = coalesce(v_source.bank_details, bank_details),
        vat_rate = 0,
        shipping_handling = 0,
        total_cost = 0,
        subtotal = 0,
        vat_amount = 0,
        total_amount = 0,
        pricing_reviewed_by = null,
        pricing_reviewed_at = null,
        approved_by = null,
        approved_at = null,
        revision_note = null
    where id = v_quote.id;
  end if;

  delete from public.quotation_items where quotation_id = v_quote_id;
  for v_item in
    select btrim(item.description) as description, item.quantity
    from jsonb_to_recordset(p_items) as item(description text, quantity numeric)
  loop
    insert into public.quotation_items (
      quotation_id,
      description,
      quantity,
      unit_cost,
      sort_order
    )
    values (
      v_quote_id,
      v_item.description,
      v_item.quantity,
      0,
      v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  end loop;

  return v_quote_id;
end;
$$;

revoke all on function public.save_mockup_quotation_draft(uuid, uuid, jsonb) from public;
grant execute on function public.save_mockup_quotation_draft(uuid, uuid, jsonb) to authenticated;
