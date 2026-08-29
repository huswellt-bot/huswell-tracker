-- Persists the configured rates on new Costing Breakdowns and calculates
-- totals from rounded subtotal and VAT components. Run after 053.
-- This is safe to re-run and does not alter existing quotation records.

create or replace function public.recalculate_quotation_totals()
returns trigger
language plpgsql
as $$
declare
  v_quotation_id uuid := coalesce(new.quotation_id, old.quotation_id);
  v_cost numeric(14,2);
  v_profit_margin_rate numeric(5,2);
  v_overhead_rate numeric(5,2);
  v_buffer_margin_rate numeric(5,2);
  v_commission_rate numeric(5,2);
  v_vat_rate numeric(5,2);
  v_subtotal numeric(14,2);
  v_vat_amount numeric(14,2);
begin
  select coalesce(sum(line_total), 0)
  into v_cost
  from public.quotation_items
  where quotation_id = v_quotation_id;

  select
    profit_margin_rate,
    overhead_rate,
    buffer_margin_rate,
    commission_rate,
    vat_rate
  into
    v_profit_margin_rate,
    v_overhead_rate,
    v_buffer_margin_rate,
    v_commission_rate,
    v_vat_rate
  from public.quotations
  where id = v_quotation_id;

  if not found then
    return null;
  end if;

  v_subtotal := round(v_cost * (
    1 + v_profit_margin_rate / 100 + v_overhead_rate / 100
      + v_buffer_margin_rate / 100 + v_commission_rate / 100
  ), 2);
  v_vat_amount := round(v_subtotal * v_vat_rate / 100, 2);

  update public.quotations
  set
    total_cost = v_cost,
    subtotal = v_subtotal,
    vat_amount = v_vat_amount,
    total_amount = v_subtotal + v_vat_amount
  where id = v_quotation_id;

  return null;
end;
$$;

create or replace function private.refresh_quotation_totals(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_cost numeric(14,2);
  v_profit_margin_rate numeric(5,2);
  v_overhead_rate numeric(5,2);
  v_buffer_margin_rate numeric(5,2);
  v_commission_rate numeric(5,2);
  v_vat_rate numeric(5,2);
  v_subtotal numeric(14,2);
  v_vat_amount numeric(14,2);
begin
  select coalesce(sum(line_total), 0)
  into v_cost
  from public.quotation_items
  where quotation_id = p_quotation_id;

  select
    profit_margin_rate,
    overhead_rate,
    buffer_margin_rate,
    commission_rate,
    vat_rate
  into
    v_profit_margin_rate,
    v_overhead_rate,
    v_buffer_margin_rate,
    v_commission_rate,
    v_vat_rate
  from public.quotations
  where id = p_quotation_id;

  if not found then
    return;
  end if;

  v_subtotal := round(v_cost * (
    1 + v_profit_margin_rate / 100 + v_overhead_rate / 100
      + v_buffer_margin_rate / 100 + v_commission_rate / 100
  ), 2);
  v_vat_amount := round(v_subtotal * v_vat_rate / 100, 2);

  update public.quotations
  set
    total_cost = v_cost,
    subtotal = v_subtotal,
    vat_amount = v_vat_amount,
    total_amount = v_subtotal + v_vat_amount
  where id = p_quotation_id;
end;
$$;
