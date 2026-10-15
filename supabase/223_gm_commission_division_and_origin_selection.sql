--
-- Run after 222_sidebar_queue_counts.sql and before deploying the matching
-- Price Quotation workspace update.
--
-- Pricing Officers and Sales Executives choose the S.E. Origin and, when
-- shared, the Co-Worker. The General Manager is the only role that chooses
-- the commission division. Pre-GM quotations therefore keep their division
-- NULL, and a GM return for revision clears any temporary division choice.
-- This migration is source-only until it is explicitly applied in Supabase.

begin;

-- Migration 214 added a 60/40 default for historical backfill. It must not
-- assign a division to a new or returned quotation before GM approval.
alter table public.quotations
  alter column commission_split_option drop default;

alter table public.commission_summaries
  alter column commission_split_option drop default;

-- Remove stale pre-final choices created by the former modal/default. Final
-- and approved records are intentionally preserved for Finance and payout
-- history.
select set_config('huswell.commission_assignment_rpc', 'on', true);
update public.quotations
set commission_split_option = null
where commission_handling_mode is not null
  and commission_split_option is not null
  and status::text in ('draft', 'pending', 'pending_gm_approval', 'needs_revision')
  and approved_at is null;
select set_config('huswell.commission_assignment_rpc', '', true);

-- Shared assignment validation without a division. This is used by the
-- preparation, submission, Pricing Officer review, and GM return paths.
create or replace function private.validate_quotation_commission_assignment_pre_gm(
  p_organization_id uuid,
  p_project_type text,
  p_origin_user_id uuid,
  p_handling_mode text,
  p_co_worker_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_origin_role text;
  v_co_worker_role text;
begin
  if p_origin_user_id is null then
    raise exception 'The S.E. Origin is required';
  end if;
  if p_handling_mode not in ('self_handled', 'shared') then
    raise exception 'Choose whether the quotation is self-handled or shared';
  end if;

  select member.role::text
    into v_origin_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_origin_user_id;

  if v_origin_role not in ('project_manager', 'sales_pricing_officer') then
    raise exception 'The S.E. Origin must be an active Sales Executive or Sales & Pricing Officer';
  end if;

  if p_handling_mode = 'self_handled' then
    if v_origin_role <> 'sales_pricing_officer' then
      raise exception 'Only a Sales & Pricing Officer can use self-handled mode';
    end if;
    if p_co_worker_user_id is not null then
      raise exception 'Self-handled quotations cannot have a Co-Worker';
    end if;
    if not private.is_pricing_officer_assigned(
      p_organization_id,
      p_origin_user_id,
      p_project_type
    ) then
      raise exception 'The self-handling officer is not assigned to this project type';
    end if;
    return;
  end if;

  if p_co_worker_user_id is null then
    raise exception 'Shared quotations require a Co-Worker';
  end if;
  if p_co_worker_user_id = p_origin_user_id then
    raise exception 'The Co-Worker must be different from the S.E. Origin';
  end if;

  select member.role::text
    into v_co_worker_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_co_worker_user_id;

  if v_co_worker_role <> 'sales_pricing_officer' then
    raise exception 'The Co-Worker must be an active Sales & Pricing Officer';
  end if;
  if not private.is_pricing_officer_assigned(
    p_organization_id,
    p_co_worker_user_id,
    p_project_type
  ) then
    raise exception 'The selected Co-Worker is not assigned to this project type';
  end if;
end;
$$;

revoke all on function private.validate_quotation_commission_assignment_pre_gm(
  uuid, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function private.validate_quotation_commission_assignment_pre_gm(
  uuid, text, uuid, text, uuid
) to authenticated;

-- Keep the existing full validator for final approval and summary creation,
-- but share its role/mode checks with the pre-GM validator.
create or replace function private.validate_quotation_commission_assignment(
  p_organization_id uuid,
  p_project_type text,
  p_origin_user_id uuid,
  p_handling_mode text,
  p_co_worker_user_id uuid,
  p_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_origin_rate numeric;
  v_coworker_rate numeric;
  v_self_handled boolean;
begin
  perform private.validate_quotation_commission_assignment_pre_gm(
    p_organization_id,
    p_project_type,
    p_origin_user_id,
    p_handling_mode,
    p_co_worker_user_id
  );

  select rates.origin_rate, rates.coworker_rate, rates.self_handled
    into v_origin_rate, v_coworker_rate, v_self_handled
  from private.commission_split_rates(p_split_option) rates;
  if v_origin_rate is null or v_coworker_rate is null then
    raise exception 'Choose a valid commission division';
  end if;
  if p_handling_mode = 'self_handled' and not v_self_handled then
    raise exception 'Self-handled quotations require the 100%% S.E. Origin division';
  end if;
  if p_handling_mode = 'shared' and v_self_handled then
    raise exception 'Shared quotations require a shared commission division';
  end if;
end;
$$;

revoke all on function private.validate_quotation_commission_assignment(
  uuid, text, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function private.validate_quotation_commission_assignment(
  uuid, text, uuid, text, uuid, text
) to authenticated;

-- Return only officer identities needed by the assignment selectors. The
-- project-type assignment table remains private; the scoped RPC avoids
-- widening its table-level RLS policy to every Pricing Officer.
create or replace function public.quotation_commission_officer_options(
  p_organization_id uuid,
  p_project_type text default null
)
returns table (
  user_id uuid,
  full_name text,
  role text,
  can_be_origin boolean,
  can_be_co_worker boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(
    p_organization_id,
    array['project_manager', 'pricing_officer', 'super_admin', 'owner', 'admin']
  ) then
    raise exception 'You do not have permission to read commission officer options';
  end if;

  return query
  select
    member.user_id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      case
        when member.role::text = 'project_manager' then 'Sales Executive'
        else 'Sales & Pricing Officer'
      end
    )::text,
    member.role::text,
    true,
    member.role::text = 'sales_pricing_officer'
      and exists (
        select 1
        from public.pricing_officer_project_types assignment
        where assignment.organization_id = member.organization_id
          and assignment.pricing_officer_user_id = member.user_id
          and assignment.project_type = private.normalize_price_quotation_project_type(p_project_type)
      )
  from public.organization_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.organization_id = p_organization_id
    and member.role::text in ('project_manager', 'sales_pricing_officer')
  order by coalesce(nullif(btrim(profile.full_name), ''), member.role::text), member.user_id;
end;
$$;

revoke all on function public.quotation_commission_officer_options(uuid, text)
  from public, anon;
grant execute on function public.quotation_commission_officer_options(uuid, text)
  to authenticated;

-- New preparation entry point. The preparer can select another eligible
-- Origin; the preparer/created_by identity remains separate from commission
-- Origin and continues to control draft editing/submission.
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
begin
  select * into v_lead
  from public.leads lead_row
  where lead_row.id = p_lead_id
  for share;
  if not found then
    raise exception 'Lead not found';
  end if;

  if p_quotation_id is not null then
    select * into v_quote
    from public.quotations quotation
    where quotation.id = p_quotation_id
    for update;
    if not found
      or v_quote.document_type <> 'price_quotation'
      or v_quote.costing_source_id is not null then
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

  perform private.validate_quotation_commission_assignment_pre_gm(
    v_lead.organization_id,
    p_project_type,
    p_se_origin_user_id,
    p_commission_handling_mode,
    p_commission_co_worker_user_id
  );

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    coalesce(p_has_illustrations, false),
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );

  v_assigned_user_id := case
    when p_commission_handling_mode = 'self_handled' then p_se_origin_user_id
    else p_commission_co_worker_user_id
  end;

  update public.quotations
  set se_origin_user_id = p_se_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = p_commission_handling_mode,
      commission_co_worker_user_id = p_commission_co_worker_user_id,
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

-- Preserve the old signature for rolling deployments, but ignore its former
-- division argument and treat the logged-in preparer as the selected Origin.
create or replace function public.save_price_quotation_draft_with_commission(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean,
  p_quotation_illustrations jsonb,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return public.save_price_quotation_draft_with_commission_v2(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    p_has_illustrations,
    p_quotation_illustrations,
    (select auth.uid()),
    p_commission_handling_mode,
    p_commission_co_worker_user_id
  );
end;
$$;

revoke all on function public.save_price_quotation_draft_with_commission(
  uuid, uuid, text, jsonb, boolean, jsonb, text, uuid, text
) from public, anon;
grant execute on function public.save_price_quotation_draft_with_commission(
  uuid, uuid, text, jsonb, boolean, jsonb, text, uuid, text
) to authenticated;

-- A preparer may submit a quotation even when another officer is the Origin.
-- The division is cleared on every pre-GM submission.
create or replace function public.submit_price_quotation_with_commission(
  p_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_assigned_user_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Price Quotations can be submitted';
  end if;
  if not exists (
    select 1 from public.quotation_items item where item.quotation_id = v_quote.id
  ) then
    raise exception 'Add at least one item before submitting the quotation';
  end if;

  if v_quote.commission_handling_mode is null then
    perform public.submit_price_quotation(p_quotation_id);
    return;
  end if;

  if v_quote.created_by is distinct from (select auth.uid())
    and v_quote.prepared_by_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the officer who prepared this quotation can submit it';
  end if;
  if not private.has_text_role(
    v_quote.organization_id,
    array['project_manager', 'pricing_officer']
  ) then
    raise exception 'Only an active Sales Executive or Sales & Pricing Officer can submit this quotation request';
  end if;

  perform private.validate_quotation_commission_assignment_pre_gm(
    v_quote.organization_id,
    v_quote.project_types,
    v_quote.se_origin_user_id,
    v_quote.commission_handling_mode,
    v_quote.commission_co_worker_user_id
  );

  v_assigned_user_id := case
    when v_quote.commission_handling_mode = 'self_handled' then v_quote.se_origin_user_id
    else v_quote.commission_co_worker_user_id
  end;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set status = 'pending',
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_split_option = null,
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      revision_requested_to = null,
      resubmission_count = case
        when v_quote.status::text = 'needs_revision' then v_quote.resubmission_count + 1
        else v_quote.resubmission_count
      end
  where id = v_quote.id;

  insert into public.approval_requests (
    organization_id, resource_type, resource_id, status, submitted_by, submitted_at
  ) values (
    v_quote.organization_id, 'quotation', v_quote.id, 'pending',
    (select auth.uid()), now()
  )
  on conflict (resource_type, resource_id) do update
    set status = 'pending',
        submitted_by = excluded.submitted_by,
        submitted_at = excluded.submitted_at,
        decided_by = null,
        decided_at = null,
        decision_note = null;
end;
$$;

revoke all on function public.submit_price_quotation_with_commission(uuid)
  from public, anon;
grant execute on function public.submit_price_quotation_with_commission(uuid)
  to authenticated;

-- Pricing Officer review cannot set or retain a division. GM approval owns
-- the only transition that may write a final split.
-- The legacy split argument is accepted for rolling deployments but ignored.
create or replace function public.pricing_review_price_quotation_with_commission(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_submission_note text,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer']) then
    raise exception 'Only a Sales & Pricing Officer can review this quotation';
  end if;

  if v_quote.commission_handling_mode is null then
    perform public.pricing_review_price_quotation(
      p_quotation_id,
      p_decision,
      p_vat_rate,
      p_terms_conditions,
      p_bank_details,
      p_costings,
      p_revision_note,
      p_vat_calculation_type,
      p_vat_fixed_amount,
      p_submission_note,
      p_payment_terms_option,
      p_pdc_term_days
    );
    return;
  end if;

  if v_quote.assigned_pricing_officer_user_id is distinct from (select auth.uid())
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the selected Pricing Officer can review this quotation';
  end if;

  perform private.validate_quotation_commission_assignment_pre_gm(
    v_quote.organization_id,
    v_quote.project_types,
    v_quote.se_origin_user_id,
    v_quote.commission_handling_mode,
    v_quote.commission_co_worker_user_id
  );

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set commission_split_option = null
  where id = v_quote.id;

  perform public.pricing_review_price_quotation(
    p_quotation_id,
    p_decision,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_revision_note,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_submission_note,
    p_payment_terms_option,
    p_pdc_term_days
  );
end;
$$;

revoke all on function public.pricing_review_price_quotation_with_commission(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text
) from public, anon;
grant execute on function public.pricing_review_price_quotation_with_commission(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text
) to authenticated;

-- GM final approval accepts the selected Origin explicitly and requires a
-- valid division before the approval/snapshot trigger runs.
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
  if p_se_origin_user_id is null then
    raise exception 'The final S.E. Origin is required';
  end if;

  perform private.validate_quotation_commission_assignment(
    v_quote.organization_id,
    v_quote.project_types,
    p_se_origin_user_id,
    p_commission_handling_mode,
    p_commission_co_worker_user_id,
    p_commission_split_option
  );
  v_assigned_user_id := case
    when p_commission_handling_mode = 'self_handled' then p_se_origin_user_id
    else p_commission_co_worker_user_id
  end;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set se_origin_user_id = p_se_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = p_commission_handling_mode,
      commission_co_worker_user_id = p_commission_co_worker_user_id,
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

-- The older GM return signature remains callable for rolling deployments, but
-- every commission-workflow return now clears the division.
create or replace function public.return_price_quotation_from_gm_with_commission(
  p_quotation_id uuid,
  p_note text,
  p_terms_conditions text,
  p_bank_details jsonb,
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
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;

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
    raise exception 'Only the General Manager can return this quotation';
  end if;
  if v_quote.commission_handling_mode is not null
    and p_commission_handling_mode is null then
    raise exception 'Commission assignment is required for this quotation';
  end if;

  v_origin_user_id := coalesce(
    v_quote.se_origin_user_id,
    v_quote.prepared_by_user_id,
    v_quote.created_by
  );
  if p_commission_handling_mode is not null then
    perform private.validate_quotation_commission_assignment_pre_gm(
      v_quote.organization_id,
      v_quote.project_types,
      v_origin_user_id,
      p_commission_handling_mode,
      p_commission_co_worker_user_id
    );
    v_assigned_user_id := case
      when p_commission_handling_mode = 'self_handled' then v_origin_user_id
      else p_commission_co_worker_user_id
    end;
  end if;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      payment_terms_option = coalesce(nullif(btrim(p_payment_terms_option), ''), payment_terms_option),
      pdc_term_days = coalesce(p_pdc_term_days, pdc_term_days),
      se_origin_user_id = case when p_commission_handling_mode is null then se_origin_user_id else v_origin_user_id end,
      assigned_pricing_officer_user_id = case when p_commission_handling_mode is null then assigned_pricing_officer_user_id else v_assigned_user_id end,
      commission_handling_mode = coalesce(p_commission_handling_mode, commission_handling_mode),
      commission_co_worker_user_id = case when p_commission_handling_mode is null then commission_co_worker_user_id else p_commission_co_worker_user_id end,
      commission_split_option = case when p_commission_handling_mode is null then commission_split_option else null end,
      status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now(),
      approved_by = null,
      approved_at = null
  where id = v_quote.id;

  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation'
    and resource_id = v_quote.id;
end;
$$;

revoke all on function public.return_price_quotation_from_gm_with_commission(
  uuid, text, text, jsonb, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.return_price_quotation_from_gm_with_commission(
  uuid, text, text, jsonb, text, integer, text, uuid, text
) to authenticated;

-- Current GM review path with costing edits. The Origin is explicit in v2;
-- the old signature below delegates with its stored/fallback Origin.
create or replace function public.return_price_quotation_from_gm_with_edits_and_costings_v2(
  p_quotation_id uuid,
  p_se_origin_user_id uuid,
  p_note text,
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
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_option text := coalesce(nullif(btrim(coalesce(p_payment_terms_option, '')), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
  v_vat_type text := coalesce(nullif(btrim(coalesce(p_vat_calculation_type, '')), ''), 'percentage');
  v_item_count bigint;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then
    raise exception 'VAT needs a percentage or amount basis';
  end if;
  if v_vat_type = 'percentage'
    and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then
    raise exception 'VAT percentage must be between 0 and 100';
  end if;
  if v_vat_type = 'fixed_amount'
    and coalesce(p_vat_fixed_amount, 0) < 0 then
    raise exception 'VAT amount cannot be negative';
  end if;

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
    raise exception 'Only the General Manager can return this quotation';
  end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items item
  where item.quotation_id = v_quote.id;
  if jsonb_array_length(p_costings) = 0
    or jsonb_array_length(p_costings) <> v_item_count then
    raise exception 'Add one costing table for every quotation product';
  end if;

  if v_quote.commission_handling_mode is not null
    and p_commission_handling_mode is null then
    raise exception 'Commission assignment is required for this quotation';
  end if;
  if p_commission_handling_mode is not null then
    v_origin_user_id := coalesce(
      p_se_origin_user_id,
      v_quote.se_origin_user_id,
      v_quote.prepared_by_user_id,
      v_quote.created_by
    );
    perform private.validate_quotation_commission_assignment_pre_gm(
      v_quote.organization_id,
      v_quote.project_types,
      v_origin_user_id,
      p_commission_handling_mode,
      p_commission_co_worker_user_id
    );
    v_assigned_user_id := case
      when p_commission_handling_mode = 'self_handled' then v_origin_user_id
      else p_commission_co_worker_user_id
    end;
    perform set_config('huswell.commission_assignment_rpc', 'on', true);
  end if;

  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);
  perform private.apply_product_costings(
    v_quote.organization_id,
    v_quote.id,
    p_costings,
    (select auth.uid())
  );
  perform private.persist_product_quotation_totals(
    v_quote.id,
    'needs_revision',
    v_vat_type,
    p_vat_rate,
    p_vat_fixed_amount,
    p_terms_conditions,
    p_bank_details,
    (select auth.uid())
  );

  update public.quotations
  set payment_terms_option = v_option,
      pdc_term_days = v_days,
      se_origin_user_id = case
        when p_commission_handling_mode is null then se_origin_user_id
        else v_origin_user_id
      end,
      assigned_pricing_officer_user_id = case
        when p_commission_handling_mode is null then assigned_pricing_officer_user_id
        else v_assigned_user_id
      end,
      commission_handling_mode = coalesce(p_commission_handling_mode, commission_handling_mode),
      commission_co_worker_user_id = case
        when p_commission_handling_mode is null then commission_co_worker_user_id
        else p_commission_co_worker_user_id
      end,
      commission_split_option = case
        when p_commission_handling_mode is null then commission_split_option
        else null
      end,
      status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now(),
      approved_by = null,
      approved_at = null
  where id = v_quote.id;

  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation'
    and resource_id = v_quote.id;
end;
$$;

revoke all on function public.return_price_quotation_from_gm_with_edits_and_costings_v2(
  uuid, uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.return_price_quotation_from_gm_with_edits_and_costings_v2(
  uuid, uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) to authenticated;

create or replace function public.return_price_quotation_from_gm_with_edits_and_costings(
  p_quotation_id uuid,
  p_note text,
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
begin
  perform public.return_price_quotation_from_gm_with_edits_and_costings_v2(
    p_quotation_id,
    null,
    p_note,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_payment_terms_option,
    p_pdc_term_days,
    p_commission_handling_mode,
    p_commission_co_worker_user_id,
    p_commission_split_option
  );
end;
$$;

revoke all on function public.return_price_quotation_from_gm_with_edits_and_costings(
  uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.return_price_quotation_from_gm_with_edits_and_costings(
  uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) to authenticated;

commit;
