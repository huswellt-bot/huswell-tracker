-- Run after 096_fixed_amount_internal_cost_lines.sql.
-- Adds a "Pricing Officer" role that reviews price quotations (costing tables,
-- terms, bank, return/approve) alongside the General Manager, and owns a new
-- price-quotation mockup upload page with Ongoing/Completed/Cancelled status.
-- Sales Project Officers receive read-only access to the mockup page.

-- PostgreSQL cannot run ALTER TYPE ... ADD VALUE inside a transaction block in
-- older versions, so the enum change is done first, standalone.
alter type public.member_role add value if not exists 'pricing_officer';

begin;

-- ---------------------------------------------------------------------------
-- 1) Allow the Pricing Officer to review price quotations (alongside GM).
--    The function bodies below are reproduced verbatim from migrations
--    063/065/096 with the SINGLE change of adding 'pricing_officer' to the
--    has_text_role approval arrays. No other behavior is altered.
-- ---------------------------------------------------------------------------
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
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']) then
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

create or replace function public.review_price_quotation_revision(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.price_quotation_revision_requests%rowtype;
  v_quote public.quotations%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported Price Quotation revision decision';
  end if;

  select * into v_request from public.price_quotation_revision_requests where id = p_request_id for update;
  if not found or v_request.status::text <> 'pending' then
    raise exception 'Price Quotation revision request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']) then
    raise exception 'Only the General Manager can review Price Quotation revisions';
  end if;

  select * into v_quote from public.quotations where id = v_request.quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'This Price Quotation is no longer available for revision';
  end if;

  if p_decision = 'approved' then
    update public.quotations
    set status = 'needs_revision',
        approved_by = null,
        approved_at = null,
        revision_note = 'Revision request approved. Update the Price Quotation and submit it for review.',
        revision_requested_by = (select auth.uid()),
        revision_requested_at = now()
    where id = v_quote.id;
  end if;

  update public.price_quotation_revision_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = v_request.id;

  return v_quote.id;
end;
$$;

create or replace function public.review_price_quotation_with_product_costings(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
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
  v_line_prices jsonb := '[]'::jsonb;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' or jsonb_array_length(p_costings) = 0 then
    raise exception 'Add a costing table for every quotation product';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']) then
    raise exception 'Only the General Manager can review Price Quotations';
  end if;
  if v_quote.status::text not in ('pending', 'draft') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if jsonb_array_length(p_costings) <> (
    select count(*) from public.quotation_items where quotation_id = v_quote.id
  ) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  for v_product_costing in select value from jsonb_array_elements(p_costings) loop
    begin
      v_item_id := (v_product_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;
    if v_item_id = any(v_seen_item_ids) then
      raise exception 'A quotation product can have only one costing table';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);

    select * into v_quotation_item
    from public.quotation_items
    where id = v_item_id and quotation_id = v_quote.id
    for update;
    if not found or coalesce(v_quotation_item.quantity, 0) <= 0 then
      raise exception 'Each costing table must be linked to a quotation product with a quantity';
    end if;
    if coalesce(jsonb_typeof(v_product_costing -> 'cost_lines'), '') <> 'array'
      or jsonb_array_length(v_product_costing -> 'cost_lines') = 0 then
      raise exception 'Add at least one internal cost line for every quotation product';
    end if;
    if jsonb_typeof(coalesce(v_product_costing -> 'markups', '[]'::jsonb)) <> 'array' then
      raise exception 'Costing markups must be a list';
    end if;

    v_cogs := 0;
    for v_cost_line in select value from jsonb_array_elements(v_product_costing -> 'cost_lines') loop
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
    for v_markup in select value from jsonb_array_elements(coalesce(v_product_costing -> 'markups', '[]'::jsonb)) loop
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

    v_line_prices := v_line_prices || jsonb_build_array(jsonb_build_object(
      'id', v_quotation_item.id,
      'unit_cost', round((v_cogs + v_markup_total) / v_quotation_item.quantity, 2)
    ));
  end loop;

  delete from public.price_quotation_product_costings
  where quotation_id = v_quote.id;

  for v_product_costing in select value from jsonb_array_elements(p_costings) loop
    v_item_id := (v_product_costing ->> 'quotation_item_id')::uuid;
    insert into public.price_quotation_product_costings (
      organization_id, quotation_id, quotation_item_id, created_by, updated_at
    ) values (
      v_quote.organization_id, v_quote.id, v_item_id, (select auth.uid()), now()
    ) returning id into v_product_costing_id;

    v_index := 0;
    for v_cost_line in select value from jsonb_array_elements(v_product_costing -> 'cost_lines') loop
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
      ) values (
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
    for v_markup in select value from jsonb_array_elements(coalesce(v_product_costing -> 'markups', '[]'::jsonb)) loop
      insert into public.price_quotation_costing_markups (
        organization_id, product_costing_id, label, rate, sort_order
      ) values (
        v_quote.organization_id,
        v_product_costing_id,
        btrim(v_markup ->> 'label'),
        (v_markup ->> 'rate')::numeric,
        v_index
      );
      v_index := v_index + 1;
    end loop;
  end loop;

  perform public.review_price_quotation(
    v_quote.id,
    p_decision,
    greatest(coalesce(p_vat_rate, 0), 0),
    0,
    p_terms_conditions,
    p_bank_details,
    v_line_prices,
    p_revision_note
  );
end;
$$;

revoke all on function public.review_price_quotation(uuid, text, numeric, numeric, text, jsonb, jsonb, text) from public;
grant execute on function public.review_price_quotation(uuid, text, numeric, numeric, text, jsonb, jsonb, text) to authenticated;
revoke all on function public.review_price_quotation_with_product_costings(uuid, text, numeric, text, jsonb, jsonb, text) from public;
grant execute on function public.review_price_quotation_with_product_costings(uuid, text, numeric, text, jsonb, jsonb, text) to authenticated;
revoke all on function public.review_price_quotation_revision(uuid, text) from public;
grant execute on function public.review_price_quotation_revision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Extend RLS read policies so the Pricing Officer can read the quoting and
--    costing tables (same read scope as the General Manager). Writes continue
--    through the security-definer RPCs above.
-- ---------------------------------------------------------------------------
drop policy if exists "price quotation product costings: GM only" on public.price_quotation_product_costings;
create policy "price quotation product costings: GM only"
on public.price_quotation_product_costings for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
);

drop policy if exists "price quotation costing lines: GM only" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: GM only"
on public.price_quotation_costing_lines for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
);

drop policy if exists "price quotation costing markups: GM only" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: GM only"
on public.price_quotation_costing_markups for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
);

drop policy if exists "price quotation illustrations: workflow read" on public.price_quotation_illustrations;
create policy "price quotation illustrations: workflow read"
on public.price_quotation_illustrations for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
  or exists (
    select 1 from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
      )
  )
);

drop policy if exists "price quotation revision requests: read" on public.price_quotation_revision_requests;
create policy "price quotation revision requests: read"
on public.price_quotation_revision_requests for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
  or submitted_by = (select auth.uid())
);

-- The quotations / quotation_items read and write policies already allow admin
-- roles (via has_text_role arrays) that we do not extend wholesale, because the
-- Pricing Officer must be able to READ quotations. We add the Pricing Officer
-- to the quotation read policy (and quotation_items read) below.
drop policy if exists "quotations: price workflow read" on public.quotations;
create policy "quotations: price workflow read" on public.quotations for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
  or created_by = (select auth.uid())
  or (prepared_by_user_id = (select auth.uid()) and document_type = 'price_quotation')
);

drop policy if exists "quotation items: price workflow read" on public.quotation_items;
create policy "quotation items: price workflow read" on public.quotation_items for select to authenticated using (
  exists (select 1 from public.quotations quote where quote.id = quotation_id and (
    (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']))
    or quote.created_by = (select auth.uid())
    or quote.prepared_by_user_id = (select auth.uid())
  ))
);

-- ---------------------------------------------------------------------------
-- 3) New price-quotation mockup table (multi-image, status-tracked).
-- ---------------------------------------------------------------------------
create table if not exists public.price_quotation_mockups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  image_url text not null check (btrim(image_url) <> ''),
  status text not null default 'ongoing' check (
    status in ('ongoing', 'completed', 'cancelled')
  ),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_quotation_mockups_quotation_idx
  on public.price_quotation_mockups (quotation_id, created_at desc);
create index if not exists price_quotation_mockups_org_status_idx
  on public.price_quotation_mockups (organization_id, status);

drop trigger if exists price_quotation_mockups_updated_at on public.price_quotation_mockups;
create trigger price_quotation_mockups_updated_at
before update on public.price_quotation_mockups
for each row execute function public.set_updated_at();

alter table public.price_quotation_mockups enable row level security;

-- Org members may view mockups (read-only for Sales Project Officers).
drop policy if exists "price quotation mockups: read" on public.price_quotation_mockups;
create policy "price quotation mockups: read"
on public.price_quotation_mockups for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer', 'project_manager', 'sales']))
);

-- No direct inserts/updates; writes go through the security-definer RPC.
drop policy if exists "no direct write" on public.price_quotation_mockups;
create policy "no direct write"
on public.price_quotation_mockups for insert
to authenticated with check (false);

drop policy if exists "no direct update" on public.price_quotation_mockups;
create policy "no direct update"
on public.price_quotation_mockups for update
to authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- 4) RPC to save a quotation's mockup images + status.
--    Pricing Officer or General Manager may set images/status.
-- ---------------------------------------------------------------------------
create or replace function public.save_price_quotation_mockups(
  p_quotation_id uuid,
  p_images jsonb,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_count integer;
begin
  if p_status not in ('ongoing', 'completed', 'cancelled') then
    raise exception 'Unsupported mockup status';
  end if;

  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin', 'pricing_officer']) then
    raise exception 'Only a General Manager or Pricing Officer can manage quotation mockups';
  end if;

  if coalesce(jsonb_typeof(p_images), '') <> 'array' then
    raise exception 'Mockup images must be an array';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_images);
  if v_count > 20 then
    raise exception 'A Price Quotation can have a maximum of twenty mockup images';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_images) as image(value)
    where nullif(btrim(coalesce(image.value ->> 'image_url', '')), '') is null
  ) then
    raise exception 'Each mockup image requires an uploaded image';
  end if;

  delete from public.price_quotation_mockups where quotation_id = v_quote.id;
  insert into public.price_quotation_mockups (
    organization_id, quotation_id, image_url, status, uploaded_by
  )
  select
    v_quote.organization_id,
    v_quote.id,
    btrim(image.value ->> 'image_url'),
    p_status,
    (select auth.uid())
  from jsonb_array_elements(p_images) as image(value);
end;
$$;

revoke all on function public.save_price_quotation_mockups(uuid, jsonb, text) from public;
grant execute on function public.save_price_quotation_mockups(uuid, jsonb, text) to authenticated;

-- Realtime so the newest status is visible to all roles immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'price_quotation_mockups'
  ) then
    alter publication supabase_realtime add table public.price_quotation_mockups;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually if needed):
--   drop function public.save_price_quotation_mockups(uuid, jsonb, text);
--   drop table public.price_quotation_mockups;
--   -- The 'pricing_officer' enum value CANNOT be dropped in PostgreSQL; it is
--   -- left in place but unused. To restore the original review authorization,
--   -- re-apply the RPC bodies verbatim from supabase/063, 065, and 096.
-- ---------------------------------------------------------------------------
