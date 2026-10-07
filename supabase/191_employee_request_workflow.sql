-- Run after 190_monthly_kpi_activity_graphs.sql and before deploying the
-- matching Letter Request workspace update.
--
-- This is a standalone employee permission-request workflow. It does not
-- write to payroll or leave_requests. Either an owner/admin or Payroll can
-- decide a pending request; the first decision wins.

begin;

create table if not exists public.employee_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_no text not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  requester_name text not null,
  request_type text not null check (request_type in ('work_from_home', 'leave_of_absence')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  work_plan text,
  leave_type text,
  attachment_storage_path text,
  attachment_file_name text,
  attachment_mime_type text,
  attachment_file_size bigint,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, request_no),
  check (end_date >= start_date),
  check (attachment_file_size is null or attachment_file_size between 1 and 10485760),
  check (
    (request_type = 'work_from_home'
      and nullif(trim(work_plan), '') is not null
      and leave_type is null)
    or
    (request_type = 'leave_of_absence'
      and leave_type in ('vacation', 'sick', 'personal', 'other')
      and nullif(trim(work_plan), '') is null)
  )
);

create table if not exists public.employee_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.employee_requests(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists employee_requests_org_updated_idx
  on public.employee_requests (organization_id, updated_at desc);
create index if not exists employee_requests_requester_idx
  on public.employee_requests (requested_by, updated_at desc);
create index if not exists employee_request_events_request_idx
  on public.employee_request_events (request_id, created_at desc);

alter table public.employee_requests enable row level security;
alter table public.employee_request_events enable row level security;

revoke all on public.employee_requests, public.employee_request_events from anon, authenticated;
grant select on public.employee_requests, public.employee_request_events to authenticated;

drop policy if exists "employee requests: requester or reviewer read" on public.employee_requests;
create policy "employee requests: requester or reviewer read"
on public.employee_requests for select to authenticated
using (
  (
    requested_by = (select auth.uid())
    and private.has_text_role(organization_id, array['sales_pricing_officer'])
  )
  or private.has_text_role(organization_id, array['owner', 'admin', 'payroll'])
);

drop policy if exists "employee request events: requester or reviewer read" on public.employee_request_events;
create policy "employee request events: requester or reviewer read"
on public.employee_request_events for select to authenticated
using (
  exists (
    select 1
    from public.employee_requests request
    where request.id = request_id
      and request.organization_id = public.employee_request_events.organization_id
      and (
        (
          request.requested_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
        or private.has_text_role(request.organization_id, array['owner', 'admin', 'payroll'])
      )
  )
);

drop trigger if exists employee_requests_updated_at on public.employee_requests;
create trigger employee_requests_updated_at
before update on public.employee_requests
for each row execute function public.set_updated_at();

create or replace function public.save_employee_request(
  p_request_id uuid,
  p_request_type text,
  p_start_date date,
  p_end_date date,
  p_reason text,
  p_work_plan text default null,
  p_leave_type text default null,
  p_attachment_storage_path text default null,
  p_attachment_file_name text default null,
  p_attachment_mime_type text default null,
  p_attachment_file_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_request public.employee_requests%rowtype;
  v_request_id uuid;
  v_next_status text := 'draft';
  v_event_type text := 'created';
  v_requester_name text;
begin
  select member.organization_id
  into v_organization_id
  from public.organization_members member
  where member.user_id = (select auth.uid())
    and member.role::text = 'sales_pricing_officer'
  order by member.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'Only a Sales & Pricing Officer can create Letter Requests';
  end if;

  if p_request_type not in ('work_from_home', 'leave_of_absence') then
    raise exception 'Choose Work From Home or Leave of Absence';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Choose a valid start and end date';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required';
  end if;
  if p_request_type = 'work_from_home'
     and nullif(trim(coalesce(p_work_plan, '')), '') is null then
    raise exception 'A work plan is required for Work From Home';
  end if;
  if p_request_type = 'leave_of_absence'
     and p_leave_type not in ('vacation', 'sick', 'personal', 'other') then
    raise exception 'Choose a Leave of Absence type';
  end if;
  if p_request_type = 'work_from_home' and p_leave_type is not null then
    raise exception 'Leave type is not used for Work From Home';
  end if;
  if p_request_type = 'leave_of_absence'
     and nullif(trim(coalesce(p_work_plan, '')), '') is not null then
    raise exception 'Work plan is not used for Leave of Absence';
  end if;
  if p_attachment_file_size is not null
     and p_attachment_file_size not between 1 and 10485760 then
    raise exception 'The supporting file must be 10 MB or smaller';
  end if;

  if p_request_id is null then
    select coalesce(nullif(trim(profile.full_name), ''), (select auth.uid())::text)
    into v_requester_name
    from public.profiles profile
    where profile.id = (select auth.uid());

    insert into public.employee_requests (
      organization_id,
      request_no,
      requested_by,
      requester_name,
      request_type,
      start_date,
      end_date,
      reason,
      work_plan,
      leave_type,
      attachment_storage_path,
      attachment_file_name,
      attachment_mime_type,
      attachment_file_size,
      status
    ) values (
      v_organization_id,
      'LR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      (select auth.uid()),
      coalesce(v_requester_name, (select auth.uid())::text),
      p_request_type,
      p_start_date,
      p_end_date,
      trim(p_reason),
      nullif(trim(p_work_plan), ''),
      nullif(trim(p_leave_type), ''),
      null,
      null,
      null,
      null,
      'draft'
    ) returning id into v_request_id;
  else
    select *
    into v_request
    from public.employee_requests
    where id = p_request_id
    for update;

    if not found then
      raise exception 'Letter Request not found';
    end if;
    v_organization_id := v_request.organization_id;
    if v_request.requested_by <> (select auth.uid()) then
      raise exception 'Only the requester can edit this Letter Request';
    end if;
    if not private.has_text_role(v_request.organization_id, array['sales_pricing_officer']) then
      raise exception 'Only a Sales & Pricing Officer can edit this Letter Request';
    end if;
    if v_request.status not in ('draft', 'pending') then
      raise exception 'Only a draft or pending Letter Request can be edited';
    end if;

    v_request_id := v_request.id;
    v_event_type := case when v_request.status = 'pending' then 'edited_pending' else 'saved' end;
    update public.employee_requests
    set request_type = p_request_type,
        start_date = p_start_date,
        end_date = p_end_date,
        reason = trim(p_reason),
        work_plan = nullif(trim(p_work_plan), ''),
        leave_type = nullif(trim(p_leave_type), ''),
        attachment_storage_path = p_attachment_storage_path,
        attachment_file_name = nullif(trim(p_attachment_file_name), ''),
        attachment_mime_type = nullif(trim(p_attachment_mime_type), ''),
        attachment_file_size = p_attachment_file_size,
        status = v_next_status,
        submitted_at = null,
        decided_by = null,
        decided_at = null,
        decision_note = null,
        withdrawn_at = null,
        updated_at = now()
    where id = v_request_id;
  end if;

  if p_attachment_storage_path is not null then
    if split_part(p_attachment_storage_path, '/', 1) <> v_organization_id::text
       or split_part(p_attachment_storage_path, '/', 2) <> v_request_id::text
       or not exists (
         select 1
         from storage.objects object
         where object.bucket_id = 'employee-request-attachments'
           and object.name = p_attachment_storage_path
       ) then
      raise exception 'The supporting file is not registered for this request';
    end if;
  end if;

  insert into public.employee_request_events (
    organization_id,
    request_id,
    event_type,
    from_status,
    to_status,
    actor_id
  ) values (
    v_organization_id,
    v_request_id,
    v_event_type,
    case when p_request_id is null then null else v_request.status end,
    'draft',
    (select auth.uid())
  );

  return v_request_id;
end;
$$;

create or replace function public.submit_employee_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.employee_requests%rowtype;
begin
  select *
  into v_request
  from public.employee_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Letter Request not found';
  end if;
  if v_request.requested_by <> (select auth.uid()) then
    raise exception 'Only the requester can submit this Letter Request';
  end if;
  if not private.has_text_role(v_request.organization_id, array['sales_pricing_officer']) then
    raise exception 'Only a Sales & Pricing Officer can submit this Letter Request';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'Only a draft Letter Request can be submitted';
  end if;

  update public.employee_requests
  set status = 'pending',
      submitted_at = now(),
      decided_by = null,
      decided_at = null,
      decision_note = null,
      withdrawn_at = null,
      updated_at = now()
  where id = p_request_id;

  insert into public.employee_request_events (
    organization_id, request_id, event_type, from_status, to_status, actor_id
  ) values (
    v_request.organization_id, p_request_id, 'submitted', 'draft', 'pending', (select auth.uid())
  );
end;
$$;

create or replace function public.withdraw_employee_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.employee_requests%rowtype;
begin
  select *
  into v_request
  from public.employee_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Letter Request not found';
  end if;
  if v_request.requested_by <> (select auth.uid()) then
    raise exception 'Only the requester can cancel this Letter Request';
  end if;
  if not private.has_text_role(v_request.organization_id, array['sales_pricing_officer']) then
    raise exception 'Only a Sales & Pricing Officer can cancel this Letter Request';
  end if;
  if v_request.status not in ('draft', 'pending') then
    raise exception 'Only a draft or pending Letter Request can be cancelled';
  end if;

  update public.employee_requests
  set status = 'withdrawn',
      withdrawn_at = now(),
      updated_at = now()
  where id = p_request_id;

  insert into public.employee_request_events (
    organization_id, request_id, event_type, from_status, to_status, actor_id
  ) values (
    v_request.organization_id, p_request_id, 'withdrawn', v_request.status, 'withdrawn', (select auth.uid())
  );
end;
$$;

create or replace function public.review_employee_request(
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.employee_requests%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose Approve or Reject';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A note is required for every decision';
  end if;

  select *
  into v_request
  from public.employee_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Letter Request not found';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin', 'payroll']) then
    raise exception 'Only the General Manager or Payroll can decide a Letter Request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending Letter Request can be decided';
  end if;

  update public.employee_requests
  set status = p_decision,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = trim(p_note),
      updated_at = now()
  where id = p_request_id;

  insert into public.employee_request_events (
    organization_id, request_id, event_type, from_status, to_status, actor_id, note
  ) values (
    v_request.organization_id,
    p_request_id,
    p_decision,
    'pending',
    p_decision,
    (select auth.uid()),
    trim(p_note)
  );
end;
$$;

revoke execute on function public.save_employee_request(uuid, text, date, date, text, text, text, text, text, text, bigint) from public, anon;
revoke execute on function public.submit_employee_request(uuid) from public, anon;
revoke execute on function public.withdraw_employee_request(uuid) from public, anon;
revoke execute on function public.review_employee_request(uuid, text, text) from public, anon;
grant execute on function public.save_employee_request(uuid, text, date, date, text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.submit_employee_request(uuid) to authenticated;
grant execute on function public.withdraw_employee_request(uuid) to authenticated;
grant execute on function public.review_employee_request(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-request-attachments',
  'employee-request-attachments',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "employee request attachments: authorized read" on storage.objects;
create policy "employee request attachments: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and exists (
    select 1
    from public.employee_requests request
    where request.attachment_storage_path = storage.objects.name
      and request.organization_id::text = split_part(storage.objects.name, '/', 1)
      and request.id::text = split_part(storage.objects.name, '/', 2)
      and (
        (
          request.requested_by = (select auth.uid())
          and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
        )
        or private.has_text_role(request.organization_id, array['owner', 'admin', 'payroll'])
      )
  )
);

drop policy if exists "employee request attachments: requester upload" on storage.objects;
create policy "employee request attachments: requester upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-request-attachments'
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$'
  and exists (
    select 1
    from public.employee_requests request
    where request.id::text = split_part(name, '/', 2)
      and request.organization_id::text = split_part(name, '/', 1)
      and request.requested_by = (select auth.uid())
      and request.status in ('draft', 'pending')
      and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
  )
);

drop policy if exists "employee request attachments: requester delete" on storage.objects;
create policy "employee request attachments: requester delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and exists (
    select 1
    from public.employee_requests request
    where request.id::text = split_part(name, '/', 2)
      and request.organization_id::text = split_part(name, '/', 1)
      and request.requested_by = (select auth.uid())
      and request.status in ('draft', 'pending', 'withdrawn')
      and private.has_text_role(request.organization_id, array['sales_pricing_officer'])
  )
);

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_requests'
  ) then
    alter publication supabase_realtime add table public.employee_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_request_events'
  ) then
    alter publication supabase_realtime add table public.employee_request_events;
  end if;
end;
$$;

commit;
