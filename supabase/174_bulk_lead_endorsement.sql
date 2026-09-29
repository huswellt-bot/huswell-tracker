-- Allow a Sales & Pricing Officer to endorse multiple assigned Leads in one
-- atomic action. Bulk endorsement intentionally does not support attachments;
-- the existing single-lead endorsement RPC remains the image-capable path.
-- Run after 173_commission_summary_approved_quotation_eligibility.sql and
-- before deploying the matching Leads workspace update. Safe to re-run.

begin;

create or replace function public.endorse_leads_bulk(
  p_lead_ids uuid[],
  p_recipient_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_lead_id uuid;
  v_requested_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
begin
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then
    raise exception 'Select at least one Lead to endorse';
  end if;

  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select another Sales & Pricing Officer recipient';
  end if;

  select count(*)::integer, count(distinct requested.id)::integer
    into v_requested_count, v_distinct_count
  from unnest(p_lead_ids) as requested(id);

  if v_requested_count <> v_distinct_count then
    raise exception 'A Lead can only be selected once';
  end if;

  select lead_row.organization_id
    into v_organization_id
  from public.leads lead_row
  where lead_row.id = p_lead_ids[1];

  if not found then
    raise exception 'One or more selected Leads could not be found';
  end if;

  if not private.has_text_role(
    v_organization_id,
    array['sales_pricing_officer']
  ) then
    raise exception 'Only a Sales & Pricing Officer can endorse Leads in bulk';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;

  if exists (
    select 1
    from unnest(p_lead_ids) as requested(id)
    left join public.leads lead_row on lead_row.id = requested.id
    where lead_row.id is null
      or lead_row.organization_id is distinct from v_organization_id
  ) then
    raise exception 'All selected Leads must belong to the same organization';
  end if;

  -- Match the single-lead RPC's advisory lock order so concurrent endorsement,
  -- unendorsement, and approved-quotation changes cannot race this batch.
  for v_lead_id in
    select lead_row.id
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
    order by lead_row.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lead_id::text, 1));
  end loop;

  -- Lock every selected row before any update. If a row disappears between
  -- the earlier existence check and this lock pass, fail the whole batch.
  for v_lead_id in
    select lead_row.id
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
    order by lead_row.id
    for update
  loop
    v_locked_count := v_locked_count + 1;
  end loop;

  if v_locked_count <> v_requested_count then
    raise exception 'One or more selected Leads are no longer available';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
      and coalesce(lead_row.assigned_to, lead_row.created_by)
        is distinct from (select auth.uid())
  ) then
    raise exception 'All selected Leads must be assigned to you';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
      and coalesce(lead_row.evaluation_number, 0) = 7
  ) then
    raise exception 'Only Leads can be endorsed in bulk';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
      and private.lead_has_approved_price_quotation(lead_row.id)
  ) then
    raise exception 'Lead endorsement cannot be changed after an approved Price Quotation exists';
  end if;

  if exists (
    select 1
    from public.leads lead_row
    where lead_row.id = any(p_lead_ids)
      and (
        lead_row.endorsed_by is not null
        or lead_row.endorsed_to is not null
        or lead_row.endorsed_at is not null
      )
  ) then
    raise exception 'One or more selected Leads already have an active endorsement';
  end if;

  -- Reuse the current single-lead workflow so each Lead receives the same
  -- audit/history behavior. All calls share this transaction: any failure
  -- rolls back every endorsement in the batch.
  for v_lead_id in
    select requested.id
    from unnest(p_lead_ids) as requested(id)
    order by requested.id
  loop
    perform public.endorse_lead(v_lead_id, p_recipient_user_id);
  end loop;

  return v_requested_count;
end;
$$;

revoke all on function public.endorse_leads_bulk(uuid[], uuid) from public;
grant execute on function public.endorse_leads_bulk(uuid[], uuid) to authenticated;

commit;
