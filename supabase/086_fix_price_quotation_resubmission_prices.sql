-- Repairs the direct Price Quotation revision flow.
--
-- The earlier preservation implementation stored prices in an RLS-protected
-- private table. Depending on the function owner, the item trigger could not
-- read that handoff and rejected an officer's valid resubmission. This version
-- uses transaction-local settings that are set only by the security-definer
-- draft-save function immediately before it restores existing prices.
--
-- Run after 085_delete_historical_price_quotations.sql. Safe to re-run.

begin;

create or replace function public.enforce_price_quotation_item_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_preserved_quote_id text;
  v_preserved_prices jsonb;
  v_preserved_price numeric;
begin
  select * into v_quote from public.quotations where id = new.quotation_id;

  if v_quote.document_type = 'price_quotation'
    and v_quote.costing_source_id is null
    and private.has_text_role(v_quote.organization_id, array['project_manager'])
    and coalesce(new.unit_cost, 0) <> 0 then
    v_preserved_quote_id := current_setting(
      'huswell.price_quotation_preserved_quote_id',
      true
    );
    v_preserved_prices := coalesce(
      nullif(
        current_setting('huswell.price_quotation_preserved_item_prices', true),
        ''
      )::jsonb,
      '{}'::jsonb
    );

    if v_preserved_quote_id = new.quotation_id::text then
      v_preserved_price := (
        v_preserved_prices ->> (new.sort_order + 1)::text
      )::numeric;
    end if;

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
    select coalesce(
      jsonb_object_agg(
        item.ordinality::text,
        to_jsonb(existing_item.unit_cost)
      ),
      '{}'::jsonb
    )
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
    perform set_config(
      'huswell.price_quotation_preserved_quote_id',
      v_quote_id::text,
      true
    );
    perform set_config(
      'huswell.price_quotation_preserved_item_prices',
      v_preserved_prices::text,
      true
    );

    update public.quotation_items quotation_item
    set unit_cost = (
      v_preserved_prices ->> (quotation_item.sort_order + 1)::text
    )::numeric
    where quotation_item.quotation_id = v_quote_id
      and v_preserved_prices ? (quotation_item.sort_order + 1)::text;

    perform set_config('huswell.price_quotation_preserved_quote_id', '', true);
    perform set_config('huswell.price_quotation_preserved_item_prices', '', true);
  end if;

  update public.quotation_items quotation_item
  set image_url = nullif(btrim(item.value ->> 'image_url'), '')
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  where quotation_item.quotation_id = v_quote_id
    and quotation_item.sort_order = item.ordinality - 1;

  return v_quote_id;
end;
$$;

revoke all on function public.enforce_price_quotation_item_preparation() from public;
revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) to authenticated;

commit;
