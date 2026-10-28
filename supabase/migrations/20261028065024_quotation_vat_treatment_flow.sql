begin;

alter table public.quotations
  add column if not exists vat_inclusive boolean not null default false;

alter table public.quotations
  add column if not exists vat_rate_snapshot numeric(5,2) not null default 0;

alter table public.quotations
  drop constraint if exists quotations_vat_rate_snapshot_check;

alter table public.quotations
  add constraint quotations_vat_rate_snapshot_check
  check (vat_rate_snapshot between 0 and 100);

-- Preserve historical totals. Existing records with an applied VAT rate are
-- treated as inclusive; pending records without one receive the current GM
-- VAT default as their editable snapshot but remain VAT Exclusive.
update public.quotations
set vat_inclusive = coalesce(vat_rate, 0) > 0,
    vat_rate_snapshot = greatest(least(coalesce(vat_rate, 0), 100), 0)
where vat_rate_snapshot = 0
  and coalesce(vat_rate, 0) <> 0;

update public.quotations q
set vat_rate_snapshot = greatest(least(coalesce(
      (
        select nullif(entry.value ->> 'value', '')::numeric
        from public.business_settings settings
        cross join jsonb_each(coalesce(settings.pricing_markup_defaults, '{}'::jsonb)) entry(key, value)
        where settings.organization_id = q.organization_id
          and private.pricing_markup_purpose(entry.key, entry.value) = 'vat'
        limit 1
      ),
      (
        select settings.vat_rate
        from public.business_settings settings
        where settings.organization_id = q.organization_id
      ),
      0
    ), 100), 0)
where q.status::text in ('pending', 'pending_gm_approval', 'needs_revision')
  and coalesce(q.vat_rate, 0) = 0;

create or replace function public.set_price_quotation_vat_preferences(
  p_quotation_id uuid,
  p_vat_inclusive boolean,
  p_vat_rate numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_default_rate numeric := 0;
  v_rate numeric;
  v_is_gm boolean;
begin
  select *
  into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;

  if v_quote.status::text not in ('pending', 'pending_gm_approval', 'needs_revision') then
    raise exception 'This quotation is not awaiting VAT review';
  end if;

  v_is_gm := private.has_text_role(
    v_quote.organization_id,
    array['super_admin', 'owner', 'admin']
  );

  select coalesce(
    (
      select nullif(entry.value ->> 'value', '')::numeric
      from jsonb_each(coalesce(settings.pricing_markup_defaults, '{}'::jsonb)) entry(key, value)
      where private.pricing_markup_purpose(entry.key, entry.value) = 'vat'
      limit 1
    ),
    settings.vat_rate,
    0
  )
  into v_default_rate
  from public.business_settings settings
  where settings.organization_id = v_quote.organization_id;

  v_default_rate := greatest(least(v_default_rate, 100), 0);

  if v_is_gm then
    if v_quote.status::text not in ('pending_gm_approval', 'pending') then
      raise exception 'Only a quotation awaiting GM approval can be finalized';
    end if;
    v_rate := greatest(least(coalesce(p_vat_rate, v_default_rate), 100), 0);
  else
    if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
      or not private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
      or v_quote.status::text not in ('pending', 'needs_revision')
      or (v_quote.status::text = 'needs_revision' and v_quote.revision_requested_to <> 'pricing_officer') then
      raise exception 'Only the assigned Sales & Pricing Officer can choose VAT treatment';
    end if;
    v_rate := v_default_rate;
  end if;

  update public.quotations
  set vat_inclusive = coalesce(p_vat_inclusive, false),
      vat_rate_snapshot = v_rate,
      vat_rate = case when coalesce(p_vat_inclusive, false) then v_rate else 0 end,
      vat_calculation_type = 'percentage',
      vat_fixed_amount = 0
  where id = p_quotation_id;
end;
$$;

revoke all on function public.set_price_quotation_vat_preferences(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_price_quotation_vat_preferences(uuid, boolean, numeric) to authenticated;

commit;
