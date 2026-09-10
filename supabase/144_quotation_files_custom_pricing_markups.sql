-- Extend quotation attachments to support PDFs and allow General Manager
-- managed custom percentage markups. Existing quotation snapshots remain
-- unchanged; custom defaults are applied only when a new costing is
-- materialized or when the submitted costing explicitly includes them.
-- Run after 143_fix_price_quotation_deletion_with_mockups.sql and before the
-- matching application update.

begin;

-- ---------------------------------------------------------------------------
-- Public quotation illustration gallery: keep the existing public bucket and
-- URL column, while retaining the file metadata needed for PDF previews.
-- ---------------------------------------------------------------------------
alter table public.price_quotation_illustrations
  add column if not exists file_name text,
  add column if not exists content_type text;

update public.price_quotation_illustrations
set content_type = case
  when image_url ~* '\.pdf(?:$|[?#])' then 'application/pdf'
  else 'image/jpeg'
end
where content_type is null;

update public.price_quotation_illustrations
set file_name = 'illustration-' || (sort_order + 1)::text || case
  when content_type = 'application/pdf' then '.pdf'
  else '.jpg'
end
where file_name is null or btrim(file_name) = '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-images',
  'quotation-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
      or (
        nullif(btrim(coalesce(illustration.value ->> 'content_type', '')), '') is not null
        and illustration.value ->> 'content_type' not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      )
  ) then
    raise exception 'Each quotation illustration must be a JPEG, PNG, WebP, or PDF file';
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
    organization_id, quotation_id, image_url, file_name, content_type,
    sort_order, created_by
  )
  select
    v_quote.organization_id,
    v_quote.id,
    btrim(illustration.value ->> 'image_url'),
    coalesce(
      nullif(btrim(illustration.value ->> 'file_name'), ''),
      'illustration-' || illustration.ordinality::text
    ),
    coalesce(
      nullif(btrim(illustration.value ->> 'content_type'), ''),
      case when illustration.value ->> 'image_url' ~* '\.pdf(?:$|[?#])'
        then 'application/pdf' else 'image/jpeg' end
    ),
    illustration.ordinality - 1,
    (select auth.uid())
  from jsonb_array_elements(p_illustrations) with ordinality as illustration(value, ordinality);
end;
$$;

revoke all on function public.save_price_quotation_illustrations(uuid, jsonb) from public;
grant execute on function public.save_price_quotation_illustrations(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Private signed proofs: permit PDFs without making the bucket public.
-- ---------------------------------------------------------------------------
alter table public.quotation_signed_proofs
  drop constraint if exists quotation_signed_proofs_content_type_check;
alter table public.quotation_signed_proofs
  add constraint quotation_signed_proofs_content_type_check
  check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-signed-proofs',
  'quotation-signed-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quotation signed proofs: preparer upload" on storage.objects;
create policy "quotation signed proofs: preparer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotation-signed-proofs'
  and split_part(name, '/', 1) in (
    select organization_id::text
    from public.organization_members
    where user_id = (select auth.uid())
  )
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'
  and exists (
    select 1
    from public.quotations quote
    where quote.organization_id::text = split_part(name, '/', 1)
      and quote.id::text = split_part(name, '/', 2)
      and quote.status::text = 'approved'
      and quote.document_type in ('price_quotation', 'mockup_quotation')
      and private.has_text_role(quote.organization_id, array['project_manager'])
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
      )
  )
);

create or replace function public.register_quotation_signed_proof(
  p_quotation_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_proof_id uuid;
  v_sort_order integer;
  v_file_name text := nullif(btrim(coalesce(p_file_name, '')), '');
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or v_quote.status::text <> 'approved' then
    raise exception 'Signed proof can only be added to an approved quotation';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager']) then
    raise exception 'Only a Sales Project Officer can upload a signed proof';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_quote.id::text || ':signed-proof', 0)
  );
  if v_quote.created_by is distinct from (select auth.uid())
    and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the Sales Project Officer who prepared this quotation can upload its signed proof';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    or coalesce(p_file_size, 0) <= 0
    or p_file_size > 10485760 then
    raise exception 'Signed proof must be a JPEG, PNG, WebP, or PDF file no larger than 10 MB';
  end if;
  if v_file_name is null or length(v_file_name) > 255 then
    raise exception 'Enter a valid signed proof file name';
  end if;
  if p_storage_path !~* (
    '^' || v_quote.organization_id::text || '/'
    || v_quote.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'
  ) then
    raise exception 'Signed proof storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'quotation-signed-proofs'
      and name = p_storage_path
  ) then
    raise exception 'Upload the signed proof file before registering it';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.quotation_signed_proofs
  where quotation_id = v_quote.id;
  if v_sort_order > 4 then
    raise exception 'A quotation can have a maximum of five signed proof files';
  end if;

  insert into public.quotation_signed_proofs (
    organization_id,
    quotation_id,
    storage_path,
    file_name,
    content_type,
    file_size,
    sort_order,
    uploaded_by
  )
  values (
    v_quote.organization_id,
    v_quote.id,
    p_storage_path,
    v_file_name,
    p_content_type,
    p_file_size,
    v_sort_order,
    (select auth.uid())
  )
  returning id into v_proof_id;
  return v_proof_id;
end;
$$;

revoke all on function public.register_quotation_signed_proof(uuid, text, text, text, bigint) from public;
grant execute on function public.register_quotation_signed_proof(uuid, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Pricing defaults: preserve the fixed defaults, permit custom_* percentage
-- categories, and retain a GM-only visibility flag for review presentation.
-- ---------------------------------------------------------------------------
create or replace function private.validate_pricing_markup_defaults(p_defaults jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_entry jsonb;
  v_type text;
  v_value numeric;
begin
  if coalesce(jsonb_typeof(p_defaults), '') <> 'object' then
    raise exception 'Pricing defaults must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_defaults) as supplied(key)
    where supplied.key not in (
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'incentives', 'discounts', 'third_party_markup', 'vat'
    )
    and supplied.key !~ '^custom_[0-9a-f-]{36}$'
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'incentives', 'third_party_markup', 'vat'
  ] loop
    if not (p_defaults ? v_key) then
      raise exception 'Missing pricing default: %', v_key;
    end if;
  end loop;

  for v_key, v_entry in
    select key, value from jsonb_each(p_defaults)
  loop
    if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
      raise exception 'Pricing default % must be an object', v_key;
    end if;
    if v_key ~ '^custom_' and nullif(btrim(coalesce(v_entry ->> 'label', '')), '') is null then
      raise exception 'Custom pricing defaults need a name';
    end if;
    if (v_entry ? 'visible') and jsonb_typeof(v_entry -> 'visible') <> 'boolean' then
      raise exception 'Pricing default % visibility must be true or false', v_key;
    end if;
    v_type := coalesce(v_entry ->> 'calculation_type', 'percentage');
    if v_type <> 'percentage' then
      raise exception 'Pricing default % must use percentage basis', v_key;
    end if;
    begin
      if v_entry ->> 'value' is null then
        raise exception 'Pricing default % needs a valid numeric value', v_key;
      end if;
      v_value := (v_entry ->> 'value')::numeric;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value < 0 or v_value > 100 then
      raise exception 'Pricing default % must be between 0%% and 100%%', v_key;
    end if;
    if v_key = 'target_profit_margin' and v_value >= 100 then
      raise exception 'Pricing default % must be below 100%%', v_key;
    end if;
  end loop;
end;
$$;

-- Apply every current organization default, including custom markups, when a
-- new quotation is first materialized by the assigned Pricing Officer. The
-- hidden flag is deliberately ignored here: it only controls the GM view.
create or replace function private.apply_product_costings(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_costings jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing jsonb;
  v_line jsonb;
  v_markup jsonb;
  v_default record;
  v_item_id uuid;
  v_costing_id uuid;
  v_item_quantity numeric;
  v_pricing_model text;
  v_calculation_type text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_markup_type text;
  v_value numeric;
  v_markup_key text;
  v_markup_label text;
  v_entry jsonb;
  v_default_markups jsonb := '[]'::jsonb;
  v_normalized_costings jsonb;
  v_settings public.business_settings%rowtype;
  v_had_existing_costings boolean := false;
  v_use_pricing_defaults boolean := false;
  v_saved_costing jsonb;
  v_result jsonb;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_index integer;
begin
  if coalesce(jsonb_typeof(p_costings), '') <> 'array'
    or coalesce(jsonb_array_length(p_costings), 0) = 0 then
    raise exception 'Add one costing table for every quotation product';
  end if;
  if jsonb_array_length(p_costings) <> (select count(*) from public.quotation_items where quotation_id = p_quotation_id) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  select exists (
    select 1
    from public.price_quotation_product_costings
    where quotation_id = p_quotation_id
  ) into v_had_existing_costings;
  select * into v_settings
  from public.business_settings
  where organization_id = p_organization_id;
  v_settings.pricing_markup_defaults := coalesce(
    v_settings.pricing_markup_defaults,
    jsonb_build_object(
      'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
      'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
      'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
      'sales_commission', jsonb_build_object('label', 'Sales Commission', 'calculation_type', 'percentage', 'value', 0),
      'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
      'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15)
    )
  );
  v_use_pricing_defaults := not v_had_existing_costings
    and p_actor is not null
    and p_actor = (select auth.uid())
    and private.has_text_role(p_organization_id, array['pricing_officer'])
    and not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']);
  if v_use_pricing_defaults then
    for v_default in
      select entries.key, entries.value
      from jsonb_each(v_settings.pricing_markup_defaults) as entries(key, value)
      where entries.key not in ('vat', 'discounts')
      order by case entries.key
        when 'target_profit_margin' then 1
        when 'overhead_allocation' then 2
        when 'contingency_allowance' then 3
        when 'sales_commission' then 4
        when 'incentives' then 5
        when 'third_party_markup' then 6
        else 100
      end, entries.key
    loop
      v_markup_key := v_default.key;
      v_entry := v_default.value;
      v_markup_type := 'percentage';
      v_value := coalesce((v_entry ->> 'value')::numeric, 0);
      v_markup_label := coalesce(nullif(v_entry ->> 'label', ''), initcap(replace(v_markup_key, '_', ' ')));
      v_default_markups := v_default_markups || jsonb_build_array(jsonb_build_object(
        'markup_key', v_markup_key,
        'label', v_markup_label,
        'calculation_type', v_markup_type,
        'value', v_value,
        'rate', v_value,
        'amount', 0
      ));
    end loop;
  end if;

  v_normalized_costings := p_costings;
  v_index := 0;

  for v_costing in select value from jsonb_array_elements(p_costings) loop
    begin
      v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each costing table must be linked to a quotation product';
    end;
    if v_item_id = any(v_seen_item_ids) then
      raise exception 'A quotation product can have only one costing table';
    end if;
    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);
    select quantity into v_item_quantity
    from public.quotation_items
    where id = v_item_id and quotation_id = p_quotation_id
    for update;
    if not found or coalesce(v_item_quantity, 0) <= 0 then
      raise exception 'Each costing table must be linked to a quotation product with a quantity';
    end if;
    if v_use_pricing_defaults
      and coalesce(v_costing ->> 'pricing_model', 'target_margin') = 'target_margin' then
      v_costing := jsonb_set(v_costing, '{markups}', v_default_markups, true);
      v_normalized_costings := jsonb_set(v_normalized_costings, array[v_index::text, 'markups'], v_default_markups, true);
    end if;
    v_result := private.calculate_product_costing(v_costing);
    v_index := v_index + 1;
  end loop;

  if exists (
    select 1 from public.quotation_items item
    where item.quotation_id = p_quotation_id and not (item.id = any(v_seen_item_ids))
  ) then
    raise exception 'Add one costing table for every quotation product';
  end if;

  delete from public.price_quotation_product_costings where quotation_id = p_quotation_id;

  for v_costing in select value from jsonb_array_elements(v_normalized_costings) loop
    v_item_id := (v_costing ->> 'quotation_item_id')::uuid;
    v_pricing_model := case when coalesce(v_costing ->> 'pricing_model', 'target_margin') = 'legacy_markup' then 'legacy_markup' else 'target_margin' end;
    insert into public.price_quotation_product_costings (
      organization_id, quotation_id, quotation_item_id, created_by, pricing_model, updated_at
    ) values (
      p_organization_id, p_quotation_id, v_item_id, p_actor, v_pricing_model, now()
    ) returning id into v_costing_id;

    v_index := 0;
    for v_line in select value from jsonb_array_elements(v_costing -> 'cost_lines') loop
      v_calculation_type := coalesce(nullif(btrim(coalesce(v_line ->> 'calculation_type', '')), ''), 'quantity_unit_cost');
      if v_calculation_type = 'fixed_amount' then
        v_quantity := 1;
        v_unit_cost := coalesce((v_line ->> 'amount')::numeric, (v_line ->> 'unit_cost')::numeric);
      else
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_cost := (v_line ->> 'unit_cost')::numeric;
      end if;
      insert into public.price_quotation_costing_lines (
        organization_id, product_costing_id, description, calculation_type,
        quantity, unit_cost, sort_order
      ) values (
        p_organization_id, v_costing_id, btrim(v_line ->> 'description'),
        v_calculation_type, v_quantity, v_unit_cost, v_index
      );
      v_index := v_index + 1;
    end loop;

    v_index := 0;
    for v_markup in select value from jsonb_array_elements(coalesce(v_costing -> 'markups', '[]'::jsonb)) loop
      v_markup_type := coalesce(nullif(btrim(coalesce(v_markup ->> 'calculation_type', '')), ''), 'percentage');
      if v_markup_type = 'fixed_amount' then
        v_value := coalesce((v_markup ->> 'amount')::numeric, (v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, 0);
      else
        v_markup_type := 'percentage';
        v_value := coalesce((v_markup ->> 'value')::numeric, (v_markup ->> 'rate')::numeric, 0);
      end if;
      insert into public.price_quotation_costing_markups (
        organization_id, product_costing_id, markup_key, label,
        calculation_type, rate, amount, sort_order
      ) values (
        p_organization_id, v_costing_id,
        nullif(btrim(coalesce(v_markup ->> 'markup_key', '')), ''),
        btrim(v_markup ->> 'label'), v_markup_type,
        case when v_markup_type = 'percentage' then v_value else 0 end,
        case when v_markup_type = 'fixed_amount' then v_value else 0 end,
        v_index
      );
      v_index := v_index + 1;
    end loop;

    select jsonb_build_object(
      'pricing_model', pc.pricing_model,
      'internal_vat_rate', pc.internal_vat_rate,
      'cost_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'description', cl.description,
          'calculation_type', cl.calculation_type,
          'quantity', cl.quantity,
          'unit_cost', cl.unit_cost,
          'amount', cl.unit_cost
        ) order by cl.sort_order)
        from public.price_quotation_costing_lines cl
        where cl.product_costing_id = pc.id
      ), '[]'::jsonb),
      'markups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'markup_key', cm.markup_key,
          'label', cm.label,
          'calculation_type', cm.calculation_type,
          'value', case when cm.calculation_type = 'fixed_amount' then cm.amount else cm.rate end,
          'rate', cm.rate,
          'amount', cm.amount
        ) order by cm.sort_order)
        from public.price_quotation_costing_markups cm
        where cm.product_costing_id = pc.id
      ) , '[]'::jsonb)
    ) into v_saved_costing
    from public.price_quotation_product_costings pc
    where pc.id = v_costing_id;
    v_result := private.calculate_product_costing(v_saved_costing);

    select quantity into v_item_quantity from public.quotation_items where id = v_item_id;
    update public.quotation_items
    set unit_cost = round((v_result ->> 'selling_ex_vat')::numeric / nullif(v_item_quantity, 0), 2)
    where id = v_item_id;
  end loop;
end;
$$;

commit;
