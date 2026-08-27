-- General Manager costing review workflow and Project Officer costing form.
-- Run after migration 029. This is additive and safe for existing records.

alter table public.quotations
  add column if not exists client_name text,
  add column if not exists client_phone text;

alter table public.business_settings
  add column if not exists company_policies text not null default '';

-- A costing may now be created directly from the Client Information fields.
-- Older costings linked to Leads / Projects remain valid.
create or replace function public.validate_quotation_document_workflow()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare source_status text; source_type text;
begin
  if new.document_type='costing_breakdown'
    and new.lead_id is null
    and nullif(btrim(coalesce(new.client_name,'')), '') is null then
    raise exception 'A Costing Breakdown requires client information';
  end if;

  if new.document_type='price_quotation' and new.costing_source_id is null then
    raise exception 'A Price Quotation must be created from an approved Costing Breakdown';
  end if;

  if new.document_type='price_quotation' then
    select status::text, document_type into source_status, source_type
      from public.quotations
      where id=new.costing_source_id and organization_id=new.organization_id;
    if source_type is distinct from 'costing_breakdown' or source_status is distinct from 'approved' then
      raise exception 'A Price Quotation requires an approved Costing Breakdown';
    end if;
  end if;
  return new;
end;
$$;

-- Project Officers can read the central material list but only the General
-- Manager may create, edit, or remove materials.
alter table public.inventory_items enable row level security;
drop policy if exists "inventory_items: members read" on public.inventory_items;
drop policy if exists "inventory_items: members insert" on public.inventory_items;
drop policy if exists "inventory_items: members update" on public.inventory_items;
drop policy if exists "inventory_items: members delete" on public.inventory_items;
drop policy if exists "inventory items: role read" on public.inventory_items;
drop policy if exists "inventory items: general manager write" on public.inventory_items;
create policy "inventory items: role read" on public.inventory_items for select to authenticated
using ((select private.has_text_role(organization_id, array['owner','admin','project_manager'])));
create policy "inventory items: general manager write" on public.inventory_items for all to authenticated
using ((select private.has_text_role(organization_id, array['owner','admin'])))
with check ((select private.has_text_role(organization_id, array['owner','admin'])));

-- Project Officers own only their Costing Breakdowns. General Managers create
-- Price Quotations and may review every organization costing.
create or replace function private.can_view_price_quotation_from_own_costing(
  target_quotation_id uuid
)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists (
    select 1
    from public.quotations price
    join public.quotations costing on costing.id=price.costing_source_id
    where price.id=target_quotation_id
      and price.document_type='price_quotation'
      and costing.created_by=(select auth.uid())
  );
$$;
grant execute on function private.can_view_price_quotation_from_own_costing(uuid) to authenticated;

drop policy if exists "quotations: creator or owner read" on public.quotations;
drop policy if exists "quotations: creator or owner insert" on public.quotations;
drop policy if exists "quotations: creator or owner update" on public.quotations;
drop policy if exists "quotations: creator or owner delete" on public.quotations;
drop policy if exists "quotations: members read" on public.quotations;
drop policy if exists "quotations: members insert" on public.quotations;
drop policy if exists "quotations: members update" on public.quotations;
drop policy if exists "quotations: members delete" on public.quotations;
drop policy if exists "quotations: authorized update" on public.quotations;
drop policy if exists "quotations: workflow read" on public.quotations;
drop policy if exists "quotations: workflow insert" on public.quotations;
drop policy if exists "quotations: workflow update" on public.quotations;
drop policy if exists "quotations: workflow delete" on public.quotations;
create policy "quotations: workflow read" on public.quotations for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (created_by=(select auth.uid()) and document_type='costing_breakdown')
  or (select private.can_view_price_quotation_from_own_costing(id))
);
create policy "quotations: workflow insert" on public.quotations for insert to authenticated with check (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    (select private.has_text_role(organization_id, array['project_manager']))
    and created_by=(select auth.uid()) and document_type='costing_breakdown'
  )
);
create policy "quotations: workflow update" on public.quotations for update to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (created_by=(select auth.uid()) and document_type='costing_breakdown')
) with check (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    (select private.has_text_role(organization_id, array['project_manager']))
    and created_by=(select auth.uid()) and document_type='costing_breakdown'
  )
);
create policy "quotations: workflow delete" on public.quotations for delete to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (
    (select private.has_text_role(organization_id, array['project_manager']))
    and created_by=(select auth.uid()) and document_type='costing_breakdown'
  )
);

-- A Project Officer can view the quotation lines created by the General
-- Manager when the quotation came from that officer's Costing Breakdown.
alter table public.quotation_items enable row level security;
drop policy if exists "quotation items: creator or owner read" on public.quotation_items;
drop policy if exists "quotation items: workflow read" on public.quotation_items;
create policy "quotation items: workflow read" on public.quotation_items for select to authenticated using (
  exists (
    select 1 from public.quotations q
    where q.id=quotation_id and (
      (select private.has_text_role(q.organization_id, array['owner','admin']))
      or q.created_by=(select auth.uid())
      or (q.document_type='price_quotation' and exists (
        select 1 from public.quotations source
        where source.id=q.costing_source_id and source.created_by=(select auth.uid())
      ))
    )
  )
);
