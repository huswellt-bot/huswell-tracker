-- Repair the quotation preparation guards after migration 138. This is a
-- standalone, idempotent follow-up for databases where migration 138 was
-- already recorded or run before its guard definitions were corrected.
-- Run after 138_gm_pricing_revision_routing.sql.

begin;

alter table public.quotations
  add column if not exists revision_requested_to text;

-- The preparation triggers remain attached to the tables created by migration
-- 063. Replacing their functions is enough; dropping the triggers would widen
-- the window in which direct quotation-price writes could bypass protection.
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

commit;
