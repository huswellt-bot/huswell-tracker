-- Fix the quotation-gallery wrapper added in 092. The five-argument draft
-- function's p_has_illustrations argument refers only to legacy per-item
-- images; quotation-level gallery images are validated separately below.
-- Run after 092_price_quotation_illustration_gallery.sql.

create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean,
  p_quotation_illustrations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote_id uuid;
  v_has_legacy_item_illustrations boolean;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Add at least one item before saving the quotation';
  end if;

  -- Do not let a gallery image trigger the legacy per-item validation. The
  -- gallery is checked by save_price_quotation_illustrations after the quote
  -- and its line items have been saved.
  select exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where nullif(btrim(coalesce(item.value ->> 'image_url', '')), '') is not null
  ) into v_has_legacy_item_illustrations;

  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    v_has_legacy_item_illustrations
  );
  perform public.save_price_quotation_illustrations(
    v_quote_id,
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );
  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) to authenticated;
