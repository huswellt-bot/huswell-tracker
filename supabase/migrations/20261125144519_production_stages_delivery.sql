-- Production Monitoring stages, project due dates, and delivery evidence.
-- This migration is additive and keeps the legacy Project Calendar completion
-- workflow compatible while stopping it from skipping the Completed stage.

begin;

alter table public.production_jobs
  add column if not exists production_project_due_date date,
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists delivered_by uuid references auth.users(id) on delete set null,
  add column if not exists delivery_proof_storage_path text,
  add column if not exists delivery_proof_file_name text,
  add column if not exists delivery_proof_content_type text,
  add column if not exists delivery_proof_file_size bigint,
  add column if not exists payment_receipt_storage_path text,
  add column if not exists payment_receipt_file_name text,
  add column if not exists payment_receipt_content_type text,
  add column if not exists payment_receipt_file_size bigint;

create index if not exists production_jobs_delivery_evidence_idx
  on public.production_jobs (organization_id, delivered_at desc)
  where delivered_at is not null;

-- Every organization member may read the Production workspace. Mutations still
-- use private.has_production_operations in their RPCs.
create or replace function private.can_view_production(
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
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function private.can_view_production(uuid) from public, anon;
grant execute on function private.can_view_production(uuid) to authenticated;

drop policy if exists "production status types: operations read"
  on public.production_status_types;
create policy "production status types: operations read"
on public.production_status_types for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production box makers: operations read"
  on public.production_box_makers;
create policy "production box makers: operations read"
on public.production_box_makers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production project tiers: operations read"
  on public.production_project_tiers;
create policy "production project tiers: operations read"
on public.production_project_tiers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production assignment tiers: operations read"
  on public.production_box_maker_assignment_tiers;
create policy "production assignment tiers: operations read"
on public.production_box_maker_assignment_tiers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production box maker assignments: operations read"
  on public.production_box_maker_assignments;
create policy "production box maker assignments: operations read"
on public.production_box_maker_assignments for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production cash advance requests: operations or management read"
  on public.production_cash_advance_requests;
create policy "production cash advance requests: operations or management read"
on public.production_cash_advance_requests for select to authenticated
using ((select private.can_view_production(organization_id)));

-- A small shared validator keeps the RPC from trusting browser-supplied file
-- metadata. The storage object must already exist in the private bucket.
create or replace function private.validate_production_delivery_image(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public, private, storage
as $$
declare
  v_actual_content_type text;
  v_actual_file_size bigint;
begin
  if p_storage_path is null
    or p_file_name is null
    or p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_file_size is null
    or p_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP image no larger than 10 MB';
  end if;

  if p_file_name ~ '/' or length(btrim(p_file_name)) > 255 then
    raise exception 'Delivery evidence file name is invalid';
  end if;

  if p_storage_path !~* (
    '^' || p_organization_id::text || '/production-jobs/' ||
    p_production_job_id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Delivery evidence storage path is invalid';
  end if;

  if lower(reverse(split_part(reverse(p_file_name), '.', 1))) <>
     lower(split_part(split_part(p_storage_path, '/', 4), '.', 2)) then
    raise exception 'Delivery evidence file extension does not match its storage path';
  end if;

  select object_row.metadata ->> 'mimetype',
    case
      when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (object_row.metadata ->> 'size')::bigint
      else null
    end
  into v_actual_content_type, v_actual_file_size
  from storage.objects object_row
  where object_row.bucket_id = 'production-delivery-evidence'
    and object_row.name = p_storage_path;

  if not found then
    raise exception 'Delivery evidence upload could not be found';
  end if;
  if v_actual_content_type is distinct from p_content_type
    or v_actual_file_size is distinct from p_file_size then
    raise exception 'Delivery evidence metadata does not match the uploaded file';
  end if;
end;
$$;

revoke all on function private.validate_production_delivery_image(uuid, uuid, text, text, text, bigint)
  from public, anon;
grant execute on function private.validate_production_delivery_image(uuid, uuid, text, text, text, bigint)
  to authenticated;

create or replace function private.can_view_production_delivery_evidence(
  p_organization_id uuid,
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_view_production(p_organization_id)
    and exists (
      select 1
      from public.production_jobs job
      where job.organization_id = p_organization_id
        and (
          job.delivery_proof_storage_path = p_storage_path
          or job.payment_receipt_storage_path = p_storage_path
        )
    );
$$;

revoke all on function private.can_view_production_delivery_evidence(uuid, text)
  from public, anon;
grant execute on function private.can_view_production_delivery_evidence(uuid, text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'production-delivery-evidence',
  'production-delivery-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "production delivery evidence: operations upload" on storage.objects;
create policy "production delivery evidence: operations upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'production-delivery-evidence'
  and name ~* '^[0-9a-f-]{36}/production-jobs/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.has_production_operations(split_part(name, '/', 1)::uuid)
);

drop policy if exists "production delivery evidence: workspace read" on storage.objects;
create policy "production delivery evidence: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'production-delivery-evidence'
  and name ~* '^[0-9a-f-]{36}/production-jobs/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and private.can_view_production_delivery_evidence(
    split_part(storage.objects.name, '/', 1)::uuid,
    storage.objects.name
  )
);

drop policy if exists "production delivery evidence: pending owner read" on storage.objects;
create policy "production delivery evidence: pending owner read"
on storage.objects for select to authenticated
using (
  bucket_id = 'production-delivery-evidence'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1
    from public.production_jobs job
    where job.delivery_proof_storage_path = storage.objects.name
      or job.payment_receipt_storage_path = storage.objects.name
  )
);

drop policy if exists "production delivery evidence: pending owner delete" on storage.objects;
create policy "production delivery evidence: pending owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'production-delivery-evidence'
  and owner_id = (select auth.uid())::text
  and not exists (
    select 1
    from public.production_jobs job
    where job.delivery_proof_storage_path = storage.objects.name
      or job.payment_receipt_storage_path = storage.objects.name
  )
);

create or replace function public.mark_production_project_completed(
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
  v_completed_status uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status in ('completed'::public.production_status, 'delivered'::public.production_status) then
    raise exception 'This Production project has already reached a final stage';
  end if;
  if v_job.status = 'cancelled'::public.production_status then
    raise exception 'Cancelled Production projects cannot be completed';
  end if;

  select status_type.id into v_completed_status
  from public.production_status_types status_type
  where status_type.organization_id = p_organization_id
    and status_type.legacy_status = 'completed'::public.production_status
  order by status_type.is_system desc, status_type.is_active desc, status_type.sort_order
  limit 1;

  update public.production_jobs job
  set status = 'completed'::public.production_status,
      production_status_type_id = coalesce(v_completed_status, job.production_status_type_id),
      completed_at = coalesce(job.completed_at, now()),
      completed_by = coalesce(job.completed_by, (select auth.uid()))
  where job.id = v_job.id;

  insert into public.production_job_activity
    (organization_id, production_job_id, action, note, actor_id)
  values (
    p_organization_id,
    v_job.id,
    'project_completed',
    'Production project marked Completed',
    (select auth.uid())
  );

  if v_job.project_schedule_id is not null then
    update public.project_schedules schedule
    set completed_at = coalesce(schedule.completed_at, now()),
        completed_by = coalesce(schedule.completed_by, (select auth.uid()))
    where schedule.id = v_job.project_schedule_id
      and schedule.organization_id = p_organization_id;

    update public.project_schedule_completion_requests request
    set status = 'cancelled'::public.approval_status,
        decided_by = (select auth.uid()),
        decided_at = now(),
        decision_note = 'Completed from Production Monitoring',
        updated_at = now()
    where request.schedule_id = v_job.project_schedule_id
      and request.status = 'pending'::public.approval_status;

    update public.leads lead
    set done_deal_status = greatest(coalesce(lead.done_deal_status, 0), 12)
    from public.project_schedules schedule
    join public.quotations quotation on quotation.id = schedule.quotation_id
    where schedule.id = v_job.project_schedule_id
      and lead.id = quotation.lead_id
      and lead.organization_id = p_organization_id
      and lead.evaluation_number = 7;
  end if;
end;
$$;

create or replace function public.mark_production_project_delivered(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_delivery_proof_storage_path text,
  p_delivery_proof_file_name text,
  p_delivery_proof_content_type text,
  p_delivery_proof_file_size bigint,
  p_payment_receipt_storage_path text,
  p_payment_receipt_file_name text,
  p_payment_receipt_content_type text,
  p_payment_receipt_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
  v_delivered_status uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status <> 'completed'::public.production_status then
    raise exception 'Only Completed Production projects can be delivered';
  end if;
  if v_job.delivered_at is not null
    or v_job.delivery_proof_storage_path is not null
    or v_job.payment_receipt_storage_path is not null then
    raise exception 'This Production project has already been delivered';
  end if;

  perform private.validate_production_delivery_image(
    p_organization_id, v_job.id, p_delivery_proof_storage_path,
    p_delivery_proof_file_name, p_delivery_proof_content_type,
    p_delivery_proof_file_size
  );
  perform private.validate_production_delivery_image(
    p_organization_id, v_job.id, p_payment_receipt_storage_path,
    p_payment_receipt_file_name, p_payment_receipt_content_type,
    p_payment_receipt_file_size
  );

  if p_delivery_proof_storage_path = p_payment_receipt_storage_path then
    raise exception 'Upload separate files for Proof of Delivery and Payment Receipt';
  end if;

  select status_type.id into v_delivered_status
  from public.production_status_types status_type
  where status_type.organization_id = p_organization_id
    and status_type.legacy_status = 'delivered'::public.production_status
  order by status_type.is_system desc, status_type.is_active desc, status_type.sort_order
  limit 1;

  update public.production_jobs job
  set status = 'delivered'::public.production_status,
      production_status_type_id = coalesce(v_delivered_status, job.production_status_type_id),
      completed_at = coalesce(job.completed_at, now()),
      completed_by = coalesce(job.completed_by, (select auth.uid())),
      delivered_at = now(),
      delivered_by = (select auth.uid()),
      delivery_proof_storage_path = p_delivery_proof_storage_path,
      delivery_proof_file_name = p_delivery_proof_file_name,
      delivery_proof_content_type = p_delivery_proof_content_type,
      delivery_proof_file_size = p_delivery_proof_file_size,
      payment_receipt_storage_path = p_payment_receipt_storage_path,
      payment_receipt_file_name = p_payment_receipt_file_name,
      payment_receipt_content_type = p_payment_receipt_content_type,
      payment_receipt_file_size = p_payment_receipt_file_size
  where job.id = v_job.id;

  insert into public.production_job_activity
    (organization_id, production_job_id, action, note, actor_id)
  values (
    p_organization_id,
    v_job.id,
    'project_delivered',
    'Production project marked Delivered with delivery evidence',
    (select auth.uid())
  );
end;
$$;

-- Project due dates are entered explicitly by Production Operations. Keep the
-- existing two-argument function internal to this wrapper so older callers
-- cannot add a project without a project deadline.
create or replace function public.add_production_operator_project(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job_id uuid;
begin
  if not private.has_production_operations(p_organization_id) then
    raise exception 'Production Operations permission is required';
  end if;
  if p_due_date is null then
    raise exception 'A project due date is required';
  end if;

  v_job_id := public.add_production_operator_project(
    p_organization_id,
    p_quotation_id
  );

  update public.production_jobs job
  set production_project_due_date = p_due_date
  where job.id = v_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null;
  if not found then
    raise exception 'The Production project could not be assigned a due date';
  end if;

  return v_job_id;
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
  from public.production_status_types status_type
  where status_type.id = p_status_type_id
    and status_type.organization_id = p_organization_id
    and status_type.is_active
    and status_type.legacy_status not in ('completed'::public.production_status, 'delivered'::public.production_status);
  if not found then
    raise exception 'Completed and Delivered are controlled by their stage actions';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status in ('completed'::public.production_status, 'delivered'::public.production_status) then
    raise exception 'Final Production stages cannot be edited';
  end if;

  update public.production_jobs job
  set status = v_status.legacy_status,
      production_status_type_id = v_status.id,
      production_operator_remark = v_remark,
      started_at = case
        when v_status.legacy_status = 'in_production'::public.production_status
          then coalesce(job.started_at, now())
        else job.started_at
      end
  where job.id = v_job.id;

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

-- Extend the existing status/remark update with the project due date. The
-- four-argument function above remains available only for this wrapper and is
-- revoked from authenticated callers below.
create or replace function public.update_production_operator_project(
  p_organization_id uuid,
  p_production_job_id uuid,
  p_status_type_id uuid,
  p_operator_remark text,
  p_due_date date
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
  if p_due_date is null then
    raise exception 'A project due date is required';
  end if;

  perform public.update_production_operator_project(
    p_organization_id,
    p_production_job_id,
    p_status_type_id,
    p_operator_remark
  );

  select * into v_job
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status in ('completed'::public.production_status, 'delivered'::public.production_status) then
    raise exception 'Final Production stages cannot be edited';
  end if;

  if v_job.production_project_due_date is distinct from p_due_date then
    update public.production_jobs job
    set production_project_due_date = p_due_date
    where job.id = v_job.id;

    insert into public.production_job_activity
      (organization_id, production_job_id, action, note, actor_id)
    values (
      p_organization_id,
      v_job.id,
      'due_date_updated',
      'Project due date updated to ' || to_char(p_due_date, 'YYYY-MM-DD'),
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
  from public.production_jobs job
  where job.id = p_production_job_id
    and job.organization_id = p_organization_id
    and job.production_added_at is not null
    and job.production_archived_at is null
  for update;
  if not found then
    raise exception 'The Production project is no longer active';
  end if;
  if v_job.status in ('completed'::public.production_status, 'delivered'::public.production_status) then
    raise exception 'Completed and Delivered projects are final and cannot be removed';
  end if;

  update public.production_jobs job
  set production_archived_at = now(),
      production_archived_by = (select auth.uid())
  where job.id = v_job.id;

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

drop function if exists public.list_production_operator_projects(uuid);
create function public.list_production_operator_projects(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
  client_name text,
  project_name text,
  project_type text,
  production_job_id uuid,
  job_no text,
  project_schedule_id uuid,
  due_date date,
  status_key text,
  status_label text,
  status_type_id uuid,
  operator_remark text,
  is_added boolean,
  pdf_available boolean,
  completed_at timestamptz,
  delivered_at timestamptz,
  delivery_proof_storage_path text,
  payment_receipt_storage_path text
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    nullif(btrim(quotation.client_name), ''),
    nullif(btrim(quotation.project_name), ''),
    quotation.project_types,
    case when job.production_added_at is not null and job.production_archived_at is null then job.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.job_no end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.project_schedule_id end,
    case when job.production_added_at is not null and job.production_archived_at is null
      then job.production_project_due_date end,
    coalesce(job.status::text, 'queued'),
    case
      when job.production_added_at is null or job.production_archived_at is not null then 'Pending'
      else coalesce(status_type.name, initcap(replace(job.status::text, '_', ' ')))
    end,
    case when job.production_added_at is not null and job.production_archived_at is null then status_type.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.production_operator_remark end,
    (job.production_added_at is not null and job.production_archived_at is null),
    (quotation.status::text = 'approved' and quotation.archived_at is null),
    case when job.production_added_at is not null and job.production_archived_at is null then job.completed_at end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.delivered_at end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.delivery_proof_storage_path end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.payment_receipt_storage_path end
  from public.quotations quotation
  left join public.production_jobs job
    on job.quotation_id = quotation.id
   and job.organization_id = quotation.organization_id
  left join public.production_status_types status_type
    on status_type.id = job.production_status_type_id
   and status_type.organization_id = quotation.organization_id
  where quotation.organization_id = p_organization_id
    and quotation.document_type::text = 'price_quotation'
    and quotation.costing_source_id is null
    and (
      (job.production_added_at is not null
       and job.production_archived_at is null
       and job.status::text <> 'cancelled')
      or (
        quotation.status::text = 'approved'
        and quotation.archived_at is null
        and (
          job.id is null
          or job.production_added_at is null
          or job.production_archived_at is not null
        )
      )
    )
  order by quotation.updated_at desc, quotation.quotation_no asc;
end;
$$;

-- Existing Project Calendar approvals now stop at Completed. Delivery remains
-- an explicit Production Operations action with its two required images.
create or replace function public.review_project_schedule_completion(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.project_schedule_completion_requests%rowtype;
  v_schedule public.project_schedules%rowtype;
  v_quotation public.quotations%rowtype;
  v_completed_status uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project completion decision';
  end if;

  select * into v_request
  from public.project_schedule_completion_requests request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'pending'::public.approval_status then
    raise exception 'Project completion request is no longer pending';
  end if;
  if not private.can_approve_production(v_request.organization_id) then
    raise exception 'Only the General Manager or designated Production Approver can review project completion requests';
  end if;
  if not private.is_org_admin(v_request.organization_id)
    and v_request.submitted_by = (select auth.uid()) then
    raise exception 'The submitting Project Officer cannot approve their own completion request';
  end if;

  select * into v_schedule
  from public.project_schedules schedule
  where schedule.id = v_request.schedule_id
  for update;
  if not found or v_schedule.status <> 'approved'::public.approval_status then
    raise exception 'This project schedule is no longer available for completion';
  end if;
  if v_schedule.completed_at is not null then
    raise exception 'This project has already been completed';
  end if;

  if p_decision = 'approved' then
    select * into v_quotation
    from public.quotations quotation
    where quotation.id = v_schedule.quotation_id
      and quotation.organization_id = v_schedule.organization_id;
    if not found or v_quotation.document_type is distinct from 'price_quotation' then
      raise exception 'The project schedule no longer has a valid Price Quotation';
    end if;

    update public.project_schedules schedule
    set completed_at = now(),
        completed_by = (select auth.uid())
    where schedule.id = v_schedule.id;

    select status_type.id into v_completed_status
    from public.production_status_types status_type
    where status_type.organization_id = v_schedule.organization_id
      and status_type.legacy_status = 'completed'::public.production_status
    order by status_type.is_system desc, status_type.is_active desc, status_type.sort_order
    limit 1;

    update public.production_jobs job
    set status = case when job.status = 'delivered'::public.production_status
      then job.status else 'completed'::public.production_status end,
        production_status_type_id = case when job.status = 'delivered'::public.production_status
          then job.production_status_type_id else coalesce(v_completed_status, job.production_status_type_id) end,
        completed_at = coalesce(job.completed_at, now()),
        completed_by = coalesce(job.completed_by, (select auth.uid()))
    where job.organization_id = v_schedule.organization_id
      and (job.project_schedule_id = v_schedule.id or job.quotation_id = v_schedule.quotation_id)
      and job.status <> 'cancelled'::public.production_status;

    insert into public.production_job_activity
      (organization_id, production_job_id, action, note, actor_id)
    select job.organization_id, job.id, 'project_completed',
      'Project Calendar completion approved; delivery remains pending',
      (select auth.uid())
    from public.production_jobs job
    where job.organization_id = v_schedule.organization_id
      and (job.project_schedule_id = v_schedule.id or job.quotation_id = v_schedule.quotation_id)
      and job.status = 'completed'::public.production_status;

    update public.leads lead
    set done_deal_status = greatest(coalesce(lead.done_deal_status, 0), 12)
    where lead.id = v_quotation.lead_id
      and lead.organization_id = v_schedule.organization_id
      and lead.evaluation_number = 7;
  end if;

  update public.project_schedule_completion_requests request
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where request.id = v_request.id;

  return v_schedule.id;
end;
$$;

revoke all on function public.mark_production_project_completed(uuid, uuid) from public, anon;
grant execute on function public.mark_production_project_completed(uuid, uuid) to authenticated;
revoke all on function public.mark_production_project_delivered(uuid, uuid, text, text, text, bigint, text, text, text, bigint) from public, anon;
grant execute on function public.mark_production_project_delivered(uuid, uuid, text, text, text, bigint, text, text, text, bigint) to authenticated;
revoke all on function public.add_production_operator_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_production_operator_project(uuid, uuid, date) from public, anon;
grant execute on function public.add_production_operator_project(uuid, uuid, date) to authenticated;
revoke all on function public.list_production_operator_projects(uuid) from public, anon;
grant execute on function public.list_production_operator_projects(uuid) to authenticated;
revoke all on function public.update_production_operator_project(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.update_production_operator_project(uuid, uuid, uuid, text) from authenticated;
revoke all on function public.update_production_operator_project(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.update_production_operator_project(uuid, uuid, uuid, text, date) to authenticated;
revoke all on function public.archive_production_operator_project(uuid, uuid) from public, anon;
grant execute on function public.archive_production_operator_project(uuid, uuid) to authenticated;
revoke all on function public.review_project_schedule_completion(uuid, text, text) from public, anon;
grant execute on function public.review_project_schedule_completion(uuid, text, text) to authenticated;

commit;
