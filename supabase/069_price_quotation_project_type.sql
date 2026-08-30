-- Let Sales Project Officers save the project type on direct Price Quotations.
-- The quotations table already has project_types, so this only extends the
-- existing draft-save workflow and is safe to run after migration 063.

create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote_id uuid;
begin
  if nullif(btrim(coalesce(p_project_type, '')), '') is null then
    raise exception 'Enter the project type before saving the quotation';
  end if;

  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_items
  );

  update public.quotations
  set project_types = btrim(p_project_type)
  where id = v_quote_id;

  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb) to authenticated;
