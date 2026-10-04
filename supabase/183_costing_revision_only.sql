-- Run after 182_costing_request_workflow.sql and immediately after deploying
-- the revision-only Print Costing workspace update. The new workspace is
-- compatible with migration 182 during this rollout window.
--
-- The GM decision path is intentionally limited to approve or return for
-- revision. Existing rejected rows are retained, converted to needs_revision,
-- and recorded in costing_request_events before the status constraint is
-- tightened. No costing request or line item is deleted.

begin;

insert into public.costing_request_events (
  organization_id,
  request_id,
  event_type,
  from_status,
  to_status,
  actor_id,
  note
)
select
  request.organization_id,
  request.id,
  'status_policy_normalized',
  'rejected',
  'needs_revision',
  null,
  coalesce(
    nullif(trim(request.decision_note), ''),
    'No previous decision note was recorded.'
  )
from public.costing_requests request
where request.status = 'rejected';

update public.costing_requests
set status = 'needs_revision',
    approved_by = null,
    approved_at = null,
    decision_note = case
      when nullif(trim(decision_note), '') is null
        then 'This costing was returned for revision during the revision-only workflow update.'
      else 'Returned for revision during the revision-only workflow update. Previous decision note: ' || decision_note
    end,
    updated_at = now()
where status = 'rejected';

alter table public.costing_requests
  drop constraint if exists costing_requests_status_check;

alter table public.costing_requests
  add constraint costing_requests_status_check
  check (status in ('draft', 'pending', 'needs_revision', 'approved'));

create or replace function public.submit_costing_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
begin
  select * into v_request
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if v_request.prepared_by <> (select auth.uid())
     and not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the preparer or General Manager can submit this costing request';
  end if;
  if v_request.status not in ('draft', 'needs_revision') then
    raise exception 'Only a draft or returned costing request can be submitted';
  end if;
  if not exists (
    select 1 from public.costing_request_items item
    where item.request_id = p_request_id
      and item.width_mm > 0 and item.height_mm > 0 and item.quantity > 0
  ) then
    raise exception 'Add at least one costing item with width, height, and quantity before submitting';
  end if;

  perform private.refresh_costing_request_calculation(p_request_id);
  update public.costing_requests
  set status = 'pending', submitted_by = (select auth.uid()), submitted_at = now(),
      decided_by = null, decided_at = null, decision_note = null, updated_at = now()
  where id = p_request_id;
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id)
  values
    (v_request.organization_id, p_request_id, 'submitted', v_request.status, 'pending', (select auth.uid()));
end;
$$;

create or replace function public.review_costing_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.costing_requests%rowtype;
  v_next_status text;
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported costing decision';
  end if;
  if p_decision = 'needs_revision'
     and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A note is required when returning a costing request for revision';
  end if;
  select * into v_request
  from public.costing_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Costing request not found'; end if;
  if not private.has_text_role(v_request.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only a General Manager can decide a costing request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending costing request can be decided';
  end if;
  v_next_status := p_decision;
  update public.costing_requests
  set status = v_next_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end,
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_request_id;
  insert into public.costing_request_events
    (organization_id, request_id, event_type, from_status, to_status, actor_id, note)
  values
    (v_request.organization_id, p_request_id, p_decision, v_request.status, v_next_status, (select auth.uid()), nullif(trim(coalesce(p_note, '')), ''));
end;
$$;

revoke execute on function public.submit_costing_request(uuid) from public, anon;
revoke execute on function public.review_costing_request(uuid, text, text) from public, anon;
grant execute on function public.submit_costing_request(uuid) to authenticated;
grant execute on function public.review_costing_request(uuid, text, text) to authenticated;

commit;
