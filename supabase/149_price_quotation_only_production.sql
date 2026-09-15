-- Make the active production workflow Price Quotation-only.
-- Existing Mockup Quotation and signed-proof columns, records, and storage
-- objects remain in place for historical compatibility.
-- Run after 148_endorsed_lead_quotation_workflow.sql and before deploying the
-- matching workspace update. Safe to re-run.

begin;

-- New production requests may be created only with the direct Price Quotation
-- and dates. The legacy attachment columns remain available for historical
-- rows, but they cannot be populated by the current insert path.
drop policy if exists "project schedules: project officer submit"
  on public.project_schedules;
create policy "project schedules: project officer submit"
on public.project_schedules for insert to authenticated
with check (
  assigned_to = (select auth.uid())
  and created_by = (select auth.uid())
  and status = 'pending'::public.approval_status
  and (select private.has_text_role(organization_id, array['project_manager']))
  and mockup_quotation_id is null
  and price_signed_proof_id is null
  and mockup_signed_proof_id is null
);

-- Keep the legacy function signature used by the existing trigger and job
-- workflow, but no longer require or validate Mockup Quotations or proofs.
create or replace function private.validate_project_schedule_attachments(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_mockup_quotation_id uuid,
  p_price_signed_proof_id uuid,
  p_mockup_signed_proof_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_price public.quotations%rowtype;
begin
  select * into v_price
  from public.quotations
  where id = p_quotation_id;

  if not found
    or v_price.organization_id is distinct from p_organization_id
    or v_price.document_type is distinct from 'price_quotation'
    or v_price.costing_source_id is not null
    or v_price.status::text is distinct from 'approved' then
    raise exception 'Production requests require an approved direct Price Quotation';
  end if;
end;
$$;

-- New clients resubmit only the production details. The old ten-argument
-- overload remains available for already-deployed clients, but its legacy
-- attachment arguments are intentionally ignored by delegating to this path.
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
begin
  if p_due_date < p_start_date then
    raise exception 'The deadline cannot be before the start date';
  end if;

  if nullif(btrim(p_project_name), '') is null
    or nullif(btrim(p_client_name), '') is null
    or nullif(btrim(p_product_name), '') is null
    or p_quantity is null
    or p_quantity <= 0 then
    raise exception 'Project, client, product, and a positive quantity are required';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found
    or v_schedule.assigned_to is distinct from auth.uid()
    or v_schedule.created_by is distinct from auth.uid()
    or not private.has_text_role(v_schedule.organization_id, array['project_manager']) then
    raise exception 'Only the submitting Project Officer can resubmit this project';
  end if;

  if v_schedule.status <> 'rejected'::public.approval_status then
    raise exception 'Only rejected project schedules can be resubmitted';
  end if;

  perform private.validate_project_schedule_attachments(
    v_schedule.organization_id,
    v_schedule.quotation_id,
    null,
    null,
    null
  );

  update public.project_schedules
  set
    mockup_quotation_id = null,
    price_signed_proof_id = null,
    mockup_signed_proof_id = null,
    quotation_no = coalesce((select quotation_no from public.quotations where id = quotation_id), ''),
    project_name = btrim(p_project_name),
    client_name = btrim(p_client_name),
    product_name = btrim(p_product_name),
    quantity = p_quantity,
    start_date = p_start_date,
    due_date = p_due_date,
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

-- Preserve the old RPC signature during rollout without allowing it to create
-- a new Mockup/proof dependency.
create or replace function public.resubmit_project_schedule(
  p_schedule_id uuid,
  p_project_name text,
  p_client_name text,
  p_product_name text,
  p_quantity numeric,
  p_start_date date,
  p_due_date date,
  p_mockup_quotation_id uuid,
  p_price_signed_proof_id uuid,
  p_mockup_signed_proof_id uuid
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return public.resubmit_project_schedule(
    p_schedule_id,
    p_project_name,
    p_client_name,
    p_product_name,
    p_quantity,
    p_start_date,
    p_due_date
  );
end;
$$;

revoke all on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date) from public;
grant execute on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date) to authenticated;
revoke all on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date, uuid, uuid, uuid) from public;
grant execute on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date, uuid, uuid, uuid) to authenticated;

commit;
