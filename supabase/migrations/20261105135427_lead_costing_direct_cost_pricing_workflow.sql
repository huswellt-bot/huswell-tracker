begin;

-- Seed each printing quotation with one internal costing table per line. The
-- line stores the direct production cost only; GM pricing defaults are applied
-- later by the existing Price Quotation review/final-approval functions.
create or replace function private.seed_lead_costing_printing_product_costings(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_quote public.quotations%rowtype;
  v_costings jsonb;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
    and quotation_source = 'lead_costing_printing'
  for update;

  if not found then
    raise exception 'Printing quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['lead_coordinator', 'super_admin', 'owner', 'admin']) then
    raise exception 'You are not authorized to prepare this printing quotation';
  end if;
  if v_quote.created_by is distinct from (select auth.uid())
     and not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the coordinator who prepared this quotation can prepare its costing';
  end if;
  if not exists (select 1 from public.quotation_items where quotation_id = p_quotation_id) then
    raise exception 'Add at least one printing line before submitting';
  end if;
  if exists (
    select 1
    from public.quotation_items item
    where item.quotation_id = p_quotation_id
      and coalesce((item.costing_metadata ->> 'production_cost')::numeric, -1) < 0
  ) then
    raise exception 'Printing direct cost cannot be negative';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'quotation_item_id', item.id,
      'pricing_model', 'target_margin',
      'internal_vat_rate', 0,
      'vat_locked', true,
      'vat_inclusive', false,
      'vat_rate_snapshot', 0,
      'cost_lines', jsonb_build_array(jsonb_build_object(
        'description', 'Direct printing production cost',
        'calculation_type', 'fixed_amount',
        'quantity', 1,
        'unit_cost', round(coalesce((item.costing_metadata ->> 'production_cost')::numeric, 0) * item.quantity, 2),
        'amount', round(coalesce((item.costing_metadata ->> 'production_cost')::numeric, 0) * item.quantity, 2)
      )),
      'markups', '[]'::jsonb
    ) order by item.sort_order
  ), '[]'::jsonb)
  into v_costings
  from public.quotation_items item
  where item.quotation_id = p_quotation_id;

  perform private.apply_product_costings_before_va_scope(
    v_quote.organization_id,
    p_quotation_id,
    v_costings,
    null
  );
end;
$function$;

-- Pixel dimensions are valid when the calculator has supplied a positive DPI.
-- Physical conversion and validation happen in the Lead Costing calculation
-- before the quotation line is saved.
create or replace function public.submit_lead_costing_printing_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.quotation_source <> 'lead_costing_printing' then
    raise exception 'Printing quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['lead_coordinator'])
     or v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the coordinator who prepared this quotation can submit it';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned printing quotations can be submitted';
  end if;
  if not exists (select 1 from public.quotation_items where quotation_id = v_quote.id) then
    raise exception 'Add at least one printing line before submitting';
  end if;

  perform private.seed_lead_costing_printing_product_costings(v_quote.id);

  update public.quotations
  set status = 'pending_gm_approval',
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      revision_requested_to = null
  where id = v_quote.id;

  insert into public.approval_requests (organization_id, resource_type, resource_id, status, submitted_by, submitted_at)
  values (v_quote.organization_id, 'quotation', v_quote.id, 'pending', (select auth.uid()), now())
  on conflict (resource_type, resource_id) do update
  set status = 'pending', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
      decided_by = null, decided_at = null, decision_note = null;
end;
$function$;

-- Pricing Officers can reuse saved direct computations as a cost line without
-- receiving unrestricted read access to the Lead Costing tables. The filter
-- excludes legacy rows that already contain a selling price or margin, which
-- prevents importing an amount that already includes markup.
create or replace function public.list_lead_costing_print_computations(p_organization_id uuid)
returns table (
  id uuid,
  order_no text,
  order_date date,
  customer_name text,
  order_description text,
  width numeric,
  height numeric,
  measurement_unit text,
  resolution_dpi numeric,
  quantity integer,
  direct_cost_per_item numeric,
  total_production_cost numeric,
  stock_fit_status text
)
language sql
stable
security definer
set search_path = public, private
as $function$
  select
    costing.id,
    costing.order_no,
    costing.order_date,
    costing.customer_name,
    costing.order_description,
    costing.width,
    costing.height,
    costing.measurement_unit,
    costing.resolution_dpi,
    costing.quantity,
    costing.direct_cost_per_item,
    costing.total_production_cost,
    costing.stock_fit_status
  from public.lead_costing_orders costing
  where costing.organization_id = p_organization_id
    and private.has_text_role(
      p_organization_id,
      array['lead_coordinator', 'pricing_officer', 'sales_pricing_officer', 'super_admin', 'owner', 'admin']
    )
    and coalesce(costing.target_margin, 0) = 0
    and coalesce(costing.selling_price_per_item, 0) = 0
    and coalesce(costing.total_quotation, 0) = 0
  order by costing.order_date desc, costing.created_at desc
  limit 250;
$function$;

revoke all on function public.list_lead_costing_print_computations(uuid) from public, anon;
grant execute on function public.list_lead_costing_print_computations(uuid) to authenticated;

revoke all on function public.submit_lead_costing_printing_quotation(uuid) from public, anon;
grant execute on function public.submit_lead_costing_printing_quotation(uuid) to authenticated;

commit;
