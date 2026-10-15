-- Add return-for-revision support to External Finance budget requests.
-- Internal Finance can return a pending request with a required reason;
-- the requesting External Finance user can edit and resubmit it.
-- Run after 217_finance_money_out_revision_workflow.sql and before deploying
-- the matching Finance workspace update. Safe to re-run.

begin;

-- Replace the original status check while preserving all existing statuses.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.finance_budget_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.finance_budget_requests drop constraint if exists %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.finance_budget_requests
  add constraint finance_budget_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'revision_requested', 'cancelled'));

create table if not exists public.finance_budget_request_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  budget_request_id uuid not null references public.finance_budget_requests(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  reason text not null check (btrim(reason) <> ''),
  returned_by uuid not null references auth.users(id) on delete restrict,
  returned_at timestamptz not null default now(),
  resubmitted_by uuid references auth.users(id) on delete set null,
  resubmitted_at timestamptz,
  before_data jsonb not null,
  after_data jsonb,
  created_at timestamptz not null default now(),
  check ((resubmitted_at is null and resubmitted_by is null) or (resubmitted_at is not null and resubmitted_by is not null)),
  unique (budget_request_id, revision_number)
);

create index if not exists finance_budget_request_revisions_org_idx
  on public.finance_budget_request_revisions(organization_id, returned_at desc);
create index if not exists finance_budget_request_revisions_request_idx
  on public.finance_budget_request_revisions(budget_request_id, revision_number desc);

alter table public.finance_budget_request_revisions enable row level security;
revoke all on public.finance_budget_request_revisions from anon, authenticated;
grant select on public.finance_budget_request_revisions to authenticated;

drop policy if exists "finance budget revisions: finance read"
  on public.finance_budget_request_revisions;
create policy "finance budget revisions: finance read"
on public.finance_budget_request_revisions for select to authenticated
using (
  private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ])
  or exists (
    select 1
    from public.finance_budget_requests request
    where request.id = budget_request_id
      and request.requested_by = (select auth.uid())
  )
);

-- Preserve the existing approval/rejection protection and add the only valid
-- revision transitions: pending -> revision_requested and
-- revision_requested -> pending after resubmission.
create or replace function private.finance_budget_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'pending'
      and new.status not in ('approved', 'rejected', 'revision_requested', 'cancelled') then
      raise exception 'Invalid budget request status transition';
    end if;
    if old.status = 'revision_requested'
      and new.status <> 'pending' then
      raise exception 'A returned budget request can only be resubmitted';
    end if;
    if old.status = 'approved'
      and new.status not in ('approved', 'cancelled') then
      raise exception 'An approved budget request cannot be edited';
    end if;
    if old.status in ('rejected', 'cancelled')
      and new.status <> old.status then
      raise exception 'A closed budget request cannot be reopened';
    end if;
  end if;

  if new.status in ('rejected', 'cancelled', 'revision_requested')
    and old.status is distinct from new.status
    and exists (
      select 1
      from public.finance_transactions transaction
      where transaction.organization_id = new.organization_id
        and transaction.budget_request_id = new.id
        and not transaction.is_voided
        and transaction.approval_status not in ('rejected', 'revision_requested', 'cancelled')
    ) then
    raise exception 'This budget has active Money Out commitments and cannot be closed or returned for revision';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_budget_requests_status_guard
  on public.finance_budget_requests;
create trigger finance_budget_requests_status_guard
before update of status on public.finance_budget_requests
for each row execute function private.finance_budget_status_guard();

create or replace function public.review_finance_budget_request(
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
  v_request public.finance_budget_requests%rowtype;
  v_revision_number integer;
  v_reason text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  select * into v_request
  from public.finance_budget_requests
  where id = p_request_id
  for update;

  if not found or not private.finance_is_internal(v_request.organization_id) then
    raise exception 'Budget request not found';
  end if;
  if v_request.status <> 'pending'
    or p_decision not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'Only pending budget requests can be reviewed';
  end if;
  if p_decision in ('rejected', 'revision_requested') and v_reason is null then
    raise exception 'A reason is required for this budget decision';
  end if;

  if p_decision = 'revision_requested' then
    select coalesce(max(revision.revision_number), 0) + 1
    into v_revision_number
    from public.finance_budget_request_revisions revision
    where revision.budget_request_id = v_request.id;

    insert into public.finance_budget_request_revisions (
      organization_id,
      budget_request_id,
      revision_number,
      reason,
      returned_by,
      before_data
    )
    values (
      v_request.organization_id,
      v_request.id,
      v_revision_number,
      v_reason,
      (select auth.uid()),
      jsonb_build_object(
        'amount', v_request.amount,
        'note', v_request.note,
        'status', v_request.status,
        'requested_by', v_request.requested_by,
        'requested_at', v_request.requested_at,
        'decided_by', v_request.decided_by,
        'decided_at', v_request.decided_at,
        'decision_note', v_request.decision_note
      )
    );
  end if;

  update public.finance_budget_requests
  set status = p_decision,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_reason
  where id = v_request.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  )
  values (
    v_request.organization_id,
    (select auth.uid()),
    'finance_budget_request',
    v_request.id,
    case when p_decision = 'revision_requested' then 'budget_revision_requested' else 'budget_reviewed' end,
    jsonb_build_object('status', v_request.status, 'amount', v_request.amount, 'note', v_request.note),
    jsonb_build_object('status', p_decision, 'amount', v_request.amount, 'note', v_request.note, 'decision_note', v_reason),
    v_reason
  );

  return v_request.id;
end;
$$;

revoke all on function public.review_finance_budget_request(uuid, text, text) from public;
grant execute on function public.review_finance_budget_request(uuid, text, text) to authenticated;

create or replace function public.resubmit_finance_budget_request(
  p_request_id uuid,
  p_amount numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.finance_budget_requests%rowtype;
  v_revision public.finance_budget_request_revisions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_request
  from public.finance_budget_requests
  where id = p_request_id
  for update;

  if not found
    or not private.has_text_role(v_request.organization_id, array['external_finance'])
    or private.finance_is_internal(v_request.organization_id)
    or v_request.requested_by is distinct from (select auth.uid()) then
    raise exception 'Budget request not found';
  end if;
  if v_request.status <> 'revision_requested' then
    raise exception 'Only a returned budget request can be resubmitted';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Budget amount must be greater than zero';
  end if;

  select * into v_revision
  from public.finance_budget_request_revisions revision
  where revision.budget_request_id = v_request.id
    and revision.resubmitted_at is null
  order by revision.revision_number desc
  limit 1
  for update;

  if not found then
    raise exception 'Budget revision history not found';
  end if;

  update public.finance_budget_requests
  set amount = round(p_amount, 2),
      note = v_note,
      status = 'pending',
      requested_at = now(),
      decided_by = null,
      decided_at = null,
      decision_note = null
  where id = v_request.id;

  update public.finance_budget_request_revisions
  set resubmitted_by = (select auth.uid()),
      resubmitted_at = now(),
      after_data = jsonb_build_object(
        'amount', round(p_amount, 2),
        'note', v_note,
        'status', 'pending',
        'requested_at', now()
      )
  where id = v_revision.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  )
  values (
    v_request.organization_id,
    (select auth.uid()),
    'finance_budget_request',
    v_request.id,
    'budget_resubmitted',
    jsonb_build_object('status', v_request.status, 'amount', v_request.amount, 'note', v_request.note),
    jsonb_build_object('status', 'pending', 'amount', round(p_amount, 2), 'note', v_note),
    'External Finance resubmitted the budget request after revision.'
  );

  return v_request.id;
end;
$$;

revoke all on function public.resubmit_finance_budget_request(uuid, numeric, text) from public;
grant execute on function public.resubmit_finance_budget_request(uuid, numeric, text) to authenticated;

commit;
