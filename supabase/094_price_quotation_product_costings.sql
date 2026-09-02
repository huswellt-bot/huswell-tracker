-- GM-only, per-product internal costing for direct Price Quotations.
-- Run after 093_fix_price_quotation_gallery_save.sql.

begin;

create table if not exists public.price_quotation_product_costings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  quotation_item_id uuid not null references public.quotation_items(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_item_id)
);

create table if not exists public.price_quotation_costing_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_costing_id uuid not null references public.price_quotation_product_costings(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.price_quotation_costing_markups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_costing_id uuid not null references public.price_quotation_product_costings(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  rate numeric(7,3) not null default 0 check (rate >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists price_quotation_product_costings_quotation_id_idx
  on public.price_quotation_product_costings (quotation_id);
create index if not exists price_quotation_costing_lines_product_costing_id_idx
  on public.price_quotation_costing_lines (product_costing_id, sort_order);
create index if not exists price_quotation_costing_markups_product_costing_id_idx
  on public.price_quotation_costing_markups (product_costing_id, sort_order);

alter table public.price_quotation_product_costings enable row level security;
alter table public.price_quotation_costing_lines enable row level security;
alter table public.price_quotation_costing_markups enable row level security;

drop policy if exists "price quotation product costings: GM only" on public.price_quotation_product_costings;
create policy "price quotation product costings: GM only"
on public.price_quotation_product_costings for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
);

drop policy if exists "price quotation costing lines: GM only" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: GM only"
on public.price_quotation_costing_lines for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
);

drop policy if exists "price quotation costing markups: GM only" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: GM only"
on public.price_quotation_costing_markups for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
);

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
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
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
      begin
        v_quantity := coalesce((v_cost_line ->> 'quantity')::numeric, 0);
        v_unit_cost := coalesce((v_cost_line ->> 'unit_cost')::numeric, -1);
      exception when invalid_text_representation then
        raise exception 'Cost line quantities and unit costs must be valid numbers';
      end;
      if v_description is null or v_quantity <= 0 or v_unit_cost < 0 then
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
      insert into public.price_quotation_costing_lines (
        organization_id, product_costing_id, description, quantity, unit_cost, sort_order
      ) values (
        v_quote.organization_id,
        v_product_costing_id,
        btrim(v_cost_line ->> 'description'),
        (v_cost_line ->> 'quantity')::numeric,
        (v_cost_line ->> 'unit_cost')::numeric,
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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'price_quotation_product_costings'
  ) then
    alter publication supabase_realtime add table public.price_quotation_product_costings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'price_quotation_costing_lines'
  ) then
    alter publication supabase_realtime add table public.price_quotation_costing_lines;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'price_quotation_costing_markups'
  ) then
    alter publication supabase_realtime add table public.price_quotation_costing_markups;
  end if;
end $$;

revoke all on function public.review_price_quotation_with_product_costings(uuid, text, numeric, text, jsonb, jsonb, text) from public;
grant execute on function public.review_price_quotation_with_product_costings(uuid, text, numeric, text, jsonb, jsonb, text) to authenticated;

commit;
