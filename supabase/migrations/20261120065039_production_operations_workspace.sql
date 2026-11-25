-- Additive Production Operations access. This migration keeps the existing
-- production approval permission and production role workflow separate.
-- The operator UI writes through narrow RPCs so the new permission cannot
-- directly mutate unrelated production, quotation, inventory, or finance
-- fields.

begin;

create table if not exists public.production_operations_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint production_operations_permissions_member_fk
    foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id)
    on delete cascade,
  constraint production_operations_permissions_active_state_check
    check ((is_active and revoked_at is null) or not is_active)
);

create index if not exists production_operations_permissions_active_idx
  on public.production_operations_permissions (organization_id, is_active, user_id);

alter table public.production_operations_permissions enable row level security;
drop policy if exists "production operations permissions: self or admin read"
  on public.production_operations_permissions;
create policy "production operations permissions: self or admin read"
on public.production_operations_permissions for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_org_admin(organization_id))
);

revoke all on public.production_operations_permissions from public, anon, authenticated;
grant select on public.production_operations_permissions to authenticated;

create table if not exists public.production_status_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  legacy_status public.production_status not null default 'queued',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists production_status_types_name_key
  on public.production_status_types (organization_id, lower(name));
create index if not exists production_status_types_org_sort_idx
  on public.production_status_types (organization_id, is_active, sort_order, name);

alter table public.production_status_types enable row level security;
revoke all on public.production_status_types from public, anon, authenticated;

alter table public.production_jobs
  add column if not exists production_status_type_id uuid references public.production_status_types(id) on delete set null,
  add column if not exists production_operator_remark text,
  add column if not exists production_added_at timestamptz,
  add column if not exists production_added_by uuid references auth.users(id) on delete set null,
  add column if not exists production_archived_at timestamptz,
  add column if not exists production_archived_by uuid references auth.users(id) on delete set null;

create index if not exists production_jobs_operator_lookup_idx
  on public.production_jobs (organization_id, production_added_at, production_archived_at);

-- Seed the four new operator statuses plus every legacy enum value so old
-- production jobs remain readable and can be moved forward without changing
-- their stored status semantics.
insert into public.production_status_types
  (organization_id, name, legacy_status, sort_order, is_system)
select organizations.id, seeded.name, seeded.legacy_status::public.production_status,
  seeded.sort_order, true
from public.organizations
cross join (
  values
    ('Pending', 'queued', 10),
    ('Ongoing', 'in_production', 20),
    ('Completed', 'completed', 30),
    ('Delivered', 'delivered', 40),
    ('Artwork approval', 'artwork_approval', 50),
    ('Materials ready', 'materials_ready', 60),
    ('Quality check', 'quality_check', 70),
    ('Cancelled', 'cancelled', 80)
) as seeded(name, legacy_status, sort_order)
on conflict do nothing;

create or replace function public.seed_production_status_types_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.production_status_types
    (organization_id, name, legacy_status, sort_order, is_system)
  values
    (new.id, 'Pending', 'queued', 10, true),
    (new.id, 'Ongoing', 'in_production', 20, true),
    (new.id, 'Completed', 'completed', 30, true),
    (new.id, 'Delivered', 'delivered', 40, true),
    (new.id, 'Artwork approval', 'artwork_approval', 50, true),
    (new.id, 'Materials ready', 'materials_ready', 60, true),
    (new.id, 'Quality check', 'quality_check', 70, true),
    (new.id, 'Cancelled', 'cancelled', 80, true)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.seed_production_status_types_for_organization() from public, anon, authenticated;
drop trigger if exists organizations_seed_production_status_types on public.organizations;
create trigger organizations_seed_production_status_types
after insert on public.organizations
for each row execute function public.seed_production_status_types_for_organization();

-- Backfill the compatibility pointer for existing jobs without changing their
-- legacy production status. Custom labels remain possible because the pointer
-- is selected by legacy_status and can later be changed through the operator RPC.
update public.production_jobs job
set production_status_type_id = (
  select status_type.id
  from public.production_status_types status_type
  where status_type.organization_id = job.organization_id
    and status_type.legacy_status = job.status
    and status_type.is_active
  order by status_type.is_system desc, status_type.sort_order, status_type.created_at
  limit 1
)
where job.production_status_type_id is null
  and exists (
    select 1
    from public.production_status_types status_type
    where status_type.organization_id = job.organization_id
      and status_type.legacy_status = job.status
      and status_type.is_active
  );

-- Legacy Production updates production_jobs.status directly. Keep the new
-- display-label pointer aligned when that happens, while preserving a custom
-- label when the operator RPC changes both fields together.
create or replace function private.sync_production_status_type()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_status_type_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.production_status_type_id is null
       or not exists (
         select 1
         from public.production_status_types status_type
         where status_type.id = new.production_status_type_id
           and status_type.organization_id = new.organization_id
           and status_type.legacy_status = new.status
       ) then
      select status_type.id
      into v_status_type_id
      from public.production_status_types status_type
      where status_type.organization_id = new.organization_id
        and status_type.legacy_status = new.status
        and status_type.is_active
      order by status_type.is_system desc, status_type.sort_order, status_type.created_at
      limit 1;
      new.production_status_type_id := v_status_type_id;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.production_status_type_id is not distinct from old.production_status_type_id then
    select status_type.id
    into v_status_type_id
    from public.production_status_types status_type
    where status_type.organization_id = new.organization_id
      and status_type.legacy_status = new.status
      and status_type.is_active
    order by status_type.is_system desc, status_type.sort_order, status_type.created_at
    limit 1;
    new.production_status_type_id := v_status_type_id;
  elsif new.production_status_type_id is distinct from old.production_status_type_id
    and not exists (
      select 1
      from public.production_status_types status_type
      where status_type.id = new.production_status_type_id
        and status_type.organization_id = new.organization_id
        and status_type.legacy_status = new.status
    ) then
    select status_type.id
    into v_status_type_id
    from public.production_status_types status_type
    where status_type.organization_id = new.organization_id
      and status_type.legacy_status = new.status
      and status_type.is_active
    order by status_type.is_system desc, status_type.sort_order, status_type.created_at
    limit 1;
    new.production_status_type_id := v_status_type_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_production_status_type() from public, anon, authenticated;
drop trigger if exists production_jobs_sync_status_type on public.production_jobs;
create trigger production_jobs_sync_status_type
before insert or update of status, production_status_type_id on public.production_jobs
for each row execute function private.sync_production_status_type();

create or replace function private.has_production_operations(
  p_organization_id uuid
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
    join public.production_operations_permissions permission
      on permission.organization_id = member.organization_id
     and permission.user_id = member.user_id
     and permission.is_active
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function private.has_production_operations(uuid) from public, anon;
grant execute on function private.has_production_operations(uuid) to authenticated;

drop policy if exists "production status types: operations read"
  on public.production_status_types;
create policy "production status types: operations read"
on public.production_status_types for select to authenticated
using (
  (select private.has_production_operations(organization_id))
);

create or replace function public.list_production_operator_projects(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
  project_name text,
  project_type text,
  production_job_id uuid,
  job_no text,
  status_key text,
  status_label text,
  status_type_id uuid,
  operator_remark text,
  is_added boolean,
  pdf_available boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  return query
  select
    quotation.id,
    quotation.quotation_no,
    coalesce(nullif(btrim(quotation.project_name), ''), quotation.quotation_no),
    quotation.project_types,
    case when job.production_added_at is not null and job.production_archived_at is null then job.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.job_no end,
    coalesce(job.status::text, 'queued'),
    case
      when job.production_added_at is null or job.production_archived_at is not null then 'Pending'
      else coalesce(status_type.name, initcap(replace(job.status::text, '_', ' ')))
    end,
    case when job.production_added_at is not null and job.production_archived_at is null then status_type.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.production_operator_remark end,
    (job.production_added_at is not null and job.production_archived_at is null),
    (quotation.status::text = 'approved' and quotation.archived_at is null)
  from public.quotations quotation
  left join public.production_jobs job
    on job.quotation_id = quotation.id
   and job.organization_id = quotation.organization_id
  left join public.production_status_types status_type
    on status_type.id = job.production_status_type_id
   and status_type.organization_id = quotation.organization_id
   and status_type.legacy_status = job.status
  where quotation.organization_id = p_organization_id
    and quotation.document_type::text = 'price_quotation'
    and quotation.costing_source_id is null
    and (
      (job.production_added_at is not null and job.production_archived_at is null)
      or (
        quotation.status::text = 'approved'
        and quotation.archived_at is null
      )
    )
  order by quotation.updated_at desc, quotation.quotation_no asc;
end;
$$;

create or replace function public.get_production_operator_quotation_pdf(
  p_organization_id uuid,
  p_quotation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
    and organization_id = p_organization_id
    and document_type::text = 'price_quotation'
    and costing_source_id is null
    and status::text = 'approved'
    and archived_at is null;

  if not found then
    raise exception 'Only an active approved direct Price Quotation can be opened';
  end if;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quotation.id,
      'quotation_no', v_quotation.quotation_no,
      'document_type', v_quotation.document_type,
      'quotation_source', v_quotation.quotation_source,
      'source_price_quotation_id', v_quotation.source_price_quotation_id,
      'issue_date', v_quotation.issue_date,
      'status', v_quotation.status,
      'customer_id', v_quotation.customer_id,
      'lead_id', v_quotation.lead_id,
      'project_name', v_quotation.project_name,
      'client_name', v_quotation.client_name,
      'client_contact_name', v_quotation.client_contact_name,
      'client_phone', v_quotation.client_phone,
      'client_address', v_quotation.client_address,
      'project_types', v_quotation.project_types,
      'representative', coalesce(
        (
          select profile.full_name
          from public.profiles profile
          where profile.id = coalesce(v_quotation.prepared_by_user_id, v_quotation.created_by)
        ),
        v_quotation.representative
      ),
      'prepared_by_signature_url', v_quotation.prepared_by_signature_url,
      'approved_by_name', (
        select profile.full_name
        from public.profiles profile
        where profile.id = v_quotation.approved_by
      ),
      'terms_conditions', v_quotation.terms_conditions,
      'payment_terms_option', v_quotation.payment_terms_option,
      'pdc_term_days', v_quotation.pdc_term_days,
      'bank_details', v_quotation.bank_details,
      'vat_rate', v_quotation.vat_rate,
      'vat_calculation_type', v_quotation.vat_calculation_type,
      'subtotal', v_quotation.subtotal,
      'vat_amount', v_quotation.vat_amount,
      'shipping_handling', v_quotation.shipping_handling,
      'total_amount', v_quotation.total_amount
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'quotation_id', item.quotation_id,
            'inventory_item_id', item.inventory_item_id,
            'description', item.description,
            'details', item.details,
            'image_url', item.image_url,
            'quantity', item.quantity,
            'unit_cost', item.unit_cost,
            'line_total', item.line_total,
            'sort_order', item.sort_order
          )
          order by item.sort_order, item.id
        )
        from public.quotation_items item
        where item.quotation_id = v_quotation.id
      ),
      '[]'::jsonb
    ),
    'customer', (
      select jsonb_build_object(
        'id', customer.id,
        'company_name', customer.company_name,
        'contact_name', customer.contact_name,
        'email', customer.email,
        'phone', customer.phone,
        'billing_address', customer.billing_address
      )
      from public.customers customer
      where customer.id = v_quotation.customer_id
        and customer.organization_id = p_organization_id
    ),
    'lead', (
      select jsonb_build_object(
        'id', lead.id,
        'client_name', lead.client_name,
        'contact_name', lead.contact_name,
        'email', lead.email,
        'phone', lead.phone,
        'address', lead.address,
        'date_sent', lead.date_sent,
        'created_at', lead.created_at
      )
      from public.leads lead
      where lead.id = v_quotation.lead_id
        and lead.organization_id = p_organization_id
    )
  );
end;
$$;

create or replace function public.list_production_status_types(
  p_organization_id uuid
)
returns table (
  id uuid,
  name text,
  legacy_status text,
  sort_order integer,
  is_active boolean,
  is_system boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  return query
  select status_type.id,
    status_type.name,
    status_type.legacy_status::text,
    status_type.sort_order,
    status_type.is_active,
    status_type.is_system
  from public.production_status_types status_type
  where status_type.organization_id = p_organization_id
  order by status_type.sort_order, status_type.name;
end;
$$;

create or replace function public.add_production_operator_project(
  p_organization_id uuid,
  p_quotation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_job public.production_jobs%rowtype;
  v_pending public.production_status_types%rowtype;
  v_status_id uuid;
  v_job_no text;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
    and organization_id = p_organization_id
    and document_type::text = 'price_quotation'
    and costing_source_id is null
    and archived_at is null
    and status::text = 'approved'
  for update;

  if not found then
    raise exception 'Only an approved direct Price Quotation can be added to Production';
  end if;

  select * into v_pending
  from public.production_status_types
  where organization_id = p_organization_id
    and legacy_status = 'queued'::public.production_status
    and is_active
  order by is_system desc, sort_order
  limit 1;

  if not found then
    raise exception 'Production status types are not configured';
  end if;

  select * into v_job
  from public.production_jobs
  where quotation_id = p_quotation_id
    and organization_id = p_organization_id
  for update;

  if not found then
    v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-' || substr(replace(v_quotation.id::text, '-', ''), 1, 6);
    while exists (
      select 1 from public.production_jobs
      where organization_id = p_organization_id and job_no = v_job_no
    ) loop
      v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-' || substr(replace(v_quotation.id::text, '-', ''), 1, 6) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    end loop;

    insert into public.production_jobs (
      organization_id,
      job_no,
      quotation_id,
      customer_id,
      title,
      status,
      due_date,
      notes,
      production_status_type_id,
      production_added_at,
      production_added_by
    )
    values (
      p_organization_id,
      v_job_no,
      v_quotation.id,
      v_quotation.customer_id,
      coalesce(v_quotation.project_name, 'Quotation ' || v_quotation.quotation_no),
      v_pending.legacy_status,
      v_quotation.valid_until,
      v_quotation.notes,
      v_pending.id,
      now(),
      (select auth.uid())
    )
    returning * into v_job;
  else
    select status_type.id into v_status_id
    from public.production_status_types status_type
    where status_type.organization_id = p_organization_id
      and status_type.legacy_status = v_job.status
      and status_type.is_active
    order by status_type.is_system desc, status_type.sort_order
    limit 1;

    update public.production_jobs
    set production_status_type_id = coalesce(v_job.production_status_type_id, v_status_id, v_pending.id),
        production_added_at = coalesce(v_job.production_added_at, now()),
        production_added_by = coalesce(v_job.production_added_by, (select auth.uid())),
        production_archived_at = null,
        production_archived_by = null
    where id = v_job.id
    returning * into v_job;
  end if;

  return v_job.id;
end;
$$;

create or replace function public.update_production_operator_project(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_status_type_id uuid,
  p_operator_remark text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
  v_status public.production_status_types%rowtype;
  v_remark text := nullif(btrim(p_operator_remark), '');
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if length(coalesce(p_operator_remark, '')) > 2000 then
    raise exception 'Production remarks must be 2000 characters or fewer';
  end if;

  select * into v_status
  from public.production_status_types
  where id = p_status_type_id
    and organization_id = p_organization_id
    and is_active;
  if not found then
    raise exception 'Select an active Production status type';
  end if;

  select * into v_job
  from public.production_jobs
  where id = p_production_job_id
    and organization_id = p_organization_id
    and production_added_at is not null
    and production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;

  update public.production_jobs
  set status = v_status.legacy_status,
      production_status_type_id = v_status.id,
      production_operator_remark = v_remark,
      started_at = case
        when v_status.legacy_status = 'in_production'::public.production_status
          then coalesce(started_at, now())
        else started_at
      end,
      completed_at = case
        when v_status.legacy_status = 'completed'::public.production_status
          then coalesce(completed_at, now())
        else completed_at
      end,
      delivered_at = case
        when v_status.legacy_status = 'delivered'::public.production_status
          then coalesce(delivered_at, now())
        else delivered_at
      end
  where id = v_job.id;

  if v_job.production_operator_remark is distinct from v_remark then
    insert into public.production_job_activity
      (organization_id, production_job_id, action, note, actor_id)
    values (
      p_organization_id,
      v_job.id,
      'remark_updated',
      coalesce(v_remark, 'Remark cleared'),
      (select auth.uid())
    );
  end if;
end;
$$;

create or replace function public.archive_production_operator_project(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_job
  from public.production_jobs
  where id = p_production_job_id
    and organization_id = p_organization_id
    and production_added_at is not null
    and production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;

  update public.production_jobs
  set production_archived_at = now(),
      production_archived_by = (select auth.uid())
  where id = v_job.id;

  insert into public.production_job_activity
    (organization_id, production_job_id, action, note, actor_id)
  values (
    p_organization_id,
    v_job.id,
    'project_archived',
    'Production project archived by operator',
    (select auth.uid())
  );
end;
$$;

create or replace function public.create_production_status_type(
  p_organization_id uuid,
  p_name text,
  p_legacy_status public.production_status default 'queued'
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := btrim(p_name);
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Status type names must be between 1 and 80 characters';
  end if;
  if exists (
    select 1 from public.production_status_types
    where organization_id = p_organization_id and lower(name) = lower(v_name)
  ) then
    raise exception 'A Production status type with this name already exists';
  end if;

  insert into public.production_status_types
    (organization_id, name, legacy_status, sort_order, created_by, updated_by)
  values (
    p_organization_id,
    v_name,
    p_legacy_status,
    coalesce((select max(sort_order) + 10 from public.production_status_types where organization_id = p_organization_id), 10),
    (select auth.uid()),
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_production_status_type(
  p_organization_id uuid,
  p_status_type_id uuid,
  p_name text,
  p_legacy_status public.production_status
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := btrim(p_name);
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Status type names must be between 1 and 80 characters';
  end if;
  if exists (
    select 1 from public.production_status_types
    where organization_id = p_organization_id
      and lower(name) = lower(v_name)
      and id <> p_status_type_id
  ) then
    raise exception 'A Production status type with this name already exists';
  end if;

  if exists (
    select 1
    from public.production_jobs job
    where job.organization_id = p_organization_id
      and job.production_status_type_id = p_status_type_id
      and job.status is distinct from p_legacy_status
  ) then
    raise exception 'This status type is already used by Production projects and its mapped stage cannot be changed';
  end if;

  update public.production_status_types
  set name = v_name,
      legacy_status = p_legacy_status,
      updated_by = (select auth.uid())
  where id = p_status_type_id
    and organization_id = p_organization_id;
  if not found then
    raise exception 'Production status type not found';
  end if;
end;
$$;

revoke all on function public.list_production_operator_projects(uuid) from public, anon;
grant execute on function public.list_production_operator_projects(uuid) to authenticated;
revoke all on function public.get_production_operator_quotation_pdf(uuid, uuid) from public, anon;
grant execute on function public.get_production_operator_quotation_pdf(uuid, uuid) to authenticated;
revoke all on function public.list_production_status_types(uuid) from public, anon;
grant execute on function public.list_production_status_types(uuid) to authenticated;
revoke all on function public.add_production_operator_project(uuid, uuid) from public, anon;
grant execute on function public.add_production_operator_project(uuid, uuid) to authenticated;
revoke all on function public.update_production_operator_project(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.update_production_operator_project(uuid, uuid, uuid, text) to authenticated;
revoke all on function public.archive_production_operator_project(uuid, uuid) from public, anon;
grant execute on function public.archive_production_operator_project(uuid, uuid) to authenticated;
revoke all on function public.create_production_status_type(uuid, text, public.production_status) from public, anon;
grant execute on function public.create_production_status_type(uuid, text, public.production_status) to authenticated;
revoke all on function public.update_production_status_type(uuid, uuid, text, public.production_status) from public, anon;
grant execute on function public.update_production_status_type(uuid, uuid, text, public.production_status) to authenticated;

drop trigger if exists production_status_types_updated_at on public.production_status_types;
create trigger production_status_types_updated_at
before update on public.production_status_types
for each row execute function public.set_updated_at();

drop trigger if exists production_operations_permissions_updated_at
  on public.production_operations_permissions;
create trigger production_operations_permissions_updated_at
before update on public.production_operations_permissions
for each row execute function public.set_updated_at();

drop trigger if exists production_operations_permissions_activity_log
  on public.production_operations_permissions;
create trigger production_operations_permissions_activity_log
after insert or update or delete on public.production_operations_permissions
for each row execute function public.log_activity();

-- Production detail records are additive to the existing Production workflow.
-- Box makers are organization-level catalog entries, while tier percentages
-- belong to the active Production project and are shared by every assignment.
create table if not exists public.production_box_makers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_box_makers_active_state_check
    check ((is_active and archived_at is null) or not is_active)
);

create unique index if not exists production_box_makers_active_name_key
  on public.production_box_makers (organization_id, lower(name))
  where is_active;
create index if not exists production_box_makers_org_active_name_idx
  on public.production_box_makers (organization_id, is_active, name);

create table if not exists public.production_project_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  tier_number smallint not null check (tier_number between 1 and 4),
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_project_tiers_active_state_check
    check ((is_active and archived_at is null) or not is_active)
);

create unique index if not exists production_project_tiers_active_number_key
  on public.production_project_tiers (production_job_id, tier_number)
  where is_active;
create index if not exists production_project_tiers_org_job_idx
  on public.production_project_tiers (organization_id, production_job_id, is_active, tier_number);

create table if not exists public.production_box_maker_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  box_maker_id uuid not null references public.production_box_makers(id) on delete restrict,
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  cash_advance numeric(14,2) not null default 0 check (cash_advance >= 0),
  due_date date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_box_maker_assignments_active_state_check
    check ((is_active and archived_at is null) or not is_active),
  constraint production_box_maker_assignments_advance_limit_check
    check (cash_advance <= labor_cost)
);

create unique index if not exists production_box_maker_assignments_active_maker_key
  on public.production_box_maker_assignments (production_job_id, box_maker_id)
  where is_active;
create index if not exists production_box_maker_assignments_org_job_idx
  on public.production_box_maker_assignments (organization_id, production_job_id, is_active);

-- Cash advances are requested per Box Maker assignment and become project-fund
-- debits only after management approval. The assignment cash_advance column is
-- retained as the approved-total snapshot for compatibility with the existing
-- Production detail model; it is no longer directly editable by operators.
create table if not exists public.production_cash_advance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  assignment_id uuid not null references public.production_box_maker_assignments(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  approved_amount numeric(14,2),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  request_note text not null check (length(btrim(request_note)) between 1 and 2000),
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_cash_advance_approved_amount_check
    check (approved_amount is null or (approved_amount > 0 and approved_amount <= requested_amount))
);

create unique index if not exists production_cash_advance_pending_assignment_key
  on public.production_cash_advance_requests (assignment_id)
  where status = 'pending';
create index if not exists production_cash_advance_org_status_idx
  on public.production_cash_advance_requests (organization_id, status, requested_at desc);
create index if not exists production_cash_advance_assignment_idx
  on public.production_cash_advance_requests (assignment_id, requested_at desc);

-- Project-fund entries remain the canonical balance source. This traceability
-- link makes each approved Production cash advance idempotent and auditable.
alter table public.project_fund_entries
  add column if not exists source_production_cash_advance_id uuid
    references public.production_cash_advance_requests(id) on delete restrict;

create unique index if not exists project_fund_entries_production_cash_advance_idx
  on public.project_fund_entries (source_production_cash_advance_id)
  where source_production_cash_advance_id is not null;

-- Approved cash advances are part of the project-fund audit trail. Preserve
-- that history when legacy quotation deletion attempts to cascade through a
-- Production job by returning a clear archive-required error instead of a
-- restrictive foreign-key failure.
create or replace function private.prevent_production_job_delete_with_cash_advance()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if exists (
    select 1
    from public.production_cash_advance_requests request
    where request.production_job_id = old.id
      and request.status = 'approved'
  ) then
    raise exception using
      errcode = 'restrict_violation',
      message = 'This Production project has approved cash advances and must be archived instead of deleted';
  end if;
  return old;
end;
$$;

revoke all on function private.prevent_production_job_delete_with_cash_advance() from public, anon, authenticated;
drop trigger if exists production_jobs_prevent_financial_history_delete
  on public.production_jobs;
create trigger production_jobs_prevent_financial_history_delete
before delete on public.production_jobs
for each row execute function private.prevent_production_job_delete_with_cash_advance();

alter table public.production_box_makers enable row level security;
alter table public.production_project_tiers enable row level security;
alter table public.production_box_maker_assignments enable row level security;
alter table public.production_cash_advance_requests enable row level security;

revoke all on public.production_box_makers,
  public.production_project_tiers,
  public.production_box_maker_assignments
from public, anon, authenticated;

drop policy if exists "production box makers: operations read"
  on public.production_box_makers;
create policy "production box makers: operations read"
on public.production_box_makers for select to authenticated
using ((select private.has_production_operations(organization_id)));

drop policy if exists "production project tiers: operations read"
  on public.production_project_tiers;
create policy "production project tiers: operations read"
on public.production_project_tiers for select to authenticated
using ((select private.has_production_operations(organization_id)));

drop policy if exists "production box maker assignments: operations read"
  on public.production_box_maker_assignments;
create policy "production box maker assignments: operations read"
on public.production_box_maker_assignments for select to authenticated
using ((select private.has_production_operations(organization_id)));

drop policy if exists "production cash advance requests: operations or management read"
  on public.production_cash_advance_requests;
create policy "production cash advance requests: operations or management read"
on public.production_cash_advance_requests for select to authenticated
using (
  (select private.has_production_operations(organization_id))
  or (select private.has_text_role(organization_id, array['owner', 'admin']))
);

revoke all on public.production_cash_advance_requests
from public, anon, authenticated;

create or replace function public.count_pending_production_cash_advance_requests(
  p_organization_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when private.has_text_role(p_organization_id, array['owner', 'admin']) then (
      select count(*)
      from public.production_cash_advance_requests request
      where request.organization_id = p_organization_id
        and request.status = 'pending'
    )
    else 0
  end;
$$;

create or replace function public.get_production_operator_details(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;

  return jsonb_build_object(
    'tiers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', tier.id,
            'tier_number', tier.display_number,
            'percentage', tier.percentage
          )
          order by tier.display_number
        )
        from (
          select tier.id,
            tier.percentage,
            row_number() over (order by tier.tier_number, tier.created_at, tier.id) as display_number
          from public.production_project_tiers tier
          where tier.organization_id = p_organization_id
            and tier.production_job_id = p_production_job_id
            and tier.is_active
        ) tier
      ),
      '[]'::jsonb
    ),
    'box_makers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', maker.id,
            'name', maker.name,
            'is_active', maker.is_active
          )
          order by maker.name
        )
        from public.production_box_makers maker
        where maker.organization_id = p_organization_id
      ),
      '[]'::jsonb
    ),
    'assignments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'box_maker_id', assignment.box_maker_id,
            'box_maker_name', maker.name,
            'labor_cost', assignment.labor_cost,
            'cash_advance', assignment.cash_advance,
            'pending_cash_advance', coalesce((
              select sum(request.requested_amount)
              from public.production_cash_advance_requests request
              where request.assignment_id = assignment.id
                and request.status = 'pending'
            ), 0)::numeric(14,2),
            'balance', round(assignment.labor_cost - assignment.cash_advance, 2),
            'due_date', assignment.due_date
          )
          order by maker.name, assignment.created_at, assignment.id
        )
        from public.production_box_maker_assignments assignment
        join public.production_box_makers maker
          on maker.id = assignment.box_maker_id
         and maker.organization_id = p_organization_id
        where assignment.organization_id = p_organization_id
          and assignment.production_job_id = p_production_job_id
          and assignment.is_active
      ),
      '[]'::jsonb
    ),
    'cash_advance_requests', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', request.id,
            'assignment_id', request.assignment_id,
            'requested_amount', request.requested_amount,
            'approved_amount', request.approved_amount,
            'status', request.status,
            'request_note', request.request_note,
            'decision_note', request.decision_note,
            'requested_at', request.requested_at,
            'decided_at', request.decided_at
          )
          order by request.requested_at desc, request.id desc
        )
        from public.production_cash_advance_requests request
        where request.organization_id = p_organization_id
          and request.production_job_id = p_production_job_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.create_production_box_maker(
  p_organization_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_name is null or length(v_name) > 80 then
    raise exception 'Box Maker names must be between 1 and 80 characters';
  end if;
  if exists (
    select 1
    from public.production_box_makers maker
    where maker.organization_id = p_organization_id
      and lower(maker.name) = lower(v_name)
      and maker.is_active
  ) then
    raise exception 'A Box Maker with this name already exists';
  end if;

  update public.production_box_makers maker
  set name = v_name,
      is_active = true,
      archived_by = null,
      archived_at = null,
      updated_by = (select auth.uid())
  where maker.organization_id = p_organization_id
    and lower(maker.name) = lower(v_name)
    and not maker.is_active
  returning maker.id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.production_box_makers (
    organization_id, name, created_by, updated_by
  )
  values (
    p_organization_id, v_name, (select auth.uid()), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_production_box_maker(
  p_organization_id uuid,
  p_box_maker_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_name is null or length(v_name) > 80 then
    raise exception 'Box Maker names must be between 1 and 80 characters';
  end if;
  if exists (
    select 1
    from public.production_box_makers maker
    where maker.organization_id = p_organization_id
      and lower(maker.name) = lower(v_name)
      and maker.id <> p_box_maker_id
      and maker.is_active
  ) then
    raise exception 'A Box Maker with this name already exists';
  end if;

  update public.production_box_makers maker
  set name = v_name,
      updated_by = (select auth.uid())
  where maker.id = p_box_maker_id
    and maker.organization_id = p_organization_id
    and maker.is_active;
  if not found then
    raise exception 'Box Maker not found or already archived';
  end if;
end;
$$;

create or replace function public.archive_production_box_maker(
  p_organization_id uuid,
  p_box_maker_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  update public.production_box_makers maker
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where maker.id = p_box_maker_id
    and maker.organization_id = p_organization_id
    and maker.is_active;
  if not found then
    raise exception 'Box Maker not found or already archived';
  end if;
end;
$$;

create or replace function public.create_production_project_tier(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_percentage numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_percentage numeric(5,2) := round(p_percentage, 2);
  v_tier_number smallint;
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_percentage is null
    or v_percentage <= 0
    or v_percentage > 100
    or v_percentage <> trunc(v_percentage) then
    raise exception 'Tier percentage must be a whole number greater than 0 and no more than 100';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;

  select min(candidates.tier_number)::smallint
  into v_tier_number
  from generate_series(1, 4) as candidates(tier_number)
  where not exists (
    select 1
    from public.production_project_tiers tier
    where tier.organization_id = p_organization_id
      and tier.production_job_id = p_production_job_id
      and tier.tier_number = candidates.tier_number
      and tier.is_active
  );
  if v_tier_number is null then
    raise exception 'A Production project can have at most four tiers';
  end if;

  insert into public.production_project_tiers (
    organization_id, production_job_id, tier_number, percentage, created_by, updated_by
  )
  values (
    p_organization_id, p_production_job_id, v_tier_number, v_percentage,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_production_project_tier(
  p_organization_id uuid,
  p_tier_id uuid,
  p_percentage numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_percentage numeric(5,2) := round(p_percentage, 2);
  v_tier public.production_project_tiers%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_percentage is null
    or v_percentage <= 0
    or v_percentage > 100
    or v_percentage <> trunc(v_percentage) then
    raise exception 'Tier percentage must be a whole number greater than 0 and no more than 100';
  end if;

  select * into v_tier
  from public.production_project_tiers tier
  where tier.id = p_tier_id
    and tier.organization_id = p_organization_id
    and tier.is_active
  for update;
  if not found then
    raise exception 'Tier not found or already archived';
  end if;

  update public.production_project_tiers tier
  set percentage = v_percentage,
      updated_by = (select auth.uid())
  where tier.id = p_tier_id;
end;
$$;

create or replace function public.archive_production_project_tier(
  p_organization_id uuid,
  p_tier_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tier public.production_project_tiers%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_tier
  from public.production_project_tiers tier
  where tier.id = p_tier_id
    and tier.organization_id = p_organization_id
    and tier.is_active
  for update;
  if not found then
    raise exception 'Tier not found or already archived';
  end if;

  update public.production_project_tiers tier
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where tier.id = p_tier_id;

end;
$$;

drop function if exists public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date);
create or replace function public.create_production_box_maker_assignment(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_labor_cost numeric(14,2) := round(coalesce(p_labor_cost, 0), 2);
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_labor_cost < 0 then
    raise exception 'Total labor cost cannot be negative';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;
  if not exists (
    select 1
    from public.production_project_tiers tier
    where tier.organization_id = p_organization_id
      and tier.production_job_id = p_production_job_id
      and tier.is_active
  ) then
    raise exception 'Add at least one tier percentage before adding a Box Maker';
  end if;
  if not exists (
    select 1
    from public.production_box_makers maker
    where maker.id = p_box_maker_id
      and maker.organization_id = p_organization_id
      and maker.is_active
  ) then
    raise exception 'Select an active Box Maker';
  end if;
  if exists (
    select 1
    from public.production_box_maker_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.production_job_id = p_production_job_id
      and assignment.box_maker_id = p_box_maker_id
      and assignment.is_active
  ) then
    raise exception 'This Box Maker is already assigned to the Production project';
  end if;

  insert into public.production_box_maker_assignments (
    organization_id, production_job_id, box_maker_id,
    labor_cost, cash_advance, due_date, created_by, updated_by
  )
  values (
    p_organization_id, p_production_job_id, p_box_maker_id,
    v_labor_cost, 0, p_due_date,
    (select auth.uid()), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date);
create or replace function public.update_production_box_maker_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_labor_cost numeric(14,2) := round(coalesce(p_labor_cost, 0), 2);
  v_assignment public.production_box_maker_assignments%rowtype;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_labor_cost < 0 then
    raise exception 'Total labor cost cannot be negative';
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;
  if v_assignment.cash_advance > v_labor_cost then
    raise exception 'Total labor cost cannot be lower than the approved cash advances';
  end if;
  if v_assignment.box_maker_id <> p_box_maker_id
    and (
      v_assignment.cash_advance > 0
      or exists (
        select 1
        from public.production_cash_advance_requests request
        where request.assignment_id = v_assignment.id
      )
    ) then
    raise exception 'The Box Maker cannot be changed after a cash advance request; remove the assignment and create a new one';
  end if;
  if not exists (
    select 1
    from public.production_box_makers maker
    where maker.id = p_box_maker_id
      and maker.organization_id = p_organization_id
      and (maker.is_active or maker.id = v_assignment.box_maker_id)
  ) then
    raise exception 'Select an active Box Maker';
  end if;
  if exists (
    select 1
    from public.production_box_maker_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.production_job_id = v_assignment.production_job_id
      and assignment.box_maker_id = p_box_maker_id
      and assignment.is_active
      and assignment.id <> p_assignment_id
  ) then
    raise exception 'This Box Maker is already assigned to the Production project';
  end if;

  update public.production_box_maker_assignments assignment
  set box_maker_id = p_box_maker_id,
      labor_cost = v_labor_cost,
      due_date = p_due_date,
      updated_by = (select auth.uid())
  where assignment.id = p_assignment_id;
end;
$$;

-- Keep the previous RPC signatures available during a rolling client update.
-- They may preserve a zero/current approved snapshot for non-financial edits,
-- but they cannot write a new cash advance outside the approval workflow.
drop function if exists public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date);
create or replace function public.create_production_box_maker_assignment(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_cash_advance numeric,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if round(coalesce(p_cash_advance, 0), 2) <> 0 then
    raise exception 'Cash advances must be requested and approved separately';
  end if;

  return public.create_production_box_maker_assignment(
    p_organization_id,
    p_production_job_id,
    p_box_maker_id,
    p_labor_cost,
    p_due_date
  );
end;
$$;

drop function if exists public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date);
create or replace function public.update_production_box_maker_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_box_maker_id uuid,
  p_labor_cost numeric,
  p_cash_advance numeric,
  p_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_current_cash_advance numeric(14,2);
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select assignment.cash_advance
  into v_current_cash_advance
  from public.production_box_maker_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;
  if round(coalesce(p_cash_advance, 0), 2) <> v_current_cash_advance then
    raise exception 'Cash advances must be requested and approved separately';
  end if;

  perform public.update_production_box_maker_assignment(
    p_organization_id,
    p_assignment_id,
    p_box_maker_id,
    p_labor_cost,
    p_due_date
  );
end;
$$;

create or replace function public.archive_production_box_maker_assignment(
  p_organization_id uuid,
  p_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  update public.production_box_maker_assignments assignment
  set is_active = false,
      archived_by = (select auth.uid()),
      archived_at = now(),
      updated_by = (select auth.uid())
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;

  update public.production_cash_advance_requests request
  set status = 'cancelled',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = 'Request cancelled because the Box Maker assignment was removed',
      updated_at = now()
  where request.organization_id = p_organization_id
    and request.assignment_id = p_assignment_id
    and request.status = 'pending';
end;
$$;

create or replace function public.request_production_cash_advance(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_requested_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_assignment public.production_box_maker_assignments%rowtype;
  v_job public.production_jobs%rowtype;
  v_fund public.project_funds%rowtype;
  v_amount numeric(14,2) := round(coalesce(p_requested_amount, 0), 2);
  v_remaining numeric(14,2);
  v_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if v_amount <= 0 then
    raise exception 'Cash advance request must be greater than zero';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null
    or length(btrim(p_note)) > 2000 then
    raise exception 'A cash advance remark between 1 and 2000 characters is required';
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'Box Maker assignment not found or already archived';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = v_assignment.production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;

  select * into v_fund
  from public.project_funds fund
  where fund.organization_id = p_organization_id
    and fund.status = 'open'
    and (
      fund.production_job_id = v_job.id
      or fund.quotation_id = v_job.quotation_id
    )
  order by case when fund.production_job_id = v_job.id then 0 else 1 end,
    fund.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'This project does not have an open Project Fund';
  end if;

  if exists (
    select 1
    from public.production_cash_advance_requests request
    where request.assignment_id = v_assignment.id
      and request.status = 'pending'
  ) then
    raise exception 'This Box Maker already has a cash advance request awaiting approval';
  end if;

  v_remaining := round(v_assignment.labor_cost - v_assignment.cash_advance, 2);
  if v_amount > v_remaining + 0.001 then
    raise exception 'Cash advance cannot exceed the Box Maker balance';
  end if;

  insert into public.production_cash_advance_requests (
    organization_id, production_job_id, assignment_id, project_fund_id,
    requested_amount, request_note, requested_by
  )
  values (
    p_organization_id, v_job.id, v_assignment.id, v_fund.id,
    v_amount, btrim(p_note), (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_production_cash_advance_requests(
  p_organization_id uuid
)
returns table (
  id uuid,
  production_job_id uuid,
  assignment_id uuid,
  project_fund_id uuid,
  quotation_no text,
  project_name text,
  project_type text,
  box_maker_name text,
  labor_cost numeric,
  approved_cash_advance numeric,
  box_maker_balance numeric,
  requested_amount numeric,
  approved_amount numeric,
  status text,
  project_fund_available numeric,
  request_note text,
  decision_note text,
  requested_by uuid,
  requester_name text,
  requested_at timestamptz,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Production cash advances';
  end if;

  return query
  select
    request.id,
    request.production_job_id,
    request.assignment_id,
    request.project_fund_id,
    quotation.quotation_no,
    coalesce(nullif(btrim(quotation.project_name), ''), quotation.quotation_no),
    quotation.project_types,
    maker.name,
    assignment.labor_cost,
    assignment.cash_advance,
    round(assignment.labor_cost - assignment.cash_advance, 2),
    request.requested_amount,
    request.approved_amount,
    request.status,
    coalesce(fund_totals.available_balance, 0)::numeric(14,2),
    request.request_note,
    request.decision_note,
    request.requested_by,
    coalesce(nullif(btrim(profile.full_name), ''), 'Team member'),
    request.requested_at,
    request.decided_at
  from public.production_cash_advance_requests request
  join public.production_box_maker_assignments assignment
    on assignment.id = request.assignment_id
   and assignment.organization_id = p_organization_id
  join public.production_box_makers maker
    on maker.id = assignment.box_maker_id
   and maker.organization_id = p_organization_id
  join public.production_jobs job
    on job.id = request.production_job_id
   and job.organization_id = p_organization_id
  join public.quotations quotation
    on quotation.id = job.quotation_id
   and quotation.organization_id = p_organization_id
  left join public.profiles profile
    on profile.id = request.requested_by
  left join lateral (
    select round(coalesce(sum(
      case when entry.direction = 'credit' then entry.amount else -entry.amount end
    ) filter (where not entry.is_voided), 0), 2) as available_balance
    from public.project_fund_entries entry
    where entry.project_fund_id = request.project_fund_id
  ) fund_totals on true
  where request.organization_id = p_organization_id
  order by case when request.status = 'pending' then 0 else 1 end,
    request.requested_at desc,
    request.id desc;
end;
$$;

create or replace function public.review_production_cash_advance(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.production_cash_advance_requests%rowtype;
  v_assignment public.production_box_maker_assignments%rowtype;
  v_fund public.project_funds%rowtype;
  v_amount numeric(14,2);
  v_available numeric(14,2);
begin
  -- Read the request first only to discover the assignment. The approval
  -- path must lock the assignment before the request so it follows the same
  -- order used by assignment archival and cannot deadlock with it.
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id;
  if not found then
    raise exception 'Production cash advance request not found';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review Production cash advances';
  end if;
  if p_decision not in ('approved', 'rejected') or v_request.status <> 'pending' then
    raise exception 'This cash advance request is no longer awaiting approval';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot approve your own cash advance request';
  end if;
  if length(btrim(coalesce(p_decision_note, ''))) > 2000 then
    raise exception 'The decision remark cannot exceed 2000 characters';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_decision_note, '')), '') is null then
    raise exception 'A rejection remark is required';
  end if;

  if p_decision = 'rejected' then
    select * into v_request
    from public.production_cash_advance_requests request
    where request.id = p_request_id
    for update;
    if not found then
      raise exception 'Production cash advance request not found';
    end if;
    if v_request.status <> 'pending' then
      raise exception 'This cash advance request is no longer awaiting approval';
    end if;
    if v_request.requested_by = (select auth.uid()) then
      raise exception 'You cannot reject your own cash advance request';
    end if;
    update public.production_cash_advance_requests request
    set status = 'rejected',
        decided_by = (select auth.uid()),
        decided_at = now(),
        decision_note = nullif(btrim(p_decision_note), ''),
        updated_at = now()
    where request.id = v_request.id;
    return;
  end if;

  select * into v_assignment
  from public.production_box_maker_assignments assignment
  where assignment.id = v_request.assignment_id
    and assignment.organization_id = v_request.organization_id
    and assignment.production_job_id = v_request.production_job_id
    and assignment.is_active
  for update;
  if not found then
    raise exception 'The Box Maker assignment is no longer active';
  end if;

  -- Re-read and lock the request after the assignment lock. Assignment
  -- archival uses this same assignment-then-request order.
  select * into v_request
  from public.production_cash_advance_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Production cash advance request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This cash advance request is no longer awaiting approval';
  end if;
  if v_request.assignment_id <> v_assignment.id
    or v_request.organization_id <> v_assignment.organization_id
    or v_request.production_job_id <> v_assignment.production_job_id then
    raise exception 'The cash advance request is no longer linked to this Box Maker assignment';
  end if;
  if v_request.requested_by = (select auth.uid()) then
    raise exception 'You cannot approve your own cash advance request';
  end if;

  select * into v_fund
  from public.project_funds fund
  where fund.id = v_request.project_fund_id
    and fund.organization_id = v_request.organization_id
  for update;
  if not found or v_fund.status <> 'open' then
    raise exception 'The Project Fund is not open';
  end if;
  if not exists (
    select 1
    from public.production_jobs job
    where job.id = v_request.production_job_id
      and job.organization_id = v_request.organization_id
      and (v_fund.production_job_id = job.id or v_fund.quotation_id = job.quotation_id)
  ) then
    raise exception 'The cash advance is not linked to the selected project fund';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_fund.id::text));
  select round(coalesce(sum(
    case when entry.direction = 'credit' then entry.amount else -entry.amount end
  ) filter (where not entry.is_voided), 0), 2)
  into v_available
  from public.project_fund_entries entry
  where entry.project_fund_id = v_fund.id;

  v_amount := round(v_request.requested_amount, 2);
  if v_amount > greatest(v_available, 0) + 0.001 then
    raise exception 'The Project Fund has insufficient available balance for this request';
  end if;
  if v_assignment.cash_advance + v_amount > v_assignment.labor_cost + 0.001 then
    raise exception 'Cash advance cannot exceed the Box Maker balance';
  end if;
  if exists (
    select 1
    from public.project_fund_entries entry
    where entry.source_production_cash_advance_id = v_request.id
      and not entry.is_voided
  ) then
    raise exception 'This cash advance has already been deducted from the Project Fund';
  end if;

  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount,
    entry_date, note, source_production_cash_advance_id, created_by
  ) values (
    v_request.organization_id, v_fund.id, 'project_expense', 'debit', v_amount,
    current_date, 'Production cash advance for Box Maker', v_request.id, (select auth.uid())
  );

  update public.production_box_maker_assignments assignment
  set cash_advance = round(assignment.cash_advance + v_amount, 2),
      updated_by = (select auth.uid())
  where assignment.id = v_assignment.id;

  update public.production_cash_advance_requests request
  set status = 'approved',
      approved_amount = v_amount,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(p_decision_note), ''),
      updated_at = now()
  where request.id = v_request.id;
end;
$$;

revoke all on function public.get_production_operator_details(uuid, uuid) from public, anon;
grant execute on function public.get_production_operator_details(uuid, uuid) to authenticated;
revoke all on function public.create_production_box_maker(uuid, text) from public, anon;
grant execute on function public.create_production_box_maker(uuid, text) to authenticated;
revoke all on function public.update_production_box_maker(uuid, uuid, text) from public, anon;
grant execute on function public.update_production_box_maker(uuid, uuid, text) to authenticated;
revoke all on function public.archive_production_box_maker(uuid, uuid) from public, anon;
grant execute on function public.archive_production_box_maker(uuid, uuid) to authenticated;
revoke all on function public.create_production_project_tier(uuid, uuid, numeric) from public, anon;
grant execute on function public.create_production_project_tier(uuid, uuid, numeric) to authenticated;
revoke all on function public.update_production_project_tier(uuid, uuid, numeric) from public, anon;
grant execute on function public.update_production_project_tier(uuid, uuid, numeric) to authenticated;
revoke all on function public.archive_production_project_tier(uuid, uuid) from public, anon;
grant execute on function public.archive_production_project_tier(uuid, uuid) to authenticated;
revoke all on function public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, date) from public, anon;
grant execute on function public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, date) to authenticated;
revoke all on function public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, date) from public, anon;
grant execute on function public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, date) to authenticated;
revoke all on function public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date) from public, anon;
grant execute on function public.create_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date) to authenticated;
revoke all on function public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date) from public, anon;
grant execute on function public.update_production_box_maker_assignment(uuid, uuid, uuid, numeric, numeric, date) to authenticated;
revoke all on function public.archive_production_box_maker_assignment(uuid, uuid) from public, anon;
grant execute on function public.archive_production_box_maker_assignment(uuid, uuid) to authenticated;
revoke all on function public.request_production_cash_advance(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.request_production_cash_advance(uuid, uuid, numeric, text) to authenticated;
revoke all on function public.list_production_cash_advance_requests(uuid) from public, anon;
grant execute on function public.list_production_cash_advance_requests(uuid) to authenticated;
revoke all on function public.review_production_cash_advance(uuid, text, text) from public, anon;
grant execute on function public.review_production_cash_advance(uuid, text, text) to authenticated;
revoke all on function public.count_pending_production_cash_advance_requests(uuid) from public, anon;
grant execute on function public.count_pending_production_cash_advance_requests(uuid) to authenticated;

-- Keep Super Admin access changes in one database transaction. The route
-- handler still updates the Auth account separately, but all workspace role,
-- capability, and production permission rows now commit or roll back together.
create or replace function public.update_super_admin_managed_user_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_role public.member_role,
  p_revised_finance_enabled boolean,
  p_production_approval_enabled boolean,
  p_production_operations_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := now();
begin
  if (select auth.uid()) is not null
    and (select auth.uid()) <> p_actor_user_id then
    raise exception 'The access change actor does not match the authenticated user';
  end if;
  if not exists (
    select 1
    from public.organization_members actor
    where actor.organization_id = p_organization_id
      and actor.user_id = p_actor_user_id
      and actor.role::text = 'super_admin'
  ) then
    raise exception 'Only the Super Admin can change workspace access';
  end if;
  if p_user_id = p_actor_user_id then
    raise exception 'The Super Admin account cannot be changed here';
  end if;
  if p_role::text = 'super_admin' then
    raise exception 'The Super Admin role cannot be assigned here';
  end if;
  if p_production_approval_enabled and p_role::text <> 'sales_pricing_officer' then
    raise exception 'Production approval can only be assigned to a Sales & Pricing Officer';
  end if;
  if p_revised_finance_enabled and p_role::text <> 'sales_pricing_officer' then
    raise exception 'Revised Finance access can only be assigned to a Sales & Pricing Officer';
  end if;

  update public.organization_members member
  set role = p_role
  where member.organization_id = p_organization_id
    and member.user_id = p_user_id;
  if not found then
    raise exception 'This user is not assigned to this workspace';
  end if;

  if p_role::text <> 'sales_pricing_officer' then
    delete from public.pricing_officer_project_types assignment
    where assignment.organization_id = p_organization_id
      and assignment.pricing_officer_user_id = p_user_id;
  end if;

  if p_revised_finance_enabled then
    insert into public.organization_member_capabilities (
      organization_id, user_id, capability, granted_by
    ) values (
      p_organization_id, p_user_id, 'revised_finance', p_actor_user_id
    )
    on conflict (organization_id, user_id, capability)
    do update set granted_by = excluded.granted_by;
  else
    delete from public.organization_member_capabilities capability
    where capability.organization_id = p_organization_id
      and capability.user_id = p_user_id
      and capability.capability = 'revised_finance';
  end if;

  if p_production_approval_enabled then
    insert into public.production_approval_permissions (
      organization_id, user_id, is_active, granted_by, granted_at,
      revoked_by, revoked_at, updated_at
    ) values (
      p_organization_id, p_user_id, true, p_actor_user_id, v_now,
      null, null, v_now
    )
    on conflict (organization_id, user_id)
    do update set
      is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      revoked_by = null,
      revoked_at = null,
      updated_at = excluded.updated_at;
  else
    update public.production_approval_permissions permission
    set is_active = false,
        revoked_by = p_actor_user_id,
        revoked_at = v_now,
        updated_at = v_now
    where permission.organization_id = p_organization_id
      and permission.user_id = p_user_id;
  end if;

  if p_production_operations_enabled then
    insert into public.production_operations_permissions (
      organization_id, user_id, is_active, granted_by, granted_at,
      revoked_by, revoked_at, updated_at
    ) values (
      p_organization_id, p_user_id, true, p_actor_user_id, v_now,
      null, null, v_now
    )
    on conflict (organization_id, user_id)
    do update set
      is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      revoked_by = null,
      revoked_at = null,
      updated_at = excluded.updated_at;
  else
    update public.production_operations_permissions permission
    set is_active = false,
        revoked_by = p_actor_user_id,
        revoked_at = v_now,
        updated_at = v_now
    where permission.organization_id = p_organization_id
      and permission.user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.update_super_admin_managed_user_access(
  uuid, uuid, uuid, public.member_role, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.update_super_admin_managed_user_access(
  uuid, uuid, uuid, public.member_role, boolean, boolean, boolean
) to service_role;

-- The finance fund creator must never inherit anonymous execution through the
-- PUBLIC role. Keep the existing authenticated application path intact.
revoke execute on function public.create_project_fund(
  uuid, uuid, uuid, uuid, text, text, numeric, text
) from public, anon;
grant execute on function public.create_project_fund(
  uuid, uuid, uuid, uuid, text, text, numeric, text
) to authenticated, service_role;

drop trigger if exists production_box_makers_updated_at on public.production_box_makers;
create trigger production_box_makers_updated_at
before update on public.production_box_makers
for each row execute function public.set_updated_at();

drop trigger if exists production_project_tiers_updated_at on public.production_project_tiers;
create trigger production_project_tiers_updated_at
before update on public.production_project_tiers
for each row execute function public.set_updated_at();

drop trigger if exists production_box_maker_assignments_updated_at
  on public.production_box_maker_assignments;
create trigger production_box_maker_assignments_updated_at
before update on public.production_box_maker_assignments
for each row execute function public.set_updated_at();

drop trigger if exists production_cash_advance_requests_updated_at
  on public.production_cash_advance_requests;
create trigger production_cash_advance_requests_updated_at
before update on public.production_cash_advance_requests
for each row execute function public.set_updated_at();

commit;
