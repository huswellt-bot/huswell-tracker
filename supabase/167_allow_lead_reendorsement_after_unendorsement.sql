-- Allow a lead to be endorsed again after an approved unendorsement.
--
-- endorsement_history_locked remains true as an audit marker for leads that
-- have ever been endorsed. Active endorsement columns determine whether a new
-- endorsement is currently allowed. Existing ownership, recipient-role,
-- security-definer, and storage-path checks remain enforced.
-- Run after 166_add_instagram_to_lead_excel_import.sql and before deploying
-- the matching Leads workspace update. Safe to re-run.

begin;

comment on column public.leads.endorsement_history_locked is
  'True once a lead has ever been endorsed; retained as audit history and does not block a later endorsement after approved unendorsement.';

-- Migration 156 originally allowed one image row per lead. Re-endorsement must
-- preserve earlier images while allowing a new optional image for each later
-- endorsement.
alter table public.lead_endorsement_attachments
  drop constraint if exists lead_endorsement_attachments_lead_id_key;

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
  )
);

create or replace function public.endorse_lead(
  p_lead_id uuid,
  p_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
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

  if v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead already has an active endorsement';
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
      'endorsement_history_locked', true
    )
  );

  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead(uuid, uuid) from public;
grant execute on function public.endorse_lead(uuid, uuid) to authenticated;

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

  if v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead already has an active endorsement';
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

commit;
