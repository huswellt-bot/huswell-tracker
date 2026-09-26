-- Commission Summary receivable balance is derived from the saved Grand Total.
-- The existing RPC parameter is retained for rollout compatibility, but its
-- value is ignored and replaced with the server-calculated balance.

begin;

do $$
begin
  if exists (
    select 1
    from public.commission_summaries
    where downpayment_amount > grand_total
  ) then
    raise exception 'Existing Commission Summary data has a Downpayment Amount above its Grand Total; review it before applying migration 171';
  end if;
end;
$$;

update public.commission_summaries
set receivable_balance = round(greatest(grand_total - downpayment_amount, 0), 2);

create or replace function public.set_commission_summary_receivable_balance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.downpayment_amount > new.grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
  end if;

  new.receivable_balance := round(greatest(new.grand_total - new.downpayment_amount, 0), 2);
  return new;
end;
$$;

drop trigger if exists commission_summaries_receivable_balance
  on public.commission_summaries;
create trigger commission_summaries_receivable_balance
before insert or update on public.commission_summaries
for each row execute function public.set_commission_summary_receivable_balance();

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
  v_grand_total numeric;
  v_downpayment_amount numeric;
  v_receivable_balance numeric;
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
  v_grand_total := round(greatest(coalesce(v_quote.total_amount, 0), 0), 2);
  v_downpayment_amount := round(coalesce(p_downpayment_amount, 0), 2);
  v_receivable_balance := round(greatest(v_grand_total - v_downpayment_amount, 0), 2);

  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  if v_downpayment_amount > v_grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
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
    v_grand_total,
    v_preparator,
    v_lead.endorsed_by,
    v_lead.endorsed_to,
    v_lead.endorsed_at,
    v_va_endorser,
    v_commission_rate,
    v_va_commission_rate,
    v_downpayment_amount,
    v_receivable_balance,
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
      'grand_total', v_grand_total,
      'commission_rate', v_commission_rate,
      'va_commission_rate', v_va_commission_rate,
      'downpayment_amount', v_downpayment_amount,
      'receivable_balance', v_receivable_balance,
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

create or replace function public.update_commission_summary(
  p_summary_id uuid,
  p_downpayment_amount numeric,
  p_receivable_balance numeric,
  p_payment_due_date date,
  p_commission_rate numeric,
  p_va_commission_rate numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_summary public.commission_summaries%rowtype;
  v_before jsonb;
  v_downpayment_amount numeric;
  v_receivable_balance numeric;
begin
  select * into v_summary
  from public.commission_summaries
  where id = p_summary_id
  for update;
  if not found then
    raise exception 'Commission Summary not found';
  end if;
  if not private.has_text_role(
    v_summary.organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ) then
    raise exception 'Only GM or Finance can edit a Commission Summary';
  end if;
  if v_summary.status <> 'not_yet_paid' then
    raise exception 'Paid Commission Summaries are read-only';
  end if;

  v_downpayment_amount := round(coalesce(p_downpayment_amount, 0), 2);
  v_receivable_balance := round(greatest(v_summary.grand_total - v_downpayment_amount, 0), 2);
  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  if v_downpayment_amount > v_summary.grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
  end if;
  if p_payment_due_date is null then
    raise exception 'Payment Due Date is required';
  end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'Commission percentage must be between 0 and 100';
  end if;
  if p_va_commission_rate is null or p_va_commission_rate < 0 or p_va_commission_rate > 100 then
    raise exception 'VA Commission percentage must be between 0 and 100';
  end if;
  if v_summary.va_endorser_user_id is null and p_va_commission_rate <> 0 then
    raise exception 'A quotation without an eligible lead endorser cannot have VA Commission';
  end if;

  v_before := to_jsonb(v_summary);
  update public.commission_summaries
  set downpayment_amount = v_downpayment_amount,
      receivable_balance = v_receivable_balance,
      payment_due_date = p_payment_due_date,
      commission_rate = round(p_commission_rate, 2),
      va_commission_rate = round(p_va_commission_rate, 2)
  where id = v_summary.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data
  ) values (
    v_summary.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary.id,
    'updated',
    v_before,
    jsonb_build_object(
      'downpayment_amount', v_downpayment_amount,
      'receivable_balance', v_receivable_balance,
      'payment_due_date', p_payment_due_date,
      'commission_rate', round(p_commission_rate, 2),
      'va_commission_rate', round(p_va_commission_rate, 2)
    )
  );

  return v_summary.id;
end;
$$;

revoke all on function public.update_commission_summary(uuid, numeric, numeric, date, numeric, numeric)
  from public;
grant execute on function public.update_commission_summary(uuid, numeric, numeric, date, numeric, numeric)
  to authenticated;

commit;
