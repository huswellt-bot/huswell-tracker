-- Replace the retired VA Commission workflow with explicit Sales Executive
-- Origin / Co-Worker allocations. This migration is additive: historical
-- Commission Summary rows and their VA fields remain available for audit, but
-- new rows use the Sales Executive split and new lead endorsements transfer
-- quotation ownership to the receiving officer.
--
-- Run after 194_multiple_assigned_box_makers.sql and before deploying the
-- matching application update. Do not run this file from the application.

begin;

alter table public.commission_summaries
  drop constraint if exists commission_summaries_calculation_source_check;

alter table public.commission_summaries
  add constraint commission_summaries_calculation_source_check
  check (
    commission_calculation_source is null
    or commission_calculation_source in (
      'approved_costing_markup',
      'legacy_grand_total_rate',
      'sales_executive_split'
    )
  );

create table if not exists public.commission_summary_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commission_summary_id uuid not null references public.commission_summaries(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  allocation_role text not null check (allocation_role in (
    'originating_se',
    'costing_se',
    'self_handled_se'
  )),
  share_rate numeric(5,2) not null check (share_rate between 0 and 100),
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'not_yet_paid' check (status in (
    'not_yet_paid',
    'paid',
    'not_applicable'
  )),
  eligible_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commission_summary_id, allocation_role),
  check (
    (status = 'paid' and paid_at is not null and paid_by is not null)
    or (status in ('not_yet_paid', 'not_applicable') and paid_at is null and paid_by is null)
  ),
  check (
    (allocation_role = 'self_handled_se' and share_rate = 100)
    or (allocation_role in ('originating_se', 'costing_se') and share_rate > 0)
  )
);

create index if not exists commission_summary_allocations_org_status_idx
  on public.commission_summary_allocations (organization_id, status, created_at desc);
create index if not exists commission_summary_allocations_recipient_idx
  on public.commission_summary_allocations (organization_id, recipient_user_id, created_at desc);
create index if not exists commission_summary_allocations_summary_idx
  on public.commission_summary_allocations (commission_summary_id, allocation_role);

drop trigger if exists commission_summary_allocations_updated_at
  on public.commission_summary_allocations;
create trigger commission_summary_allocations_updated_at
before update on public.commission_summary_allocations
for each row execute function public.set_updated_at();

alter table public.commission_summary_allocations enable row level security;
revoke all on public.commission_summary_allocations from public, anon, authenticated;
grant select on public.commission_summary_allocations to authenticated;

drop policy if exists "commission allocations: authorized read"
  on public.commission_summary_allocations;
create policy "commission allocations: authorized read"
on public.commission_summary_allocations for select to authenticated
using (
  private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant',
    'internal_finance', 'external_finance'
  ])
  or (
    private.has_text_role(organization_id, array['sales_pricing_officer'])
    and recipient_user_id = (select auth.uid())
  )
);

alter table public.finance_transactions
  add column if not exists commission_allocation_id uuid
    references public.commission_summary_allocations(id) on delete set null;

alter table public.finance_transactions
  drop constraint if exists finance_transactions_commission_allocation_expense_check;
alter table public.finance_transactions
  add constraint finance_transactions_commission_allocation_expense_check
  check (transaction_type = 'expense' or commission_allocation_id is null);

drop index if exists public.finance_transactions_one_commission_payment_idx;
create unique index if not exists finance_transactions_one_commission_payment_idx
  on public.finance_transactions (commission_summary_id)
  where commission_summary_id is not null
    and commission_allocation_id is null
    and payment_status = 'paid'
    and approval_status = 'approved';
create unique index if not exists finance_transactions_one_commission_allocation_payment_idx
  on public.finance_transactions (commission_allocation_id)
  where commission_allocation_id is not null
    and payment_status = 'paid'
    and approval_status = 'approved';
create unique index if not exists finance_transactions_one_active_commission_allocation_idx
  on public.finance_transactions (commission_allocation_id)
  where commission_allocation_id is not null
    and is_voided = false
    and approval_status not in ('rejected', 'cancelled');
create index if not exists finance_transactions_commission_allocation_idx
  on public.finance_transactions (commission_allocation_id)
  where commission_allocation_id is not null;

-- New approved quotations create one self-handled allocation or a 60/40
-- Origin/Co-Worker pair. Existing unpaid rows are not backfilled or rewritten.
create or replace function private.sync_commission_summary_allocations()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_total numeric := round(coalesce(new.sales_commission_markup_amount, new.commission_amount, 0), 2);
  v_is_endorsed boolean := false;
  v_originator uuid;
  v_coworker uuid;
  v_origin_amount numeric;
begin
  if pg_trigger_depth() > 1 or new.status = 'paid' then
    return new;
  end if;

  v_originator := new.lead_endorser_user_id;
  v_coworker := coalesce(new.lead_endorsed_to_user_id, new.preparator_user_id);
  v_is_endorsed := v_originator is not null
    and v_coworker is not null
    and v_originator is distinct from v_coworker
    and new.lead_endorsed_to_user_id = new.preparator_user_id
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = new.organization_id
        and member.user_id = v_originator
        and member.role::text = 'sales_pricing_officer'
    )
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = new.organization_id
        and member.user_id = v_coworker
        and member.role::text = 'sales_pricing_officer'
    );

  if v_is_endorsed then
    v_origin_amount := round(v_total * 0.60, 2);

    delete from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = new.id
      and allocation.status = 'not_yet_paid'
      and allocation.allocation_role = 'self_handled_se';

    insert into public.commission_summary_allocations (
      organization_id, commission_summary_id, quotation_id, recipient_user_id,
      allocation_role, share_rate, amount,
      status
    ) values (
      new.organization_id, new.id, new.quotation_id, v_originator,
      'originating_se', 60, v_origin_amount,
      case when v_origin_amount = 0 then 'not_applicable' else 'not_yet_paid' end
    )
    on conflict (commission_summary_id, allocation_role) do update
    set recipient_user_id = excluded.recipient_user_id,
        quotation_id = excluded.quotation_id,
        share_rate = excluded.share_rate,
        amount = excluded.amount,
        status = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.status
          when excluded.amount = 0 then 'not_applicable'
          else 'not_yet_paid'
        end,
        eligible_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.eligible_at
          else null
        end,
        paid_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_at
          else null
        end,
        paid_by = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_by
          else null
        end;

    insert into public.commission_summary_allocations (
      organization_id, commission_summary_id, quotation_id, recipient_user_id,
      allocation_role, share_rate, amount,
      status
    ) values (
      new.organization_id, new.id, new.quotation_id, v_coworker,
      'costing_se', 40, round(v_total - v_origin_amount, 2),
      case when round(v_total - v_origin_amount, 2) = 0 then 'not_applicable' else 'not_yet_paid' end
    )
    on conflict (commission_summary_id, allocation_role) do update
    set recipient_user_id = excluded.recipient_user_id,
        quotation_id = excluded.quotation_id,
        share_rate = excluded.share_rate,
        amount = excluded.amount,
        status = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.status
          when excluded.amount = 0 then 'not_applicable'
          else 'not_yet_paid'
        end,
        eligible_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.eligible_at
          else null
        end,
        paid_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_at
          else null
        end,
        paid_by = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_by
          else null
        end;

    delete from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = new.id
      and allocation.status = 'not_yet_paid'
      and allocation.allocation_role = 'self_handled_se';
  else
    delete from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = new.id
      and allocation.status = 'not_yet_paid'
      and allocation.allocation_role in ('originating_se', 'costing_se');

    insert into public.commission_summary_allocations (
      organization_id, commission_summary_id, quotation_id, recipient_user_id,
      allocation_role, share_rate, amount,
      status
    ) values (
      new.organization_id, new.id, new.quotation_id, new.preparator_user_id,
      'self_handled_se', 100, v_total,
      case when v_total = 0 then 'not_applicable' else 'not_yet_paid' end
    )
    on conflict (commission_summary_id, allocation_role) do update
    set recipient_user_id = excluded.recipient_user_id,
        quotation_id = excluded.quotation_id,
        share_rate = excluded.share_rate,
        amount = excluded.amount,
        status = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.status
          when excluded.amount = 0 then 'not_applicable'
          else 'not_yet_paid'
        end,
        eligible_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.eligible_at
          else null
        end,
        paid_at = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_at
          else null
        end,
        paid_by = case
          when commission_summary_allocations.status = 'paid' then commission_summary_allocations.paid_by
          else null
        end;
  end if;

  -- Keep VA fields as historical compatibility columns, but make the new
  -- summary explicitly describe the Sales Executive split.
  update public.commission_summaries summary
  set va_endorser_user_id = null,
      va_commission_rate = 0,
      va_commission_markup_amount = 0,
      commission_calculation_source = 'sales_executive_split'
  where summary.id = new.id
    and (
      summary.va_endorser_user_id is not null
      or summary.va_commission_rate <> 0
      or coalesce(summary.va_commission_markup_amount, 0) <> 0
      or summary.commission_calculation_source is distinct from 'sales_executive_split'
    );

  return new;
end;
$$;

drop trigger if exists commission_summary_allocations_sync
  on public.commission_summaries;
create trigger commission_summary_allocations_sync
after insert or update of preparator_user_id, lead_endorser_user_id,
  lead_endorsed_to_user_id, lead_endorsement_at, sales_commission_markup_amount,
  commission_rate, grand_total
on public.commission_summaries
for each row execute function private.sync_commission_summary_allocations();

create or replace function private.block_commission_summary_allocation_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status is distinct from old.status
    and exists (
      select 1
      from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = old.id
    )
    and coalesce(current_setting('huswell.allow_commission_allocation_status_sync', true), '') <> 'on' then
    raise exception 'Commission status is controlled by its individual Finance payout allocations';
  end if;
  return new;
end;
$$;

drop trigger if exists commission_summary_allocation_status_guard
  on public.commission_summaries;
create trigger commission_summary_allocation_status_guard
before update on public.commission_summaries
for each row execute function private.block_commission_summary_allocation_status_change();

-- An endorsed lead belongs to the receiving officer while the endorsement is
-- active. Approval of an unendorsement restores the original endorser.
create or replace function private.sync_lead_endorsement_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE' then
    if new.endorsed_to is not null and new.endorsed_to is distinct from old.endorsed_to then
      new.assigned_to := new.endorsed_to;
    elsif old.endorsed_to is not null and new.endorsed_to is null then
      new.assigned_to := coalesce(old.endorsed_by, old.assigned_to);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_sync_endorsement_owner on public.leads;
create trigger leads_sync_endorsement_owner
before update on public.leads
for each row execute function private.sync_lead_endorsement_owner();

create or replace function private.can_prepare_endorsed_lead(
  target_organization_id uuid,
  target_assigned_to uuid,
  target_endorsed_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_text_role(target_organization_id, array['project_manager'])
    and target_assigned_to = (select auth.uid());
$$;

revoke all on function private.can_prepare_endorsed_lead(uuid, uuid, uuid) from public;
grant execute on function private.can_prepare_endorsed_lead(uuid, uuid, uuid) to authenticated;

do $$
declare
  lead_row record;
begin
  for lead_row in
    select id, organization_id, assigned_to, endorsed_by, endorsed_to
    from public.leads
    where endorsed_by is not null
      and endorsed_to is not null
      and assigned_to is distinct from endorsed_to
  loop
    update public.leads
    set assigned_to = lead_row.endorsed_to
    where id = lead_row.id;

    insert into public.lead_transfer_history (
      organization_id, lead_id, previous_owner_id, new_owner_id,
      transferred_by, note
    ) values (
      lead_row.organization_id,
      lead_row.id,
      lead_row.assigned_to,
      lead_row.endorsed_to,
      coalesce(lead_row.endorsed_by, lead_row.endorsed_to),
      'Ownership synchronized with the active lead endorsement.'
    );
  end loop;
end;
$$;

-- The quotation review queue is an officer's own work queue. Non-officer
-- roles retain their existing visibility through this restrictive policy.
drop policy if exists "price quotation submissions: own officer read"
  on public.quotations;
create policy "price quotation submissions: own officer read"
on public.quotations as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or created_by = (select auth.uid())
  or prepared_by_user_id = (select auth.uid())
  or submitted_by = (select auth.uid())
);

-- Retire VA Commission from active settings and new costing writes without
-- deleting historical markup rows or historical Commission Summary columns.
create or replace function private.validate_pricing_markup_defaults(p_defaults jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_entry jsonb;
  v_type text;
  v_value numeric;
begin
  if coalesce(jsonb_typeof(p_defaults), '') <> 'object' then
    raise exception 'Pricing defaults must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_defaults) as supplied(key)
    where supplied.key not in (
      'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
      'sales_commission', 'incentives', 'discounts', 'third_party_markup',
      'vat'
    )
    and supplied.key !~ '^custom_[0-9a-f-]{36}$'
  ) then
    raise exception 'Pricing defaults contain an unsupported category';
  end if;

  foreach v_key in array array[
    'target_profit_margin', 'overhead_allocation', 'contingency_allowance',
    'sales_commission', 'incentives', 'third_party_markup', 'vat'
  ] loop
    if not (p_defaults ? v_key) then
      raise exception 'Missing pricing default: %', v_key;
    end if;
  end loop;

  for v_key, v_entry in
    select key, value from jsonb_each(p_defaults)
  loop
    if coalesce(jsonb_typeof(v_entry), '') <> 'object' then
      raise exception 'Pricing default % must be an object', v_key;
    end if;
    if v_key ~ '^custom_' and nullif(btrim(coalesce(v_entry ->> 'label', '')), '') is null then
      raise exception 'Custom pricing defaults need a name';
    end if;
    if (v_entry ? 'visible') and jsonb_typeof(v_entry -> 'visible') <> 'boolean' then
      raise exception 'Pricing default % visibility must be true or false', v_key;
    end if;
    v_type := coalesce(v_entry ->> 'calculation_type', 'percentage');
    if v_type <> 'percentage' then
      raise exception 'Pricing default % must use percentage basis', v_key;
    end if;
    begin
      if v_entry ->> 'value' is null then
        raise exception 'Pricing default % needs a valid numeric value', v_key;
      end if;
      v_value := (v_entry ->> 'value')::numeric;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Pricing default % needs a valid numeric value', v_key;
    end;
    if v_value < 0 or v_value > 100 then
      raise exception 'Pricing default % must be between 0%% and 100%%', v_key;
    end if;
    if v_key = 'target_profit_margin' and v_value >= 100 then
      raise exception 'Pricing default % must be below 100%%', v_key;
    end if;
  end loop;
end;
$$;

create or replace function private.sync_commission_summary_defaults_from_pricing_markups()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_sales_rate numeric;
begin
  if coalesce(jsonb_typeof(new.pricing_markup_defaults), '') = 'object' then
    begin
      v_sales_rate := coalesce(
        nullif(new.pricing_markup_defaults -> 'sales_commission' ->> 'value', '')::numeric,
        nullif(new.pricing_markup_defaults -> 'sales_commission' ->> 'rate', '')::numeric
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Commission pricing defaults need valid numeric values';
    end;
    if v_sales_rate is not null then
      new.commission_default_rate := round(v_sales_rate, 2);
    end if;
  end if;
  new.va_commission_default_rate := 0;
  return new;
end;
$$;

drop trigger if exists business_commission_summary_defaults_sync
  on public.business_settings;
create trigger business_commission_summary_defaults_sync
before insert or update of pricing_markup_defaults on public.business_settings
for each row execute function private.sync_commission_summary_defaults_from_pricing_markups();

create or replace function public.save_pricing_defaults(
  p_organization_id uuid,
  p_defaults jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_defaults jsonb := coalesce(p_defaults, '{}'::jsonb) - 'va_commission';
  v_profit numeric;
  v_overhead numeric;
  v_contingency numeric;
  v_commission numeric;
  v_third_party numeric;
  v_vat numeric;
begin
  if not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can change internal pricing defaults';
  end if;
  perform private.validate_pricing_markup_defaults(v_defaults);

  v_profit := case when v_defaults -> 'target_profit_margin' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'target_profit_margin' ->> 'value')::numeric else 75 end;
  v_overhead := case when v_defaults -> 'overhead_allocation' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'overhead_allocation' ->> 'value')::numeric else 0 end;
  v_contingency := case when v_defaults -> 'contingency_allowance' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'contingency_allowance' ->> 'value')::numeric else 20 end;
  v_commission := case when v_defaults -> 'sales_commission' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'sales_commission' ->> 'value')::numeric else 5 end;
  v_third_party := case when v_defaults -> 'third_party_markup' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'third_party_markup' ->> 'value')::numeric else 15 end;
  v_vat := case when v_defaults -> 'vat' ->> 'calculation_type' = 'percentage' then (v_defaults -> 'vat' ->> 'value')::numeric else 12 end;

  insert into public.business_settings (
    organization_id, pricing_markup_defaults, default_profit_margin,
    default_overhead_rate, default_buffer_margin, production_commission,
    default_additional_markup, vat_rate
  ) values (
    p_organization_id, v_defaults, v_profit, v_overhead, v_contingency,
    v_commission, v_third_party, v_vat
  )
  on conflict (organization_id) do update
  set pricing_markup_defaults = excluded.pricing_markup_defaults,
      default_profit_margin = case when v_defaults -> 'target_profit_margin' ->> 'calculation_type' = 'percentage' then excluded.default_profit_margin else business_settings.default_profit_margin end,
      default_overhead_rate = case when v_defaults -> 'overhead_allocation' ->> 'calculation_type' = 'percentage' then excluded.default_overhead_rate else business_settings.default_overhead_rate end,
      default_buffer_margin = case when v_defaults -> 'contingency_allowance' ->> 'calculation_type' = 'percentage' then excluded.default_buffer_margin else business_settings.default_buffer_margin end,
      production_commission = case when v_defaults -> 'sales_commission' ->> 'calculation_type' = 'percentage' then excluded.production_commission else business_settings.production_commission end,
      default_additional_markup = case when v_defaults -> 'third_party_markup' ->> 'calculation_type' = 'percentage' then excluded.default_additional_markup else business_settings.default_additional_markup end,
      vat_rate = case when v_defaults -> 'vat' ->> 'calculation_type' = 'percentage' then excluded.vat_rate else business_settings.vat_rate end;

  return v_defaults;
end;
$$;

revoke all on function public.save_pricing_defaults(uuid, jsonb) from public;
grant execute on function public.save_pricing_defaults(uuid, jsonb) to authenticated;

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
declare
  v_defaults jsonb;
begin
  if not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can change commission defaults';
  end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'Commission percentage must be between 0 and 100';
  end if;

  select jsonb_build_object(
    'target_profit_margin', jsonb_build_object('label', 'Target Profit Margin', 'calculation_type', 'percentage', 'value', 75),
    'overhead_allocation', jsonb_build_object('label', 'Overhead Allocation', 'calculation_type', 'percentage', 'value', 0),
    'contingency_allowance', jsonb_build_object('label', 'Contingency Allowance', 'calculation_type', 'percentage', 'value', 20),
    'sales_commission', jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', round(p_commission_rate, 2)),
    'incentives', jsonb_build_object('label', 'Incentives', 'calculation_type', 'percentage', 'value', 0),
    'third_party_markup', jsonb_build_object('label', 'Third Party Mark Up', 'calculation_type', 'percentage', 'value', 15),
    'vat', jsonb_build_object('label', 'VAT', 'calculation_type', 'percentage', 'value', 12)
  ) || coalesce(settings.pricing_markup_defaults, '{}'::jsonb)
  into v_defaults
  from public.business_settings settings
  where settings.organization_id = p_organization_id;

  v_defaults := jsonb_set(
    v_defaults - 'va_commission',
    '{sales_commission}',
    jsonb_build_object('label', 'Sales Executive Commission', 'calculation_type', 'percentage', 'value', round(p_commission_rate, 2)),
    true
  );
  perform public.save_pricing_defaults(p_organization_id, v_defaults);
end;
$$;

revoke all on function public.save_commission_defaults(uuid, numeric, numeric) from public;
grant execute on function public.save_commission_defaults(uuid, numeric, numeric) to authenticated;

alter table public.business_settings
  alter column pricing_markup_defaults set default '{
    "target_profit_margin": {"label": "Target Profit Margin", "calculation_type": "percentage", "value": 75},
    "overhead_allocation": {"label": "Overhead Allocation", "calculation_type": "percentage", "value": 0},
    "contingency_allowance": {"label": "Contingency Allowance", "calculation_type": "percentage", "value": 20},
    "sales_commission": {"label": "Sales Executive Commission", "calculation_type": "percentage", "value": 0},
    "incentives": {"label": "Incentives", "calculation_type": "percentage", "value": 0},
    "discounts": {"label": "Discounts", "calculation_type": "percentage", "value": 0},
    "third_party_markup": {"label": "Third Party Mark Up", "calculation_type": "percentage", "value": 15},
    "vat": {"label": "VAT", "calculation_type": "percentage", "value": 12}
  }'::jsonb;

update public.business_settings
set pricing_markup_defaults = pricing_markup_defaults - 'va_commission',
    va_commission_default_rate = 0;

create or replace function private.reject_retired_va_markup()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if private.canonical_pricing_markup_key(
    coalesce(nullif(btrim(new.markup_key), ''), nullif(btrim(new.label), ''), '')
  ) = 'va_commission' then
    if tg_op = 'UPDATE'
      and private.canonical_pricing_markup_key(
        coalesce(nullif(btrim(old.markup_key), ''), nullif(btrim(old.label), ''), '')
      ) = 'va_commission' then
      return new;
    end if;
    raise exception 'VA Commission is retired. Use Sales Executive Commission for new quotations.';
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_costing_markups_retired_va_guard
  on public.price_quotation_costing_markups;
create trigger price_quotation_costing_markups_retired_va_guard
before insert or update on public.price_quotation_costing_markups
for each row execute function private.reject_retired_va_markup();

-- Keep the legacy Commission Summary shape compatible while adding explicit
-- allocation rows for the new manager and officer views.
create or replace function public.commission_summary_rows_v2(
  p_organization_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
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
  commission_rate numeric,
  va_commission_rate numeric,
  commission_amount numeric,
  va_commission_amount numeric,
  sales_commission_markup_amount numeric,
  va_commission_markup_amount numeric,
  commission_calculation_source text,
  commission_markup_snapshot jsonb,
  downpayment_amount numeric,
  receivable_balance numeric,
  payment_due_date date,
  status text,
  paid_at timestamptz,
  paid_by uuid,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  my_commission_type text,
  my_commission_amount numeric,
  my_officer_name text,
  allocations jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
with access as (
  select
    private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance']
    ) as can_manage,
    private.has_text_role(
      p_organization_id,
      array['sales_pricing_officer']
    ) as is_officer
),
rows as (
  select
    summary.*,
    access.can_manage,
    access.is_officer,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', allocation.id,
            'commission_summary_id', allocation.commission_summary_id,
            'quotation_id', allocation.quotation_id,
            'recipient_user_id', allocation.recipient_user_id,
            'recipient_name', coalesce(profile.full_name, 'Sales & Pricing Officer'),
            'allocation_role', allocation.allocation_role,
            'share_rate', allocation.share_rate,
            'amount', allocation.amount,
            'status', allocation.status,
            'eligible_at', allocation.eligible_at,
            'paid_at', allocation.paid_at,
            'paid_by', allocation.paid_by
          )
          order by allocation.allocation_role
        )
        from public.commission_summary_allocations allocation
        left join public.profiles profile on profile.id = allocation.recipient_user_id
        where allocation.commission_summary_id = summary.id
          and (
            access.can_manage
            or allocation.recipient_user_id = (select auth.uid())
          )
      ),
      '[]'::jsonb
    ) as allocation_rows,
    mine.my_amount,
    mine.my_type,
    mine.my_name
  from public.commission_summaries summary
  cross join access
  left join lateral (
    select
      round(coalesce(sum(allocation.amount), 0), 2) as my_amount,
      string_agg(
        case allocation.allocation_role
          when 'originating_se' then 'S.E. Origin'
          when 'costing_se' then 'Co-Worker'
          when 'self_handled_se' then 'Self-handled'
          else allocation.allocation_role
        end,
        ', ' order by allocation.allocation_role
      ) as my_type,
      max(profile.full_name) as my_name
    from public.commission_summary_allocations allocation
    left join public.profiles profile on profile.id = allocation.recipient_user_id
    where allocation.commission_summary_id = summary.id
      and allocation.recipient_user_id = (select auth.uid())
  ) mine on true
  where summary.organization_id = p_organization_id
    and (
      access.can_manage
      or (
        access.is_officer
        and (
          summary.preparator_user_id = (select auth.uid())
          or summary.lead_endorser_user_id = (select auth.uid())
          or summary.va_endorser_user_id = (select auth.uid())
          or exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = summary.id
              and allocation.recipient_user_id = (select auth.uid())
          )
        )
      )
    )
)
select
  rows.id,
  rows.organization_id,
  rows.quotation_id,
  case when rows.can_manage then rows.production_job_id else null end,
  rows.quotation_no,
  rows.project_name,
  rows.client_name,
  rows.grand_total,
  case
    when rows.can_manage or rows.preparator_user_id = (select auth.uid())
      then rows.preparator_user_id
    else null
  end,
  case
    when rows.can_manage or rows.preparator_user_id = (select auth.uid())
      then preparator_profile.full_name
    else null
  end,
  case
    when rows.can_manage
      or rows.preparator_user_id = (select auth.uid())
      or rows.lead_endorser_user_id = (select auth.uid())
      or rows.va_endorser_user_id = (select auth.uid())
      then rows.lead_endorser_user_id
    else null
  end,
  case
    when rows.can_manage
      or rows.preparator_user_id = (select auth.uid())
      or rows.lead_endorser_user_id = (select auth.uid())
      or rows.va_endorser_user_id = (select auth.uid())
      then rows.lead_endorsed_to_user_id
    else null
  end,
  case
    when rows.can_manage
      or rows.preparator_user_id = (select auth.uid())
      or rows.lead_endorser_user_id = (select auth.uid())
      or rows.va_endorser_user_id = (select auth.uid())
      then rows.lead_endorsement_at
    else null
  end,
  case when rows.can_manage or rows.va_endorser_user_id = (select auth.uid()) then rows.va_endorser_user_id else null end,
  case when rows.can_manage or rows.va_endorser_user_id = (select auth.uid()) then va_profile.full_name else null end,
  case when rows.can_manage or rows.preparator_user_id = (select auth.uid()) then rows.commission_rate else 0 end,
  case when rows.can_manage or rows.va_endorser_user_id = (select auth.uid()) then rows.va_commission_rate else 0 end,
  case when rows.can_manage or rows.preparator_user_id = (select auth.uid()) then rows.commission_amount else 0 end,
  case when rows.can_manage or rows.va_endorser_user_id = (select auth.uid()) then rows.va_commission_amount else 0 end,
  case when rows.can_manage or rows.preparator_user_id = (select auth.uid()) then rows.sales_commission_markup_amount else null end,
  case when rows.can_manage or rows.va_endorser_user_id = (select auth.uid()) then rows.va_commission_markup_amount else null end,
  rows.commission_calculation_source,
  case when rows.can_manage then rows.commission_markup_snapshot else null end,
  case when rows.can_manage then rows.downpayment_amount else null end,
  case when rows.can_manage then rows.receivable_balance else null end,
  case when rows.can_manage then rows.payment_due_date else null end,
  rows.status,
  case when rows.can_manage then rows.paid_at else null end,
  case when rows.can_manage then rows.paid_by else null end,
  case when rows.can_manage then rows.created_by else null end,
  rows.created_at,
  rows.updated_at,
  coalesce(
    rows.my_type,
    case
      when rows.preparator_user_id = (select auth.uid()) and rows.va_endorser_user_id = (select auth.uid()) then 'Sales Commission'
      when rows.preparator_user_id = (select auth.uid()) then 'Sales Commission'
      when rows.va_endorser_user_id = (select auth.uid()) then 'Historical VA Commission'
      else null
    end
  ),
  coalesce(
    rows.my_amount,
    case
      when rows.preparator_user_id = (select auth.uid()) then coalesce(rows.sales_commission_markup_amount, rows.commission_amount)
      when rows.va_endorser_user_id = (select auth.uid()) then coalesce(rows.va_commission_markup_amount, rows.va_commission_amount)
      else 0
    end
  ),
  coalesce(rows.my_name, preparator_profile.full_name, va_profile.full_name),
  rows.allocation_rows
from rows
left join public.profiles preparator_profile on preparator_profile.id = rows.preparator_user_id
left join public.profiles va_profile on va_profile.id = rows.va_endorser_user_id
order by rows.created_at desc, rows.quotation_no asc;
$$;

revoke all on function public.commission_summary_rows_v2(uuid) from public;
grant execute on function public.commission_summary_rows_v2(uuid) to authenticated;

-- Reconcile individual commission payouts. Supplier and legacy parent-summary
-- behavior remains available for existing finance records.
create or replace function private.sync_paid_finance_source(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_allocation public.commission_summary_allocations%rowtype;
  v_latest_verified timestamptz;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found or v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'paid'
    or v_transaction.approval_status <> 'approved' then
    return;
  end if;

  if v_transaction.commission_allocation_id is not null then
    if v_transaction.supplier_payable_id is not null then
      raise exception 'A Money Out transaction cannot link a supplier payable and commission allocation together';
    end if;

    select * into v_allocation
    from public.commission_summary_allocations allocation
    where allocation.id = v_transaction.commission_allocation_id
      and allocation.organization_id = v_transaction.organization_id
    for update;

    if not found or v_allocation.status <> 'not_yet_paid' then
      raise exception 'The commission allocation is no longer payable';
    end if;
    if round(v_allocation.amount, 2) <> round(v_transaction.amount, 2) then
      raise exception 'The Money Out amount must equal the selected commission allocation';
    end if;

    select max(payment.verified_at) into v_latest_verified
    from public.quotation_payment_records payment
    where payment.organization_id = v_transaction.organization_id
      and payment.quotation_id = v_allocation.quotation_id
      and payment.status = 'verified';
    if v_latest_verified is null then
      raise exception 'The commission cannot be paid until a client payment is verified';
    end if;
    if now() < v_latest_verified + interval '3 days' then
      raise exception 'The commission becomes payable three days after the verified client payment';
    end if;

    update public.commission_summary_allocations
    set status = 'paid',
        eligible_at = v_latest_verified + interval '3 days',
        paid_at = coalesce(v_transaction.paid_at, now()),
        paid_by = coalesce(v_transaction.paid_by, (select auth.uid()))
    where id = v_allocation.id
      and status = 'not_yet_paid';

    perform set_config('huswell.allow_commission_allocation_status_sync', 'on', true);
    update public.commission_summaries summary
    set status = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then 'paid'
          else 'not_yet_paid'
        end,
        paid_at = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then coalesce(paid_at, v_transaction.paid_at, now())
          else null
        end,
        paid_by = case
          when not exists (
            select 1
            from public.commission_summary_allocations allocation
            where allocation.commission_summary_id = v_allocation.commission_summary_id
              and allocation.status = 'not_yet_paid'
          ) then coalesce(paid_by, v_transaction.paid_by, (select auth.uid()))
          else null
        end
    where id = v_allocation.commission_summary_id;
    perform set_config('huswell.allow_commission_allocation_status_sync', 'off', true);
    return;
  end if;

  if v_transaction.supplier_payable_id is not null then
    if not exists (
      select 1 from public.supplier_payables payable
      where payable.id = v_transaction.supplier_payable_id
        and payable.organization_id = v_transaction.organization_id
        and payable.status not in ('paid', 'cancelled')
        and payable.amount_paid + v_transaction.amount <= payable.amount
    ) then
      raise exception 'The supplier payable no longer has enough remaining balance';
    end if;
    update public.supplier_payables payable
    set amount_paid = round(payable.amount_paid + v_transaction.amount, 2),
        status = case
          when payable.amount_paid + v_transaction.amount >= payable.amount then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where payable.id = v_transaction.supplier_payable_id
      and payable.organization_id = v_transaction.organization_id;
  end if;

  if v_transaction.commission_summary_id is not null then
    if not exists (
      select 1 from public.commission_summaries summary
      where summary.id = v_transaction.commission_summary_id
        and summary.organization_id = v_transaction.organization_id
        and round(summary.commission_amount + summary.va_commission_amount, 2) = round(v_transaction.amount, 2)
        and summary.status = 'not_yet_paid'
    ) then
      raise exception 'The commission amount or status has changed';
    end if;
    select max(payment.verified_at) into v_latest_verified
    from public.quotation_payment_records payment
    join public.commission_summaries summary on summary.quotation_id = payment.quotation_id
    where summary.id = v_transaction.commission_summary_id
      and payment.status = 'verified';
    if v_latest_verified is null then
      raise exception 'The commission cannot be paid until a client payment is verified';
    end if;
    if now() < v_latest_verified + interval '3 days' then
      raise exception 'The commission becomes payable three days after the verified client payment';
    end if;
    update public.commission_summaries
    set status = 'paid', paid_at = coalesce(paid_at, v_transaction.paid_at, now()), paid_by = coalesce(paid_by, (select auth.uid()))
    where id = v_transaction.commission_summary_id
      and status = 'not_yet_paid';
  end if;
end;
$$;

create or replace function public.create_finance_transaction_with_commission_allocation(
  p_transaction_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_transaction_date date,
  p_transaction_time time,
  p_payment_status text,
  p_lead_id uuid,
  p_customer_id uuid,
  p_quotation_id uuid,
  p_supplier_payable_id uuid,
  p_commission_summary_id uuid,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint,
  p_commission_allocation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_allocation public.commission_summary_allocations%rowtype;
  v_transaction_id uuid;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null or not private.finance_is_external_or_internal(v_organization_id) then
    raise exception 'Only Finance users can add a transaction';
  end if;
  if p_commission_allocation_id is null then
    return public.create_finance_transaction(
      p_transaction_id => p_transaction_id,
      p_transaction_type => p_transaction_type,
      p_amount => p_amount,
      p_category_id => p_category_id,
      p_account_id => p_account_id,
      p_note => p_note,
      p_transaction_date => p_transaction_date,
      p_transaction_time => p_transaction_time,
      p_payment_status => p_payment_status,
      p_lead_id => p_lead_id,
      p_customer_id => p_customer_id,
      p_quotation_id => p_quotation_id,
      p_supplier_payable_id => p_supplier_payable_id,
      p_commission_summary_id => p_commission_summary_id,
      p_receipt_storage_path => p_receipt_storage_path,
      p_receipt_file_name => p_receipt_file_name,
      p_receipt_content_type => p_receipt_content_type,
      p_receipt_file_size => p_receipt_file_size
    );
  end if;

  if p_transaction_type <> 'expense'
    or p_supplier_payable_id is not null
    or p_commission_summary_id is not null then
    raise exception 'A commission allocation can only be linked to Money Out';
  end if;

  select * into v_allocation
  from public.commission_summary_allocations allocation
  where allocation.id = p_commission_allocation_id
    and allocation.organization_id = v_organization_id
  for update;
  if not found or v_allocation.status <> 'not_yet_paid' then
    raise exception 'The commission allocation is no longer payable';
  end if;
  if round(coalesce(p_amount, 0), 2) <> round(v_allocation.amount, 2) then
    raise exception 'The Money Out amount must equal the selected commission allocation';
  end if;
  if p_quotation_id is not null and p_quotation_id is distinct from v_allocation.quotation_id then
    raise exception 'The selected quotation does not match the commission allocation';
  end if;
  if exists (
    select 1
    from public.finance_transactions transaction
    where transaction.commission_allocation_id = v_allocation.id
      and not transaction.is_voided
      and transaction.approval_status not in ('rejected', 'cancelled')
  ) then
    raise exception 'This commission allocation already has an active Finance transaction';
  end if;

  v_transaction_id := public.create_finance_transaction(
    p_transaction_id => p_transaction_id,
    p_transaction_type => p_transaction_type,
    p_amount => p_amount,
    p_category_id => p_category_id,
    p_account_id => p_account_id,
    p_note => p_note,
    p_transaction_date => p_transaction_date,
    p_transaction_time => p_transaction_time,
    p_payment_status => p_payment_status,
    p_lead_id => p_lead_id,
    p_customer_id => p_customer_id,
    p_quotation_id => coalesce(p_quotation_id, v_allocation.quotation_id),
    p_supplier_payable_id => null,
    p_commission_summary_id => null,
    p_receipt_storage_path => p_receipt_storage_path,
    p_receipt_file_name => p_receipt_file_name,
    p_receipt_content_type => p_receipt_content_type,
    p_receipt_file_size => p_receipt_file_size
  );

  update public.finance_transactions
  set commission_summary_id = v_allocation.commission_summary_id,
      commission_allocation_id = v_allocation.id
  where id = v_transaction_id;

  if p_payment_status = 'paid' and private.finance_is_internal(v_organization_id) then
    perform private.sync_paid_finance_source(v_transaction_id);
  end if;
  return v_transaction_id;
end;
$$;

revoke all on function public.create_finance_transaction_with_commission_allocation(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) from public;
grant execute on function public.create_finance_transaction_with_commission_allocation(
  uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid,
  uuid, uuid, uuid, text, text, text, bigint, uuid
) to authenticated;

commit;
