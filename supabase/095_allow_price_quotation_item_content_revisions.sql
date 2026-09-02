-- Allow a Sales Project Officer to revise the non-price fields of a direct
-- Price Quotation item after it has been priced by the General Manager.
--
-- The existing guard ran for every UPDATE and treated the unchanged, existing
-- unit_cost as though the officer had supplied a new selling price. Check the
-- price delta instead: officers remain unable to add a priced line or modify
-- an existing selling price.
--
-- Run after 094_price_quotation_product_costings.sql. Safe to re-run.

begin;

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
    and private.has_text_role(v_quote.organization_id, array['project_manager'])
    and (
      (tg_op = 'INSERT' and coalesce(new.unit_cost, 0) <> 0)
      or (tg_op = 'UPDATE' and new.unit_cost is distinct from old.unit_cost)
    ) then
    raise exception 'Only the General Manager can set Selling Price / Unit';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_price_quotation_item_preparation() from public;

commit;
