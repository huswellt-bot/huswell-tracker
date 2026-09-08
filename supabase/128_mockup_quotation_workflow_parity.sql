-- Restore Mockup Quotation transitions after the direct Price Quotation guard
-- was introduced in migration 120. Mockups share the Price Quotation review
-- workflow, except they remain source-linked and do not use endorsements.
-- Run after 127_separate_mockup_requirements.sql.

begin;

create or replace function public.enforce_price_quotation_role_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

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
              and assignment.project_type = private.normalize_price_quotation_project_type(new.project_types)
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
        if new.status::text = 'approved' then
          new.status := 'pending_gm_approval';
          new.approved_by := null;
          new.approved_at := null;
          new.pricing_reviewed_by := (select auth.uid());
          new.pricing_reviewed_at := now();
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
              and assignment.project_type = private.normalize_price_quotation_project_type(new.project_types)
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

  return new;
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

create or replace function public.final_approve_price_quotation_with_edits(
  p_quotation_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_costing jsonb;
  v_line jsonb;
  v_markup jsonb;
  v_costing_id uuid;
  v_item_id uuid;
  v_item_quantity numeric;
  v_description text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_rate numeric;
  v_cogs numeric;
  v_markup_total numeric;
  v_price numeric;
  v_item_count bigint;
  v_existing_costing_count bigint;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or (v_quote.document_type = 'price_quotation' and v_quote.costing_source_id is not null) then
    raise exception 'Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve this quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This quotation is not awaiting General Manager approval';
  end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items
  where quotation_id = v_quote.id;

  select count(*) into v_existing_costing_count
  from public.price_quotation_product_costings
  where quotation_id = v_quote.id;

  if jsonb_array_length(p_costings) = 0 and v_existing_costing_count > 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) > 0 and jsonb_array_length(p_costings) <> v_item_count then
    raise exception 'Add one costing table for every quotation product';
  end if;

  if jsonb_array_length(p_costings) > 0 then
    delete from public.price_quotation_product_costings
    where quotation_id = v_quote.id;

    for v_costing in select value from jsonb_array_elements(p_costings) loop
      begin
        v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Each costing table must be linked to a quotation product';
      end;

      if v_item_id = any(v_seen_item_ids) then
        raise exception 'A quotation product can have only one costing table';
      end if;
      v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);

      select quantity
      into v_item_quantity
      from public.quotation_items
      where id = v_item_id and quotation_id = v_quote.id
      for update;
      if not found or coalesce(v_item_quantity, 0) <= 0 then
        raise exception 'Each costing table must be linked to a quotation product with a quantity';
      end if;
      if coalesce(jsonb_typeof(v_costing -> 'cost_lines'), '') <> 'array'
        or coalesce(jsonb_array_length(v_costing -> 'cost_lines'), 0) = 0 then
        raise exception 'Add at least one internal cost line for every quotation product';
      end if;
      if coalesce(jsonb_typeof(v_costing -> 'markups'), '') <> 'array' then
        raise exception 'Costing markups must be a list';
      end if;

      insert into public.price_quotation_product_costings (
        organization_id, quotation_id, quotation_item_id, created_by, updated_at
      )
      values (
        v_quote.organization_id, v_quote.id, v_item_id, (select auth.uid()), now()
      )
      returning id into v_costing_id;

      v_index := 0;
      for v_line in select value from jsonb_array_elements(v_costing -> 'cost_lines') loop
        v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
        v_calculation_type := coalesce(
          nullif(btrim(coalesce(v_line ->> 'calculation_type', '')), ''),
          'quantity_unit_cost'
        );
        if v_calculation_type not in ('quantity_unit_cost', 'fixed_amount') then
          raise exception 'Each internal cost line needs a valid calculation type';
        end if;
        begin
          if v_calculation_type = 'fixed_amount' then
            v_quantity := 1;
            v_unit_cost := coalesce(
              (v_line ->> 'amount')::numeric,
              (v_line ->> 'unit_cost')::numeric,
              -1
            );
          else
            v_quantity := coalesce((v_line ->> 'quantity')::numeric, 0);
            v_unit_cost := coalesce((v_line ->> 'unit_cost')::numeric, -1);
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

        insert into public.price_quotation_costing_lines (
          organization_id, product_costing_id, description, calculation_type,
          quantity, unit_cost, sort_order
        )
        values (
          v_quote.organization_id,
          v_costing_id,
          v_description,
          v_calculation_type,
          v_quantity,
          v_unit_cost,
          v_index
        );
        v_index := v_index + 1;
      end loop;

      v_index := 0;
      for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
        v_description := nullif(btrim(coalesce(v_markup ->> 'label', '')), '');
        begin
          v_rate := coalesce((v_markup ->> 'rate')::numeric, -1);
        exception when invalid_text_representation then
          raise exception 'Markup rates must be valid numbers';
        end;
        if v_description is null or v_rate < 0 then
          raise exception 'Each markup needs a name and a non-negative percentage';
        end if;

        insert into public.price_quotation_costing_markups (
          organization_id, product_costing_id, label, rate, sort_order
        )
        values (
          v_quote.organization_id,
          v_costing_id,
          v_description,
          v_rate,
          v_index
        );
        v_index := v_index + 1;
      end loop;

      select coalesce(sum(round(quantity * unit_cost, 2)), 0)
      into v_cogs
      from public.price_quotation_costing_lines
      where product_costing_id = v_costing_id;

      select coalesce(sum(round(v_cogs * rate / 100, 2)), 0)
      into v_markup_total
      from public.price_quotation_costing_markups
      where product_costing_id = v_costing_id;

      select (v_cogs + v_markup_total) / nullif(quantity, 0)
      into v_price
      from public.quotation_items
      where id = v_item_id;

      update public.quotation_items
      set unit_cost = round(v_price, 2)
      where id = v_item_id;
    end loop;
  end if;

  update public.quotations q
  set vat_rate = greatest(coalesce(p_vat_rate, 0), 0),
      shipping_handling = 0,
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
      bank_details = coalesce(p_bank_details, q.bank_details),
      status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now(),
      issue_date = current_date,
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
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = null
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

revoke all on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text) from public;
revoke all on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb) from public;
grant execute on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.final_approve_price_quotation_with_edits(uuid, numeric, text, jsonb, jsonb) to authenticated;

commit;
