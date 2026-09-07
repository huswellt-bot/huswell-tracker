-- Allow the assigned Sales & Pricing Officer to persist calculated direct
-- Price Quotation totals while sending the quotation to the General Manager.
-- Run after 118_sales_pricing_officer_price_review_guard.sql. Safe to re-run.

begin;

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

    -- The pricing RPC writes calculated totals in the same transaction as it
    -- moves the direct quotation from officer review to GM approval.
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
      if old.status::text = 'pending'
        and new.status::text = 'pending_gm_approval'
        and private.has_text_role(new.organization_id, array['pricing_officer'])
        and private.is_pricing_officer_assigned(
          new.organization_id,
          (select auth.uid()),
          new.project_types
        )
        and new.created_by is distinct from (select auth.uid())
        and new.prepared_by_user_id is distinct from (select auth.uid()) then
        return new;
      end if;

      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
  end if;

  return new;
end;
$$;

commit;

