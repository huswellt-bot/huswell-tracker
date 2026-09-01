-- Let the General Manager complete an approved Lead deletion without giving
-- them permission to edit Price Quotation content. Deleting a Lead sets the
-- lead_id of linked quotations to NULL; that referential update runs under the
-- GM's authenticated identity and was being rejected by migration 078.
--
-- Run after 078_general_manager_management_workflow_boundaries.sql. Safe to re-run.

begin;

create or replace function public.enforce_project_officer_price_quotation_content()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and not private.has_text_role(new.organization_id, array['project_manager']) then
    if tg_op = 'INSERT' then
      raise exception 'Only a Sales Project Officer can prepare a Price Quotation';
    end if;

    if new.lead_id is distinct from old.lead_id
      and not (
        new.lead_id is null
        and old.lead_id is not null
        and coalesce(
          current_setting('huswell.allow_price_quotation_lead_unlink', true),
          'off'
        ) = 'on'
      )
      or new.client_name is distinct from old.client_name
      or new.client_contact_name is distinct from old.client_contact_name
      or new.client_phone is distinct from old.client_phone
      or new.client_address is distinct from old.client_address
      or new.project_name is distinct from old.project_name
      or new.project_types is distinct from old.project_types
      or new.representative is distinct from old.representative
      or new.prepared_by_user_id is distinct from old.prepared_by_user_id
      or new.prepared_by_signature_url is distinct from old.prepared_by_signature_url then
      raise exception 'Only a Sales Project Officer can change Price Quotation content';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.review_lead_change(
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
  v_request public.lead_change_requests%rowtype;
  v_changes jsonb;
  v_lead_id uuid;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision', 'rejected') then
    raise exception 'Unsupported lead change decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter a revision note before returning this lead edit';
  end if;

  select * into v_request
  from public.lead_change_requests
  where id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Lead change request is no longer pending';
  end if;
  if not private.has_text_role(v_request.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review lead changes';
  end if;
  if v_request.lead_id is null then
    raise exception 'The lead for this request no longer exists';
  end if;
  if p_decision = 'needs_revision' and v_request.change_type <> 'update' then
    raise exception 'Only lead edits can be returned for revision';
  end if;

  v_lead_id := v_request.lead_id;
  v_changes := v_request.proposed_changes;
  if p_decision = 'approved' and v_request.change_type = 'update' then
    update public.leads lead
    set project_name = case when v_changes ? 'project_name' then nullif(btrim(v_changes->>'project_name'), '') else lead.project_name end,
        contact_name = case when v_changes ? 'contact_name' then nullif(btrim(v_changes->>'contact_name'), '') else lead.contact_name end,
        client_name = case when v_changes ? 'client_name' then nullif(btrim(v_changes->>'client_name'), '') else lead.client_name end,
        email = case when v_changes ? 'email' then nullif(btrim(v_changes->>'email'), '') else lead.email end,
        phone = case when v_changes ? 'phone' then nullif(btrim(v_changes->>'phone'), '') else lead.phone end,
        date_sent = case when v_changes ? 'date_sent' then nullif(v_changes->>'date_sent', '')::date else lead.date_sent end,
        date_contacted = case when v_changes ? 'date_contacted' then nullif(v_changes->>'date_contacted', '')::date else lead.date_contacted end,
        contact_method = case when v_changes ? 'contact_method' then nullif(btrim(v_changes->>'contact_method'), '') else lead.contact_method end,
        evaluation_number = case when v_changes ? 'evaluation_number' then nullif(v_changes->>'evaluation_number', '')::integer else lead.evaluation_number end,
        done_deal_status = case when v_changes ? 'done_deal_status' then nullif(v_changes->>'done_deal_status', '')::integer else lead.done_deal_status end
    where lead.id = v_lead_id;
  end if;

  update public.lead_change_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where id = v_request.id;

  if p_decision = 'approved' and v_request.change_type = 'delete' then
    -- This transaction-local flag permits only the FK's lead_id -> NULL update.
    perform set_config('huswell.allow_price_quotation_lead_unlink', 'on', true);
    delete from public.leads where id = v_lead_id;
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.enforce_project_officer_price_quotation_content() from public;
revoke all on function public.review_lead_change(uuid, text, text) from public;
grant execute on function public.review_lead_change(uuid, text, text) to authenticated;

commit;
