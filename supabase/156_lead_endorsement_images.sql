-- Optional private image attachments for Lead endorsements.
-- Run after 155_lead_company_address.sql and before deploying the matching
-- Leads workspace update. Safe to re-run.

begin;

create table if not exists public.lead_endorsement_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> '' and length(file_name) <= 255),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (lead_id)
);

create index if not exists lead_endorsement_attachments_org_lead_idx
  on public.lead_endorsement_attachments (organization_id, lead_id);

alter table public.lead_endorsement_attachments enable row level security;

drop policy if exists "lead endorsement attachments: authorized read"
  on public.lead_endorsement_attachments;
create policy "lead endorsement attachments: authorized read"
on public.lead_endorsement_attachments for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or exists (
    select 1
    from public.leads lead
    where lead.id = lead_endorsement_attachments.lead_id
      and lead.organization_id = lead_endorsement_attachments.organization_id
      and lead_endorsement_attachments.uploaded_by = (select auth.uid())
      and (select private.has_text_role(
        lead_endorsement_attachments.organization_id,
        array['project_manager']
      ))
  )
  or exists (
    select 1
    from public.leads lead
    join public.organization_members member
      on member.organization_id = lead.organization_id
     and member.user_id = (select auth.uid())
     and member.role::text = 'sales_pricing_officer'
    where lead.id = lead_endorsement_attachments.lead_id
      and lead.organization_id = lead_endorsement_attachments.organization_id
      and lead.endorsed_to = (select auth.uid())
  )
);

-- Attachment rows are created only by the endorsement RPC. The browser needs
-- read access for the Leads table and signed-URL lookup, but no direct writes.
revoke all on public.lead_endorsement_attachments from public, anon, authenticated;
grant select on public.lead_endorsement_attachments to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'lead-endorsement-images',
  'lead-endorsement-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lead endorsement images: submit" on storage.objects;
create policy "lead endorsement images: submit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'lead-endorsement-images'
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.leads lead
    where lead.organization_id::text = split_part(name, '/', 1)
      and lead.id::text = split_part(name, '/', 2)
      and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())
      and (select private.has_text_role(
        lead.organization_id,
        array['project_manager']
      ))
      and lead.endorsed_by is null
      and lead.endorsed_to is null
      and lead.endorsed_at is null
      and not coalesce(lead.endorsement_history_locked, false)
  )
);

drop policy if exists "lead endorsement images: authorized read" on storage.objects;
create policy "lead endorsement images: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id = 'lead-endorsement-images'
  and exists (
    select 1
    from public.lead_endorsement_attachments attachment
    join public.leads lead on lead.id = attachment.lead_id
    where attachment.storage_path = storage.objects.name
      and attachment.organization_id = lead.organization_id
      and (
        (select private.has_text_role(
          lead.organization_id,
          array['super_admin', 'owner', 'admin']
        ))
        or (
          attachment.uploaded_by = (select auth.uid())
          and (select private.has_text_role(
            attachment.organization_id,
            array['project_manager']
          ))
        )
        or (
          lead.endorsed_to = (select auth.uid())
          and exists (
            select 1
            from public.organization_members member
            where member.organization_id = lead.organization_id
              and member.user_id = (select auth.uid())
              and member.role::text = 'sales_pricing_officer'
          )
        )
      )
  )
);

-- This permits cleanup when an upload succeeds but the endorsement RPC fails.
-- Once metadata exists, no authenticated client can delete the image.
drop policy if exists "lead endorsement images: failed upload cleanup" on storage.objects;
create policy "lead endorsement images: failed upload cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'lead-endorsement-images'
  and not exists (
    select 1
    from public.lead_endorsement_attachments attachment
    where attachment.storage_path = storage.objects.name
  )
  and exists (
    select 1
    from public.leads lead
    where lead.organization_id::text = split_part(name, '/', 1)
      and lead.id::text = split_part(name, '/', 2)
      and coalesce(lead.assigned_to, lead.created_by) = (select auth.uid())
      and (select private.has_text_role(
        lead.organization_id,
        array['project_manager']
      ))
  )
);

create or replace function public.endorse_lead_with_attachment(
  p_lead_id uuid,
  p_recipient_user_id uuid,
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
  v_lead public.leads%rowtype;
  v_attachment_id uuid;
  v_endorsed_at timestamptz := now();
begin
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select another Sales & Pricing Officer recipient';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;

  if coalesce(v_lead.evaluation_number, 0) = 7 then
    raise exception 'Only Leads can be endorsed';
  end if;

  if coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid())
    or not private.has_text_role(v_lead.organization_id, array['project_manager']) then
    raise exception 'Only the owning Sales Officer can endorse this lead';
  end if;

  if coalesce(v_lead.endorsement_history_locked, false)
    or v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead has already been endorsed and cannot be endorsed again';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;

  if p_file_name is null or nullif(btrim(p_file_name), '') is null then
    raise exception 'Upload an endorsement image';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_file_size is null
    or p_file_size <= 0
    or p_file_size > 10485760 then
    raise exception 'Endorsement images must be JPEG, PNG, or WebP files no larger than 10 MB';
  end if;
  if p_storage_path !~* (
    '^' || v_lead.organization_id::text || '/' || v_lead.id::text
      || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Endorsement image storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'lead-endorsement-images'
      and object.name = p_storage_path
  ) then
    raise exception 'Upload the endorsement image before endorsing this lead';
  end if;

  insert into public.lead_endorsement_attachments (
    organization_id,
    lead_id,
    storage_path,
    file_name,
    content_type,
    file_size,
    uploaded_by
  ) values (
    v_lead.organization_id,
    v_lead.id,
    p_storage_path,
    btrim(p_file_name),
    p_content_type,
    p_file_size,
    (select auth.uid())
  ) returning id into v_attachment_id;

  update public.leads
  set endorsed_by = (select auth.uid()),
      endorsed_to = p_recipient_user_id,
      endorsed_at = v_endorsed_at,
      endorsement_history_locked = true
  where id = v_lead.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'endorsed',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at,
      'endorsement_history_locked', v_lead.endorsement_history_locked
    ),
    jsonb_build_object(
      'endorsed_by', (select auth.uid()),
      'endorsed_to', p_recipient_user_id,
      'endorsed_at', v_endorsed_at,
      'endorsement_history_locked', true,
      'attachment_id', v_attachment_id,
      'attachment_file_name', btrim(p_file_name)
    )
  );

  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead_with_attachment(uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.endorse_lead_with_attachment(uuid, uuid, text, text, text, bigint) to authenticated;

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
      and tablename = 'lead_endorsement_attachments'
  ) then
    alter publication supabase_realtime
      add table public.lead_endorsement_attachments;
  end if;
end;
$$;

commit;
