-- Extend the transactional Excel lead import to accept Instagram.
-- Run after 165_add_instagram_outbound_method.sql and before deploying the
-- matching lead-import parser update. Existing security and duplicate checks
-- remain unchanged.

begin;

create or replace function public.import_leads_from_excel(
  p_organization_id uuid,
  p_file_name text,
  p_rows jsonb,
  p_total_rows integer,
  p_invalid_rows integer,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_row record;
  v_batch_id uuid;
  v_date_sent_text text;
  v_date_contacted_text text;
  v_date_sent date;
  v_date_contacted date;
  v_contact_name text;
  v_client_name text;
  v_address text;
  v_email text;
  v_phone text;
  v_contact_method text;
  v_contact_key text;
  v_evaluation_number integer;
  v_is_duplicate boolean;
  v_imported_count integer := 0;
  v_eligible_count integer := 0;
  v_duplicate_rows integer[] := '{}'::integer[];
  v_seen_row_numbers integer[] := '{}'::integer[];
  v_seen_emails text[] := '{}'::text[];
  v_seen_phones text[] := '{}'::text[];
  v_seen_contact_keys text[] := '{}'::text[];
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'project_manager', 'sales_pricing_officer']
  ) then
    raise exception 'You do not have permission to import Leads for this organization';
  end if;

  if nullif(btrim(coalesce(p_file_name, '')), '') is null
    or char_length(btrim(p_file_name)) > 255
    or lower(btrim(p_file_name)) not like '%.xlsx' then
    raise exception 'Only .xlsx Excel files are supported';
  end if;
  if p_total_rows is null or p_invalid_rows is null
    or p_total_rows < 0 or p_total_rows > 1000
    or p_invalid_rows < 0
    or jsonb_typeof(v_rows) <> 'array'
    or jsonb_array_length(v_rows) > 1000
    or p_total_rows <> jsonb_array_length(v_rows) + p_invalid_rows then
    raise exception 'The Excel import row counts are invalid';
  end if;

  -- Serialize imports per organization so two confirmations cannot insert the
  -- same normalized email, phone, or contact/company pair at the same time.
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));

  if not p_dry_run then
    insert into public.lead_import_batches (
      organization_id,
      uploaded_by,
      file_name,
      total_rows,
      invalid_rows
    ) values (
      p_organization_id,
      (select auth.uid()),
      btrim(p_file_name),
      p_total_rows,
      p_invalid_rows
    ) returning id into v_batch_id;
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(v_rows) as item(
      row_number integer,
      date_sent text,
      contact_name text,
      client_name text,
      address text,
      email text,
      phone text,
      date_contacted text,
      contact_method text,
      evaluation_number integer
    )
  loop
    if v_row.row_number is null or v_row.row_number < 2
      or v_row.row_number = any(v_seen_row_numbers) then
      raise exception 'The Excel import contains an invalid row number';
    end if;
    v_seen_row_numbers := array_append(v_seen_row_numbers, v_row.row_number);

    v_contact_name := nullif(btrim(coalesce(v_row.contact_name, '')), '');
    v_client_name := nullif(btrim(coalesce(v_row.client_name, '')), '');
    v_address := nullif(btrim(coalesce(v_row.address, '')), '');
    v_email := nullif(lower(btrim(coalesce(v_row.email, ''))), '');
    v_phone := nullif(btrim(coalesce(v_row.phone, '')), '');
    v_date_sent_text := nullif(btrim(coalesce(v_row.date_sent, '')), '');
    v_date_contacted_text := nullif(btrim(coalesce(v_row.date_contacted, '')), '');
    v_contact_method := nullif(btrim(coalesce(v_row.contact_method, '')), '');
    v_evaluation_number := coalesce(v_row.evaluation_number, 4);

    if v_contact_name is null then
      raise exception 'Excel row %: Contact Person''s Fullname is required', v_row.row_number;
    end if;
    if char_length(v_contact_name) > 255
      or char_length(coalesce(v_client_name, '')) > 1000
      or char_length(coalesce(v_address, '')) > 4000
      or char_length(coalesce(v_email, '')) > 254
      or char_length(coalesce(v_phone, '')) > 100 then
      raise exception 'Excel row % contains a value that is too long', v_row.row_number;
    end if;
    if v_email is not null
      and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Excel row % has an invalid email address', v_row.row_number;
    end if;

    if v_date_sent_text is not null then
      if v_date_sent_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Excel row % has an invalid Date recorded value', v_row.row_number;
      end if;
      v_date_sent := v_date_sent_text::date;
    else
      v_date_sent := null;
    end if;
    if v_date_contacted_text is not null then
      if v_date_contacted_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Excel row % has an invalid Date contacted value', v_row.row_number;
      end if;
      v_date_contacted := v_date_contacted_text::date;
    else
      v_date_contacted := null;
    end if;

    if v_contact_method is not null then
      v_contact_method := case lower(v_contact_method)
        when 'viber' then 'Viber'
        when 'whatsapp' then 'WhatsApp'
        when 'messenger' then 'Messenger'
        when 'instagram' then 'Instagram'
        when 'phone call' then 'Phone Call'
        when 'email' then 'Email'
        else null
      end;
      if v_contact_method is null then
        raise exception 'Excel row % has an unknown Outbound method', v_row.row_number;
      end if;
    end if;
    if v_evaluation_number < 1
      or v_evaluation_number > 9
      or v_evaluation_number = 7 then
      raise exception 'Excel row % has an invalid Lead status', v_row.row_number;
    end if;

    v_phone := nullif(regexp_replace(v_phone, '[^0-9]', '', 'g'), '');
    v_contact_key :=
      lower(regexp_replace(btrim(v_contact_name), '[[:space:]]+', ' ', 'g'))
      || '|'
      || lower(regexp_replace(btrim(coalesce(v_client_name, '')), '[[:space:]]+', ' ', 'g'));

    select exists (
      select 1
      from public.leads existing
      where existing.organization_id = p_organization_id
        and (
          (v_email is not null and lower(btrim(coalesce(existing.email, ''))) = v_email)
          or (
            v_phone is not null
            and regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g') = v_phone
          )
          or (
            v_email is null
            and v_phone is null
            and lower(regexp_replace(btrim(coalesce(existing.contact_name, '')), '[[:space:]]+', ' ', 'g'))
              || '|'
              || lower(regexp_replace(btrim(coalesce(existing.client_name, '')), '[[:space:]]+', ' ', 'g')) = v_contact_key
          )
        )
    )
    or (v_email is not null and v_email = any(v_seen_emails))
    or (v_phone is not null and v_phone = any(v_seen_phones))
    or (v_email is null and v_phone is null and v_contact_key = any(v_seen_contact_keys))
    into v_is_duplicate;

    if v_is_duplicate then
      v_duplicate_rows := array_append(v_duplicate_rows, v_row.row_number);
    else
      v_eligible_count := v_eligible_count + 1;
      if not p_dry_run then
        insert into public.leads (
          organization_id,
          lead_source,
          lead_import_batch_id,
          lead_import_row_number,
          client_name,
          contact_name,
          address,
          email,
          phone,
          project_name,
          date_sent,
          date_contacted,
          contact_method,
          evaluation_number
        ) values (
          p_organization_id,
          'excel_import',
          v_batch_id,
          v_row.row_number,
          v_client_name,
          v_contact_name,
          v_address,
          v_email,
          nullif(btrim(coalesce(v_row.phone, '')), ''),
          coalesce(v_client_name, v_contact_name),
          v_date_sent,
          v_date_contacted,
          v_contact_method,
          v_evaluation_number
        );
        v_imported_count := v_imported_count + 1;
      end if;
    end if;

    if v_email is not null then
      v_seen_emails := array_append(v_seen_emails, v_email);
    end if;
    if v_phone is not null then
      v_seen_phones := array_append(v_seen_phones, v_phone);
    end if;
    v_seen_contact_keys := array_append(v_seen_contact_keys, v_contact_key);
  end loop;

  if not p_dry_run then
    update public.lead_import_batches
    set imported_rows = v_imported_count,
        duplicate_rows = coalesce(array_length(v_duplicate_rows, 1), 0)
    where id = v_batch_id;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'imported_count', case when p_dry_run then 0 else v_imported_count end,
    'eligible_count', v_eligible_count,
    'duplicate_count', coalesce(array_length(v_duplicate_rows, 1), 0),
    'duplicate_rows', to_jsonb(v_duplicate_rows),
    'invalid_count', p_invalid_rows
  );
end;
$$;

revoke all on function public.import_leads_from_excel(uuid, text, jsonb, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.import_leads_from_excel(uuid, text, jsonb, integer, integer, boolean) to authenticated;

commit;
