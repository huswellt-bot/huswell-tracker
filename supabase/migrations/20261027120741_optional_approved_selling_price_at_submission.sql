-- Client-approved selling prices are informational during GM costing review.
-- Blank values remain NULL and must not block Pricing Officer submission.

begin;

create or replace function private.save_approved_selling_prices(
  p_quotation_id uuid,
  p_approved_selling_prices jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_item_count bigint;
  v_payload_count bigint;
  v_distinct_item_count bigint;
begin
  if coalesce(jsonb_typeof(p_approved_selling_prices), '') <> 'array' then
    raise exception 'Approved selling prices must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items
  where quotation_id = p_quotation_id;

  select count(*) into v_payload_count
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  );

  select count(distinct price.quotation_item_id) into v_distinct_item_count
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  );

  if v_payload_count <> v_item_count
    or v_distinct_item_count <> v_item_count then
    raise exception 'Provide one approved selling price row for every quotation product';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_approved_selling_prices) as price(
      quotation_item_id uuid,
      approved_selling_price numeric
    )
    where price.approved_selling_price is not null
      and price.approved_selling_price < 0
  ) then
    raise exception 'Approved selling prices must be non-negative numbers';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_approved_selling_prices) as price(
      quotation_item_id uuid,
      approved_selling_price numeric
    )
    where not exists (
      select 1
      from public.quotation_items item
      where item.id = price.quotation_item_id
        and item.quotation_id = p_quotation_id
    )
  ) then
    raise exception 'Approved selling price item does not belong to this quotation';
  end if;

  update public.quotation_items item
  set approved_selling_price = price.approved_selling_price
  from jsonb_to_recordset(p_approved_selling_prices) as price(
    quotation_item_id uuid,
    approved_selling_price numeric
  )
  where item.id = price.quotation_item_id
    and item.quotation_id = p_quotation_id;
end;
$$;

commit;
