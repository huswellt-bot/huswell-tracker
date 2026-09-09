-- Route General Manager quotation revisions back to the assigned
-- Sales & Pricing Officer. The officer receives the GM note, edits the
-- pricing inputs, and resubmits the quotation to the GM. Unsaved GM edits
-- are intentionally not persisted by the return RPC.
-- Run after 137_direct_cost_markup_discount_and_review_vat.sql and before
-- deploying the matching application update.

begin;

alter table public.quotations
  add column if not exists revision_requested_to text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and conname = 'quotations_revision_requested_to_check'
  ) then
    alter table public.quotations
      add constraint quotations_revision_requested_to_check
      check (
        revision_requested_to is null
        or revision_requested_to in ('project_officer', 'pricing_officer')
      );
  end if;
end;
$$;

-- The preparation triggers were created by migration 063 and are still
-- attached to the quotations and quotation_items tables. Allow the assigned
-- Pricing Officer to update pricing inputs while a GM-targeted revision is
-- in needs_revision, then let the review RPC move the quotation back to the
-- pending-GM queue. Keep direct writes limited to the same role and assignment
-- checks used by the review RPC.
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
      )
      and v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
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
        and new.created_by is distinct from (select auth.uid())
        and new.prepared_by_user_id is distinct from (select auth.uid())
      ) then
        return new;
      end if;

      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
  end if;

  return new;
end;
$$;

-- Both document types use the same routing rule. A Price Quotation had
-- previously omitted the approval-request update, which left the queue out
-- of sync after a GM return.
create or replace function public.return_price_quotation_from_gm(
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
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can return this quotation';
  end if;
  update public.quotations
  set status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
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
      revision_requested_to = 'pricing_officer',
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
end;
$$;

-- The existing workflow policies expose pending-GM rows to an assigned
-- Pricing Officer, but a GM-returned row is temporarily needs_revision. Add
-- narrowly scoped read policies so the assigned officer can load the note,
-- products, and saved costing rows even if the assignment changed since the
-- original pricing review.
drop policy if exists "quotations: pricing revision read" on public.quotations;
create policy "quotations: pricing revision read"
on public.quotations for select to authenticated
using (
  document_type in ('price_quotation', 'mockup_quotation')
  and status::text = 'needs_revision'
  and revision_requested_to = 'pricing_officer'
  and (select private.is_pricing_officer_assigned(
    organization_id,
    (select auth.uid()),
    project_types
  ))
);

drop policy if exists "quotation items: pricing revision read" on public.quotation_items;
create policy "quotation items: pricing revision read"
on public.quotation_items for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and quote.status::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation product costings: pricing revision read" on public.price_quotation_product_costings;
create policy "price quotation product costings: pricing revision read"
on public.price_quotation_product_costings for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and quote.status::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing lines: pricing revision read" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: pricing revision read"
on public.price_quotation_costing_lines for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and quote.status::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing markups: pricing revision read" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: pricing revision read"
on public.price_quotation_costing_markups for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and quote.status::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation illustrations: pricing revision read" on public.price_quotation_illustrations;
create policy "price quotation illustrations: pricing revision read"
on public.price_quotation_illustrations for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and quote.document_type = 'price_quotation'
      and quote.status::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

-- Persisting the next review state clears the GM routing marker and note.
-- This is the same total calculation introduced in migration 137, with the
-- routing reset added so a successfully resubmitted quotation returns to the
-- normal pending-GM queue.
create or replace function private.persist_product_quotation_totals(
  p_quotation_id uuid,
  p_status text,
  p_vat_calculation_type text,
  p_vat_rate numeric,
  p_vat_fixed_amount numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_vat_amount numeric := 0;
  v_item record;
  v_item_grand_total numeric;
begin
  select coalesce(round(sum(line_total), 2), 0) into v_subtotal
  from public.quotation_items where quotation_id = p_quotation_id;

  if p_vat_calculation_type = 'percentage' and greatest(coalesce(p_vat_rate, 0), 0) > 0 then
    for v_item in select id, quantity, line_total from public.quotation_items where quotation_id = p_quotation_id loop
      v_item_grand_total := round(v_item.line_total * (1 + greatest(coalesce(p_vat_rate, 0), 0) / 100), 2);
      update public.quotation_items
      set unit_cost = round(v_item_grand_total / nullif(v_item.quantity, 0), 2)
      where id = v_item.id;
    end loop;
  end if;

  select coalesce(round(sum(line_total), 2), 0) into v_total
  from public.quotation_items where quotation_id = p_quotation_id;
  v_vat_amount := round(v_total - v_subtotal, 2);

  update public.quotations q
  set vat_rate = case when p_vat_calculation_type = 'percentage' then greatest(coalesce(p_vat_rate, 0), 0) else 0 end,
      vat_calculation_type = 'percentage', vat_fixed_amount = 0,
      shipping_handling = 0,
      terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), q.terms_conditions),
      bank_details = coalesce(p_bank_details, q.bank_details),
      status = p_status::public.quotation_status,
      pricing_reviewed_by = case when p_status = 'pending_gm_approval' then p_actor else q.pricing_reviewed_by end,
      pricing_reviewed_at = case when p_status = 'pending_gm_approval' then now() else q.pricing_reviewed_at end,
      approved_by = case when p_status = 'approved' then p_actor else null end,
      approved_at = case when p_status = 'approved' then now() else null end,
      issue_date = case when p_status = 'approved' then current_date else q.issue_date end,
      revision_note = null,
      revision_requested_to = null,
      subtotal = v_subtotal, total_cost = v_subtotal,
      vat_amount = v_vat_amount, total_amount = v_total
  where q.id = p_quotation_id;

  update public.approval_requests
  set status = (case when p_status = 'pending_gm_approval' then 'pending' else p_status end)::public.approval_status,
      submitted_by = case when p_status = 'pending_gm_approval' then p_actor else submitted_by end,
      submitted_at = case when p_status = 'pending_gm_approval' then now() else submitted_at end,
      decided_by = case when p_status = 'approved' then p_actor else null end,
      decided_at = case when p_status = 'approved' then now() else null end,
      decision_note = null
  where resource_type = 'quotation' and resource_id = p_quotation_id;
end;
$$;

-- Pricing Officer review accepts a GM-targeted needs_revision quotation as a
-- resubmission. Returning a normal pending quotation still routes it to the
-- project officer. Other needs_revision rows cannot be claimed by this RPC.
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
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
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
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types)
    or v_quote.created_by is not distinct from (select auth.uid())
    or v_quote.prepared_by_user_id is not distinct from (select auth.uid()) then
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
    set status = 'needs_revision', revision_note = v_note,
        revision_requested_to = 'project_officer',
        revision_requested_by = (select auth.uid()), revision_requested_at = now(),
        approved_by = null, approved_at = null
    where id = v_quote.id;
    update public.approval_requests
    set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', 'percentage', 0, 0, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

create or replace function public.pricing_review_mockup_quotation(
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
    raise exception 'Unsupported Mockup Quotation decision';
  end if;
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'mockup_quotation' then
    raise exception 'Mockup Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Mockup Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(v_quote.organization_id, (select auth.uid()), v_quote.project_types) then
    raise exception 'Only the Sales & Pricing Officer assigned to this project type can review this Mockup Quotation';
  end if;
  if p_decision = 'needs_revision' then
    if v_quote.status::text <> 'pending' then
      raise exception 'This GM revision must be resubmitted to the General Manager';
    end if;
    if v_note is null then
      raise exception 'Enter revision notes before returning this quotation';
    end if;
    update public.quotations
    set status = 'needs_revision', revision_note = v_note,
        revision_requested_to = 'project_officer',
        revision_requested_by = (select auth.uid()), revision_requested_at = now(),
        approved_by = null, approved_at = null
    where id = v_quote.id;
    update public.approval_requests
    set status = 'needs_revision', decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
    where resource_type = 'quotation' and resource_id = v_quote.id;
    return;
  end if;
  perform private.apply_pricing_officer_costings(v_quote.organization_id, v_quote.id, p_costings, (select auth.uid()));
  perform private.persist_product_quotation_totals(v_quote.id, 'pending_gm_approval', 'percentage', 0, 0, p_terms_conditions, p_bank_details, (select auth.uid()));
end;
$$;

-- Permit the assigned Pricing Officer to move a GM-targeted revision back to
-- the pending-GM state, while preventing the original preparer from changing
-- that same revision to draft/pending.
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
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
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
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
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
      if old.status::text = 'needs_revision'
        and old.revision_requested_to = 'pricing_officer'
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then
          raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type';
        end if;
        new.pricing_reviewed_by := (select auth.uid());
        new.pricing_reviewed_at := now();
        return new;
      end if;
      if old.status::text = 'pending'
        and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then
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
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
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
        and coalesce(old.revision_requested_to, '') <> 'pricing_officer'
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
      if old.status::text = 'needs_revision'
        and old.revision_requested_to = 'pricing_officer'
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then
          raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type';
        end if;
        new.pricing_reviewed_by := (select auth.uid());
        new.pricing_reviewed_at := now();
        return new;
      end if;
      if old.status::text = 'pending'
        and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
        and private.has_text_role(new.organization_id, array['pricing_officer']) then
        if not private.is_pricing_officer_assigned(new.organization_id, (select auth.uid()), new.project_types) then
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

revoke all on function public.return_price_quotation_from_gm(uuid, text) from public;
grant execute on function public.return_price_quotation_from_gm(uuid, text) to authenticated;
revoke all on function public.return_mockup_quotation_from_gm(uuid, text) from public;
grant execute on function public.return_mockup_quotation_from_gm(uuid, text) to authenticated;
revoke all on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_price_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;
revoke all on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) from public;
grant execute on function public.pricing_review_mockup_quotation(uuid, text, numeric, text, jsonb, jsonb, text, text, numeric) to authenticated;

commit;
