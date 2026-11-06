-- Lead Costing Printing Quotations use a dedicated Lead Coordinator -> GM
-- workflow. The legacy project-officer quotation guards must not block their
-- draft/item writes or direct-cost total snapshots.

create or replace function public.enforce_project_officer_price_quotation_content()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and coalesce(new.quotation_source, 'standard') <> 'lead_costing_printing'
    and not private.has_text_role(new.organization_id, array['project_manager']) then
    if tg_op = 'INSERT' then
      raise exception 'Only a Sales Project Officer can prepare a Price Quotation';
    end if;

    if new.lead_id is distinct from old.lead_id
      and not (
        new.lead_id is null
        and old.lead_id is not null
        and coalesce(
          current_setting('huswell.allow_price_quotation_lead_unlink', true),
          'off'
        ) = 'on'
      )
      or new.client_name is distinct from old.client_name
      or new.client_contact_name is distinct from old.client_contact_name
      or new.client_phone is distinct from old.client_phone
      or new.client_address is distinct from old.client_address
      or new.project_name is distinct from old.project_name
      or new.project_types is distinct from old.project_types
      or new.representative is distinct from old.representative
      or new.prepared_by_user_id is distinct from old.prepared_by_user_id
      or new.prepared_by_signature_url is distinct from old.prepared_by_signature_url then
      raise exception 'Only a Sales Project Officer can change Price Quotation content';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_project_officer_price_quotation_items()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_quotation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_quotation_id := old.quotation_id;
  else
    v_quotation_id := new.quotation_id;
  end if;

  select * into v_quotation
  from public.quotations
  where id = v_quotation_id;

  if found
    and v_quotation.document_type = 'price_quotation'
    and v_quotation.costing_source_id is null
    and coalesce(v_quotation.quotation_source, 'standard') <> 'lead_costing_printing'
    and not private.has_text_role(v_quotation.organization_id, array['project_manager']) then
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'Only a Sales Project Officer can change Price Quotation items';
    end if;

    if new.description is distinct from old.description
      or new.quantity is distinct from old.quantity
      or new.sort_order is distinct from old.sort_order
      or new.image_url is distinct from old.image_url then
      raise exception 'Only a Sales Project Officer can change Price Quotation items';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
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

revoke all on function public.enforce_project_officer_price_quotation_content() from public;
revoke all on function public.enforce_project_officer_price_quotation_items() from public;
revoke all on function public.enforce_price_quotation_preparation() from public;
