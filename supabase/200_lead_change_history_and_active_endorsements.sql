-- Preserve lead identity in change-request history and expose active
-- endorsements to the Pricing Officer who created them.
-- Run after 199_lead_coordinator_owned_deletion_and_transferred_leads.sql
-- and before deploying the matching workspace update. Safe to re-run.

begin;

alter table public.lead_change_requests
  add column if not exists lead_snapshot jsonb not null default '{}'::jsonb;

comment on column public.lead_change_requests.lead_snapshot is
  'Lead identity captured when the request was submitted so the audit row remains readable after deletion or ownership changes.';

create or replace function private.populate_lead_change_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  if new.lead_id is null
    or coalesce(new.lead_snapshot, '{}'::jsonb) <> '{}'::jsonb then
    return new;
  end if;

  select * into v_lead
  from public.leads
  where id = new.lead_id;

  if found then
    new.lead_snapshot := jsonb_build_object(
      'lead_no', v_lead.lead_no,
      'project_name', v_lead.project_name,
      'client_name', v_lead.client_name,
      'contact_name', v_lead.contact_name,
      'evaluation_number', v_lead.evaluation_number,
      'date_sent', v_lead.date_sent,
      'captured_at', now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists lead_change_requests_snapshot on public.lead_change_requests;
create trigger lead_change_requests_snapshot
before insert on public.lead_change_requests
for each row execute function private.populate_lead_change_snapshot();

-- Backfill active request rows. Rows whose Lead was already deleted retain an
-- empty snapshot and are rendered as historical records by the workspace.
update public.lead_change_requests request
set lead_snapshot = jsonb_build_object(
  'lead_no', lead.lead_no,
  'project_name', lead.project_name,
  'client_name', lead.client_name,
  'contact_name', lead.contact_name,
  'evaluation_number', lead.evaluation_number,
  'date_sent', lead.date_sent,
  'captured_at', coalesce(request.submitted_at, now())
)
from public.leads lead
where lead.id = request.lead_id
  and coalesce(request.lead_snapshot, '{}'::jsonb) = '{}'::jsonb;

create or replace function public.sales_pricing_officer_active_endorsements(
  p_organization_id uuid
)
returns table (
  lead_id uuid,
  organization_id uuid,
  lead_no text,
  project_name text,
  contact_name text,
  client_name text,
  evaluation_number integer,
  endorsed_to_id uuid,
  endorsed_to_name text,
  endorsed_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(
    p_organization_id,
    array['sales_pricing_officer']
  ) then
    raise exception 'Only a Sales & Pricing Officer can view active endorsements';
  end if;

  return query
  select
    lead_row.id,
    lead_row.organization_id,
    lead_row.lead_no,
    lead_row.project_name,
    lead_row.contact_name,
    lead_row.client_name,
    lead_row.evaluation_number,
    lead_row.endorsed_to,
    coalesce(nullif(btrim(profile.full_name), ''), 'Sales & Pricing Officer'),
    lead_row.endorsed_at
  from public.leads lead_row
  left join public.profiles profile
    on profile.id = lead_row.endorsed_to
  where lead_row.organization_id = p_organization_id
    and lead_row.endorsed_by = (select auth.uid())
    and lead_row.endorsed_to is not null
    and lead_row.endorsed_at is not null
  order by lead_row.endorsed_at desc, lead_row.id desc;
end;
$$;

revoke all on function private.populate_lead_change_snapshot() from public;
revoke all on function public.sales_pricing_officer_active_endorsements(uuid) from public;
grant execute on function public.sales_pricing_officer_active_endorsements(uuid) to authenticated;

commit;
