-- Adds the combined Sales & Pricing Officer role and routes direct Price
-- Quotations to assigned Sales & Pricing Officers by project type.
-- Run after 114_restore_approved_quotation_project_scheduling.sql and before
-- deploying the matching application update.

-- Keep the enum change outside the transaction for compatibility with older
-- PostgreSQL versions used by some Supabase projects.
alter type public.member_role add value if not exists 'sales_pricing_officer';

begin;

-- The combined role is the only pricing-capable user type. Keep this
-- conversion here for fresh deployments; migration 116 repeats it safely for
-- databases where this migration was already applied before the role change.
update public.organization_members
set role = 'sales_pricing_officer'::public.member_role
where role::text = 'pricing_officer';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and conname = 'organization_members_no_standalone_pricing_officer'
  ) then
    alter table public.organization_members
      add constraint organization_members_no_standalone_pricing_officer
      check (role::text <> 'pricing_officer');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Sales & Pricing Officer project-type assignments.
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_officer_project_types (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pricing_officer_user_id uuid not null references auth.users(id) on delete cascade,
  project_type text not null check (project_type in (
    'Premium Rigid Box',
    'Regular Rigid Box',
    'Corrugated',
    'Offset',
    'Digital',
    'Mock Up'
  )),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, pricing_officer_user_id, project_type),
  foreign key (organization_id, pricing_officer_user_id)
    references public.organization_members(organization_id, user_id)
    on delete cascade
);

create index if not exists pricing_officer_project_types_lookup_idx
  on public.pricing_officer_project_types (
    organization_id,
    project_type,
    pricing_officer_user_id
  );

alter table public.pricing_officer_project_types enable row level security;

drop policy if exists "pricing officer assignments: read" on public.pricing_officer_project_types;
create policy "pricing officer assignments: read"
on public.pricing_officer_project_types for select to authenticated
using (
  (select private.is_org_admin(organization_id))
  or pricing_officer_user_id = (select auth.uid())
);

drop policy if exists "pricing officer assignments: admins manage" on public.pricing_officer_project_types;
create policy "pricing officer assignments: admins manage"
on public.pricing_officer_project_types for all to authenticated
using (
  (select private.is_org_admin(organization_id))
)
with check (
  (select private.is_org_admin(organization_id))
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id = pricing_officer_project_types.organization_id
      and member.user_id = pricing_officer_project_types.pricing_officer_user_id
      and member.role::text = 'sales_pricing_officer'
  )
);

create or replace function private.normalize_price_quotation_project_type(
  target_project_type text
)
returns text
language sql
immutable
set search_path = public, private
as $$
  select case regexp_replace(
    lower(btrim(coalesce(target_project_type, ''))),
    '[[:space:]]+',
    ' ',
    'g'
  )
    when 'premium rigid box' then 'Premium Rigid Box'
    when 'regular rigid box' then 'Regular Rigid Box'
    when 'corrugated' then 'Corrugated'
    when 'offset' then 'Offset'
    when 'digital' then 'Digital'
    when 'mock up' then 'Mock Up'
    when 'mockup' then 'Mock Up'
    else null
  end;
$$;

create or replace function private.is_pricing_officer_assigned(
  target_organization_id uuid,
  target_user_id uuid,
  target_project_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.pricing_officer_project_types assignment
      on assignment.organization_id = member.organization_id
     and assignment.pricing_officer_user_id = member.user_id
    where member.organization_id = target_organization_id
      and member.user_id = target_user_id
      and member.role::text = 'sales_pricing_officer'
      and assignment.project_type = private.normalize_price_quotation_project_type(target_project_type)
  );
$$;

create or replace function public.set_pricing_officer_project_types(
  p_user_id uuid,
  p_project_types text[]
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_project_types text[] := coalesce(p_project_types, array[]::text[]);
  v_invalid_type text;
begin
  select member.organization_id
    into v_organization_id
  from public.organization_members member
  where member.user_id = p_user_id
    and member.role::text = 'sales_pricing_officer'
    and private.is_org_admin(member.organization_id)
  order by member.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'Only an administrator can assign Sales & Pricing Officer project types';
  end if;

  select raw.value
    into v_invalid_type
  from unnest(v_project_types) as raw(value)
  where private.normalize_price_quotation_project_type(raw.value) is null
  limit 1;

  if v_invalid_type is not null then
    raise exception 'Unsupported Price Quotation project type: %', v_invalid_type;
  end if;

  delete from public.pricing_officer_project_types
  where organization_id = v_organization_id
    and pricing_officer_user_id = p_user_id;

  insert into public.pricing_officer_project_types (
    organization_id,
    pricing_officer_user_id,
    project_type,
    created_by
  )
  select
    v_organization_id,
    p_user_id,
    private.normalize_price_quotation_project_type(raw.value),
    (select auth.uid())
  from unnest(v_project_types) as raw(value)
  group by private.normalize_price_quotation_project_type(raw.value);
end;
$$;

revoke all on function public.set_pricing_officer_project_types(uuid, text[]) from public;
grant execute on function public.set_pricing_officer_project_types(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Treat the combined role as the union of the two existing capabilities.
-- ---------------------------------------------------------------------------
create or replace function private.has_text_role(
  target_organization_id uuid,
  allowed text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and (
        member.role::text = any(allowed)
        or (
          member.role::text = 'super_admin'
          and ('owner' = any(allowed) or 'admin' = any(allowed))
        )
        or (
          member.role::text = 'sales_pricing_officer'
          and ('project_manager' = any(allowed) or 'pricing_officer' = any(allowed))
        )
      )
  );
$$;

create or replace function private.can_manage_quotation(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.role::text in (
        'super_admin',
        'owner',
        'admin',
        'project_manager',
        'sales_pricing_officer',
        'sales'
      )
  );
$$;

create or replace function private.can_access(
  target_organization_id uuid,
  resource text,
  action text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and (
        member.role::text in ('super_admin', 'owner', 'admin')
        or member.role::text in ('project_manager', 'sales_pricing_officer')
          and (
            (action = 'read' and resource = any(array['leads','customers','suppliers','inventory_items','quotations','quotation_items']))
            or (action = 'create' and resource = any(array['leads','customers','suppliers','quotations','quotation_items']))
            or (action = 'update' and resource = any(array['leads','customers','suppliers','quotations']))
          )
        or member.role::text = 'sales_pricing_officer'
          and (
            action = 'read'
            and resource = any(array[
              'business_settings',
              'leads',
              'customers',
              'quotations',
              'quotation_items',
              'price_quotation_illustrations',
              'price_quotation_product_costings',
              'price_quotation_costing_lines',
              'price_quotation_costing_markups',
              'price_quotation_mockups',
              'pricing_officer_project_types'
            ])
          )
        or member.role::text = 'accountant'
          and (
            (action = 'read' and resource = any(array['customers','suppliers','invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
            or (action = 'create' and resource = any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
            or (action = 'update' and resource = any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables','suppliers']))
            or (action = 'delete' and resource = any(array['expenses','supplier_payables']))
          )
      )
  );
$$;

grant execute on function
  private.has_text_role(uuid, text[]),
  private.can_manage_quotation(uuid),
  private.can_access(uuid, text, text),
  private.is_pricing_officer_assigned(uuid, uuid, text)
to authenticated;

-- Project Officer names and recipients include the combined role.
drop policy if exists "profiles: workspace read project managers" on public.profiles;
create policy "profiles: workspace read project managers"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1
    from public.organization_members target_member
    where target_member.user_id = profiles.id
      and target_member.role::text in ('project_manager', 'sales_pricing_officer')
      and (select private.is_org_member(target_member.organization_id))
  )
  or exists (
    select 1
    from public.organization_members target_member
    where target_member.user_id = profiles.id
      and (select private.is_org_admin(target_member.organization_id))
  )
);

drop policy if exists "members: admins and project managers read" on public.organization_members;
create policy "members: admins and project managers read"
on public.organization_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_org_admin(organization_id))
  or (
    role::text in ('project_manager', 'sales_pricing_officer')
    and (select private.is_org_member(organization_id))
  )
);

-- ---------------------------------------------------------------------------
-- 3) Route quotation reads, costing data, and review transitions by type.
-- ---------------------------------------------------------------------------
drop policy if exists "quotations: price workflow read" on public.quotations;
create policy "quotations: price workflow read"
on public.quotations for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or created_by = (select auth.uid())
  or (prepared_by_user_id = (select auth.uid()) and document_type = 'price_quotation')
  or (
    document_type = 'price_quotation'
    and status::text in ('pending', 'pending_gm_approval', 'approved')
    and created_by is distinct from (select auth.uid())
    and prepared_by_user_id is distinct from (select auth.uid())
    and (select private.is_pricing_officer_assigned(
      organization_id,
      (select auth.uid()),
      project_types
    ))
  )
);

drop policy if exists "quotation items: price workflow read" on public.quotation_items;
create policy "quotation items: price workflow read"
on public.quotation_items for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or (
          quote.document_type = 'price_quotation'
          and quote.status::text in ('pending', 'pending_gm_approval', 'approved')
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
      )
  )
);

drop policy if exists "price quotation illustrations: workflow read" on public.price_quotation_illustrations;
create policy "price quotation illustrations: workflow read"
on public.price_quotation_illustrations for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or (
          quote.document_type = 'price_quotation'
          and quote.status::text in ('pending', 'pending_gm_approval', 'approved')
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
      )
  )
);

drop policy if exists "price quotation revision requests: read" on public.price_quotation_revision_requests;
create policy "price quotation revision requests: read"
on public.price_quotation_revision_requests for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or submitted_by = (select auth.uid())
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation product costings: GM only" on public.price_quotation_product_costings;
create policy "price quotation product costings: GM only"
on public.price_quotation_product_costings for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and quote.document_type = 'price_quotation'
      and quote.status::text = 'pending'
      and quote.created_by is distinct from (select auth.uid())
      and quote.prepared_by_user_id is distinct from (select auth.uid())
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing lines: GM only" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: GM only"
on public.price_quotation_costing_lines for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type = 'price_quotation'
      and quote.status::text = 'pending'
      and quote.created_by is distinct from (select auth.uid())
      and quote.prepared_by_user_id is distinct from (select auth.uid())
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing markups: GM only" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: GM only"
on public.price_quotation_costing_markups for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and quote.document_type = 'price_quotation'
      and quote.status::text = 'pending'
      and quote.created_by is distinct from (select auth.uid())
      and quote.prepared_by_user_id is distinct from (select auth.uid())
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation mockups: read" on public.price_quotation_mockups;
create policy "price quotation mockups: read"
on public.price_quotation_mockups for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1
    from public.organization_members member
    where member.organization_id = price_quotation_mockups.organization_id
      and member.user_id = (select auth.uid())
      and member.role::text in ('project_manager', 'sales')
  )
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or (select private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        ))
      )
  )
);

-- Existing RPCs remain the write boundary. The assignment check is repeated
-- here so a caller cannot bypass routing with a forged quotation ID.
create or replace function public.save_price_quotation_mockups(
  p_quotation_id uuid,
  p_images jsonb,
  p_status text
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
  if p_status not in ('ongoing', 'completed', 'cancelled') then
    raise exception 'Unsupported mockup status';
  end if;

  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found or v_quote.document_type <> 'price_quotation' then
    raise exception 'Price Quotation not found';
  end if;
  if private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    null;
  elsif private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    and private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    null;
  else
    raise exception 'Only the Sales & Pricing Officer assigned to this project type can manage quotation mockups';
  end if;

  if coalesce(jsonb_typeof(p_images), '') <> 'array' then
    raise exception 'Mockup images must be an array';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_images);
  if v_count > 20 then
    raise exception 'A Price Quotation can have a maximum of twenty mockup images';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) as image(value)
    where nullif(btrim(coalesce(image.value ->> 'image_url', '')), '') is null
  ) then
    raise exception 'Each mockup image requires an uploaded image';
  end if;

  delete from public.price_quotation_mockups where quotation_id = v_quote.id;
  insert into public.price_quotation_mockups (
    organization_id, quotation_id, image_url, status, uploaded_by
  )
  select
    v_quote.organization_id,
    v_quote.id,
    btrim(image.value ->> 'image_url'),
    p_status,
    (select auth.uid())
  from jsonb_array_elements(p_images) as image(value);
end;
$$;

revoke all on function public.save_price_quotation_mockups(uuid, jsonb, text) from public;
grant execute on function public.save_price_quotation_mockups(uuid, jsonb, text) to authenticated;

create or replace function public.submit_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_project_type text;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Price Quotations can be submitted';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or v_quote.created_by is distinct from (select auth.uid()) then
    raise exception 'Only the Project Officer who prepared this quotation can submit it';
  end if;
  if not exists (
    select 1 from public.quotation_items where quotation_id = v_quote.id
  ) then
    raise exception 'Add at least one item before submitting the quotation';
  end if;

  v_project_type := private.normalize_price_quotation_project_type(v_quote.project_types);
  if v_project_type is null then
    raise exception 'Select a valid Price Quotation project type before submitting';
  end if;
  if not exists (
    select 1
    from public.pricing_officer_project_types assignment
    where assignment.organization_id = v_quote.organization_id
      and assignment.project_type = v_project_type
  ) then
    raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
  end if;

  update public.quotations
  set status = 'pending',
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      resubmission_count = case
        when v_quote.status::text = 'needs_revision'
          then resubmission_count + 1
        else resubmission_count
      end
  where id = v_quote.id;

  insert into public.approval_requests (
    organization_id, resource_type, resource_id, status, submitted_by, submitted_at
  )
  values (
    v_quote.organization_id, 'quotation', v_quote.id, 'pending',
    (select auth.uid()), now()
  )
  on conflict (resource_type, resource_id) do update
    set status = 'pending',
        submitted_by = excluded.submitted_by,
        submitted_at = excluded.submitted_at,
        decided_by = null,
        decided_at = null,
        decision_note = null;
end;
$$;

revoke all on function public.submit_price_quotation(uuid) from public;
grant execute on function public.submit_price_quotation(uuid) to authenticated;

create or replace function public.submit_price_quotation_to_gm(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer'])
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    )
    or v_quote.created_by is not distinct from (select auth.uid())
    or v_quote.prepared_by_user_id is not distinct from (select auth.uid()) then
    raise exception 'Only the assigned Sales & Pricing Officer can submit this Price Quotation to the General Manager';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only a submitted Price Quotation can be sent to the General Manager';
  end if;
  update public.quotations
  set status = 'pending_gm_approval',
      pricing_reviewed_by = (select auth.uid()),
      pricing_reviewed_at = now()
  where id = v_quote.id;
end;
$$;

revoke all on function public.submit_price_quotation_to_gm(uuid) from public;
grant execute on function public.submit_price_quotation_to_gm(uuid) to authenticated;

-- Protect both the legacy manual-price RPC and the newer costing RPC. The
-- trigger also handles the legacy RPC's temporary approved status by moving it
-- to the existing Sales & Pricing Officer -> GM intermediate state.
create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' then
    if tg_op = 'INSERT'
      and new.status::text not in ('draft', 'needs_revision', 'pending') then
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.document_type = 'price_quotation'
        and new.costing_source_id is null then
        if old.status::text in ('draft', 'needs_revision')
          and new.status::text = 'pending'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          if private.normalize_price_quotation_project_type(new.project_types) is null
            or not exists (
              select 1
              from public.pricing_officer_project_types assignment
              where assignment.organization_id = new.organization_id
                and assignment.project_type = private.normalize_price_quotation_project_type(new.project_types)
            ) then
            raise exception 'No Sales & Pricing Officer is assigned to the selected project type yet';
          end if;
          return new;
        end if;
        if old.status::text = 'needs_revision'
          and new.status::text = 'draft'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;
        if old.status::text = 'pending'
          and new.status::text = 'draft'
          and (
            new.created_by = (select auth.uid())
            or new.prepared_by_user_id = (select auth.uid())
          )
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;
        if old.status::text = 'approved'
          and new.status::text = 'needs_revision'
          and new.created_by = (select auth.uid())
          and private.has_text_role(new.organization_id, array['project_manager']) then
          return new;
        end if;

        if old.status::text = 'pending'
          and new.status::text in ('approved', 'needs_revision', 'pending_gm_approval')
          and private.has_text_role(new.organization_id, array['pricing_officer']) then
          if not private.is_pricing_officer_assigned(
            new.organization_id,
            (select auth.uid()),
            new.project_types
          ) then
            raise exception 'This Sales & Pricing Officer is not assigned to the quotation project type';
          end if;
          if new.created_by is not distinct from (select auth.uid())
            or new.prepared_by_user_id is not distinct from (select auth.uid()) then
            raise exception 'You cannot review your own Price Quotation';
          end if;
          if new.status::text = 'approved' then
            new.status := 'pending_gm_approval';
            new.approved_by := null;
            new.approved_at := null;
            new.pricing_reviewed_by := (select auth.uid());
            new.pricing_reviewed_at := now();
          end if;
          return new;
        end if;
      end if;
      raise exception 'Only an administrator can approve or finalize a quotation';
    end if;
  end if;

  if tg_table_name = 'expenses'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval')
          or old.status::text not in ('unfulfilled', 'fulfilled')
        ))
    ) then
    raise exception 'Only an administrator can approve, reject, or cancel an expense';
  end if;
  if tg_table_name = 'invoices'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'issued', 'partial'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'issued', 'partial')
          or old.status::text not in ('draft', 'issued', 'partial')
        ))
    ) then
    raise exception 'Only an administrator can set this invoice status directly';
  end if;
  if tg_table_name = 'payroll_periods'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'in_review'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'in_review')
          or old.status::text not in ('draft', 'in_review')
        ))
    ) then
    raise exception 'Only an administrator can approve or mark payroll paid';
  end if;
  if tg_table_name = 'cash_flow_entries'
    and (
      (tg_op = 'INSERT' and new.status::text not in ('draft', 'pending'))
      or (tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and (
          new.status::text not in ('draft', 'pending')
          or old.status::text not in ('draft', 'pending')
        ))
    ) then
    raise exception 'Only an administrator can approve cash flow';
  end if;
  return new;
end;
$$;

-- Combined-role officers can endorse an approved quotation to another
-- Project Officer, just like the existing Sales Project Officer role.
create or replace function public.create_price_quotation_endorsement(
  p_quotation_id uuid,
  p_recipient_user_id uuid,
  p_note text default null
)
returns table(id uuid, snapshot_path text)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved Price Quotation can be endorsed';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or (
      v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid())
    ) then
    raise exception 'Only the preparing Sales Project Officer can endorse this Price Quotation';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_quote.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text in ('project_manager', 'sales_pricing_officer')
  ) then
    raise exception 'Choose an active Sales Project Officer in this organization';
  end if;

  delete from public.price_quotation_endorsements
  where quotation_id = v_quote.id
    and sender_user_id = (select auth.uid())
    and recipient_user_id = p_recipient_user_id
    and status = 'processing';

  v_path := v_quote.organization_id::text
    || '/price-quotation-endorsements/'
    || v_id::text
    || '.pdf';
  insert into public.price_quotation_endorsements (
    id, organization_id, quotation_id, sender_user_id, recipient_user_id,
    quotation_no, client_name, project_name, total_amount, note, snapshot_path
  )
  values (
    v_id, v_quote.organization_id, v_quote.id, (select auth.uid()),
    p_recipient_user_id, coalesce(v_quote.quotation_no, 'Price Quotation'),
    v_quote.client_name, v_quote.project_name, v_quote.total_amount,
    nullif(btrim(coalesce(p_note, '')), ''), v_path
  );
  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action, after_data, note
  )
  values (
    v_quote.organization_id, (select auth.uid()),
    'price_quotation_endorsement', v_id, 'created',
    jsonb_build_object('quotation_id', v_quote.id, 'recipient_user_id', p_recipient_user_id),
    nullif(btrim(coalesce(p_note, '')), '')
  );
  return query select v_id, v_path;
end;
$$;

revoke all on function public.create_price_quotation_endorsement(uuid, uuid, text) from public;
grant execute on function public.create_price_quotation_endorsement(uuid, uuid, text) to authenticated;

-- Keep the older private mockup upload path compatible with the combined role.
drop policy if exists "mockup images: workspace read" on storage.objects;
create policy "mockup images: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'mockup-images'
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('super_admin', 'owner', 'admin', 'project_manager', 'sales_pricing_officer')
  )
);

drop policy if exists "mockup images: officer upload" on storage.objects;
create policy "mockup images: officer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mockup-images'
  and split_part(name, '/', 2) = 'mockups'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('project_manager', 'sales_pricing_officer')
  )
);

drop policy if exists "mockup images: officer delete" on storage.objects;
create policy "mockup images: officer delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'mockup-images'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.organization_members member
    where member.user_id = (select auth.uid())
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('project_manager', 'sales_pricing_officer')
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pricing_officer_project_types'
  ) then
    alter publication supabase_realtime
      add table public.pricing_officer_project_types;
  end if;
end;
$$;

commit;

-- Rollback before assigning project types:
--   drop function public.set_pricing_officer_project_types(uuid, text[]);
--   drop table public.pricing_officer_project_types;
--   alter table public.organization_members
--     drop constraint organization_members_no_standalone_pricing_officer;
-- The member_role enum values cannot be dropped safely in PostgreSQL. Because
-- this migration normalizes legacy memberships, restore organization_members
-- from a backup if the prior role distinction must be recovered.
