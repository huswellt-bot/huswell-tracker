-- Mockup Quotations are independent child quotations of approved Price
-- Quotations. They inherit the source project data, but receive their own
-- description/quantity snapshot and their own costing and approval lifecycle.
-- Run after 116_disable_standalone_pricing_officer.sql.

begin;

alter table public.quotations
  add column if not exists source_price_quotation_id uuid
    references public.quotations(id) on delete restrict;

-- Replace the older two-value document type check without changing existing
-- Costing Breakdown or Price Quotation rows.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%document_type%'
  loop
    execute format(
      'alter table public.quotations drop constraint if exists %I',
      constraint_name
    );
  end loop;
end;
$$;

alter table public.quotations
  add constraint quotations_document_type_check
  check (document_type in ('costing_breakdown', 'price_quotation', 'mockup_quotation'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and conname = 'quotations_mockup_source_check'
  ) then
    alter table public.quotations
      add constraint quotations_mockup_source_check
      check (
        document_type <> 'mockup_quotation'
        or source_price_quotation_id is not null
      );
  end if;
end;
$$;

create index if not exists quotations_source_price_quotation_id_idx
  on public.quotations(source_price_quotation_id);

create sequence if not exists public.mockup_quotation_number_seq;

create unique index if not exists quotations_one_active_mockup_per_source_idx
  on public.quotations(source_price_quotation_id)
  where document_type = 'mockup_quotation'
    and status in (
      'draft'::public.quotation_status,
      'pending'::public.quotation_status,
      'needs_revision'::public.quotation_status,
      'pending_gm_approval'::public.quotation_status,
      'approved'::public.quotation_status
    );

-- Keep the source relationship and inherited project type valid on every
-- insert/update, including writes made through security-definer RPCs.
create or replace function public.validate_quotation_document_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  source_status text;
  source_type text;
  source_lead uuid;
  source_project_type text;
begin
  if new.document_type = 'costing_breakdown' and new.lead_id is null then
    raise exception 'A Costing Breakdown must be created from a Lead / Project';
  end if;

  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and new.lead_id is null then
    raise exception 'A Price Quotation must be created from a Lead / Project';
  end if;

  if new.document_type = 'price_quotation'
    and new.costing_source_id is not null then
    select status::text, document_type
      into source_status, source_type
      from public.quotations
      where id = new.costing_source_id
        and organization_id = new.organization_id;
    if source_type is distinct from 'costing_breakdown'
      or source_status is distinct from 'approved' then
      raise exception 'A legacy Price Quotation requires an approved Costing Breakdown';
    end if;
  end if;

  if new.document_type = 'mockup_quotation' then
    select
      status::text,
      document_type,
      lead_id,
      project_types
      into source_status, source_type, source_lead, source_project_type
      from public.quotations
      where id = new.source_price_quotation_id
        and organization_id = new.organization_id
        and costing_source_id is null;

    if source_type is distinct from 'price_quotation'
      or source_status is distinct from 'approved' then
      raise exception 'A Mockup Quotation requires an approved direct Price Quotation';
    end if;
    if new.lead_id is distinct from source_lead then
      raise exception 'A Mockup Quotation must retain its source project';
    end if;
    if private.normalize_price_quotation_project_type(source_project_type) is null then
      raise exception 'The source Price Quotation must have a valid project type';
    end if;
    if private.normalize_price_quotation_project_type(new.project_types)
      is distinct from private.normalize_price_quotation_project_type(source_project_type) then
      raise exception 'A Mockup Quotation must retain its source project type';
    end if;
    new.project_types := source_project_type;
  end if;

  return new;
end;
$$;

drop trigger if exists quotation_document_workflow on public.quotations;
create trigger quotation_document_workflow
before insert or update
on public.quotations
for each row execute function public.validate_quotation_document_workflow();

-- The latest shared status guard is recreated here to add only the Mockup
-- Quotation transitions. Existing Price Quotation, finance, and payroll
-- protections remain unchanged.
create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' then
    if tg_op = 'INSERT'
      and new.status::text not in ('draft', 'needs_revision', 'pending') then
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.document_type = 'mockup_quotation' then
        if old.status::text in ('draft', 'needs_revision')
          and new.status::text = 'pending'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          if private.normalize_price_quotation_project_type(new.project_types) is null
            or not exists (
              select 1
              from public.pricing_officer_project_types assignment
              where assignment.organization_id = new.organization_id
                and assignment.project_type =
                  private.normalize_price_quotation_project_type(new.project_types)
            ) then
            raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
          end if;
          return new;
        end if;

        if old.status::text = 'needs_revision'
          and new.status::text = 'draft'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;

        if old.status::text = 'pending'
          and new.status::text = 'draft'
          and (
            new.created_by = (select auth.uid())
            or new.prepared_by_user_id = (select auth.uid())
          )
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;

        if old.status::text = 'pending'
          and new.status::text in ('needs_revision', 'pending_gm_approval')
          and private.has_text_role(new.organization_id, array['pricing_officer']) then
          if not private.is_pricing_officer_assigned(
            new.organization_id,
            (select auth.uid()),
            new.project_types
          ) then
            raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type';
          end if;
          if new.created_by is not distinct from (select auth.uid())
            or new.prepared_by_user_id is not distinct from (select auth.uid()) then
            raise exception 'You cannot review your own Mockup Quotation';
          end if;
          return new;
        end if;
      elsif new.document_type = 'price_quotation'
        and new.costing_source_id is null then
        if old.status::text in ('draft', 'needs_revision')
          and new.status::text = 'pending'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          if private.normalize_price_quotation_project_type(new.project_types) is null
            or not exists (
              select 1
              from public.pricing_officer_project_types assignment
              where assignment.organization_id = new.organization_id
                and assignment.project_type =
                  private.normalize_price_quotation_project_type(new.project_types)
            ) then
            raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
          end if;
          return new;
        end if;
        if old.status::text = 'needs_revision'
          and new.status::text = 'draft'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;
        if old.status::text = 'pending'
          and new.status::text = 'draft'
          and (
            new.created_by = (select auth.uid())
            or new.prepared_by_user_id = (select auth.uid())
          )
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;
        if old.status::text = 'approved'
          and new.status::text = 'needs_revision'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;

        if old.status::text = 'pending'
          and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
          and private.has_text_role(new.organization_id, array['pricing_officer']) then
          if not private.is_pricing_officer_assigned(
            new.organization_id,
            (select auth.uid()),
            new.project_types
          ) then
            raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type';
          end if;
          if new.created_by is not distinct from (select auth.uid())
            or new.prepared_by_user_id is not distinct from (select auth.uid()) then
            raise exception 'You cannot review your own Price Quotation';
          end if;
          if new.status::text = 'approved' then
            new.status := 'pending_gm_approval';
            new.approved_by := null;
            new.approved_at := null;
            new.pricing_reviewed_by := (select auth.uid());
            new.pricing_reviewed_at := now();
          end if;
          return new;
        end if;
      end if;
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;
  end if;

  if tg_table_name = 'expenses'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval')
          or old.status::text not in ('unfulfilled', 'fulfilled')
        ))
    ) then
    raise exception 'Only an administrator can approve, reject, or cancel an expense';
  end if;
  if tg_table_name = 'invoices'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'issued', 'partial'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'issued', 'partial')
          or old.status::text not in ('draft', 'issued', 'partial')
        ))
    ) then
    raise exception 'Only an administrator can set this invoice status directly';
  end if;
  if tg_table_name = 'payroll_periods'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'in_review'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'in_review')
          or old.status::text not in ('draft', 'in_review')
        ))
    ) then
    raise exception 'Only an administrator can approve or mark payroll paid';
  end if;
  if tg_table_name = 'cash_flow_entries'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'pending'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'pending')
          or old.status::text not in ('draft', 'pending')
        ))
    ) then
    raise exception 'Only an administrator can approve cash flow';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mockup quotation draft, submit, pricing review, and GM decisions.
-- ---------------------------------------------------------------------------
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
  v_source_item public.quotation_items%rowtype;
  v_description text;
  v_quantity numeric;
  v_quote_id uuid;
  v_terms text;
  v_item_count integer;
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

  select count(*) into v_item_count
  from public.quotation_items
  where quotation_id = v_source.id;
  if jsonb_array_length(p_items) <> v_item_count then
    raise exception 'Mockup Quotation items must match the approved Price Quotation';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(source_item_id uuid, description text, quantity numeric)
    where item.source_item_id is null
      or nullif(btrim(item.description), '') is null
      or coalesce(item.quantity, 0) <= 0
      or not exists (
        select 1 from public.quotation_items source_item
        where source_item.id = item.source_item_id
          and source_item.quotation_id = v_source.id
      )
  ) then
    raise exception 'Each Mockup Quotation item needs a source item, description, and quantity greater than zero';
  end if;
  if exists (
    select item.source_item_id
    from jsonb_to_recordset(p_items) as item(source_item_id uuid, description text, quantity numeric)
    group by item.source_item_id
    having count(*) > 1
  ) then
    raise exception 'Each approved Price Quotation item can appear only once';
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
  for v_source_item in
    select * from public.quotation_items
    where quotation_id = v_source.id
    order by sort_order, id
  loop
    select item.description, item.quantity
      into v_description, v_quantity
    from jsonb_to_recordset(p_items) as item(source_item_id uuid, description text, quantity numeric)
    where item.source_item_id = v_source_item.id;

    insert into public.quotation_items (
      quotation_id,
      inventory_item_id,
      description,
      quantity,
      unit_cost,
      sort_order,
      image_url,
      details
    )
    values (
      v_quote_id,
      v_source_item.inventory_item_id,
      btrim(v_description),
      v_quantity,
      0,
      v_source_item.sort_order,
      v_source_item.image_url,
      v_source_item.details
    );
  end loop;

  return v_quote_id;
end;
$$;

create or replace function public.submit_mockup_quotation(
  p_mockup_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_source public.quotations%rowtype;
  v_project_type text;
begin
  select * into v_quote
  from public.quotations
  where id = p_mockup_quotation_id
  for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then
    raise exception 'Mockup Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Mockup Quotations can be submitted';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or (
      v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid())
    ) then
    raise exception 'Only the Mockup Quotation preparer can submit it';
  end if;

  select * into v_source
  from public.quotations
  where id = v_quote.source_price_quotation_id
  for share;
  if not found
    or v_source.document_type <> 'price_quotation'
    or v_source.costing_source_id is not null
    or v_source.status::text <> 'approved' then
    raise exception 'The source Price Quotation must remain approved';
  end if;
  if not exists (
    select 1 from public.quotation_items where quotation_id = v_quote.id
  ) then
    raise exception 'Add at least one item before submitting the Mockup Quotation';
  end if;

  v_project_type := private.normalize_price_quotation_project_type(v_quote.project_types);
  if v_project_type is null then
    raise exception 'The Mockup Quotation must have a valid project type';
  end if;
  if not exists (
    select 1
    from public.pricing_officer_project_types assignment
    where assignment.organization_id = v_quote.organization_id
      and assignment.project_type = v_project_type
  ) then
    raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
  end if;

  update public.quotations
  set status = 'pending',
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      revision_note = null,
      resubmission_count = case
        when v_quote.status::text = 'needs_revision'
          then resubmission_count + 1
        else resubmission_count
      end
  where id = v_quote.id;

  insert into public.approval_requests (
    organization_id, resource_type, resource_id, status, submitted_by, submitted_at
  )
  values (
    v_quote.organization_id, 'quotation', v_quote.id, 'pending',
    (select auth.uid()), now()
  )
  on conflict (resource_type, resource_id) do update
  set status = 'pending',
      submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at,
      decided_by = null,
      decided_at = null,
      decision_note = null;
end;
$$;

create or replace function public.pricing_review_mockup_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb default '[]'::jsonb,
  p_revision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_source public.quotations%rowtype;
  v_product_costing jsonb;
  v_cost_line jsonb;
  v_markup jsonb;
  v_quotation_item public.quotation_items%rowtype;
  v_product_costing_id uuid;
  v_item_id uuid;
  v_description text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_rate numeric;
  v_cogs numeric;
  v_markup_total numeric;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Mockup Quotation decision';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then
    raise exception 'Mockup Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the Sales & Pricing Officer assigned to this project type can review this Mockup Quotation';
  end if;
  if v_quote.created_by is not distinct from (select auth.uid())
    or v_quote.prepared_by_user_id is not distinct from (select auth.uid()) then
    raise exception 'You cannot review your own Mockup Quotation';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only submitted Mockup Quotations can be reviewed';
  end if;
  if p_decision = 'needs_revision' then
    if v_note is null then
      raise exception 'Enter revision notes before returning this quotation';
    end if;
    update public.quotations
    set status = 'needs_revision',
        revision_note = v_note,
        revision_requested_by = (select auth.uid()),
        revision_requested_at = now(),
        approved_by = null,
        approved_at = null
    where id = v_quote.id;
    update public.approval_requests
    set status = 'needs_revision',
        decided_by = (select auth.uid()),
        decided_at = now(),
        decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;

  if jsonb_typeof(p_costings) <> 'array'
    or jsonb_array_length(p_costings) <> (
      select count(*) from public.quotation_items where quotation_id = v_quote.id
    ) then
    raise exception 'Add one costing table for every Mockup Quotation product';
  end if;

  for v_product_costing in select value from jsonb_array_elements(p_costings)
  loop
    begin
      v_item_id := (v_product_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a Mockup Quotation product';
    end;
    if v_item_id = any(v_seen_item_ids) then
      raise exception 'A Mockup Quotation product can have only one costing table';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);

    select * into v_quotation_item
    from public.quotation_items
    where id = v_item_id and quotation_id = v_quote.id
    for update;
    if not found or coalesce(v_quotation_item.quantity, 0) <= 0 then
      raise exception 'Each costing table must be linked to a Mockup Quotation product with a quantity';
    end if;
    if jsonb_typeof(v_product_costing -> 'cost_lines') <> 'array'
      or jsonb_array_length(v_product_costing -> 'cost_lines') = 0 then
      raise exception 'Add at least one internal cost line for every Mockup Quotation product';
    end if;
    if jsonb_typeof(coalesce(v_product_costing -> 'markups', '[]'::jsonb)) <> 'array' then
      raise exception 'Mockup Quotation markups must be a list';
    end if;

    v_cogs := 0;
    for v_cost_line in select value from jsonb_array_elements(v_product_costing -> 'cost_lines')
    loop
      v_description := nullif(btrim(coalesce(v_cost_line ->> 'description', '')), '');
      v_calculation_type := coalesce(
        nullif(btrim(coalesce(v_cost_line ->> 'calculation_type', '')), ''),
        'quantity_unit_cost'
      );
      if v_calculation_type not in ('quantity_unit_cost', 'fixed_amount') then
        raise exception 'Each internal cost line needs a valid calculation type';
      end if;
      begin
        if v_calculation_type = 'fixed_amount' then
          v_quantity := 1;
          v_unit_cost := coalesce(
            (v_cost_line ->> 'amount')::numeric,
            (v_cost_line ->> 'unit_cost')::numeric,
            -1
          );
        else
          v_quantity := coalesce((v_cost_line ->> 'quantity')::numeric, 0);
          v_unit_cost := coalesce((v_cost_line ->> 'unit_cost')::numeric, -1);
        end if;
      exception when invalid_text_representation then
        raise exception 'Cost line quantities, unit costs, and fixed amounts must be valid numbers';
      end;
      if v_description is null or v_quantity <= 0 or v_unit_cost < 0 then
        if v_calculation_type = 'fixed_amount' then
          raise exception 'Each fixed expense needs a description and non-negative amount';
        end if;
        raise exception 'Each internal cost line needs a description, quantity, and non-negative unit cost';
      end if;
      v_cogs := v_cogs + round(v_quantity * v_unit_cost, 2);
    end loop;

    v_markup_total := 0;
    for v_markup in select value from jsonb_array_elements(coalesce(v_product_costing -> 'markups', '[]'::jsonb))
    loop
      v_description := nullif(btrim(coalesce(v_markup ->> 'label', '')), '');
      begin
        v_rate := coalesce((v_markup ->> 'rate')::numeric, -1);
      exception when invalid_text_representation then
        raise exception 'Markup rates must be valid numbers';
      end;
      if v_description is null or v_rate < 0 then
        raise exception 'Each markup needs a name and a non-negative percentage';
      end if;
      v_markup_total := v_markup_total + round(v_cogs * v_rate / 100, 2);
    end loop;

    update public.quotation_items
    set unit_cost = round((v_cogs + v_markup_total) / v_quotation_item.quantity, 2)
    where id = v_quotation_item.id;
  end loop;

  if exists (
    select 1 from public.quotation_items item
    where item.quotation_id = v_quote.id
      and not (item.id = any(v_seen_item_ids))
  ) then
    raise exception 'Add one costing table for every Mockup Quotation product';
  end if;

  delete from public.price_quotation_product_costings
  where quotation_id = v_quote.id;

  for v_product_costing in select value from jsonb_array_elements(p_costings)
  loop
    v_item_id := (v_product_costing ->> 'quotation_item_id')::uuid;
    insert into public.price_quotation_product_costings (
      organization_id, quotation_id, quotation_item_id, created_by, updated_at
    )
    values (
      v_quote.organization_id, v_quote.id, v_item_id, (select auth.uid()), now()
    )
    returning id into v_product_costing_id;

    v_index := 0;
    for v_cost_line in select value from jsonb_array_elements(v_product_costing -> 'cost_lines')
    loop
      v_calculation_type := coalesce(
        nullif(btrim(coalesce(v_cost_line ->> 'calculation_type', '')), ''),
        'quantity_unit_cost'
      );
      if v_calculation_type = 'fixed_amount' then
        v_quantity := 1;
        v_unit_cost := coalesce(
          (v_cost_line ->> 'amount')::numeric,
          (v_cost_line ->> 'unit_cost')::numeric
        );
      else
        v_quantity := (v_cost_line ->> 'quantity')::numeric;
        v_unit_cost := (v_cost_line ->> 'unit_cost')::numeric;
      end if;
      insert into public.price_quotation_costing_lines (
        organization_id, product_costing_id, description, calculation_type,
        quantity, unit_cost, sort_order
      )
      values (
        v_quote.organization_id,
        v_product_costing_id,
        btrim(v_cost_line ->> 'description'),
        v_calculation_type,
        v_quantity,
        v_unit_cost,
        v_index
      );
      v_index := v_index + 1;
    end loop;

    v_index := 0;
    for v_markup in select value from jsonb_array_elements(coalesce(v_product_costing -> 'markups', '[]'::jsonb))
    loop
      insert into public.price_quotation_costing_markups (
        organization_id, product_costing_id, label, rate, sort_order
      )
      values (
        v_quote.organization_id,
        v_product_costing_id,
        btrim(v_markup ->> 'label'),
        (v_markup ->> 'rate')::numeric,
        v_index
      );
      v_index := v_index + 1;
    end loop;
  end loop;

  update public.quotations q
  set vat_rate = greatest(coalesce(p_vat_rate, 0), 0),
      shipping_handling = 0,
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
      bank_details = coalesce(p_bank_details, q.bank_details),
      status = 'pending_gm_approval',
      pricing_reviewed_by = (select auth.uid()),
      pricing_reviewed_at = now(),
      approved_by = null,
      approved_at = null,
      revision_note = null,
      subtotal = totals.subtotal,
      total_cost = totals.subtotal,
      vat_amount = round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2),
      total_amount = totals.subtotal
        + round(totals.subtotal * greatest(coalesce(p_vat_rate, 0), 0) / 100, 2)
  from (
    select coalesce(round(sum(quantity * unit_cost), 2), 0) subtotal
    from public.quotation_items
    where quotation_id = v_quote.id
  ) totals
  where q.id = v_quote.id;

  update public.approval_requests
  set status = 'pending',
      decided_by = null,
      decided_at = null,
      decision_note = null
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

create or replace function public.final_approve_mockup_quotation(
  p_quotation_id uuid
)
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
  where id = p_quotation_id
  for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then
    raise exception 'Mockup Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve a Mockup Quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This Mockup Quotation is not awaiting General Manager approval';
  end if;
  update public.quotations
  set status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now(),
      issue_date = current_date
  where id = v_quote.id;
  update public.approval_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

create or replace function public.return_mockup_quotation_from_gm(
  p_quotation_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'mockup_quotation'
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Mockup Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can return this quotation';
  end if;
  update public.quotations
  set status = 'needs_revision',
      revision_note = v_note,
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now()
  where id = v_quote.id;
  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

-- Keep the latest quotation-preparation wrapper compatible with the new
-- default terms text. The underlying five-argument function is retained for
-- older callers, while the gallery-aware six-argument path used by the UI
-- appends the seventh default term to new and edited Price Quotations.
create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean,
  p_quotation_illustrations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote_id uuid;
  v_terms text;
  v_has_legacy_item_illustrations boolean;
begin
  if coalesce(jsonb_typeof(p_items), '') <> 'array'
    or coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'Add at least one item before saving the quotation';
  end if;

  -- The gallery is independent from legacy per-item illustrations. Preserve
  -- the existing five-argument validation behavior for the actual items.
  select exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where nullif(btrim(coalesce(item.value ->> 'image_url', '')), '') is not null
  ) into v_has_legacy_item_illustrations;

  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    v_has_legacy_item_illustrations
  );

  select terms_conditions into v_terms
  from public.quotations
  where id = v_quote_id
  for update;

  v_terms := coalesce(
    nullif(btrim(v_terms), ''),
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

  update public.quotations
  set terms_conditions = v_terms
  where id = v_quote_id;

  perform public.save_price_quotation_illustrations(
    v_quote_id,
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );
  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) to authenticated;

revoke all on function public.save_mockup_quotation_draft(uuid, uuid, jsonb) from public;
revoke all on function public.submit_mockup_quotation(uuid) from public;
revoke all on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text) from public;
revoke all on function public.final_approve_mockup_quotation(uuid) from public;
revoke all on function public.return_mockup_quotation_from_gm(uuid, text) from public;
grant execute on function public.save_mockup_quotation_draft(uuid, uuid, jsonb) to authenticated;
grant execute on function public.submit_mockup_quotation(uuid) to authenticated;
grant execute on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.final_approve_mockup_quotation(uuid) to authenticated;
grant execute on function public.return_mockup_quotation_from_gm(uuid, text) to authenticated;

-- Route both quotation document types through the same project-type queue.
drop policy if exists "quotations: price workflow read" on public.quotations;
create policy "quotations: price workflow read"
on public.quotations for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or created_by = (select auth.uid())
  or (
    prepared_by_user_id = (select auth.uid())
    and document_type in ('price_quotation', 'mockup_quotation')
  )
  or (
    document_type in ('price_quotation', 'mockup_quotation')
    and pricing_reviewed_by = (select auth.uid())
  )
  or (
    document_type in ('price_quotation', 'mockup_quotation')
    and status::text in ('pending', 'pending_gm_approval', 'approved')
    and created_by is distinct from (select auth.uid())
    and prepared_by_user_id is distinct from (select auth.uid())
    and (select private.is_pricing_officer_assigned(
      organization_id,
      (select auth.uid()),
      project_types
    ))
  )
);

drop policy if exists "quotation items: price workflow read" on public.quotation_items;
create policy "quotation items: price workflow read"
on public.quotation_items for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or quote.created_by = (select auth.uid())
        or (
          quote.prepared_by_user_id = (select auth.uid())
          and quote.document_type in ('price_quotation', 'mockup_quotation')
        )
        or (
          quote.document_type in ('price_quotation', 'mockup_quotation')
          and quote.pricing_reviewed_by = (select auth.uid())
        )
        or (
          quote.document_type in ('price_quotation', 'mockup_quotation')
          and quote.status::text in ('pending', 'pending_gm_approval', 'approved')
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
      )
  )
);

drop policy if exists "price quotation product costings: GM only" on public.price_quotation_product_costings;
create policy "price quotation product costings: GM only"
on public.price_quotation_product_costings for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        (
          quote.status::text = 'pending'
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.pricing_reviewed_by = (select auth.uid())
          and quote.status::text in ('pending_gm_approval', 'approved', 'needs_revision')
        )
      )
  )
);

drop policy if exists "price quotation costing lines: GM only" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: GM only"
on public.price_quotation_costing_lines for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or (
          quote.status::text = 'pending'
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.pricing_reviewed_by = (select auth.uid())
          and quote.status::text in ('pending_gm_approval', 'approved', 'needs_revision')
        )
      )
  )
);

drop policy if exists "price quotation costing markups: GM only" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: GM only"
on public.price_quotation_costing_markups for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or (
          quote.status::text = 'pending'
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.pricing_reviewed_by = (select auth.uid())
          and quote.status::text in ('pending_gm_approval', 'approved', 'needs_revision')
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Private signed client proof attachments, separate from quotation
-- illustrations and never embedded in generated quotation PDFs.
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_signed_proofs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> ''),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  sort_order integer not null check (sort_order between 0 and 4),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (quotation_id, sort_order)
);

create index if not exists quotation_signed_proofs_quotation_idx
  on public.quotation_signed_proofs(quotation_id, sort_order);

alter table public.quotation_signed_proofs enable row level security;

drop policy if exists "quotation signed proofs: authorized read" on public.quotation_signed_proofs;
create policy "quotation signed proofs: authorized read"
on public.quotation_signed_proofs for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1 from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.pricing_reviewed_by = (select auth.uid())
        or (select private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        ))
      )
  )
);

drop policy if exists "quotation signed proofs: no direct insert" on public.quotation_signed_proofs;
create policy "quotation signed proofs: no direct insert"
on public.quotation_signed_proofs for insert to authenticated
with check (false);
drop policy if exists "quotation signed proofs: no direct update" on public.quotation_signed_proofs;
create policy "quotation signed proofs: no direct update"
on public.quotation_signed_proofs for update to authenticated
using (false) with check (false);
drop policy if exists "quotation signed proofs: no direct delete" on public.quotation_signed_proofs;
create policy "quotation signed proofs: no direct delete"
on public.quotation_signed_proofs for delete to authenticated
using (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-signed-proofs',
  'quotation-signed-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quotation signed proofs: workspace read" on storage.objects;
create policy "quotation signed proofs: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'quotation-signed-proofs'
  and exists (
    select 1
    from public.quotation_signed_proofs proof
    join public.quotations quote on quote.id = proof.quotation_id
    where proof.storage_path = storage.objects.name
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.pricing_reviewed_by = (select auth.uid())
        or (select private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        ))
      )
  )
);

drop policy if exists "quotation signed proofs: preparer upload" on storage.objects;
create policy "quotation signed proofs: preparer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotation-signed-proofs'
  and split_part(name, '/', 1) in (
    select organization_id::text
    from public.organization_members
    where user_id = (select auth.uid())
  )
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.quotations quote
    where quote.organization_id::text = split_part(name, '/', 1)
      and quote.id::text = split_part(name, '/', 2)
      and quote.status::text = 'approved'
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and private.has_text_role(quote.organization_id, array['project_manager'])
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
      )
  )
);

drop policy if exists "quotation signed proofs: authorized delete" on storage.objects;
create policy "quotation signed proofs: authorized delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quotation-signed-proofs'
  and exists (
    select 1
    from public.quotations quote
    where quote.organization_id::text = split_part(name, '/', 1)
      and quote.id::text = split_part(name, '/', 2)
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
      )
  )
);

create or replace function public.register_quotation_signed_proof(
  p_quotation_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_proof_id uuid;
  v_sort_order integer;
  v_file_name text := nullif(btrim(coalesce(p_file_name, '')), '');
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or v_quote.status::text <> 'approved' then
    raise exception 'Signed proof can only be added to an approved quotation';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) then
    raise exception 'Only a Sales Project Officer can upload a signed proof';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_quote.id::text || ':signed-proof', 0)
  );
  if v_quote.created_by is distinct from (select auth.uid())
    and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the Sales Project Officer who prepared this quotation can upload its signed proof';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or coalesce(p_file_size, 0) <= 0
    or p_file_size > 10485760 then
    raise exception 'Signed proof must be a JPEG, PNG, or WebP image no larger than 10 MB';
  end if;
  if v_file_name is null or length(v_file_name) > 255 then
    raise exception 'Enter a valid signed proof file name';
  end if;
  if p_storage_path !~* (
    '^' || v_quote.organization_id::text || '/'
    || v_quote.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Signed proof storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'quotation-signed-proofs'
      and name = p_storage_path
  ) then
    raise exception 'Upload the signed proof image before registering it';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.quotation_signed_proofs
  where quotation_id = v_quote.id;
  if v_sort_order > 4 then
    raise exception 'A quotation can have a maximum of five signed proof images';
  end if;

  insert into public.quotation_signed_proofs (
    organization_id,
    quotation_id,
    storage_path,
    file_name,
    content_type,
    file_size,
    sort_order,
    uploaded_by
  )
  values (
    v_quote.organization_id,
    v_quote.id,
    p_storage_path,
    v_file_name,
    p_content_type,
    p_file_size,
    v_sort_order,
    (select auth.uid())
  )
  returning id into v_proof_id;
  return v_proof_id;
end;
$$;

create or replace function public.delete_quotation_signed_proof(
  p_proof_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_proof public.quotation_signed_proofs%rowtype;
  v_quote public.quotations%rowtype;
begin
  select quote.*
    into v_quote
  from public.quotation_signed_proofs proof
  join public.quotations quote on quote.id = proof.quotation_id
  where proof.id = p_proof_id
  for update of quote;
  if not found then
    raise exception 'Signed proof not found';
  end if;

  select proof.*
    into v_proof
  from public.quotation_signed_proofs proof
  where proof.id = p_proof_id
  for update;
  if not found then
    raise exception 'Signed proof not found';
  end if;

  if not (
    private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
    or v_quote.created_by = (select auth.uid())
    or v_quote.prepared_by_user_id = (select auth.uid())
  ) then
    raise exception 'You do not have permission to delete this signed proof';
  end if;
  delete from public.quotation_signed_proofs where id = v_proof.id;
end;
$$;

revoke all on function public.register_quotation_signed_proof(uuid, text, text, text, bigint) from public;
revoke all on function public.delete_quotation_signed_proof(uuid) from public;
grant execute on function public.register_quotation_signed_proof(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.delete_quotation_signed_proof(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quotation_signed_proofs'
  ) then
    alter publication supabase_realtime add table public.quotation_signed_proofs;
  end if;
end;
$$;

commit;

-- The old direct mockup upload rows and storage objects are intentionally not
-- removed by this migration. Remove them only after the new flow has passed
-- authenticated role testing and an organization-scoped backup/preflight.
