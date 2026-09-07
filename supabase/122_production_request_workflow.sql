-- Tie Project Calendar production requests to an approved Mockup Quotation and
-- two selected signed client proofs, then link the approved request to the
-- existing production job workflow.
-- Run after 117_mockup_quotation_workflow.sql and the project schedule
-- approval migrations. Safe to re-run.

begin;

alter table public.project_schedules
  add column if not exists mockup_quotation_id uuid references public.quotations(id) on delete restrict,
  add column if not exists price_signed_proof_id uuid references public.quotation_signed_proofs(id) on delete restrict,
  add column if not exists mockup_signed_proof_id uuid references public.quotation_signed_proofs(id) on delete restrict,
  add column if not exists production_job_id uuid references public.production_jobs(id) on delete set null;

alter table public.production_jobs
  add column if not exists project_schedule_id uuid references public.project_schedules(id) on delete set null,
  add column if not exists mockup_quotation_id uuid references public.quotations(id) on delete set null,
  add column if not exists price_signed_proof_id uuid references public.quotation_signed_proofs(id) on delete set null,
  add column if not exists mockup_signed_proof_id uuid references public.quotation_signed_proofs(id) on delete set null;

create unique index if not exists production_jobs_project_schedule_key
  on public.production_jobs(project_schedule_id)
  where project_schedule_id is not null;

create index if not exists project_schedules_mockup_quotation_idx
  on public.project_schedules(mockup_quotation_id);

create index if not exists production_jobs_proof_lookup_idx
  on public.production_jobs(price_signed_proof_id, mockup_signed_proof_id);

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
  v_mockup public.quotations%rowtype;
  v_price_proof public.quotation_signed_proofs%rowtype;
  v_mockup_proof public.quotation_signed_proofs%rowtype;
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

  if p_mockup_quotation_id is null then
    if p_price_signed_proof_id is not null or p_mockup_signed_proof_id is not null then
      raise exception 'Select an approved Mockup Quotation before attaching signed proofs';
    end if;
    return;
  end if;

  select * into v_mockup
  from public.quotations
  where id = p_mockup_quotation_id;

  if not found
    or v_mockup.organization_id is distinct from p_organization_id
    or v_mockup.document_type is distinct from 'mockup_quotation'
    or v_mockup.source_price_quotation_id is distinct from v_price.id
    or v_mockup.status::text is distinct from 'approved' then
    raise exception 'Select the approved Mockup Quotation linked to the Price Quotation';
  end if;

  if p_price_signed_proof_id is null or p_mockup_signed_proof_id is null then
    raise exception 'Attach one signed proof image for each quotation';
  end if;

  select * into v_price_proof
  from public.quotation_signed_proofs
  where id = p_price_signed_proof_id;
  if not found
    or v_price_proof.organization_id is distinct from p_organization_id
    or v_price_proof.quotation_id is distinct from v_price.id then
    raise exception 'The Price Quotation signed proof is invalid';
  end if;

  select * into v_mockup_proof
  from public.quotation_signed_proofs
  where id = p_mockup_signed_proof_id;
  if not found
    or v_mockup_proof.organization_id is distinct from p_organization_id
    or v_mockup_proof.quotation_id is distinct from v_mockup.id then
    raise exception 'The Mockup Quotation signed proof is invalid';
  end if;

  if p_price_signed_proof_id = p_mockup_signed_proof_id then
    raise exception 'Use separate signed proof images for the Price and Mockup Quotations';
  end if;
end;
$$;

create or replace function public.populate_project_schedule_from_quotation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
begin
  perform private.validate_project_schedule_attachments(
    new.organization_id,
    new.quotation_id,
    new.mockup_quotation_id,
    new.price_signed_proof_id,
    new.mockup_signed_proof_id
  );

  select * into v_quotation
  from public.quotations
  where id = new.quotation_id;

  new.quotation_no := coalesce(v_quotation.quotation_no, '');
  new.project_name := coalesce(
    nullif(btrim(new.project_name), ''),
    nullif(v_quotation.project_name, ''),
    v_quotation.quotation_no,
    'Untitled project'
  );
  new.client_name := coalesce(
    nullif(btrim(new.client_name), ''),
    nullif(v_quotation.client_name, '')
  );
  new.product_name := coalesce(
    nullif(btrim(new.product_name), ''),
    nullif(v_quotation.project_types, '')
  );
  new.quantity := coalesce(new.quantity, v_quotation.project_quantity);
  return new;
end;
$$;

drop trigger if exists project_schedules_populate_from_quotation on public.project_schedules;
create trigger project_schedules_populate_from_quotation
before insert or update of organization_id, quotation_id, mockup_quotation_id,
  price_signed_proof_id, mockup_signed_proof_id
on public.project_schedules
for each row execute function public.populate_project_schedule_from_quotation();

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
begin
  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found or v_schedule.status::text <> 'approved' then
    raise exception 'Only an approved production request can create a production job';
  end if;

  perform private.validate_project_schedule_attachments(
    v_schedule.organization_id,
    v_schedule.quotation_id,
    v_schedule.mockup_quotation_id,
    v_schedule.price_signed_proof_id,
    v_schedule.mockup_signed_proof_id
  );

  select * into v_quotation
  from public.quotations
  where id = v_schedule.quotation_id;

  select * into v_job
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
      mockup_signed_proof_id
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
      v_schedule.mockup_signed_proof_id
    )
    returning * into v_job;
  else
    update public.production_jobs
    set project_schedule_id = v_schedule.id,
        mockup_quotation_id = v_schedule.mockup_quotation_id,
        price_signed_proof_id = v_schedule.price_signed_proof_id,
        mockup_signed_proof_id = v_schedule.mockup_signed_proof_id,
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

revoke all on function public.ensure_production_job_for_project_schedule(uuid) from public;

create or replace function public.review_project_schedule(
  p_schedule_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns public.project_schedules
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_schedule public.project_schedules%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported project schedule decision';
  end if;

  select * into v_schedule
  from public.project_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Project schedule was not found';
  end if;

  if not private.has_text_role(v_schedule.organization_id, array['owner', 'admin']) then
    raise exception 'Only the General Manager can review project schedules';
  end if;

  if v_schedule.status <> 'pending'::public.approval_status then
    raise exception 'This project schedule has already been reviewed';
  end if;

  update public.project_schedules
  set
    status = p_decision::public.approval_status,
    decided_by = auth.uid(),
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_schedule_id
  returning * into v_schedule;

  if p_decision = 'approved' then
    perform public.ensure_production_job_for_project_schedule(v_schedule.id);
    select * into v_schedule
    from public.project_schedules
    where id = v_schedule.id;
  end if;

  return v_schedule;
end;
$$;

-- New clients can resubmit rejected requests with a corrected Mockup/proof
-- pair while the old overload remains available for older deployed clients.
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
    p_mockup_quotation_id,
    p_price_signed_proof_id,
    p_mockup_signed_proof_id
  );

  update public.project_schedules
  set
    mockup_quotation_id = p_mockup_quotation_id,
    price_signed_proof_id = p_price_signed_proof_id,
    mockup_signed_proof_id = p_mockup_signed_proof_id,
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

revoke all on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date, uuid, uuid, uuid) from public;
grant execute on function public.resubmit_project_schedule(uuid, text, text, text, numeric, date, date, uuid, uuid, uuid) to authenticated;

create or replace function public.delete_quotation_signed_proof(
  p_proof_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_proof public.quotation_signed_proofs%rowtype;
  v_quote public.quotations%rowtype;
begin
  select quote.*
    into v_quote
  from public.quotation_signed_proofs proof
  join public.quotations quote on quote.id = proof.quotation_id
  where proof.id = p_proof_id
  for update of quote;
  if not found then
    raise exception 'Signed proof not found';
  end if;

  select * into v_proof
  from public.quotation_signed_proofs
  where id = p_proof_id
  for update;
  if not found then
    raise exception 'Signed proof not found';
  end if;

  if not (
    private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
    or v_quote.created_by = (select auth.uid())
    or v_quote.prepared_by_user_id = (select auth.uid())
  ) then
    raise exception 'You do not have permission to delete this signed proof';
  end if;

  if exists (
    select 1
    from public.project_schedules schedule
    where schedule.price_signed_proof_id = v_proof.id
       or schedule.mockup_signed_proof_id = v_proof.id
  ) or exists (
    select 1
    from public.production_jobs job
    where job.price_signed_proof_id = v_proof.id
       or job.mockup_signed_proof_id = v_proof.id
  ) then
    raise exception 'This signed proof is linked to a production request and cannot be removed';
  end if;

  delete from public.quotation_signed_proofs where id = v_proof.id;
end;
$$;

revoke all on function public.delete_quotation_signed_proof(uuid) from public;
grant execute on function public.delete_quotation_signed_proof(uuid) to authenticated;

drop policy if exists "quotation signed proofs: authorized read" on public.quotation_signed_proofs;
create policy "quotation signed proofs: authorized read"
on public.quotation_signed_proofs for select to authenticated
using (
  (select private.has_text_role(organization_id, array['super_admin', 'owner', 'admin']))
  or exists (
    select 1 from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.pricing_reviewed_by = (select auth.uid())
        or (select private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        ))
      )
  )
  or exists (
    select 1
    from public.production_jobs job
    where job.organization_id = quotation_signed_proofs.organization_id
      and (job.price_signed_proof_id = quotation_signed_proofs.id
        or job.mockup_signed_proof_id = quotation_signed_proofs.id)
      and (select private.has_text_role(job.organization_id, array['production', 'warehouse']))
  )
);

drop policy if exists "quotation signed proofs: workspace read" on storage.objects;
create policy "quotation signed proofs: workspace read"
on storage.objects for select to authenticated
using (
  bucket_id = 'quotation-signed-proofs'
  and exists (
    select 1
    from public.quotation_signed_proofs proof
    join public.quotations quote on quote.id = proof.quotation_id
    where proof.storage_path = storage.objects.name
      and (
        (select private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin']))
        or quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.pricing_reviewed_by = (select auth.uid())
        or (select private.is_pricing_officer_assigned(
          quote.organization_id,
          (select auth.uid()),
          quote.project_types
        ))
        or exists (
          select 1
          from public.production_jobs job
          where job.organization_id = proof.organization_id
            and (job.price_signed_proof_id = proof.id
              or job.mockup_signed_proof_id = proof.id)
            and (select private.has_text_role(job.organization_id, array['production', 'warehouse']))
        )
      )
  )
);

commit;
