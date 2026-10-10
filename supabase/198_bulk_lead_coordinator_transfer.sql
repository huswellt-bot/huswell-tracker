-- Add an atomic bulk Lead Coordinator transfer workflow.
-- Run after 197_lead_coordinator_excel_import.sql and before deploying the
-- matching Lead Coordinator workspace update.

begin;

create or replace function public.transfer_leads_to_pricing_officer(
  p_lead_ids uuid[],
  p_recipient_user_id uuid,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_requested_count integer;
  v_found_count integer;
  v_organization_count integer;
  v_organization_id uuid;
  v_lead_id uuid;
  v_transferred_count integer := 0;
begin
  select count(distinct input.lead_id)::integer
    into v_requested_count
  from unnest(coalesce(p_lead_ids, '{}'::uuid[])) as input(lead_id)
  where input.lead_id is not null;

  if v_requested_count = 0 then
    raise exception 'Select at least one lead to transfer';
  end if;

  select count(distinct lead.id)::integer,
         count(distinct lead.organization_id)::integer
    into v_found_count, v_organization_count
  from public.leads lead
  where lead.id = any(coalesce(p_lead_ids, '{}'::uuid[]));

  if v_found_count <> v_requested_count then
    raise exception 'One or more selected leads could not be found';
  end if;
  if v_organization_count <> 1 then
    raise exception 'Selected leads must belong to one organization';
  end if;

  select lead.organization_id
    into v_organization_id
  from public.leads lead
  where lead.id = any(coalesce(p_lead_ids, '{}'::uuid[]))
  order by lead.id
  limit 1;

  if not private.has_text_role(
    v_organization_id,
    array['super_admin', 'owner', 'admin', 'lead_coordinator']
  ) then
    raise exception 'Only a Lead Coordinator or administrator can transfer leads';
  end if;
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select a Sales & Pricing Officer';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected user is not an active Sales & Pricing Officer';
  end if;

  -- The existing single-transfer RPC remains the source of truth for ownership
  -- checks, endorsement/quotation locks, audit history, and activity logging.
  -- Calling it inside this transaction makes the complete batch all-or-nothing.
  for v_lead_id in
    select distinct input.lead_id
    from unnest(coalesce(p_lead_ids, '{}'::uuid[])) as input(lead_id)
    where input.lead_id is not null
    order by input.lead_id
  loop
    perform public.transfer_lead_to_pricing_officer(
      v_lead_id,
      p_recipient_user_id,
      p_note
    );
    v_transferred_count := v_transferred_count + 1;
  end loop;

  return v_transferred_count;
end;
$$;

revoke all on function public.transfer_leads_to_pricing_officer(uuid[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.transfer_leads_to_pricing_officer(uuid[], uuid, text)
  to authenticated;

commit;
