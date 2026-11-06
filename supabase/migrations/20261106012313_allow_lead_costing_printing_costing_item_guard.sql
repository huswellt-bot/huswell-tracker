-- Direct printing submission seeds its own internal direct-cost snapshot before
-- GM pricing. The standard quotation selling-price guard must not block that
-- source-specific step.

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
    and coalesce(v_quote.quotation_source, 'standard') <> 'lead_costing_printing'
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

revoke all on function public.enforce_price_quotation_item_preparation() from public;
