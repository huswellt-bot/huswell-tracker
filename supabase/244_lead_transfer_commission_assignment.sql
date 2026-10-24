-- Lead Coordinator transfers create a locked commission assignment:
-- the configured S.E. Origin remains fixed and the receiving Sales & Pricing
-- Officer becomes the Co-Worker. Historical non-approved transfers are
-- backfilled; approved quotations remain unchanged for audit integrity.

begin;

alter table public.business_settings
  add column if not exists lead_transfer_origin_user_id uuid
    references auth.users(id) on delete set null;

alter table public.leads
  add column if not exists transfer_se_origin_user_id uuid
    references auth.users(id) on delete restrict;

alter table public.leads
  add column if not exists transfer_co_worker_user_id uuid
    references auth.users(id) on delete restrict;

create index if not exists leads_transfer_commission_assignment_idx
  on public.leads (organization_id, transfer_se_origin_user_id, transfer_co_worker_user_id)
  where transfer_se_origin_user_id is not null;

-- Configure every organization that has exactly one active Sales & Pricing
-- Officer named Marvin Tavarez. The transfer RPC still validates the role and
-- organization at execution time.
update public.business_settings settings
set lead_transfer_origin_user_id = member.user_id
from public.organization_members member
join public.profiles profile on profile.id = member.user_id
where settings.organization_id = member.organization_id
  and member.role::text = 'sales_pricing_officer'
  and lower(btrim(profile.full_name)) = 'marvin tavarez'
  and not exists (
    select 1
    from public.organization_members duplicate_member
    join public.profiles duplicate_profile on duplicate_profile.id = duplicate_member.user_id
    where duplicate_member.organization_id = settings.organization_id
      and duplicate_member.role::text = 'sales_pricing_officer'
      and lower(btrim(duplicate_profile.full_name)) = 'marvin tavarez'
      and duplicate_member.user_id <> member.user_id
  );

create or replace function private.validate_lead_transfer_commission_assignment(
  p_organization_id uuid,
  p_origin_user_id uuid,
  p_co_worker_user_id uuid,
  p_split_option text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_origin_role text;
  v_co_worker_role text;
  v_origin_rate numeric;
  v_co_worker_rate numeric;
begin
  if p_origin_user_id is null or p_co_worker_user_id is null then
    raise exception 'Transferred leads require an S.E. Origin and Co-Worker';
  end if;
  if p_origin_user_id = p_co_worker_user_id then
    raise exception 'The transfer S.E. Origin and Co-Worker must be different users';
  end if;

  select member.role::text into v_origin_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_origin_user_id;

  select member.role::text into v_co_worker_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_co_worker_user_id;

  if v_origin_role <> 'sales_pricing_officer' then
    raise exception 'The configured transfer S.E. Origin is not an active Sales & Pricing Officer';
  end if;
  if v_co_worker_role <> 'sales_pricing_officer' then
    raise exception 'The transfer recipient must be an active Sales & Pricing Officer';
  end if;

  if p_split_option is not null then
    select rates.origin_rate, rates.coworker_rate
      into v_origin_rate, v_co_worker_rate
    from private.commission_split_rates(p_split_option) rates;
    if v_origin_rate is null or v_co_worker_rate is null then
      raise exception 'Transferred leads require a shared commission division';
    end if;
  end if;
end;
$$;

revoke all on function private.validate_lead_transfer_commission_assignment(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.validate_lead_transfer_commission_assignment(uuid, uuid, uuid, text)
  to authenticated;

create or replace function private.apply_lead_transfer_commission_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
begin
  if new.lead_id is null then
    return new;
  end if;

  select * into v_lead
  from public.leads lead_row
  where lead_row.id = new.lead_id;

  if v_lead.transfer_se_origin_user_id is null then
    return new;
  end if;

  perform private.validate_lead_transfer_commission_assignment(
    v_lead.organization_id,
    v_lead.transfer_se_origin_user_id,
    v_lead.transfer_co_worker_user_id,
    null
  );

  if new.commission_split_option = 'self_handled_100_0' then
    raise exception 'Transferred leads require a shared commission division';
  end if;

  new.se_origin_user_id := v_lead.transfer_se_origin_user_id;
  new.commission_handling_mode := 'shared';
  new.commission_co_worker_user_id := v_lead.transfer_co_worker_user_id;
  new.assigned_pricing_officer_user_id := v_lead.transfer_co_worker_user_id;
  return new;
end;
$$;

drop trigger if exists quotations_apply_lead_transfer_commission_assignment
  on public.quotations;
create trigger quotations_apply_lead_transfer_commission_assignment
before insert or update of lead_id, se_origin_user_id, commission_handling_mode,
  commission_co_worker_user_id, assigned_pricing_officer_user_id, commission_split_option
on public.quotations
for each row execute function private.apply_lead_transfer_commission_assignment();

-- Backfill historical Lead Coordinator transfers using the latest transfer
-- recipient for each lead. Approved quotations are intentionally preserved;
-- all other Price Quotation records receive the same locked assignment.
with latest_coordinator_transfer as (
  select distinct on (transfer.organization_id, transfer.lead_id)
    transfer.organization_id,
    transfer.lead_id,
    transfer.new_owner_id
  from public.lead_transfer_history transfer
  join public.organization_members actor
    on actor.organization_id = transfer.organization_id
   and actor.user_id = transfer.transferred_by
  where actor.role::text = 'lead_coordinator'
  order by transfer.organization_id, transfer.lead_id, transfer.transferred_at desc, transfer.id desc
), backfill as (
  select lead_row.id,
         settings.lead_transfer_origin_user_id,
         latest.new_owner_id
  from public.leads lead_row
  join public.business_settings settings
    on settings.organization_id = lead_row.organization_id
   and settings.lead_transfer_origin_user_id is not null
  join latest_coordinator_transfer latest
    on latest.organization_id = lead_row.organization_id
   and latest.lead_id = lead_row.id
  where lead_row.transfer_se_origin_user_id is null
)
update public.leads lead_row
set transfer_se_origin_user_id = backfill.lead_transfer_origin_user_id,
    transfer_co_worker_user_id = backfill.new_owner_id
from backfill
where lead_row.id = backfill.id;

select set_config('huswell.commission_assignment_rpc', 'on', true);
update public.quotations quotation
set se_origin_user_id = lead_row.transfer_se_origin_user_id,
    assigned_pricing_officer_user_id = lead_row.transfer_co_worker_user_id,
    commission_handling_mode = 'shared',
    commission_co_worker_user_id = lead_row.transfer_co_worker_user_id,
    commission_split_option = null
from public.leads lead_row
where quotation.lead_id = lead_row.id
  and lead_row.transfer_se_origin_user_id is not null
  and quotation.document_type = 'price_quotation'
  and quotation.costing_source_id is null
  and quotation.status::text <> 'approved';
select set_config('huswell.commission_assignment_rpc', '', true);

create or replace function public.transfer_lead_to_pricing_officer(
  p_lead_id uuid,
  p_recipient_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_actor_is_manager boolean;
  v_actor_is_coordinator boolean;
  v_previous_owner uuid;
  v_transfer_origin_user_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 2));
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;

  v_actor_is_manager := private.has_text_role(v_lead.organization_id, array['super_admin', 'owner', 'admin']);
  v_actor_is_coordinator := private.has_text_role(v_lead.organization_id, array['lead_coordinator']);
  if not v_actor_is_manager and not v_actor_is_coordinator then
    raise exception 'Only a Lead Coordinator or administrator can transfer a lead';
  end if;
  if v_actor_is_coordinator and coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid()) then
    raise exception 'Only leads assigned to the current Lead Coordinator can be transferred';
  end if;
  if p_recipient_user_id is null or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select a Sales & Pricing Officer';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected user is not an active Sales & Pricing Officer';
  end if;
  if coalesce(v_lead.evaluation_number, 0) = 7 then raise exception 'Done Deals cannot be transferred'; end if;
  if v_lead.endorsed_by is not null or v_lead.endorsed_to is not null or v_lead.endorsed_at is not null then
    raise exception 'Resolve the existing lead endorsement before transferring ownership';
  end if;
  if exists (
    select 1 from public.quotations quotation
    where quotation.lead_id = v_lead.id
      and quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
  ) then
    raise exception 'A lead with an approved Price Quotation cannot change owner';
  end if;

  v_previous_owner := coalesce(v_lead.assigned_to, v_lead.created_by);
  if v_actor_is_coordinator then
    select settings.lead_transfer_origin_user_id
      into v_transfer_origin_user_id
    from public.business_settings settings
    where settings.organization_id = v_lead.organization_id;
    if v_transfer_origin_user_id is null then
      raise exception 'Configure the Lead Coordinator transfer S.E. Origin before transferring leads';
    end if;
    perform private.validate_lead_transfer_commission_assignment(
      v_lead.organization_id,
      v_transfer_origin_user_id,
      p_recipient_user_id,
      null
    );
  end if;

  perform set_config('huswell.allow_lead_owner_transfer', 'on', true);
  if v_actor_is_coordinator then
    update public.leads
    set assigned_to = p_recipient_user_id,
        transfer_se_origin_user_id = v_transfer_origin_user_id,
        transfer_co_worker_user_id = p_recipient_user_id
    where id = v_lead.id;
  else
    update public.leads set assigned_to = p_recipient_user_id where id = v_lead.id;
  end if;
  perform set_config('huswell.allow_lead_owner_transfer', 'off', true);

  if v_actor_is_coordinator then
    perform set_config('huswell.commission_assignment_rpc', 'on', true);
    update public.quotations
    set se_origin_user_id = v_transfer_origin_user_id,
        assigned_pricing_officer_user_id = p_recipient_user_id,
        commission_handling_mode = 'shared',
        commission_co_worker_user_id = p_recipient_user_id,
        commission_split_option = null
    where lead_id = v_lead.id
      and document_type = 'price_quotation'
      and costing_source_id is null
      and status::text <> 'approved';
    perform set_config('huswell.commission_assignment_rpc', '', true);
  end if;

  insert into public.lead_transfer_history (
    organization_id, lead_id, previous_owner_id, new_owner_id, transferred_by, note
  ) values (
    v_lead.organization_id, v_lead.id, v_previous_owner, p_recipient_user_id,
    (select auth.uid()), nullif(btrim(coalesce(p_note, '')), '')
  );
  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data, note
  ) values (
    v_lead.organization_id, (select auth.uid()), 'lead', v_lead.id, 'ownership_transferred',
    jsonb_build_object('assigned_to', v_previous_owner),
    jsonb_build_object(
      'assigned_to', p_recipient_user_id,
      'transfer_se_origin_user_id', case when v_actor_is_coordinator then v_transfer_origin_user_id else null end,
      'transfer_co_worker_user_id', case when v_actor_is_coordinator then p_recipient_user_id else null end
    ),
    nullif(btrim(coalesce(p_note, '')), '')
  );
  return v_lead.id;
end;
$$;

revoke all on function public.transfer_lead_to_pricing_officer(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_lead_to_pricing_officer(uuid, uuid, text) to authenticated;
revoke all on function public.transfer_leads_to_pricing_officer(uuid[], uuid, text) from public, anon;
grant execute on function public.transfer_leads_to_pricing_officer(uuid[], uuid, text) to authenticated;

create or replace function public.save_price_quotation_draft_with_commission_v2(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean,
  p_quotation_illustrations jsonb,
  p_se_origin_user_id uuid,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_lead public.leads%rowtype;
  v_assigned_user_id uuid;
  v_quote_id uuid;
  v_origin_user_id uuid := p_se_origin_user_id;
  v_handling_mode text := p_commission_handling_mode;
  v_co_worker_user_id uuid := p_commission_co_worker_user_id;
begin
  select * into v_lead
  from public.leads lead_row
  where lead_row.id = p_lead_id
  for share;
  if not found then raise exception 'Lead not found'; end if;

  if p_quotation_id is not null then
    select * into v_quote
    from public.quotations quotation
    where quotation.id = p_quotation_id
    for update;
    if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
      raise exception 'Price Quotation not found';
    end if;
    if v_quote.status::text not in ('draft', 'needs_revision') then
      raise exception 'Only draft or returned quotations can be edited';
    end if;
    if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin'])
      and v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
      raise exception 'Only the Project Officer or Pricing Officer who prepared this quotation can edit it';
    end if;
  end if;

  if v_lead.transfer_se_origin_user_id is not null then
    v_origin_user_id := v_lead.transfer_se_origin_user_id;
    v_handling_mode := 'shared';
    v_co_worker_user_id := v_lead.transfer_co_worker_user_id;
    perform private.validate_lead_transfer_commission_assignment(
      v_lead.organization_id, v_origin_user_id, v_co_worker_user_id, null
    );
  else
    perform private.validate_quotation_commission_assignment_pre_gm(
      v_lead.organization_id, p_project_type, v_origin_user_id,
      v_handling_mode, v_co_worker_user_id
    );
  end if;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id, p_lead_id, p_project_type, p_items,
    coalesce(p_has_illustrations, false),
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );

  v_assigned_user_id := case
    when v_handling_mode = 'self_handled' then v_origin_user_id
    else v_co_worker_user_id
  end;
  update public.quotations
  set se_origin_user_id = v_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = v_handling_mode,
      commission_co_worker_user_id = v_co_worker_user_id,
      commission_split_option = null,
      revision_requested_to = null
  where id = v_quote_id;
  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft_with_commission_v2(
  uuid, uuid, text, jsonb, boolean, jsonb, uuid, text, uuid
) from public, anon;
grant execute on function public.save_price_quotation_draft_with_commission_v2(
  uuid, uuid, text, jsonb, boolean, jsonb, uuid, text, uuid
) to authenticated;

create or replace function public.final_approve_price_quotation_with_commission_v2(
  p_quotation_id uuid,
  p_se_origin_user_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_lead public.leads%rowtype;
  v_origin_user_id uuid := p_se_origin_user_id;
  v_handling_mode text := p_commission_handling_mode;
  v_co_worker_user_id uuid := p_commission_co_worker_user_id;
  v_assigned_user_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve this quotation';
  end if;

  select * into v_lead from public.leads where id = v_quote.lead_id;
  if v_lead.transfer_se_origin_user_id is not null then
    v_origin_user_id := v_lead.transfer_se_origin_user_id;
    v_handling_mode := 'shared';
    v_co_worker_user_id := v_lead.transfer_co_worker_user_id;
    perform private.validate_lead_transfer_commission_assignment(
      v_quote.organization_id, v_origin_user_id, v_co_worker_user_id, p_commission_split_option
    );
  else
    if v_origin_user_id is null then
      raise exception 'The final S.E. Origin is required';
    end if;
    perform private.validate_quotation_commission_assignment(
      v_quote.organization_id,
      v_quote.project_types,
      v_origin_user_id,
      v_handling_mode,
      v_co_worker_user_id,
      p_commission_split_option
    );
  end if;

  v_assigned_user_id := case
    when v_handling_mode = 'self_handled' then v_origin_user_id
    else v_co_worker_user_id
  end;
  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set se_origin_user_id = v_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = v_handling_mode,
      commission_co_worker_user_id = v_co_worker_user_id,
      commission_split_option = p_commission_split_option
  where id = v_quote.id;

  perform public.final_approve_price_quotation_with_edits(
    p_quotation_id,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_payment_terms_option,
    p_pdc_term_days
  );
end;
$$;

revoke all on function public.final_approve_price_quotation_with_commission_v2(
  uuid, uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.final_approve_price_quotation_with_commission_v2(
  uuid, uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) to authenticated;

-- The trigger enforces fixed Origin/Co-Worker values during final approval and
-- GM revision paths. The GM retains control of the shared commission split.
commit;
