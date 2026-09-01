-- Permanently remove every workflow record derived from a Lead when the
-- General Manager deletes it, either directly or by approving an officer's
-- deletion request. This is intentionally destructive.
--
-- Run after 083_general_manager_lead_deletion.sql. Safe to re-run.

begin;

create or replace function public.prevent_costing_breakdown_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' and new.document_type = 'costing_breakdown' then
    raise exception 'Costing Breakdowns are no longer available. Create a direct Price Quotation instead.';
  end if;

  if tg_op = 'UPDATE' and old.document_type = 'costing_breakdown'
    and not (
      new.lead_id is null
      and old.lead_id is not null
      and coalesce(
        current_setting('huswell.allow_price_quotation_lead_unlink', true),
        'off'
      ) = 'on'
    ) then
    raise exception 'Historical Costing Breakdowns are read-only.';
  end if;

  if tg_op = 'DELETE' and old.document_type = 'costing_breakdown'
    and coalesce(current_setting('huswell.allow_lead_cascade', true), 'off') <> 'on' then
    raise exception 'Historical Costing Breakdowns cannot be deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.delete_lead_linked_records(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(current_setting('huswell.allow_lead_cascade', true), 'off') <> 'on' then
    raise exception 'Lead-linked records can be removed only through an authorized Lead deletion';
  end if;

  -- A Price Quotation may be linked through a historical Costing Breakdown,
  -- so include both quotations directly tied to the Lead and those derived
  -- from a tied Costing Breakdown.
  delete from public.project_schedules
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.lead_id = p_lead_id
       or quote.costing_source_id in (
         select costing.id
         from public.quotations costing
         where costing.lead_id = p_lead_id
       )
  );

  delete from public.payments
  where invoice_id in (
    select invoice.id
    from public.invoices invoice
    where invoice.quotation_id in (
      select quote.id
      from public.quotations quote
      where quote.lead_id = p_lead_id
         or quote.costing_source_id in (
           select costing.id
           from public.quotations costing
           where costing.lead_id = p_lead_id
         )
    )
  );
  delete from public.invoices
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.lead_id = p_lead_id
       or quote.costing_source_id in (
         select costing.id
         from public.quotations costing
         where costing.lead_id = p_lead_id
       )
  );

  delete from public.finished_product_stock_ins
  where production_job_id in (
    select job.id
    from public.production_jobs job
    where job.quotation_id in (
      select quote.id
      from public.quotations quote
      where quote.lead_id = p_lead_id
         or quote.costing_source_id in (
           select costing.id
           from public.quotations costing
           where costing.lead_id = p_lead_id
         )
    )
  );
  delete from public.production_jobs
  where quotation_id in (
    select quote.id
    from public.quotations quote
    where quote.lead_id = p_lead_id
       or quote.costing_source_id in (
         select costing.id
         from public.quotations costing
         where costing.lead_id = p_lead_id
       )
  );

  -- Delete dependent Price Quotations before their Costing Breakdown source.
  delete from public.quotations price
  where price.document_type = 'price_quotation'
    and (
      price.lead_id = p_lead_id
      or price.costing_source_id in (
        select costing.id
        from public.quotations costing
        where costing.lead_id = p_lead_id
      )
    );
  delete from public.quotations
  where lead_id = p_lead_id;
end;
$$;

create or replace function public.delete_lead_as_general_manager(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;
  if not private.has_text_role(v_lead.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can delete a Lead';
  end if;

  perform set_config('huswell.allow_lead_cascade', 'on', true);
  perform private.delete_lead_linked_records(v_lead.id);
  delete from public.leads where id = v_lead.id;

  return v_lead.id;
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
    perform public.delete_lead_as_general_manager(v_lead_id);
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.prevent_costing_breakdown_workflow() from public;
revoke all on function private.delete_lead_linked_records(uuid) from public;
revoke all on function public.delete_lead_as_general_manager(uuid) from public;
grant execute on function public.delete_lead_as_general_manager(uuid) to authenticated;
revoke all on function public.review_lead_change(uuid, text, text) from public;
grant execute on function public.review_lead_change(uuid, text, text) to authenticated;

commit;
