begin;

-- The Pricing Officer VAT-preference RPC validates the assigned officer before
-- updating the quotation. Mark only that transaction-local update so the
-- legacy monetary-field trigger does not mistake it for a direct edit.
create or replace function public.enforce_price_quotation_preparation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and coalesce(new.quotation_source, 'standard') <> 'lead_costing_printing'
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
      if coalesce(
        current_setting('huswell.pricing_officer_vat_preference_rpc', true),
        'off'
      ) = 'on' then
        return new;
      end if;

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
      ) then
        return new;
      end if;

      raise exception 'Only the General Manager can set quotation prices or totals';
    end if;
  end if;

  return new;
end;
$$;

-- GM Settings remains the starting VAT rate. The General Manager may adjust
-- that rate for an individual quotation during final approval. Pricing
-- Officers remain restricted to the organization VAT setting.
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

    -- The trigger is intentionally retained for direct table writes. This
    -- flag exists only after the RPC's role, assignment, and status checks.
    perform set_config('huswell.pricing_officer_vat_preference_rpc', 'on', true);
  end if;

  update public.quotations
  set vat_inclusive = coalesce(p_vat_inclusive, false),
      vat_rate_snapshot = v_rate,
      vat_rate = case when coalesce(p_vat_inclusive, false) then v_rate else 0 end,
      vat_calculation_type = 'percentage',
      vat_fixed_amount = 0
  where id = p_quotation_id;

  if not v_is_gm then
    perform set_config('huswell.pricing_officer_vat_preference_rpc', 'off', true);
  end if;
end;
$$;

revoke all on function public.enforce_price_quotation_preparation() from public;
revoke all on function public.set_price_quotation_vat_preferences(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_price_quotation_vat_preferences(uuid, boolean, numeric) to authenticated;

commit;
