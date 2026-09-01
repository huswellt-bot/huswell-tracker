-- Store up to five quotation-level illustrations independently from quotation
-- line items. Run after 091_require_dropped_client_reason.sql.

create table if not exists public.price_quotation_illustrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  image_url text not null check (btrim(image_url) <> ''),
  sort_order integer not null check (sort_order between 0 and 4),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (quotation_id, sort_order)
);

alter table public.price_quotation_illustrations enable row level security;

drop policy if exists "price quotation illustrations: workflow read" on public.price_quotation_illustrations;
create policy "price quotation illustrations: workflow read"
on public.price_quotation_illustrations for select to authenticated using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1 from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
      )
  )
);

create or replace function public.save_price_quotation_illustrations(
  p_quotation_id uuid,
  p_illustrations jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_count integer;
begin
  if jsonb_typeof(p_illustrations) <> 'array' then
    raise exception 'Quotation illustrations must be an array';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_illustrations);
  if v_count > 5 then
    raise exception 'A Price Quotation can have a maximum of five illustrations';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_illustrations) as illustration(value)
    where nullif(btrim(coalesce(illustration.value ->> 'image_url', '')), '') is null
  ) then
    raise exception 'Each quotation illustration requires an uploaded image';
  end if;

  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
    and (
      not private.has_text_role(v_quote.organization_id, array['project_manager'])
      or (v_quote.created_by is distinct from (select auth.uid())
        and v_quote.prepared_by_user_id is distinct from (select auth.uid()))
    ) then
    raise exception 'Only the Price Quotation preparer can save illustrations';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Illustrations can only be changed while the Price Quotation is editable';
  end if;

  delete from public.price_quotation_illustrations where quotation_id = v_quote.id;
  insert into public.price_quotation_illustrations (
    organization_id, quotation_id, image_url, sort_order, created_by
  )
  select
    v_quote.organization_id,
    v_quote.id,
    btrim(illustration.value ->> 'image_url'),
    illustration.ordinality - 1,
    (select auth.uid())
  from jsonb_array_elements(p_illustrations) with ordinality as illustration(value, ordinality);
end;
$$;

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
begin
  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    p_has_illustrations
  );
  perform public.save_price_quotation_illustrations(
    v_quote_id,
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );
  return v_quote_id;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'price_quotation_illustrations'
  ) then
    alter publication supabase_realtime add table public.price_quotation_illustrations;
  end if;
end $$;

revoke all on function public.save_price_quotation_illustrations(uuid, jsonb) from public;
grant execute on function public.save_price_quotation_illustrations(uuid, jsonb) to authenticated;
revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean, jsonb) to authenticated;
