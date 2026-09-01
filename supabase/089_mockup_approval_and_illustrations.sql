-- Makes mockups an approval-controlled stage between an approved Price
-- Quotation and Project scheduling. Mockup artwork is stored privately and is
-- visible only to authorized workspace members through signed URLs.
-- Run after 088_mockup_workflow.sql. Safe to re-run.

begin;

alter table public.mockup_tasks
  add column if not exists quotation_id uuid references public.quotations(id) on delete cascade,
  add column if not exists illustration_path text,
  add column if not exists approval_status public.approval_status not null default 'pending',
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists revision_note text;

create index if not exists mockup_tasks_quotation_idx
  on public.mockup_tasks (quotation_id, approval_status);

-- Preserve pre-approval tracker records. When an existing record has a single
-- eligible quotation for its lead, link it automatically; otherwise it stays
-- visible but cannot be approved or scheduled until corrected by the owner.
update public.mockup_tasks task
set quotation_id = (
  select quote.id
  from public.quotations quote
  where quote.lead_id = task.lead_id
    and quote.organization_id = task.organization_id
    and quote.document_type = 'price_quotation'
    and quote.costing_source_id is null
    and quote.status::text = 'approved'
  order by quote.approved_at desc nulls last, quote.created_at desc
  limit 1
)
where task.quotation_id is null;

update public.mockup_tasks
set submitted_by = coalesce(submitted_by, created_by),
    submitted_at = coalesce(submitted_at, created_at)
where submitted_by is null or submitted_at is null;

-- Replaces the original direct-lead creation guard. A mockup must now come
-- from an approved direct Price Quotation whose source lead is assigned to the
-- signed-in Project Officer. All display fields are server-generated.
create or replace function public.populate_mockup_task_from_lead()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_quote public.quotations%rowtype;
  v_expected_path_prefix text;
begin
  if tg_op = 'INSERT' then
    select * into v_quote
    from public.quotations
    where id = new.quotation_id
    for share;

    if not found
      or v_quote.document_type <> 'price_quotation'
      or v_quote.costing_source_id is not null
      or v_quote.status::text <> 'approved'
      or v_quote.lead_id is null then
      raise exception 'Mockups can only be created from an approved Price Quotation';
    end if;

    select * into v_lead
    from public.leads
    where id = v_quote.lead_id
      and organization_id = v_quote.organization_id
    for share;

    if not found
      or not private.has_text_role(v_quote.organization_id, array['project_manager'])
      or v_lead.assigned_to is distinct from auth.uid() then
      raise exception 'Only the assigned Sales Project Officer can create a mockup';
    end if;

    new.organization_id := v_quote.organization_id;
    new.lead_id := v_lead.id;
    new.assigned_to := auth.uid();
    new.created_by := auth.uid();
    new.client_name := nullif(btrim(v_lead.contact_name), '');
    new.company_name := nullif(btrim(v_lead.client_name), '');
    new.project_name := coalesce(
      nullif(btrim(v_quote.project_name), ''),
      nullif(btrim(v_lead.project_name), ''),
      nullif(btrim(v_lead.client_name), ''),
      'Untitled project'
    );
    new.approval_status := 'pending'::public.approval_status;
    new.submitted_by := auth.uid();
    new.submitted_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.revision_note := null;

    v_expected_path_prefix := format('%s/mockups/%s/', new.organization_id, auth.uid());
    if nullif(btrim(coalesce(new.illustration_path, '')), '') is null
      or left(new.illustration_path, length(v_expected_path_prefix)) <> v_expected_path_prefix then
      raise exception 'Upload a mockup illustration before submitting it';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.lead_id is distinct from old.lead_id
    or new.quotation_id is distinct from old.quotation_id
    or new.client_name is distinct from old.client_name
    or new.company_name is distinct from old.company_name
    or new.project_name is distinct from old.project_name
    or new.assigned_to is distinct from old.assigned_to
    or new.created_by is distinct from old.created_by then
    raise exception 'Price Quotation, lead, and assignment details for a mockup cannot be changed';
  end if;

  if private.has_text_role(old.organization_id, array['project_manager'])
    and old.assigned_to = auth.uid()
    and old.created_by = auth.uid() then
    if old.approval_status <> 'needs_revision'::public.approval_status
      or new.approval_status <> 'pending'::public.approval_status then
      raise exception 'Only a mockup returned for revision can be updated and resubmitted';
    end if;

    v_expected_path_prefix := format('%s/mockups/%s/', old.organization_id, auth.uid());
    if nullif(btrim(coalesce(new.illustration_path, '')), '') is null
      or left(new.illustration_path, length(v_expected_path_prefix)) <> v_expected_path_prefix then
      raise exception 'Upload a revised mockup illustration before resubmitting';
    end if;

    new.submitted_by := auth.uid();
    new.submitted_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.revision_note := null;
    return new;
  end if;

  if private.has_text_role(old.organization_id, array['super_admin', 'owner', 'admin']) then
    if old.approval_status <> 'pending'::public.approval_status
      or new.approval_status not in ('approved'::public.approval_status, 'needs_revision'::public.approval_status)
      or new.mockup_name is distinct from old.mockup_name
      or new.pieces is distinct from old.pieces
      or new.due_date is distinct from old.due_date
      or new.status is distinct from old.status
      or new.notes is distinct from old.notes
      or new.illustration_path is distinct from old.illustration_path then
      raise exception 'General Managers can only approve or return a pending mockup';
    end if;
    return new;
  end if;

  raise exception 'Only the assigned Sales Project Officer can resubmit this mockup';
end;
$$;

drop policy if exists "mockup tasks: officer update" on public.mockup_tasks;
create policy "mockup tasks: officer revise and resubmit"
on public.mockup_tasks for update to authenticated
using (
  approval_status = 'needs_revision'::public.approval_status
  and assigned_to = auth.uid()
  and created_by = auth.uid()
  and (select private.has_text_role(organization_id, array['project_manager']))
)
with check (
  approval_status = 'pending'::public.approval_status
  and assigned_to = auth.uid()
  and created_by = auth.uid()
  and (select private.has_text_role(organization_id, array['project_manager']))
);

create or replace function public.review_mockup_task(
  p_mockup_id uuid,
  p_decision text,
  p_revision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_mockup public.mockup_tasks%rowtype;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported mockup decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter revision notes before returning this mockup';
  end if;

  select * into v_mockup
  from public.mockup_tasks
  where id = p_mockup_id
  for update;

  if not found then
    raise exception 'Mockup not found';
  end if;
  if not private.has_text_role(v_mockup.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can review mockups';
  end if;
  if v_mockup.approval_status <> 'pending'::public.approval_status then
    raise exception 'This mockup has already been reviewed';
  end if;
  if v_mockup.quotation_id is null or nullif(btrim(coalesce(v_mockup.illustration_path, '')), '') is null then
    raise exception 'A linked Price Quotation and mockup illustration are required before review';
  end if;

  update public.mockup_tasks
  set approval_status = p_decision::public.approval_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      revision_note = case when p_decision = 'needs_revision' then v_note else null end
  where id = v_mockup.id;
end;
$$;

-- A project is a post-mockup stage. This guard is authoritative even if a
-- browser bypasses the filtered Project Calendar selector.
create or replace function public.populate_project_schedule_from_quotation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
begin
  select * into v_quotation
  from public.quotations
  where id = new.quotation_id;

  if not found
    or v_quotation.organization_id is distinct from new.organization_id
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved Price Quotation';
  end if;
  if not exists (
    select 1 from public.mockup_tasks mockup
    where mockup.quotation_id = v_quotation.id
      and mockup.approval_status = 'approved'::public.approval_status
  ) then
    raise exception 'Projects can only be scheduled after General Manager approval of the mockup';
  end if;

  new.quotation_no := coalesce(v_quotation.quotation_no, '');
  new.project_name := coalesce(nullif(btrim(new.project_name), ''), nullif(v_quotation.project_name, ''), v_quotation.quotation_no, 'Untitled project');
  new.client_name := coalesce(nullif(btrim(new.client_name), ''), nullif(v_quotation.client_name, ''));
  new.product_name := coalesce(nullif(btrim(new.product_name), ''), nullif(v_quotation.project_types, ''));
  new.quantity := coalesce(new.quantity, v_quotation.project_quantity);
  return new;
end;
$$;

-- Private mockup illustration storage. The organization-scoped path is
-- verified on upload; callers receive short-lived signed URLs rather than a
-- public object URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mockup-images', 'mockup-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mockup images: workspace read" on storage.objects;
drop policy if exists "mockup images: officer upload" on storage.objects;
drop policy if exists "mockup images: officer delete" on storage.objects;

create policy "mockup images: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'mockup-images'
  and exists (
    select 1 from public.organization_members member
    where member.user_id = auth.uid()
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text in ('super_admin', 'owner', 'admin', 'project_manager')
  )
);

create policy "mockup images: officer upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mockup-images'
  and split_part(name, '/', 2) = 'mockups'
  and split_part(name, '/', 3) = auth.uid()::text
  and exists (
    select 1 from public.organization_members member
    where member.user_id = auth.uid()
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'project_manager'
  )
);

create policy "mockup images: officer delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'mockup-images'
  and split_part(name, '/', 3) = auth.uid()::text
  and exists (
    select 1 from public.organization_members member
    where member.user_id = auth.uid()
      and member.organization_id::text = split_part(name, '/', 1)
      and member.role::text = 'project_manager'
  )
);

revoke all on function public.populate_mockup_task_from_lead() from public;
revoke all on function public.review_mockup_task(uuid, text, text) from public;
grant execute on function public.review_mockup_task(uuid, text, text) to authenticated;

commit;
