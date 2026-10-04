-- Run after 183_costing_revision_only.sql and immediately after deploying the
-- matching Print Costing role-visibility update.
--
-- Pricing Officers can see their own drafts. General Managers can see only
-- submitted, returned, and approved requests; draft records and their child
-- data/source files remain unavailable to management through RLS and storage.

begin;

drop policy if exists "costing requests: authorized read" on public.costing_requests;
create policy "costing requests: authorized read"
on public.costing_requests for select to authenticated
using (
  (
    status <> 'draft'
    and private.has_text_role(organization_id, array['super_admin', 'owner', 'admin'])
  )
  or (
    prepared_by = (select auth.uid())
    and private.has_text_role(organization_id, array['sales_pricing_officer'])
  )
);

drop policy if exists "costing request items: authorized read" on public.costing_request_items;
create policy "costing request items: authorized read"
on public.costing_request_items for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        (
          request.status <> 'draft'
          and private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        )
        or (
          request.prepared_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
      )
  )
);

drop policy if exists "costing request materials: authorized read" on public.costing_request_materials;
create policy "costing request materials: authorized read"
on public.costing_request_materials for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        (
          request.status <> 'draft'
          and private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        )
        or (
          request.prepared_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
      )
  )
);

drop policy if exists "costing request additional costs: authorized read" on public.costing_request_additional_costs;
create policy "costing request additional costs: authorized read"
on public.costing_request_additional_costs for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        (
          request.status <> 'draft'
          and private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        )
        or (
          request.prepared_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
      )
  )
);

drop policy if exists "costing request events: authorized read" on public.costing_request_events;
create policy "costing request events: authorized read"
on public.costing_request_events for select to authenticated
using (
  exists (
    select 1
    from public.costing_requests request
    where request.id = request_id
      and request.organization_id = organization_id
      and (
        (
          request.status <> 'draft'
          and private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        )
        or (
          request.prepared_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
      )
  )
);

create or replace function private.guard_costing_request_draft_access()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'draft'
     and (
       new.prepared_by is distinct from (select auth.uid())
       or not exists (
         select 1
         from public.organization_members member
         where member.organization_id = new.organization_id
           and member.user_id = (select auth.uid())
           and member.role::text = 'sales_pricing_officer'
       )
     ) then
    raise exception 'Only the Pricing Officer who is preparing the costing can create a draft';
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'draft'
     and old.prepared_by is distinct from (select auth.uid()) then
    raise exception 'Only the Pricing Officer who prepared a draft can change it';
  end if;

  return new;
end;
$$;

drop trigger if exists costing_request_draft_access_guard on public.costing_requests;
create trigger costing_request_draft_access_guard
before insert or update on public.costing_requests
for each row execute function private.guard_costing_request_draft_access();

create or replace function public.create_costing_request_revision(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_source public.costing_requests%rowtype;
  v_revision_id uuid;
begin
  select * into v_source
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if v_source.prepared_by is distinct from (select auth.uid()) then
    raise exception 'Only the Pricing Officer who prepared this costing can create a revision';
  end if;
  if v_source.status <> 'approved' then
    raise exception 'Only an approved costing request can be revised';
  end if;

  insert into public.costing_requests (
    organization_id, request_no, source_file_name, source_storage_path,
    source_mime_type, source_file_size, client_name, client_contact_name,
    client_phone, project_name, notes, hp_latex_rate, waste_allowance,
    formula_version, extraction_json, status, prepared_by, revision_of,
    revision_number
  ) values (
    v_source.organization_id,
    'CR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    v_source.source_file_name, v_source.source_storage_path,
    v_source.source_mime_type, v_source.source_file_size, v_source.client_name,
    v_source.client_contact_name, v_source.client_phone, v_source.project_name,
    v_source.notes, v_source.hp_latex_rate, v_source.waste_allowance,
    v_source.formula_version, v_source.extraction_json, 'draft',
    v_source.prepared_by, p_request_id,
    v_source.revision_number + 1
  ) returning id into v_revision_id;

  insert into public.costing_request_items (
    organization_id, request_id, material_category, item_description,
    width_mm, height_mm, quantity, finish, extraction_confidence,
    source_page, sort_order
  ) select organization_id, v_revision_id, material_category, item_description,
    width_mm, height_mm, quantity, finish, extraction_confidence, source_page, sort_order
  from public.costing_request_items
  where request_id = p_request_id;

  insert into public.costing_request_materials (
    organization_id, request_id, material_category, display_name,
    roll_width_m, roll_length_m, roll_cost, required_rolls,
    linear_meters_used, sort_order
  ) select organization_id, v_revision_id, material_category, display_name,
    roll_width_m, roll_length_m, roll_cost, required_rolls,
    linear_meters_used, sort_order
  from public.costing_request_materials
  where request_id = p_request_id;

  insert into public.costing_request_additional_costs
    (organization_id, request_id, label, amount, note, sort_order)
  select organization_id, v_revision_id, label, amount, note, sort_order
  from public.costing_request_additional_costs
  where request_id = p_request_id;

  perform private.refresh_costing_request_calculation(v_revision_id);
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id, note)
  values
    (v_source.organization_id, v_revision_id, 'revision_created', null, 'draft', (select auth.uid()), p_request_id::text);
  return v_revision_id;
end;
$$;

drop policy if exists "costing source documents: authorized read" on storage.objects;
create policy "costing source documents: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and exists (
    select 1
    from public.costing_requests request
    where request.source_storage_path = storage.objects.name
      and split_part(storage.objects.name, '/', 1) = request.organization_id::text
      and (
        (
          request.status <> 'draft'
          and private.has_text_role(request.organization_id, array['super_admin', 'owner', 'admin'])
        )
        or (
          request.prepared_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
      )
  )
);

drop policy if exists "costing source documents: preparer upload" on storage.objects;
create policy "costing source documents: preparer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id::text = split_part(name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text = 'sales_pricing_officer'
  )
);

drop policy if exists "costing source documents: preparer delete" on storage.objects;
create policy "costing source documents: preparer delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'costing-source-documents'
  and split_part(name, '/', 2) = 'costing-requests'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id::text = split_part(name, '/', 1)
      and member.user_id = (select auth.uid())
      and member.role::text = 'sales_pricing_officer'
  )
);

commit;
