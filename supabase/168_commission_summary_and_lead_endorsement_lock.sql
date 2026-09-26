-- Commission Summary, commission-rate snapshots, and approved-lead
-- endorsement locking.
--
-- This migration intentionally replaces the retired payment-receipt
-- commission workflow. Before running it in Supabase:
--   1. Export/backup the affected commission and quotation-endorsement data.
--   2. Run `npm.cmd run cleanup:retired-quotation-storage -- --dry-run`.
--   3. Run `npm.cmd run cleanup:retired-quotation-storage` to remove the
--      price-quotation-endorsements bucket through the Storage API.
-- The SQL below permanently drops the old payout/quotation-endorsement
-- relations, RPCs, fields, and setting. It must not be applied without the
-- backup/recovery step above.
--
-- Run after 167_allow_lead_reendorsement_after_unendorsement.sql and before
-- deploying the matching workspace update.

begin;

-- Supabase protects storage metadata from direct SQL deletion. Fail closed if
-- the API cleanup was skipped so old quotation-PDF files cannot be orphaned.
do $$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'price-quotation-endorsements'
  ) or exists (
    select 1
    from storage.buckets
    where id = 'price-quotation-endorsements'
  ) then
    raise exception
      'Run npm.cmd run cleanup:retired-quotation-storage with the Storage API before migration 168';
  end if;
end;
$$;

alter table public.business_settings
  add column if not exists commission_default_rate numeric(5,2) not null default 5
    check (commission_default_rate between 0 and 100),
  add column if not exists va_commission_default_rate numeric(5,2) not null default 0
    check (va_commission_default_rate between 0 and 100);

-- Seed the new normal-commission default from the existing quotation-setting
-- value once. VA Commission is intentionally zero until the GM configures it.
update public.business_settings
set commission_default_rate = coalesce(production_commission, 5)
where commission_default_rate = 5;

create table if not exists public.commission_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  production_job_id uuid not null references public.production_jobs(id) on delete restrict,
  quotation_no text not null,
  project_name text,
  client_name text,
  grand_total numeric(14,2) not null check (grand_total >= 0),
  preparator_user_id uuid not null references auth.users(id) on delete restrict,
  lead_endorser_user_id uuid references auth.users(id) on delete set null,
  lead_endorsed_to_user_id uuid references auth.users(id) on delete set null,
  lead_endorsement_at timestamptz,
  va_endorser_user_id uuid references auth.users(id) on delete restrict,
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  va_commission_rate numeric(5,2) not null default 0 check (va_commission_rate between 0 and 100),
  commission_amount numeric(14,2) generated always as (
    round(grand_total * commission_rate / 100, 2)
  ) stored,
  va_commission_amount numeric(14,2) generated always as (
    case
      when va_endorser_user_id is null then 0::numeric
      else round(grand_total * va_commission_rate / 100, 2)
    end
  ) stored,
  downpayment_amount numeric(14,2) not null check (downpayment_amount >= 0),
  receivable_balance numeric(14,2) not null check (receivable_balance >= 0),
  payment_due_date date not null,
  status text not null default 'not_yet_paid'
    check (status in ('not_yet_paid', 'paid')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quotation_id),
  check (
    (status = 'paid' and paid_at is not null and paid_by is not null)
    or (status = 'not_yet_paid' and paid_at is null and paid_by is null)
  ),
  check (va_endorser_user_id is not null or va_commission_rate = 0)
);

create index if not exists commission_summaries_org_status_idx
  on public.commission_summaries (organization_id, status, created_at desc);
create index if not exists commission_summaries_preparator_idx
  on public.commission_summaries (organization_id, preparator_user_id, created_at desc);
create index if not exists commission_summaries_va_endorser_idx
  on public.commission_summaries (organization_id, va_endorser_user_id, created_at desc)
  where va_endorser_user_id is not null;

drop trigger if exists commission_summaries_updated_at
  on public.commission_summaries;
create trigger commission_summaries_updated_at
before update on public.commission_summaries
for each row execute function public.set_updated_at();

alter table public.commission_summaries enable row level security;
revoke all on public.commission_summaries from public, anon, authenticated;
grant select on public.commission_summaries to authenticated;
drop policy if exists "commission summaries: authorized read"
  on public.commission_summaries;
create policy "commission summaries: authorized read"
on public.commission_summaries for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ))
  or (
    (select private.has_text_role(
      organization_id,
      array['sales_pricing_officer']
    ))
    and (
      preparator_user_id = (select auth.uid())
      or va_endorser_user_id = (select auth.uid())
    )
  )
);

create or replace function private.lead_has_approved_price_quotation(
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.quotations quotation
    where quotation.lead_id = p_lead_id
      and quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
  );
$$;

revoke all on function private.lead_has_approved_price_quotation(uuid) from public;
grant execute on function private.lead_has_approved_price_quotation(uuid) to authenticated;

create or replace function public.save_commission_defaults(
  p_organization_id uuid,
  p_commission_rate numeric,
  p_va_commission_rate numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Only the General Manager can change commission defaults';
  end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'Commission percentage must be between 0 and 100';
  end if;
  if p_va_commission_rate is null or p_va_commission_rate < 0 or p_va_commission_rate > 100 then
    raise exception 'VA Commission percentage must be between 0 and 100';
  end if;

  insert into public.business_settings (
    organization_id,
    commission_default_rate,
    va_commission_default_rate
  ) values (
    p_organization_id,
    round(p_commission_rate, 2),
    round(p_va_commission_rate, 2)
  )
  on conflict (organization_id) do update
  set commission_default_rate = excluded.commission_default_rate,
      va_commission_default_rate = excluded.va_commission_default_rate,
      updated_at = now();
end;
$$;

revoke all on function public.save_commission_defaults(uuid, numeric, numeric)
  from public;
grant execute on function public.save_commission_defaults(uuid, numeric, numeric)
  to authenticated;

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
     and job.status::text = 'in_production'
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

revoke all on function public.commission_summary_eligible_quotations(uuid) from public;
grant execute on function public.commission_summary_eligible_quotations(uuid) to authenticated;

create or replace function public.commission_summary_officer_options(
  p_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    member.user_id,
    coalesce(profile.full_name, 'Unnamed Sales & Pricing Officer')
  from public.organization_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.organization_id = p_organization_id
    and member.role::text = 'sales_pricing_officer'
    and private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin', 'accountant']
    )
  order by coalesce(profile.full_name, 'Unnamed Sales & Pricing Officer');
$$;

revoke all on function public.commission_summary_officer_options(uuid) from public;
grant execute on function public.commission_summary_officer_options(uuid) to authenticated;

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
  from public.production_jobs
  where organization_id = v_quote.organization_id
    and quotation_id = v_quote.id
  for update;
  if not found or v_job.status::text <> 'in_production' then
    raise exception 'The Price Quotation must have a production job that is In Production';
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

revoke all on function public.create_commission_summary(uuid, numeric, numeric, date, numeric, numeric)
  from public;
grant execute on function public.create_commission_summary(uuid, numeric, numeric, date, numeric, numeric)
  to authenticated;

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
  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  if p_receivable_balance is null or p_receivable_balance < 0 then
    raise exception 'Receivable / Due Balance is required and cannot be negative';
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
  set downpayment_amount = round(p_downpayment_amount, 2),
      receivable_balance = round(p_receivable_balance, 2),
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
      'downpayment_amount', round(p_downpayment_amount, 2),
      'receivable_balance', round(p_receivable_balance, 2),
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

create or replace function public.mark_commission_summary_paid(
  p_summary_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_summary public.commission_summaries%rowtype;
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
    raise exception 'Only GM or Finance can mark a Commission Summary paid';
  end if;
  if v_summary.status = 'paid' then
    raise exception 'This Commission Summary is already paid';
  end if;

  update public.commission_summaries
  set status = 'paid',
      paid_at = now(),
      paid_by = (select auth.uid())
  where id = v_summary.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action, after_data
  ) values (
    v_summary.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary.id,
    'paid',
    jsonb_build_object('paid_at', now(), 'paid_by', (select auth.uid()))
  );

  return v_summary.id;
end;
$$;

revoke all on function public.mark_commission_summary_paid(uuid) from public;
grant execute on function public.mark_commission_summary_paid(uuid) to authenticated;

create or replace function public.undo_commission_summary_paid(
  p_summary_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_summary public.commission_summaries%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
    array['super_admin', 'owner', 'admin']
  ) then
    raise exception 'Only the General Manager can undo a paid Commission Summary';
  end if;
  if v_summary.status <> 'paid' then
    raise exception 'This Commission Summary is not marked paid';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Enter a reason before undoing Paid status';
  end if;

  update public.commission_summaries
  set status = 'not_yet_paid',
      paid_at = null,
      paid_by = null
  where id = v_summary.id;

  insert into public.activity_log (
    organization_id,
    actor_id,
    resource_type,
    resource_id,
    action,
    before_data,
    after_data,
    note
  ) values (
    v_summary.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary.id,
    'paid_undone',
    jsonb_build_object(
      'status', v_summary.status,
      'paid_at', v_summary.paid_at,
      'paid_by', v_summary.paid_by
    ),
    jsonb_build_object('status', 'not_yet_paid'),
    v_reason
  );

  return v_summary.id;
end;
$$;

revoke all on function public.undo_commission_summary_paid(uuid, text) from public;
grant execute on function public.undo_commission_summary_paid(uuid, text) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'commission_summaries'
  ) then
    alter publication supabase_realtime add table public.commission_summaries;
  end if;
end;
$$;

-- The old payment-receipt commission and approved-quotation PDF endorsement
-- paths are retired permanently. Drop dependent functions before dropping the
-- relations/columns they reference.
drop function if exists public.delete_price_quotation(uuid);
drop function if exists public.sales_project_officer_commissions();
drop function if exists public.mark_sales_commission_paid(uuid, numeric, text, text);
drop function if exists private.calculate_sales_commission(numeric, jsonb);
drop function if exists private.quotation_sales_commission_owner(uuid, uuid, uuid, uuid, uuid);
drop trigger if exists quotation_sales_commission_owner on public.quotations;
drop function if exists public.capture_quotation_sales_commission_owner();

drop function if exists public.create_price_quotation_endorsement(uuid, uuid, text);
drop function if exists public.activate_price_quotation_endorsement(uuid);
drop function if exists public.revoke_price_quotation_endorsement(uuid);
drop policy if exists "endorsement snapshots: participants read" on storage.objects;
drop policy if exists "endorsement snapshots: sender upload" on storage.objects;
drop table if exists public.price_quotation_endorsements;

drop table if exists public.sales_commission_payouts;

alter table public.quotations
  drop column if exists commission_owner_user_id,
  drop column if exists sales_commission_tiers_snapshot;
alter table public.business_settings
  drop column if exists sales_commission_tiers;

-- Preserve the existing guarded quotation deletion workflow while making a
-- Commission Summary an explicit deletion barrier for financial history.
create or replace function public.delete_price_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_costing_id uuid;
  v_workflow_quotation_ids uuid[] := '{}'::uuid[];
  v_price_quotation_ids uuid[] := '{}'::uuid[];
  v_mockup_quotation_ids uuid[] := '{}'::uuid[];
  v_all_quotation_ids uuid[] := '{}'::uuid[];
  v_is_general_manager boolean;
  v_is_own_editable_quotation boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_quotation_id::text, 0));

  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quotation.document_type <> 'price_quotation' then
    raise exception 'Price Quotation not found';
  end if;

  v_is_general_manager := private.has_text_role(
    v_quotation.organization_id,
    array['super_admin', 'owner', 'admin']
  );
  v_is_own_editable_quotation := coalesce(
    v_quotation.costing_source_id is null
    and v_quotation.created_by = (select auth.uid())
    and v_quotation.status::text in ('draft', 'needs_revision')
    and private.has_text_role(v_quotation.organization_id, array['project_manager']),
    false
  );

  if not coalesce(v_is_general_manager, false)
    and not v_is_own_editable_quotation then
    raise exception 'Only the General Manager can delete this Price Quotation. Project Officers can delete only their own direct draft or returned quotations';
  end if;

  v_costing_id := v_quotation.costing_source_id;
  if v_costing_id is not null then
    perform set_config('huswell.allow_historical_costing_cascade', 'on', true);
  end if;

  select coalesce(array_agg(quote.id), '{}'::uuid[])
    into v_workflow_quotation_ids
  from public.quotations quote
  where quote.id = v_quotation.id
     or (
       v_costing_id is not null
       and (quote.id = v_costing_id or quote.costing_source_id = v_costing_id)
     );

  select coalesce(array_agg(quote.id), '{}'::uuid[])
    into v_price_quotation_ids
  from public.quotations quote
  where quote.document_type = 'price_quotation'
    and quote.id = any(v_workflow_quotation_ids);

  select coalesce(array_agg(mockup.id), '{}'::uuid[])
    into v_mockup_quotation_ids
  from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.source_price_quotation_id = any(v_price_quotation_ids);

  v_all_quotation_ids := v_workflow_quotation_ids || v_mockup_quotation_ids;

  if exists (
    select 1
    from public.commission_summaries summary
    where summary.quotation_id = any(v_price_quotation_ids)
  ) then
    raise exception 'This Price Quotation cannot be deleted because it has a Commission Summary';
  end if;

  delete from public.project_schedules schedule
  where schedule.quotation_id = any(v_all_quotation_ids)
     or schedule.mockup_quotation_id = any(v_mockup_quotation_ids);

  delete from public.approval_requests approval
  where approval.resource_type = 'quotation'
    and approval.resource_id = any(v_all_quotation_ids);

  delete from public.payments payment
  where payment.invoice_id in (
    select invoice.id
    from public.invoices invoice
    where invoice.quotation_id = any(v_all_quotation_ids)
  );
  delete from public.invoices invoice
  where invoice.quotation_id = any(v_all_quotation_ids);

  delete from public.finished_product_stock_ins stock_in
  where stock_in.production_job_id in (
    select job.id
    from public.production_jobs job
    where job.quotation_id = any(v_all_quotation_ids)
       or job.mockup_quotation_id = any(v_mockup_quotation_ids)
  );
  delete from public.production_jobs job
  where job.quotation_id = any(v_all_quotation_ids)
     or job.mockup_quotation_id = any(v_mockup_quotation_ids);

  delete from public.quotations mockup
  where mockup.document_type = 'mockup_quotation'
    and mockup.id = any(v_mockup_quotation_ids);
  delete from public.quotations price
  where price.document_type = 'price_quotation'
    and price.id = any(v_price_quotation_ids);

  if v_costing_id is not null then
    delete from public.quotations
    where id = v_costing_id
      and document_type = 'costing_breakdown';
  end if;
end;
$$;

revoke all on function public.delete_price_quotation(uuid) from public;
grant execute on function public.delete_price_quotation(uuid) to authenticated;

-- Once a direct Price Quotation is approved, active lead endorsement columns
-- are immutable. The unendorsement RPCs below also reject the transition, so
-- this protects against direct client writes and future server paths alike.
create or replace function private.block_approved_lead_endorsement_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 1));
  if private.lead_has_approved_price_quotation(old.id)
    and (
      new.endorsed_by is distinct from old.endorsed_by
      or new.endorsed_to is distinct from old.endorsed_to
      or new.endorsed_at is distinct from old.endorsed_at
    ) then
    raise exception 'Lead endorsement cannot be changed after an approved Price Quotation exists';
  end if;
  return new;
end;
$$;

create or replace function private.lock_lead_endorsement_on_quote_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status::text = 'approved'
    and old.status::text is distinct from 'approved'
    and new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and new.lead_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.lead_id::text, 1));
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_lock_lead_endorsement_on_approval
  on public.quotations;
create trigger quotations_lock_lead_endorsement_on_approval
before update of status on public.quotations
for each row execute function private.lock_lead_endorsement_on_quote_approval();

drop trigger if exists leads_block_approved_endorsement_change on public.leads;
create trigger leads_block_approved_endorsement_change
before update on public.leads
for each row execute function private.block_approved_lead_endorsement_change();

drop policy if exists "lead endorsement images: submit" on storage.objects;
create policy "lead endorsement images: submit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'lead-endorsement-images'
  and split_part(name, '/', 3) ~* '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.leads lead_row
    where lead_row.organization_id::text = split_part(name, '/', 1)
      and lead_row.id::text = split_part(name, '/', 2)
      and coalesce(lead_row.assigned_to, lead_row.created_by) = (select auth.uid())
      and (select private.has_text_role(
        lead_row.organization_id,
        array['project_manager', 'sales_pricing_officer']
      ))
      and lead_row.endorsed_by is null
      and lead_row.endorsed_to is null
      and lead_row.endorsed_at is null
      and not private.lead_has_approved_price_quotation(lead_row.id)
  )
);

create or replace function public.endorse_lead(
  p_lead_id uuid,
  p_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_endorsed_at timestamptz := now();
begin
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select another Sales & Pricing Officer recipient';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 1));

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if coalesce(v_lead.evaluation_number, 0) = 7 then
    raise exception 'Only Leads can be endorsed';
  end if;
  if private.lead_has_approved_price_quotation(v_lead.id) then
    raise exception 'Lead endorsement cannot be changed after an approved Price Quotation exists';
  end if;
  if coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid())
    or not private.has_text_role(
      v_lead.organization_id,
      array['project_manager', 'sales_pricing_officer']
    ) then
    raise exception 'Only the owning Sales Officer can endorse this lead';
  end if;
  if v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead already has an active endorsement';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;

  update public.leads
  set endorsed_by = (select auth.uid()),
      endorsed_to = p_recipient_user_id,
      endorsed_at = v_endorsed_at,
      endorsement_history_locked = true
  where id = v_lead.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'endorsed',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at,
      'endorsement_history_locked', v_lead.endorsement_history_locked
    ),
    jsonb_build_object(
      'endorsed_by', (select auth.uid()),
      'endorsed_to', p_recipient_user_id,
      'endorsed_at', v_endorsed_at,
      'endorsement_history_locked', true
    )
  );
  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead(uuid, uuid) from public;
grant execute on function public.endorse_lead(uuid, uuid) to authenticated;

create or replace function public.endorse_lead_with_attachment(
  p_lead_id uuid,
  p_recipient_user_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_attachment_id uuid;
  v_endorsed_at timestamptz := now();
begin
  if p_recipient_user_id is null
    or p_recipient_user_id = (select auth.uid()) then
    raise exception 'Select another Sales & Pricing Officer recipient';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 1));

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if coalesce(v_lead.evaluation_number, 0) = 7 then
    raise exception 'Only Leads can be endorsed';
  end if;
  if private.lead_has_approved_price_quotation(v_lead.id) then
    raise exception 'Lead endorsement cannot be changed after an approved Price Quotation exists';
  end if;
  if coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid())
    or not private.has_text_role(
      v_lead.organization_id,
      array['project_manager', 'sales_pricing_officer']
    ) then
    raise exception 'Only the owning Sales Officer can endorse this lead';
  end if;
  if v_lead.endorsed_by is not null
    or v_lead.endorsed_to is not null
    or v_lead.endorsed_at is not null then
    raise exception 'This lead already has an active endorsement';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_lead.organization_id
      and member.user_id = p_recipient_user_id
      and member.role::text = 'sales_pricing_officer'
  ) then
    raise exception 'The selected recipient is not a Sales & Pricing Officer in this organization';
  end if;
  if p_file_name is null or nullif(btrim(p_file_name), '') is null then
    raise exception 'Upload an endorsement image';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_file_size is null
    or p_file_size <= 0
    or p_file_size > 10485760 then
    raise exception 'Endorsement images must be JPEG, PNG, or WebP files no larger than 10 MB';
  end if;
  if p_storage_path !~* (
    '^' || v_lead.organization_id::text || '/' || v_lead.id::text
      || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'Endorsement image storage path is invalid';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'lead-endorsement-images'
      and object.name = p_storage_path
  ) then
    raise exception 'Upload the endorsement image before endorsing this lead';
  end if;

  insert into public.lead_endorsement_attachments (
    organization_id, lead_id, storage_path, file_name, content_type,
    file_size, uploaded_by
  ) values (
    v_lead.organization_id,
    v_lead.id,
    p_storage_path,
    btrim(p_file_name),
    p_content_type,
    p_file_size,
    (select auth.uid())
  ) returning id into v_attachment_id;

  update public.leads
  set endorsed_by = (select auth.uid()),
      endorsed_to = p_recipient_user_id,
      endorsed_at = v_endorsed_at,
      endorsement_history_locked = true
  where id = v_lead.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'endorsed',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at,
      'endorsement_history_locked', v_lead.endorsement_history_locked
    ),
    jsonb_build_object(
      'endorsed_by', (select auth.uid()),
      'endorsed_to', p_recipient_user_id,
      'endorsed_at', v_endorsed_at,
      'endorsement_history_locked', true,
      'attachment_id', v_attachment_id,
      'attachment_file_name', btrim(p_file_name)
    )
  );
  return v_lead.id;
end;
$$;

revoke all on function public.endorse_lead_with_attachment(uuid, uuid, text, text, text, bigint)
  from public;
grant execute on function public.endorse_lead_with_attachment(uuid, uuid, text, text, text, bigint)
  to authenticated;

create or replace function public.request_lead_unendorsement(
  p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_request_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 1));

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'Lead not found';
  end if;
  if private.lead_has_approved_price_quotation(v_lead.id) then
    raise exception 'Lead endorsement cannot be removed after an approved Price Quotation exists';
  end if;
  if v_lead.endorsed_by is null
    or v_lead.endorsed_to is null
    or v_lead.endorsed_at is null then
    raise exception 'This lead does not have an active endorsement';
  end if;
  if v_lead.endorsed_by is distinct from (select auth.uid())
    or not private.has_text_role(
      v_lead.organization_id,
      array['project_manager', 'sales_pricing_officer']
    ) then
    raise exception 'Only the original lead owner can request unendorsement';
  end if;
  if exists (
    select 1 from public.lead_unendorsement_requests request
    where request.lead_id = v_lead.id and request.status = 'pending'
  ) then
    raise exception 'An unendorsement request is already pending for this lead';
  end if;

  insert into public.lead_unendorsement_requests (
    organization_id, lead_id, requested_by, endorsed_by, endorsed_to
  ) values (
    v_lead.organization_id,
    v_lead.id,
    (select auth.uid()),
    v_lead.endorsed_by,
    v_lead.endorsed_to
  ) returning id into v_request_id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data
  ) values (
    v_lead.organization_id,
    (select auth.uid()),
    'lead',
    v_lead.id,
    'unendorsement_requested',
    jsonb_build_object(
      'endorsed_by', v_lead.endorsed_by,
      'endorsed_to', v_lead.endorsed_to,
      'endorsed_at', v_lead.endorsed_at
    ),
    jsonb_build_object('request_id', v_request_id, 'status', 'pending')
  );
  return v_request_id;
exception
  when unique_violation then
    raise exception 'An unendorsement request is already pending for this lead';
end;
$$;

revoke all on function public.request_lead_unendorsement(uuid) from public;
grant execute on function public.request_lead_unendorsement(uuid) to authenticated;

create or replace function public.review_lead_unendorsement(
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
  v_request public.lead_unendorsement_requests%rowtype;
  v_lead public.leads%rowtype;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported lead unendorsement decision';
  end if;
  select * into v_request
  from public.lead_unendorsement_requests
  where id = p_request_id
  for update;
  if not found or v_request.status::text <> 'pending' then
    raise exception 'This unendorsement request is no longer pending';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request.lead_id::text, 1));

  if not (
    private.has_text_role(
      v_request.organization_id,
      array['super_admin', 'owner', 'admin']
    )
    or (
      v_request.endorsed_to = (select auth.uid())
      and private.has_text_role(
        v_request.organization_id,
        array['sales_pricing_officer']
      )
    )
  ) then
    raise exception 'Only the endorsed Sales & Pricing Officer or General Manager can review this request';
  end if;

  select * into v_lead
  from public.leads
  where id = v_request.lead_id
  for update;
  if not found
    or v_lead.organization_id is distinct from v_request.organization_id
    or v_lead.endorsed_by is distinct from v_request.endorsed_by
    or v_lead.endorsed_to is distinct from v_request.endorsed_to
    or v_lead.endorsed_at is null then
    raise exception 'The active lead endorsement no longer matches this request';
  end if;
  if p_decision = 'approved' and private.lead_has_approved_price_quotation(v_lead.id) then
    raise exception 'Lead endorsement cannot be removed after an approved Price Quotation exists';
  end if;

  if p_decision = 'approved' then
    update public.leads
    set endorsed_by = null,
        endorsed_to = null,
        endorsed_at = null
    where id = v_lead.id;

    insert into public.activity_log (
      organization_id, actor_id, resource_type, resource_id, action,
      before_data, after_data
    ) values (
      v_lead.organization_id,
      (select auth.uid()),
      'lead',
      v_lead.id,
      'unendorsed',
      jsonb_build_object(
        'endorsed_by', v_lead.endorsed_by,
        'endorsed_to', v_lead.endorsed_to,
        'endorsed_at', v_lead.endorsed_at,
        'endorsement_history_locked', v_lead.endorsement_history_locked
      ),
      jsonb_build_object(
        'endorsed_by', null,
        'endorsed_to', null,
        'endorsed_at', null,
        'endorsement_history_locked', true,
        'request_id', v_request.id
      )
    );
  end if;

  update public.lead_unendorsement_requests
  set status = p_decision::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where id = v_request.id;
  return v_request.id;
end;
$$;

revoke all on function public.review_lead_unendorsement(uuid, text, text) from public;
grant execute on function public.review_lead_unendorsement(uuid, text, text) to authenticated;

commit;
