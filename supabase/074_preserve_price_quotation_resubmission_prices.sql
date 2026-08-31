-- Preserve General Manager selling prices for existing item rows when a direct
-- Price Quotation is edited and resubmitted. Newly added items remain unpriced
-- and therefore still require General Manager review.
-- Run after migration 073.

begin;

-- This private, transaction-scoped handoff lets the draft-save function prove
-- that a nonzero price came from an existing item. It is not accessible to
-- application roles and is deleted before the function returns.
create table if not exists private.price_quotation_preserved_item_prices (
  quotation_id uuid primary key references public.quotations(id) on delete cascade,
  item_prices jsonb not null
);
alter table private.price_quotation_preserved_item_prices enable row level security;

create or replace function public.enforce_price_quotation_item_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_preserved_price numeric;
begin
  select * into v_quote from public.quotations where id = new.quotation_id;
  if v_quote.document_type = 'price_quotation'
    and v_quote.costing_source_id is null
    and private.has_text_role(v_quote.organization_id, array['project_manager'])
    and coalesce(new.unit_cost, 0) <> 0 then
    select (preserved.item_prices ->> (new.sort_order + 1)::text)::numeric
    into v_preserved_price
    from private.price_quotation_preserved_item_prices preserved
    where preserved.quotation_id = new.quotation_id;

    if v_preserved_price is distinct from new.unit_cost then
      raise exception 'Only the General Manager can set Selling Price / Unit';
    end if;
  end if;
  return new;
end;
$$;

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
  v_quote_id uuid;
  v_illustration_count integer;
  v_preserved_prices jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Add at least one item before saving the quotation';
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

  if p_quotation_id is not null then
    select coalesce(jsonb_object_agg(item.ordinality::text, to_jsonb(existing_item.unit_cost)), '{}'::jsonb)
    into v_preserved_prices
    from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
    join public.quotation_items existing_item
      on existing_item.quotation_id = p_quotation_id
      and existing_item.id = case
        when coalesce(item.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (item.value ->> 'id')::uuid
      end;
  end if;

  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items
  );

  if v_preserved_prices <> '{}'::jsonb then
    insert into private.price_quotation_preserved_item_prices (quotation_id, item_prices)
    values (v_quote_id, v_preserved_prices)
    on conflict (quotation_id) do update set item_prices = excluded.item_prices;

    update public.quotation_items quotation_item
    set unit_cost = (v_preserved_prices ->> (quotation_item.sort_order + 1)::text)::numeric
    where quotation_item.quotation_id = v_quote_id
      and v_preserved_prices ? (quotation_item.sort_order + 1)::text;

    delete from private.price_quotation_preserved_item_prices
    where quotation_id = v_quote_id;
  end if;

  update public.quotation_items quotation_item
  set image_url = nullif(btrim(item.value ->> 'image_url'), '')
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  where quotation_item.quotation_id = v_quote_id
    and quotation_item.sort_order = item.ordinality - 1;

  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) to authenticated;
revoke all on table private.price_quotation_preserved_item_prices from public, anon, authenticated;

commit;
