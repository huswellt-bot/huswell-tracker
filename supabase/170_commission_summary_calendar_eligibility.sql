-- Commission Summary eligibility must follow the active Project Calendar.
--
-- Migration 169 made queued production jobs eligible, but approved Price
-- Quotations create queued jobs before a Project Calendar due date is added.
-- This migration makes an approved, active, explicitly linked Project
-- Calendar schedule the authoritative eligibility rule.
--
-- Run after 169_commission_summary_queued_eligibility.sql and before
-- deploying the matching workspace update. Safe to re-run.

begin;

create or replace function public.commission_summary_eligible_quotations(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  production_job_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  grand_total numeric,
  preparator_user_id uuid,
  preparator_name text,
  lead_endorser_user_id uuid,
  lead_endorsed_to_user_id uuid,
  lead_endorsement_at timestamptz,
  va_endorser_user_id uuid,
  va_endorser_name text,
  commission_default_rate numeric,
  va_commission_default_rate numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with candidates as (
    select
      quotation.id as quotation_id,
      job.id as production_job_id,
      quotation.quotation_no,
      quotation.project_name,
      quotation.client_name,
      round(greatest(coalesce(quotation.total_amount, 0), 0), 2) as grand_total,
      coalesce(quotation.prepared_by_user_id, quotation.created_by) as preparator_user_id,
      lead_row.endorsed_by as lead_endorser_user_id,
      lead_row.endorsed_to as lead_endorsed_to_user_id,
      lead_row.endorsed_at as lead_endorsement_at,
      case
        when lead_row.endorsed_to = coalesce(quotation.prepared_by_user_id, quotation.created_by)
          and exists (
            select 1
            from public.organization_members endorser_member
            where endorser_member.organization_id = quotation.organization_id
              and endorser_member.user_id = lead_row.endorsed_by
              and endorser_member.role::text = 'sales_pricing_officer'
          )
        then lead_row.endorsed_by
        else null
      end as va_endorser_user_id,
      coalesce(settings.commission_default_rate, settings.production_commission, 5) as commission_default_rate,
      coalesce(settings.va_commission_default_rate, 0) as va_commission_default_rate
    from public.quotations quotation
    join public.production_jobs job
      on job.organization_id = quotation.organization_id
     and job.quotation_id = quotation.id
    join public.project_schedules schedule
      on schedule.organization_id = quotation.organization_id
     and schedule.quotation_id = quotation.id
     and schedule.status::text = 'approved'
     and schedule.due_date is not null
     and schedule.completed_at is null
     and (
       schedule.production_job_id = job.id
       or job.project_schedule_id = schedule.id
     )
    left join public.leads lead_row
      on lead_row.id = quotation.lead_id
    left join public.business_settings settings
      on settings.organization_id = quotation.organization_id
    where quotation.organization_id = p_organization_id
      and private.has_text_role(
        p_organization_id,
        array['super_admin', 'owner', 'admin', 'accountant']
      )
      and quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
      and exists (
        select 1
        from public.organization_members preparator_member
        where preparator_member.organization_id = quotation.organization_id
          and preparator_member.user_id = coalesce(quotation.prepared_by_user_id, quotation.created_by)
          and preparator_member.role::text = 'sales_pricing_officer'
      )
      and not exists (
        select 1
        from public.commission_summaries summary
        where summary.organization_id = quotation.organization_id
          and summary.quotation_id = quotation.id
      )
  )
  select
    candidate.quotation_id,
    candidate.production_job_id,
    candidate.quotation_no,
    candidate.project_name,
    candidate.client_name,
    candidate.grand_total,
    candidate.preparator_user_id,
    coalesce(preparator_profile.full_name, 'Unnamed Sales & Pricing Officer'),
    candidate.lead_endorser_user_id,
    candidate.lead_endorsed_to_user_id,
    candidate.lead_endorsement_at,
    candidate.va_endorser_user_id,
    va_profile.full_name,
    candidate.commission_default_rate,
    candidate.va_commission_default_rate
  from candidates candidate
  left join public.profiles preparator_profile
    on preparator_profile.id = candidate.preparator_user_id
  left join public.profiles va_profile
    on va_profile.id = candidate.va_endorser_user_id
  order by candidate.quotation_no asc;
$$;

revoke all on function public.commission_summary_eligible_quotations(uuid)
  from public;
grant execute on function public.commission_summary_eligible_quotations(uuid)
  to authenticated;

create or replace function public.create_commission_summary(
  p_quotation_id uuid,
  p_downpayment_amount numeric,
  p_receivable_balance numeric,
  p_payment_due_date date,
  p_commission_rate numeric default null,
  p_va_commission_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_job public.production_jobs%rowtype;
  v_lead public.leads%rowtype;
  v_settings public.business_settings%rowtype;
  v_preparator uuid;
  v_va_endorser uuid;
  v_commission_rate numeric;
  v_va_commission_rate numeric;
  v_summary_id uuid;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(
    v_quote.organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ) then
    raise exception 'Only GM or Finance can add a Commission Summary';
  end if;
  if v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved direct Price Quotation can have a Commission Summary';
  end if;

  select * into v_job
  from public.production_jobs job
  where job.organization_id = v_quote.organization_id
    and job.quotation_id = v_quote.id
    and exists (
      select 1
      from public.project_schedules schedule
      where schedule.organization_id = v_quote.organization_id
        and schedule.quotation_id = v_quote.id
        and schedule.status::text = 'approved'
        and schedule.due_date is not null
        and schedule.completed_at is null
        and (
          schedule.production_job_id = job.id
          or job.project_schedule_id = schedule.id
        )
    )
  for update;
  if not found then
    raise exception 'The Price Quotation must have an approved active Project Calendar due date';
  end if;

  if exists (
    select 1
    from public.commission_summaries summary
    where summary.organization_id = v_quote.organization_id
      and summary.quotation_id = v_quote.id
  ) then
    raise exception 'This Price Quotation already has a Commission Summary';
  end if;

  v_preparator := coalesce(v_quote.prepared_by_user_id, v_quote.created_by);
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_quote.organization_id
      and member.user_id = v_preparator
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The quotation preparator must be a Sales & Pricing Officer';
  end if;

  if v_quote.lead_id is not null then
    select * into v_lead
    from public.leads
    where id = v_quote.lead_id
      and organization_id = v_quote.organization_id;
  end if;

  if v_lead.endorsed_to = v_preparator
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_lead.endorsed_by
        and member.role::text = 'sales_pricing_officer'
    ) then
    v_va_endorser := v_lead.endorsed_by;
  end if;

  select * into v_settings
  from public.business_settings
  where organization_id = v_quote.organization_id;

  v_commission_rate := round(
    coalesce(p_commission_rate, v_settings.commission_default_rate, v_settings.production_commission, 5),
    2
  );
  v_va_commission_rate := case
    when v_va_endorser is null then 0
    else round(coalesce(p_va_commission_rate, v_settings.va_commission_default_rate, 0), 2)
  end;

  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  if p_receivable_balance is null or p_receivable_balance < 0 then
    raise exception 'Receivable / Due Balance is required and cannot be negative';
  end if;
  if p_payment_due_date is null then
    raise exception 'Payment Due Date is required';
  end if;
  if v_commission_rate < 0 or v_commission_rate > 100 then
    raise exception 'Commission percentage must be between 0 and 100';
  end if;
  if v_va_commission_rate < 0 or v_va_commission_rate > 100 then
    raise exception 'VA Commission percentage must be between 0 and 100';
  end if;

  insert into public.commission_summaries (
    organization_id,
    quotation_id,
    production_job_id,
    quotation_no,
    project_name,
    client_name,
    grand_total,
    preparator_user_id,
    lead_endorser_user_id,
    lead_endorsed_to_user_id,
    lead_endorsement_at,
    va_endorser_user_id,
    commission_rate,
    va_commission_rate,
    downpayment_amount,
    receivable_balance,
    payment_due_date,
    created_by
  ) values (
    v_quote.organization_id,
    v_quote.id,
    v_job.id,
    v_quote.quotation_no,
    v_quote.project_name,
    v_quote.client_name,
    round(greatest(coalesce(v_quote.total_amount, 0), 0), 2),
    v_preparator,
    v_lead.endorsed_by,
    v_lead.endorsed_to,
    v_lead.endorsed_at,
    v_va_endorser,
    v_commission_rate,
    v_va_commission_rate,
    round(p_downpayment_amount, 2),
    round(p_receivable_balance, 2),
    p_payment_due_date,
    (select auth.uid())
  ) returning id into v_summary_id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    after_data
  ) values (
    v_quote.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary_id,
    'created',
    jsonb_build_object(
      'quotation_id', v_quote.id,
      'production_job_id', v_job.id,
      'preparator_user_id', v_preparator,
      'va_endorser_user_id', v_va_endorser,
      'grand_total', v_quote.total_amount,
      'commission_rate', v_commission_rate,
      'va_commission_rate', v_va_commission_rate,
      'downpayment_amount', round(p_downpayment_amount, 2),
      'receivable_balance', round(p_receivable_balance, 2),
      'payment_due_date', p_payment_due_date
    )
  );

  return v_summary_id;
end;
$$;

revoke all on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) from public;
grant execute on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) to authenticated;

commit;
