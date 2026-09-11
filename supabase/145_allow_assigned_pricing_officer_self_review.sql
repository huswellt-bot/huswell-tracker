-- Allow an assigned Sales & Pricing Officer to price and submit a direct
-- Price Quotation they created or prepared. The project-type assignment,
-- quotation status, costing completeness, and General Manager approval
-- boundaries remain unchanged.
-- Run after 144_quotation_files_custom_pricing_markups.sql and before the
-- matching application update.

begin;

-- The preparation triggers are the database write boundary used by the
-- Pricing Officer costing workflow. Keep the role, assignment, status, and
-- GM-targeted revision checks, but do not reject an officer merely because
-- they are also the quotation creator/preparer.
create or replace function public.enforce_price_quotation_item_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = new.quotation_id;

  if v_quote.document_type = 'price_quotation'
    and v_quote.costing_source_id is null
    and (
      (tg_op = 'INSERT' and coalesce(new.unit_cost, 0) <> 0)
      or (tg_op = 'UPDATE' and new.unit_cost is distinct from old.unit_cost)
    ) then
    if private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
      return new;
    end if;

    if tg_op = 'UPDATE'
      and (
        v_quote.status::text = 'pending'
        or (
          v_quote.status::text = 'needs_revision'
          and v_quote.revision_requested_to = 'pricing_officer'
        )
      )
      and private.has_text_role(v_quote.organization_id, array['pricing_officer'])
      and private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      ) then
      return new;
    end if;

    raise exception 'Only the assigned Sales & Pricing Officer can set Selling Price / Unit';
  end if;

  return new;
end;
$$;

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
      coalesce(new.vat_rate, 0) <> 0
      or coalesce(new.shipping_handling, 0) <> 0
      or coalesce(new.total_cost, 0) <> 0
      or coalesce(new.subtotal, 0) <> 0
      or coalesce(new.vat_amount, 0) <> 0
      or coalesce(new.total_amount, 0) <> 0
    ) then
      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;

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
      if (
        (
          old.status::text = 'pending'
          or (
            old.status::text = 'needs_revision'
            and old.revision_requested_to = 'pricing_officer'
          )
        )
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer'])
        and private.is_pricing_officer_assigned(
          new.organization_id,
          (select auth.uid()),
          new.project_types
        )
      ) then
        return new;
      end if;

      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
  end if;

  return new;
end;
$$;

-- The current costing review RPC also accepts a GM-targeted revision. Keep
-- that routing behavior while allowing the assigned officer to review their
-- own quotation.
create or replace function public.pricing_review_price_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric
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
  if p_decision is null or p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Price Quotation decision';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the assigned Sales & Pricing Officer can review this Price Quotation';
  end if;

  if p_decision = 'needs_revision' then
    if v_quote.status::text <> 'pending' then
      raise exception 'This GM revision must be resubmitted to the General Manager';
    end if;
    if v_note is null then
      raise exception 'Enter revision notes before returning this quotation';
    end if;

    update public.quotations
    set status = 'needs_revision',
        revision_note = v_note,
        revision_requested_to = 'project_officer',
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

  perform private.apply_pricing_officer_costings(
    v_quote.organization_id,
    v_quote.id,
    p_costings,
    (select auth.uid())
  );
  perform private.persist_product_quotation_totals(
    v_quote.id,
    'pending_gm_approval',
    'percentage',
    0,
    0,
    p_terms_conditions,
    p_bank_details,
    (select auth.uid())
  );
end;
$$;

revoke all on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric
) from public;
grant execute on function public.pricing_review_price_quotation(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric
) to authenticated;

-- Keep the older one-step submit RPC consistent for clients or scripts that
-- still call it. The current workspace uses pricing_review_price_quotation.
create or replace function public.submit_price_quotation_to_gm(p_quotation_id uuid)
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

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the assigned Sales & Pricing Officer can submit this Price Quotation to the General Manager';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only a submitted Price Quotation can be sent to the General Manager';
  end if;

  update public.quotations
  set status = 'pending_gm_approval',
      pricing_reviewed_by = (select auth.uid()),
      pricing_reviewed_at = now()
  where id = v_quote.id;
end;
$$;

revoke all on function public.submit_price_quotation_to_gm(uuid) from public;
grant execute on function public.submit_price_quotation_to_gm(uuid) to authenticated;

-- Existing costing rows were hidden from an assigned officer when that
-- officer was also the creator/preparer. Allow the officer to reload saved
-- costing data for the pending review; GM-only and GM-revision policies stay
-- in place for their existing scopes.
drop policy if exists "price quotation product costings: assigned self review" on public.price_quotation_product_costings;
create policy "price quotation product costings: assigned self review"
on public.price_quotation_product_costings for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'pending'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing lines: assigned self review" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: assigned self review"
on public.price_quotation_costing_lines for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'pending'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing markups: assigned self review" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: assigned self review"
on public.price_quotation_costing_markups for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'pending'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

commit;
