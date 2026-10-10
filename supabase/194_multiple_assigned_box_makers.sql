-- Allow a production request to have multiple equal box-maker co-assignees.
-- Run after 193_finance_payment_reconciliation_and_supplier_costing.sql and
-- before deploying the matching workspace update. Safe to re-run.

begin;

create or replace function private.is_valid_assigned_box_makers(
  p_values text[]
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_values is not null
    and cardinality(p_values) between 1 and 8
    and not exists (
      select 1
      from unnest(p_values) as item(value)
      where item.value is null
        or item.value not in (
          'Kuya Diego',
          'Kuya Ted',
          'Kuya Bimbo',
          'Kuya Rex',
          'Kuya Jeff',
          'Kuya Mity',
          'Kuya Aries',
          'Kuya Archie'
        )
    )
    and cardinality(p_values) = (
      select count(distinct item.value)::integer
      from unnest(p_values) as item(value)
    ),
    false
  );
$$;

alter table public.project_schedules
  add column if not exists assigned_box_makers text[];

alter table public.production_jobs
  add column if not exists assigned_box_makers text[];

update public.project_schedules
set assigned_box_makers = array[assigned_box_maker]::text[]
where assigned_box_makers is null
  and assigned_box_maker is not null;

update public.production_jobs
set assigned_box_makers = array[assigned_box_maker]::text[]
where assigned_box_makers is null
  and assigned_box_maker is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_schedules'::regclass
      and conname = 'project_schedules_assigned_box_makers_check'
  ) then
    alter table public.project_schedules
      add constraint project_schedules_assigned_box_makers_check
      check (
        assigned_box_makers is null
        or private.is_valid_assigned_box_makers(assigned_box_makers)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.production_jobs'::regclass
      and conname = 'production_jobs_assigned_box_makers_check'
  ) then
    alter table public.production_jobs
      add constraint production_jobs_assigned_box_makers_check
      check (
        assigned_box_makers is null
        or private.is_valid_assigned_box_makers(assigned_box_makers)
      );
  end if;
end;
$$;

create index if not exists project_schedules_box_makers_gin_idx
  on public.project_schedules using gin (assigned_box_makers);

create index if not exists production_jobs_box_makers_gin_idx
  on public.production_jobs using gin (assigned_box_makers);

create or replace function private.effective_assigned_box_makers(
  p_values text[],
  p_legacy_value text
)
returns text[]
language sql
immutable
as $$
  select case
    when p_values is not null and cardinality(p_values) > 0 then p_values
    when p_legacy_value is not null and btrim(p_legacy_value) <> '' then array[p_legacy_value]::text[]
    else null
  end;
$$;

create or replace function private.same_assigned_box_maker_set(
  p_left text[],
  p_right text[]
)
returns boolean
language sql
immutable
as $$
  select case
    when p_left is null or p_right is null then p_left is not distinct from p_right
    else cardinality(p_left) = cardinality(p_right)
      and p_left <@ p_right
      and p_right <@ p_left
  end;
$$;

revoke all on function private.is_valid_assigned_box_makers(text[]) from public;
grant execute on function private.is_valid_assigned_box_makers(text[]) to authenticated;
revoke all on function private.effective_assigned_box_makers(text[], text) from public;
grant execute on function private.effective_assigned_box_makers(text[], text) to authenticated;
revoke all on function private.same_assigned_box_maker_set(text[], text[]) from public;

create or replace function private.validate_project_schedule_agreement(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_assigned_box_makers text[],
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_valid_assigned_box_makers(p_assigned_box_makers) then
    raise exception 'Select at least one valid assigned box maker';
  end if;

  if p_file_name is null
    or nullif(btrim(p_file_name), '') is null
    or length(btrim(p_file_name)) > 255 then
    raise exception 'Upload the agreement file';
  end if;

  if p_content_type is null
    or p_content_type not in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    )
    or p_file_size is null
    or p_file_size <= 0
    or p_file_size > 10485760 then
    raise exception 'Agreements must be JPEG, PNG, WebP, or PDF files no larger than 10 MB';
  end if;

  if p_organization_id is null
    or p_schedule_id is null
    or p_storage_path is null
    or p_storage_path !~* (
      '^' || p_organization_id::text || '/' || p_schedule_id::text
        || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'
    ) then
    raise exception 'Agreement storage path is invalid';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'production-agreements'
      and object.name = p_storage_path
  ) then
    raise exception 'Upload the agreement before submitting the production request';
  end if;
end;
$$;

revoke all on function private.validate_project_schedule_agreement(
  uuid,
  uuid,
  text[],
  text,
  text,
  text,
  bigint
) from public;

-- Keep the scalar validator compatible while routing it through the same
-- fixed-name validation used by the new multi-assignee workflow.
create or replace function private.validate_project_schedule_agreement(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_assigned_box_maker text,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.validate_project_schedule_agreement(
    p_organization_id,
    p_schedule_id,
    array[p_assigned_box_maker]::text[],
    p_storage_path,
    p_file_name,
    p_content_type,
    p_file_size
  );
end;
$$;

revoke all on function private.validate_project_schedule_agreement(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint
) from public;

-- New submissions use an array parameter. The existing scalar RPC remains
-- available for older clients and is replaced below to populate the array.
create or replace function public.submit_project_schedule_with_box_makers(
  p_schedule_id uuid,
  p_quotation_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date,
  p_assigned_box_makers text[],
  p_agreement_storage_path text,
  p_agreement_file_name text,
  p_agreement_content_type text,
  p_agreement_file_size bigint
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_schedule public.project_schedules%rowtype;
begin
  if p_start_date is null
    or p_due_date is null
    or p_due_date < p_start_date then
    raise exception 'The deadline cannot be before the start date';
  end if;

  if nullif(btrim(p_project_name), '') is null
    or nullif(btrim(p_client_name), '') is null
    or nullif(btrim(p_product_name), '') is null
    or p_quantity is null
    or p_quantity <= 0 then
    raise exception 'Project, client, product, and a positive quantity are required';
  end if;

  select *
    into v_quotation
  from public.quotations
  where id = p_quotation_id
  for share;

  if not found
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.costing_source_id is not null
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved direct Price Quotation';
  end if;

  if v_quotation.created_by is distinct from (select auth.uid())
    or not private.has_text_role(v_quotation.organization_id, array['project_manager']) then
    raise exception 'Only the Project Officer who prepared this Price Quotation can request production';
  end if;

  if exists (
    select 1
    from public.project_schedules schedule
    where schedule.organization_id = v_quotation.organization_id
      and schedule.quotation_id = v_quotation.id
  ) then
    raise exception 'This Price Quotation already has a production request';
  end if;

  perform private.validate_project_schedule_attachments(
    v_quotation.organization_id,
    v_quotation.id,
    null,
    null,
    null
  );

  perform private.validate_project_schedule_agreement(
    v_quotation.organization_id,
    p_schedule_id,
    p_assigned_box_makers,
    p_agreement_storage_path,
    p_agreement_file_name,
    p_agreement_content_type,
    p_agreement_file_size
  );

  insert into public.project_schedules (
    id,
    organization_id,
    quotation_id,
    project_name,
    client_name,
    product_name,
    quantity,
    start_date,
    due_date,
    assigned_to,
    created_by,
    status,
    submitted_at,
    assigned_box_maker,
    assigned_box_makers,
    agreement_storage_path,
    agreement_file_name,
    agreement_content_type,
    agreement_file_size
  ) values (
    p_schedule_id,
    v_quotation.organization_id,
    v_quotation.id,
    btrim(p_project_name),
    btrim(p_client_name),
    btrim(p_product_name),
    p_quantity,
    p_start_date,
    p_due_date,
    (select auth.uid()),
    (select auth.uid()),
    'pending'::public.approval_status,
    now(),
    p_assigned_box_makers[1],
    p_assigned_box_makers,
    p_agreement_storage_path,
    btrim(p_agreement_file_name),
    p_agreement_content_type,
    p_agreement_file_size
  )
  returning * into v_schedule;

  return v_schedule;
end;
$$;

create or replace function public.submit_project_schedule(
  p_schedule_id uuid,
  p_quotation_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date,
  p_assigned_box_maker text,
  p_agreement_storage_path text,
  p_agreement_file_name text,
  p_agreement_content_type text,
  p_agreement_file_size bigint
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return public.submit_project_schedule_with_box_makers(
    p_schedule_id,
    p_quotation_id,
    p_project_name,
    p_client_name,
    p_product_name,
    p_quantity,
    p_start_date,
    p_due_date,
    array[p_assigned_box_maker]::text[],
    p_agreement_storage_path,
    p_agreement_file_name,
    p_agreement_content_type,
    p_agreement_file_size
  );
end;
$$;

create or replace function public.resubmit_project_schedule_with_box_makers(
  p_schedule_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date,
  p_assigned_box_makers text[],
  p_agreement_storage_path text,
  p_agreement_file_name text,
  p_agreement_content_type text,
  p_agreement_file_size bigint
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_quotation public.quotations%rowtype;
begin
  if p_start_date is null
    or p_due_date is null
    or p_due_date < p_start_date then
    raise exception 'The deadline cannot be before the start date';
  end if;

  if nullif(btrim(p_project_name), '') is null
    or nullif(btrim(p_client_name), '') is null
    or nullif(btrim(p_product_name), '') is null
    or p_quantity is null
    or p_quantity <= 0 then
    raise exception 'Project, client, product, and a positive quantity are required';
  end if;

  select *
    into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found
    or v_schedule.assigned_to is distinct from (select auth.uid())
    or v_schedule.created_by is distinct from (select auth.uid())
    or not private.has_text_role(v_schedule.organization_id, array['project_manager']) then
    raise exception 'Only the submitting Project Officer can resubmit this project';
  end if;

  if v_schedule.status <> 'rejected'::public.approval_status then
    raise exception 'Only rejected project schedules can be resubmitted';
  end if;

  select *
    into v_quotation
  from public.quotations
  where id = v_schedule.quotation_id
  for share;

  if not found
    or v_quotation.organization_id is distinct from v_schedule.organization_id
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.costing_source_id is not null
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved direct Price Quotation';
  end if;

  perform private.validate_project_schedule_attachments(
    v_schedule.organization_id,
    v_schedule.quotation_id,
    null,
    null,
    null
  );

  perform private.validate_project_schedule_agreement(
    v_schedule.organization_id,
    v_schedule.id,
    p_assigned_box_makers,
    p_agreement_storage_path,
    p_agreement_file_name,
    p_agreement_content_type,
    p_agreement_file_size
  );

  update public.project_schedules
  set
    quotation_no = coalesce(v_quotation.quotation_no, ''),
    project_name = btrim(p_project_name),
    client_name = btrim(p_client_name),
    product_name = btrim(p_product_name),
    quantity = p_quantity,
    start_date = p_start_date,
    due_date = p_due_date,
    assigned_box_maker = p_assigned_box_makers[1],
    assigned_box_makers = p_assigned_box_makers,
    agreement_storage_path = p_agreement_storage_path,
    agreement_file_name = btrim(p_agreement_file_name),
    agreement_content_type = p_agreement_content_type,
    agreement_file_size = p_agreement_file_size,
    status = 'pending'::public.approval_status,
    submitted_at = now(),
    decided_by = null,
    decided_at = null,
    decision_note = null,
    production_job_id = null
  where id = v_schedule.id
  returning * into v_schedule;

  return v_schedule;
end;
$$;

create or replace function public.resubmit_project_schedule_with_agreement(
  p_schedule_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date,
  p_assigned_box_maker text,
  p_agreement_storage_path text,
  p_agreement_file_name text,
  p_agreement_content_type text,
  p_agreement_file_size bigint
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return public.resubmit_project_schedule_with_box_makers(
    p_schedule_id,
    p_project_name,
    p_client_name,
    p_product_name,
    p_quantity,
    p_start_date,
    p_due_date,
    array[p_assigned_box_maker]::text[],
    p_agreement_storage_path,
    p_agreement_file_name,
    p_agreement_content_type,
    p_agreement_file_size
  );
end;
$$;

create or replace function public.resubmit_project_schedule(
  p_schedule_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_assigned_box_makers text[];
begin
  select *
    into v_schedule
  from public.project_schedules
  where id = p_schedule_id;

  if not found then
    raise exception 'Project schedule was not found';
  end if;

  v_assigned_box_makers := private.effective_assigned_box_makers(
    v_schedule.assigned_box_makers,
    v_schedule.assigned_box_maker
  );

  if v_assigned_box_makers is null
    or v_schedule.agreement_storage_path is null
    or v_schedule.agreement_file_name is null
    or v_schedule.agreement_content_type is null
    or v_schedule.agreement_file_size is null then
    raise exception 'Select at least one assigned box maker and upload the agreement before resubmitting this project';
  end if;

  return public.resubmit_project_schedule_with_box_makers(
    p_schedule_id,
    p_project_name,
    p_client_name,
    p_product_name,
    p_quantity,
    p_start_date,
    p_due_date,
    v_assigned_box_makers,
    v_schedule.agreement_storage_path,
    v_schedule.agreement_file_name,
    v_schedule.agreement_content_type,
    v_schedule.agreement_file_size
  );
end;
$$;

revoke all on function public.submit_project_schedule_with_box_makers(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  date,
  date,
  text[],
  text,
  text,
  text,
  bigint
) from public;
grant execute on function public.submit_project_schedule_with_box_makers(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  date,
  date,
  text[],
  text,
  text,
  text,
  bigint
) to authenticated;

revoke all on function public.resubmit_project_schedule_with_box_makers(
  uuid,
  text,
  text,
  text,
  numeric,
  date,
  date,
  text[],
  text,
  text,
  text,
  bigint
) from public;
grant execute on function public.resubmit_project_schedule_with_box_makers(
  uuid,
  text,
  text,
  text,
  numeric,
  date,
  date,
  text[],
  text,
  text,
  text,
  bigint
) to authenticated;

-- Keep the defensive direct-insert policy aligned with the new list while
-- retaining the old scalar fallback for already deployed callers.
drop policy if exists "project schedules: project officer submit"
  on public.project_schedules;
create policy "project schedules: project officer submit"
on public.project_schedules for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'pending'::public.approval_status
  and (select private.has_text_role(organization_id, array['project_manager']))
  and private.is_valid_assigned_box_makers(
    private.effective_assigned_box_makers(assigned_box_makers, assigned_box_maker)
  )
  and agreement_storage_path is not null
  and agreement_file_name is not null
  and agreement_content_type in (
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  )
  and agreement_file_size > 0
  and agreement_file_size <= 10485760
  and agreement_storage_path ~* (
    '^' || organization_id::text || '/' || id::text
      || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'
  )
);

-- Production job assignment and agreement fields remain authoritative from
-- the approved schedule. The legacy scalar is retained as a compatibility
-- mirror of the first selected co-assignee.
drop function if exists private.guard_production_job_agreement_fields();
create function private.guard_production_job_agreement_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
begin
  if tg_op = 'INSERT'
    and new.project_schedule_id is null
    and (
      new.assigned_box_maker is not null
      or new.assigned_box_makers is not null
      or new.agreement_storage_path is not null
      or new.agreement_file_name is not null
      or new.agreement_content_type is not null
      or new.agreement_file_size is not null
    ) then
    raise exception 'Production agreement fields must come from an approved Project Calendar schedule';
  end if;

  if tg_op = 'UPDATE'
    and new.project_schedule_id is null
    and old.project_schedule_id is not null
    and new.assigned_box_maker is null
    and new.assigned_box_makers is null
    and new.agreement_storage_path is null
    and new.agreement_file_name is null
    and new.agreement_content_type is null
    and new.agreement_file_size is null
    and private.is_org_admin(new.organization_id) then
    return new;
  end if;

  if (
    tg_op = 'INSERT'
    and new.project_schedule_id is not null
  ) or (
    tg_op = 'UPDATE'
    and (
      new.project_schedule_id is distinct from old.project_schedule_id
      or new.assigned_box_maker is distinct from old.assigned_box_maker
      or new.assigned_box_makers is distinct from old.assigned_box_makers
      or new.agreement_storage_path is distinct from old.agreement_storage_path
      or new.agreement_file_name is distinct from old.agreement_file_name
      or new.agreement_content_type is distinct from old.agreement_content_type
      or new.agreement_file_size is distinct from old.agreement_file_size
    )
  ) then
    if new.project_schedule_id is null then
      raise exception 'Production agreement fields must remain linked to a Project Calendar schedule';
    end if;

    select *
      into v_schedule
    from public.project_schedules
    where id = new.project_schedule_id;

    if not found
      or v_schedule.status <> 'approved'::public.approval_status
      or v_schedule.organization_id is distinct from new.organization_id
      or not private.same_assigned_box_maker_set(
        private.effective_assigned_box_makers(new.assigned_box_makers, new.assigned_box_maker),
        private.effective_assigned_box_makers(v_schedule.assigned_box_makers, v_schedule.assigned_box_maker)
      )
      or new.agreement_storage_path is distinct from v_schedule.agreement_storage_path
      or new.agreement_file_name is distinct from v_schedule.agreement_file_name
      or new.agreement_content_type is distinct from v_schedule.agreement_content_type
      or new.agreement_file_size is distinct from v_schedule.agreement_file_size then
      raise exception 'Production agreement fields must match the approved Project Calendar schedule';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists production_jobs_agreement_fields_guard
  on public.production_jobs;
create trigger production_jobs_agreement_fields_guard
before insert or update of project_schedule_id, assigned_box_maker,
  assigned_box_makers, agreement_storage_path, agreement_file_name,
  agreement_content_type, agreement_file_size
on public.production_jobs
for each row execute function private.guard_production_job_agreement_fields();

create or replace function public.ensure_production_job_for_project_schedule(
  p_schedule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_quotation public.quotations%rowtype;
  v_job public.production_jobs%rowtype;
  v_assigned_box_makers text[];
begin
  select *
    into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found or v_schedule.status::text <> 'approved' then
    raise exception 'Only an approved production request can create a production job';
  end if;

  v_assigned_box_makers := private.effective_assigned_box_makers(
    v_schedule.assigned_box_makers,
    v_schedule.assigned_box_maker
  );

  if v_assigned_box_makers is not null
    or v_schedule.agreement_storage_path is not null
    or v_schedule.agreement_file_name is not null
    or v_schedule.agreement_content_type is not null
    or v_schedule.agreement_file_size is not null then
    perform private.validate_project_schedule_agreement(
      v_schedule.organization_id,
      v_schedule.id,
      v_assigned_box_makers,
      v_schedule.agreement_storage_path,
      v_schedule.agreement_file_name,
      v_schedule.agreement_content_type,
      v_schedule.agreement_file_size
    );
  end if;

  perform private.validate_project_schedule_attachments(
    v_schedule.organization_id,
    v_schedule.quotation_id,
    v_schedule.mockup_quotation_id,
    v_schedule.price_signed_proof_id,
    v_schedule.mockup_signed_proof_id
  );

  select *
    into v_quotation
  from public.quotations
  where id = v_schedule.quotation_id;

  if not found then
    raise exception 'The approved Price Quotation could not be found';
  end if;

  select *
    into v_job
  from public.production_jobs
  where quotation_id = v_schedule.quotation_id
  for update;

  if not found then
    insert into public.production_jobs (
      organization_id,
      job_no,
      quotation_id,
      customer_id,
      title,
      status,
      due_date,
      notes,
      project_schedule_id,
      mockup_quotation_id,
      price_signed_proof_id,
      mockup_signed_proof_id,
      assigned_box_maker,
      assigned_box_makers,
      agreement_storage_path,
      agreement_file_name,
      agreement_content_type,
      agreement_file_size
    )
    values (
      v_schedule.organization_id,
      'JOB-' || to_char(current_date, 'YYYY') || '-' || substr(replace(v_quotation.id::text, '-', ''), 1, 6),
      v_quotation.id,
      v_quotation.customer_id,
      coalesce(v_quotation.project_name, 'Quotation ' || v_quotation.quotation_no),
      'queued',
      v_schedule.due_date,
      v_quotation.notes,
      v_schedule.id,
      v_schedule.mockup_quotation_id,
      v_schedule.price_signed_proof_id,
      v_schedule.mockup_signed_proof_id,
      v_assigned_box_makers[1],
      v_assigned_box_makers,
      v_schedule.agreement_storage_path,
      v_schedule.agreement_file_name,
      v_schedule.agreement_content_type,
      v_schedule.agreement_file_size
    )
    returning * into v_job;
  else
    update public.production_jobs
    set
      project_schedule_id = v_schedule.id,
      mockup_quotation_id = v_schedule.mockup_quotation_id,
      price_signed_proof_id = v_schedule.price_signed_proof_id,
      mockup_signed_proof_id = v_schedule.mockup_signed_proof_id,
      assigned_box_maker = v_assigned_box_makers[1],
      assigned_box_makers = v_assigned_box_makers,
      agreement_storage_path = v_schedule.agreement_storage_path,
      agreement_file_name = v_schedule.agreement_file_name,
      agreement_content_type = v_schedule.agreement_content_type,
      agreement_file_size = v_schedule.agreement_file_size,
      due_date = v_schedule.due_date,
      customer_id = v_quotation.customer_id,
      title = coalesce(v_quotation.project_name, 'Quotation ' || v_quotation.quotation_no),
      notes = v_quotation.notes
    where id = v_job.id
    returning * into v_job;
  end if;

  update public.project_schedules
  set production_job_id = v_job.id
  where id = v_schedule.id;

  return v_job.id;
end;
$$;

create or replace function public.delete_project_schedule(
  p_schedule_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
  v_agreement_storage_path text;
begin
  select *
    into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Project schedule was not found';
  end if;

  if not private.is_org_admin(v_schedule.organization_id) then
    raise exception 'Only the General Manager can delete this production schedule';
  end if;

  if v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'Only an approved production schedule can be deleted';
  end if;

  v_agreement_storage_path := v_schedule.agreement_storage_path;

  update public.production_jobs
  set
    project_schedule_id = null,
    assigned_box_maker = null,
    assigned_box_makers = null,
    agreement_storage_path = null,
    agreement_file_name = null,
    agreement_content_type = null,
    agreement_file_size = null
  where organization_id = v_schedule.organization_id
    and project_schedule_id = v_schedule.id;

  delete from public.project_schedules
  where id = v_schedule.id;

  return v_agreement_storage_path;
end;
$$;

commit;
