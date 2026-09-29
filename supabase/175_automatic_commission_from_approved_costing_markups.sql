-- Automatically create Commission Summary rows from the exact Sales Commission
-- and VA Commission markup amounts saved in an approved direct Price Quotation.
--
-- Run after 174_bulk_lead_endorsement.sql and before the matching workspace
-- update. This migration preserves paid/history rows, keeps the old RPC
-- signatures callable, and prevents client-supplied rates from changing the
-- authoritative markup snapshot.

begin;

alter table public.commission_summaries
  add column if not exists sales_commission_markup_amount numeric(14,2),
  add column if not exists va_commission_markup_amount numeric(14,2),
  add column if not exists commission_calculation_source text,
  add column if not exists commission_markup_snapshot jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commission_summaries'::regclass
      and conname = 'commission_summaries_sales_markup_amount_check'
  ) then
    alter table public.commission_summaries
      add constraint commission_summaries_sales_markup_amount_check
      check (sales_commission_markup_amount is null or sales_commission_markup_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commission_summaries'::regclass
      and conname = 'commission_summaries_va_markup_amount_check'
  ) then
    alter table public.commission_summaries
      add constraint commission_summaries_va_markup_amount_check
      check (va_commission_markup_amount is null or va_commission_markup_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commission_summaries'::regclass
      and conname = 'commission_summaries_calculation_source_check'
  ) then
    alter table public.commission_summaries
      add constraint commission_summaries_calculation_source_check
      check (
        commission_calculation_source is null
        or commission_calculation_source in (
          'approved_costing_markup',
          'legacy_grand_total_rate'
        )
      );
  end if;
end;
$$;

-- The costing calculator rounds every direct-cost line before summing COGS and
-- rounds each percentage markup from that COGS. Reuse those same rules here so
-- the Commission Summary stores the markup contribution already included in
-- the quotation price, rather than recalculating a percentage of Grand Total.
create or replace function private.calculate_approved_quotation_commissions(
  p_quotation_id uuid
)
returns table (
  costing_count integer,
  sales_amount numeric,
  va_amount numeric,
  sales_rate numeric,
  va_rate numeric,
  snapshot jsonb
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing record;
  v_markup record;
  v_cogs numeric;
  v_markup_amount numeric;
  v_markup_key text;
  v_costing_sales numeric;
  v_costing_va numeric;
  v_costing_markups jsonb;
  v_total_sales numeric := 0;
  v_total_va numeric := 0;
  v_sales_rate numeric;
  v_va_rate numeric;
  v_sales_rate_consistent boolean := true;
  v_va_rate_consistent boolean := true;
begin
  costing_count := 0;
  sales_amount := 0;
  va_amount := 0;
  sales_rate := null;
  va_rate := null;
  snapshot := '[]'::jsonb;

  for v_costing in
    select product_costing.id, product_costing.pricing_model
    from public.price_quotation_product_costings product_costing
    where product_costing.quotation_id = p_quotation_id
    order by product_costing.created_at, product_costing.id
  loop
    costing_count := costing_count + 1;
    v_costing_sales := 0;
    v_costing_va := 0;
    v_costing_markups := '[]'::jsonb;

    select coalesce(
      sum(
        round(
          case
            when cost_line.calculation_type = 'fixed_amount'
              then cost_line.unit_cost
            else cost_line.quantity * cost_line.unit_cost
          end,
          2
        )
      ),
      0
    )
    into v_cogs
    from public.price_quotation_costing_lines cost_line
    where cost_line.product_costing_id = v_costing.id;
    v_cogs := round(v_cogs, 2);

    for v_markup in
      select markup.*
      from public.price_quotation_costing_markups markup
      where markup.product_costing_id = v_costing.id
      order by markup.sort_order, markup.created_at, markup.id
    loop
      v_markup_key := lower(
        regexp_replace(
          btrim(coalesce(nullif(v_markup.markup_key, ''), v_markup.label)),
          '[^a-z0-9]+',
          '_',
          'g'
        )
      );

      if v_markup_key not in (
        'sales_commission',
        'sales_executive_commission',
        'production_commission',
        'commission_default_rate',
        'va_commission',
        'va_commission_default_rate',
        'va_commission_rate'
      ) and v_markup.markup_key is not null then
        v_markup_key := lower(
          regexp_replace(btrim(v_markup.label), '[^a-z0-9]+', '_', 'g')
        );
      end if;

      if v_markup_key in (
        'sales_commission',
        'sales_executive_commission',
        'production_commission',
        'commission_default_rate',
        'va_commission',
        'va_commission_default_rate',
        'va_commission_rate'
      ) then
        v_markup_amount := case
          when v_markup.calculation_type = 'fixed_amount'
            then round(coalesce(v_markup.amount, 0), 2)
          else round(v_cogs * coalesce(v_markup.rate, 0) / 100, 2)
        end;

        v_costing_markups := v_costing_markups || jsonb_build_array(
          jsonb_build_object(
            'markup_key', v_markup.markup_key,
            'label', v_markup.label,
            'calculation_type', v_markup.calculation_type,
            'rate', v_markup.rate,
            'amount', v_markup_amount
          )
        );

        if v_markup_key in (
          'sales_commission',
          'sales_executive_commission',
          'production_commission',
          'commission_default_rate'
        ) then
          v_costing_sales := v_costing_sales + v_markup_amount;
          if v_markup.calculation_type = 'percentage' then
            if v_sales_rate is null then
              v_sales_rate := v_markup.rate;
            elsif v_sales_rate is distinct from v_markup.rate then
              v_sales_rate_consistent := false;
            end if;
          else
            v_sales_rate_consistent := false;
          end if;
        else
          v_costing_va := v_costing_va + v_markup_amount;
          if v_markup.calculation_type = 'percentage' then
            if v_va_rate is null then
              v_va_rate := v_markup.rate;
            elsif v_va_rate is distinct from v_markup.rate then
              v_va_rate_consistent := false;
            end if;
          else
            v_va_rate_consistent := false;
          end if;
        end if;
      end if;
    end loop;

    v_total_sales := v_total_sales + v_costing_sales;
    v_total_va := v_total_va + v_costing_va;
    snapshot := snapshot || jsonb_build_array(
      jsonb_build_object(
        'product_costing_id', v_costing.id,
        'pricing_model', v_costing.pricing_model,
        'cogs', v_cogs,
        'sales_amount', round(v_costing_sales, 2),
        'va_amount', round(v_costing_va, 2),
        'markups', v_costing_markups
      )
    );
  end loop;

  sales_amount := round(v_total_sales, 2);
  va_amount := round(v_total_va, 2);
  if not v_sales_rate_consistent then
    sales_rate := null;
  else
    sales_rate := round(v_sales_rate, 2);
  end if;
  if not v_va_rate_consistent then
    va_rate := null;
  else
    va_rate := round(v_va_rate, 2);
  end if;
  return next;
end;
$$;

revoke all on function private.calculate_approved_quotation_commissions(uuid)
  from public, anon, authenticated;

-- This helper is used by the approval trigger and by the compatibility create
-- RPC. The trigger passes zero downpayment; an existing unpaid row keeps its
-- saved downpayment when an approved quotation is re-finalized.
create or replace function private.ensure_commission_summary_from_approved_quotation(
  p_quotation_id uuid,
  p_downpayment_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_summary public.commission_summaries%rowtype;
  v_job_id uuid;
  v_preparator uuid;
  v_va_endorser uuid;
  v_lead_endorsed_by uuid;
  v_lead_endorsed_to uuid;
  v_lead_endorsed_at timestamptz;
  v_grand_total numeric;
  v_downpayment numeric;
  v_sales_amount numeric;
  v_va_amount numeric;
  v_sales_rate numeric;
  v_va_rate numeric;
  v_costing_count integer;
  v_costing_snapshot jsonb;
  v_source text;
  v_compat_sales_rate numeric;
  v_compat_va_rate numeric;
  v_summary_snapshot jsonb;
  v_before jsonb;
  v_summary_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved direct Price Quotation can have a Commission Summary';
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
    select lead_row.endorsed_by,
           lead_row.endorsed_to,
           lead_row.endorsed_at
    into v_lead_endorsed_by,
         v_lead_endorsed_to,
         v_lead_endorsed_at
    from public.leads lead_row
    where lead_row.id = v_quote.lead_id
      and lead_row.organization_id = v_quote.organization_id;
  end if;

  if v_lead_endorsed_to = v_preparator
    and v_lead_endorsed_by is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_lead_endorsed_by
        and member.role::text = 'sales_pricing_officer'
    ) then
    v_va_endorser := v_lead_endorsed_by;
  end if;

  select job.id into v_job_id
  from public.production_jobs job
  where job.organization_id = v_quote.organization_id
    and job.quotation_id = v_quote.id
  order by job.created_at
  limit 1;

  v_grand_total := round(greatest(coalesce(v_quote.total_amount, 0), 0), 2);
  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  v_downpayment := round(p_downpayment_amount, 2);
  if v_downpayment > v_grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
  end if;

  select costing_commission.costing_count,
         costing_commission.sales_amount,
         costing_commission.va_amount,
         costing_commission.sales_rate,
         costing_commission.va_rate,
         costing_commission.snapshot
  into v_costing_count,
       v_sales_amount,
       v_va_amount,
       v_sales_rate,
       v_va_rate,
       v_costing_snapshot
  from private.calculate_approved_quotation_commissions(v_quote.id) costing_commission;

  if coalesce(v_costing_count, 0) > 0 then
    v_source := 'approved_costing_markup';
    v_sales_amount := round(coalesce(v_sales_amount, 0), 2);
    v_va_amount := round(coalesce(v_va_amount, 0), 2);
    if v_va_endorser is null and v_va_amount > 0 then
      raise exception
        'This approved quotation has a non-zero VA Commission markup but no valid lead endorsement; correct the costing or endorsement before approval.';
    end if;

    v_compat_sales_rate := case
      when v_sales_rate is not null then round(v_sales_rate, 2)
      when v_grand_total > 0 then round(v_sales_amount / v_grand_total * 100, 2)
      else 0
    end;
    v_compat_va_rate := case
      when v_va_endorser is null then 0
      when v_va_rate is not null then round(v_va_rate, 2)
      when v_grand_total > 0 then round(v_va_amount / v_grand_total * 100, 2)
      else 0
    end;
    v_summary_snapshot := jsonb_build_object(
      'source', v_source,
      'quotation_id', v_quote.id,
      'grand_total', v_grand_total,
      'sales_commission_markup_amount', v_sales_amount,
      'va_commission_markup_amount', case when v_va_endorser is null then 0 else v_va_amount end,
      'costings', v_costing_snapshot
    );
  else
    -- Older direct quotations may predate saved product costings. Preserve
    -- their existing quotation-rate behavior without pretending it came from
    -- a costing markup. New costed quotations always use the branch above.
    v_source := 'legacy_grand_total_rate';
    v_sales_amount := null;
    v_va_amount := null;
    v_compat_sales_rate := round(greatest(coalesce(v_quote.commission_rate, 0), 0), 2);
    v_compat_va_rate := 0;
    v_summary_snapshot := null;
  end if;

  v_compat_sales_rate := least(greatest(coalesce(v_compat_sales_rate, 0), 0), 100);
  v_compat_va_rate := least(greatest(coalesce(v_compat_va_rate, 0), 0), 100);

  select * into v_summary
  from public.commission_summaries summary
  where summary.organization_id = v_quote.organization_id
    and summary.quotation_id = v_quote.id
  for update;

  if found then
    if v_summary.status = 'paid' then
      raise exception
        'Paid Commission Summary must be undone before the quotation can be approved again';
    end if;

    if v_summary.production_job_id is not distinct from coalesce(v_job_id, v_summary.production_job_id)
      and v_summary.quotation_no is not distinct from v_quote.quotation_no
      and v_summary.project_name is not distinct from v_quote.project_name
      and v_summary.client_name is not distinct from v_quote.client_name
      and v_summary.grand_total is not distinct from v_grand_total
      and v_summary.preparator_user_id is not distinct from v_preparator
      and v_summary.lead_endorser_user_id is not distinct from v_lead_endorsed_by
      and v_summary.lead_endorsed_to_user_id is not distinct from v_lead_endorsed_to
      and v_summary.lead_endorsement_at is not distinct from v_lead_endorsed_at
      and v_summary.va_endorser_user_id is not distinct from v_va_endorser
      and v_summary.commission_rate is not distinct from v_compat_sales_rate
      and v_summary.va_commission_rate is not distinct from v_compat_va_rate
      and v_summary.sales_commission_markup_amount is not distinct from v_sales_amount
      and v_summary.va_commission_markup_amount is not distinct from (
        case when v_va_endorser is null then 0 else v_va_amount end
      )
      and v_summary.commission_calculation_source is not distinct from v_source
      and v_summary.commission_markup_snapshot is not distinct from v_summary_snapshot then
      return v_summary.id;
    end if;

    v_before := to_jsonb(v_summary);
    update public.commission_summaries
    set production_job_id = coalesce(v_job_id, production_job_id),
        quotation_no = v_quote.quotation_no,
        project_name = v_quote.project_name,
        client_name = v_quote.client_name,
        grand_total = v_grand_total,
        preparator_user_id = v_preparator,
        lead_endorser_user_id = v_lead_endorsed_by,
        lead_endorsed_to_user_id = v_lead_endorsed_to,
        lead_endorsement_at = v_lead_endorsed_at,
        va_endorser_user_id = v_va_endorser,
        commission_rate = v_compat_sales_rate,
        va_commission_rate = v_compat_va_rate,
        sales_commission_markup_amount = v_sales_amount,
        va_commission_markup_amount = case when v_va_endorser is null then 0 else v_va_amount end,
        commission_calculation_source = v_source,
        commission_markup_snapshot = v_summary_snapshot
    where id = v_summary.id
    returning id into v_summary_id;

    insert into public.activity_log (
      organization_id, actor_id, resource_type, resource_id, action,
      before_data, after_data
    ) values (
      v_quote.organization_id,
      coalesce((select auth.uid()), v_quote.created_by),
      'commission_summary',
      v_summary_id,
      'automatic_markup_reconciled',
      v_before,
      jsonb_build_object(
        'quotation_id', v_quote.id,
        'source', v_source,
        'sales_commission_markup_amount', v_sales_amount,
        'va_commission_markup_amount', case when v_va_endorser is null then 0 else v_va_amount end,
        'grand_total', v_grand_total
      )
    );
    return v_summary_id;
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
    sales_commission_markup_amount,
    va_commission_markup_amount,
    commission_calculation_source,
    commission_markup_snapshot,
    downpayment_amount,
    receivable_balance,
    created_by
  ) values (
    v_quote.organization_id,
    v_quote.id,
    v_job_id,
    v_quote.quotation_no,
    v_quote.project_name,
    v_quote.client_name,
    v_grand_total,
    v_preparator,
    v_lead_endorsed_by,
    v_lead_endorsed_to,
    v_lead_endorsed_at,
    v_va_endorser,
    v_compat_sales_rate,
    v_compat_va_rate,
    v_sales_amount,
    case when v_va_endorser is null then 0 else v_va_amount end,
    v_source,
    v_summary_snapshot,
    v_downpayment,
    round(greatest(v_grand_total - v_downpayment, 0), 2),
    coalesce((select auth.uid()), v_quote.created_by, v_preparator)
  ) returning id into v_summary_id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action, after_data
  ) values (
    v_quote.organization_id,
    coalesce((select auth.uid()), v_quote.created_by),
    'commission_summary',
    v_summary_id,
    'created_automatically',
    jsonb_build_object(
      'quotation_id', v_quote.id,
      'source', v_source,
      'preparator_user_id', v_preparator,
      'va_endorser_user_id', v_va_endorser,
      'grand_total', v_grand_total,
      'sales_commission_markup_amount', v_sales_amount,
      'va_commission_markup_amount', case when v_va_endorser is null then 0 else v_va_amount end,
      'downpayment_amount', v_downpayment,
      'receivable_balance', round(greatest(v_grand_total - v_downpayment, 0), 2)
    )
  );

  return v_summary_id;
end;
$$;

revoke all on function private.ensure_commission_summary_from_approved_quotation(uuid, numeric)
  from public, anon, authenticated;

-- Create the row after the approved quotation's saved costing rows and final
-- totals have been written. Re-approval refreshes unpaid snapshots; paid rows
-- fail closed so a paid historical allocation cannot be silently changed.
create or replace function private.create_commission_summary_on_quotation_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status::text = 'approved'
    and new.document_type = 'price_quotation'
    and new.costing_source_id is null then
    if tg_op = 'INSERT' then
      perform private.ensure_commission_summary_from_approved_quotation(new.id, 0);
    elsif tg_op = 'UPDATE' and old.status::text is distinct from 'approved' then
      perform private.ensure_commission_summary_from_approved_quotation(new.id, 0);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_approved_creates_commission_summary
  on public.quotations;
create trigger quotation_approved_creates_commission_summary
after insert or update of status on public.quotations
for each row execute function private.create_commission_summary_on_quotation_approval();

-- Only the server-side approval path may create or reconcile a row. Keep the
-- existing signatures so an older deployed client cannot supply alternative
-- commission rates; those values are intentionally ignored.
create or replace function public.create_commission_summary(
  p_quotation_id uuid,
  p_downpayment_amount numeric,
  p_receivable_balance numeric,
  p_commission_rate numeric default null,
  p_va_commission_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
begin
  select quotation.organization_id into v_organization_id
  from public.quotations quotation
  where quotation.id = p_quotation_id;
  if not found then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(
    v_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ) then
    raise exception 'Only GM or Finance can add a Commission Summary';
  end if;
  return private.ensure_commission_summary_from_approved_quotation(
    p_quotation_id,
    p_downpayment_amount
  );
end;
$$;

revoke all on function public.create_commission_summary(
  uuid, numeric, numeric, numeric, numeric
) from public;
grant execute on function public.create_commission_summary(
  uuid, numeric, numeric, numeric, numeric
) to authenticated;

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
begin
  return public.create_commission_summary(
    p_quotation_id,
    p_downpayment_amount,
    p_receivable_balance,
    p_commission_rate,
    p_va_commission_rate
  );
end;
$$;

revoke all on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) from public;
grant execute on function public.create_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) to authenticated;

-- Downpayment remains the only editable financial input. The old commission
-- rate arguments are retained for deployed-client compatibility but cannot
-- alter the costing-derived allocation.
create or replace function public.update_commission_summary(
  p_summary_id uuid,
  p_downpayment_amount numeric,
  p_receivable_balance numeric,
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
  v_downpayment numeric;
  v_receivable numeric;
begin
  select * into v_summary
  from public.commission_summaries summary
  where summary.id = p_summary_id
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

  v_downpayment := round(p_downpayment_amount, 2);
  if v_downpayment > v_summary.grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
  end if;
  v_receivable := round(greatest(v_summary.grand_total - v_downpayment, 0), 2);
  v_before := to_jsonb(v_summary);

  update public.commission_summaries
  set downpayment_amount = v_downpayment,
      receivable_balance = v_receivable
  where id = v_summary.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action,
    before_data, after_data
  ) values (
    v_summary.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary.id,
    'updated',
    v_before,
    jsonb_build_object(
      'downpayment_amount', v_downpayment,
      'receivable_balance', v_receivable,
      'commission_calculation_source', v_summary.commission_calculation_source
    )
  );

  return v_summary.id;
end;
$$;

revoke all on function public.update_commission_summary(
  uuid, numeric, numeric, numeric, numeric
) from public;
grant execute on function public.update_commission_summary(
  uuid, numeric, numeric, numeric, numeric
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
begin
  return public.update_commission_summary(
    p_summary_id,
    p_downpayment_amount,
    p_receivable_balance,
    p_commission_rate,
    p_va_commission_rate
  );
end;
$$;

revoke all on function public.update_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) from public;
grant execute on function public.update_commission_summary(
  uuid, numeric, numeric, date, numeric, numeric
) to authenticated;

-- Return only the allocation visible to the caller. GM/Finance receive both
-- recipient columns; a Sales & Pricing Officer receives only their own amount
-- and role label, even if they are the other recipient on the same quotation.
create or replace function public.commission_summary_rows(
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
  my_officer_name text
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
        array['super_admin', 'owner', 'admin', 'accountant']
      ) as can_manage,
      private.has_text_role(
        p_organization_id,
        array['sales_pricing_officer']
      ) as is_officer
  )
  select
    summary.id,
    summary.organization_id,
    summary.quotation_id,
    case when access.can_manage then summary.production_job_id else null end,
    summary.quotation_no,
    summary.project_name,
    summary.client_name,
    summary.grand_total,
    case
      when access.can_manage or summary.preparator_user_id = (select auth.uid())
        then summary.preparator_user_id
      else null
    end,
    case
      when access.can_manage or summary.preparator_user_id = (select auth.uid())
        then preparator_profile.full_name
      else null
    end,
    case
      when access.can_manage
        or summary.preparator_user_id = (select auth.uid())
        or summary.va_endorser_user_id = (select auth.uid())
        then summary.lead_endorser_user_id
      else null
    end,
    case
      when access.can_manage
        or summary.preparator_user_id = (select auth.uid())
        or summary.va_endorser_user_id = (select auth.uid())
        then summary.lead_endorsed_to_user_id
      else null
    end,
    case
      when access.can_manage
        or summary.preparator_user_id = (select auth.uid())
        or summary.va_endorser_user_id = (select auth.uid())
        then summary.lead_endorsement_at
      else null
    end,
    case
      when access.can_manage or summary.va_endorser_user_id = (select auth.uid())
        then summary.va_endorser_user_id
      else null
    end,
    case
      when access.can_manage or summary.va_endorser_user_id = (select auth.uid())
        then va_profile.full_name
      else null
    end,
    case
      when access.can_manage or summary.preparator_user_id = (select auth.uid())
        then summary.commission_rate
      else 0
    end,
    case
      when access.can_manage or summary.va_endorser_user_id = (select auth.uid())
        then summary.va_commission_rate
      else 0
    end,
    case
      when access.can_manage or summary.preparator_user_id = (select auth.uid())
        then coalesce(summary.sales_commission_markup_amount, summary.commission_amount)
      else 0
    end,
    case
      when access.can_manage or summary.va_endorser_user_id = (select auth.uid())
        then coalesce(summary.va_commission_markup_amount, summary.va_commission_amount)
      else 0
    end,
    case
      when access.can_manage or summary.preparator_user_id = (select auth.uid())
        then summary.sales_commission_markup_amount
      else null
    end,
    case
      when access.can_manage or summary.va_endorser_user_id = (select auth.uid())
        then summary.va_commission_markup_amount
      else null
    end,
    summary.commission_calculation_source,
    case when access.can_manage then summary.commission_markup_snapshot else null end,
    case when access.can_manage then summary.downpayment_amount else null end,
    case when access.can_manage then summary.receivable_balance else null end,
    case when access.can_manage then summary.payment_due_date else null end,
    summary.status,
    case when access.can_manage then summary.paid_at else null end,
    case when access.can_manage then summary.paid_by else null end,
    case when access.can_manage then summary.created_by else null end,
    summary.created_at,
    summary.updated_at,
    case
      when not access.can_manage
        and summary.preparator_user_id = (select auth.uid())
        and summary.va_endorser_user_id = (select auth.uid())
        then 'Sales and VA Commission'
      when not access.can_manage
        and summary.preparator_user_id = (select auth.uid())
        then 'Sales Commission'
      when not access.can_manage
        and summary.va_endorser_user_id = (select auth.uid())
        then 'VA Commission'
      else null
    end,
    case
      when not access.can_manage
        then (case when summary.preparator_user_id = (select auth.uid())
          then coalesce(summary.sales_commission_markup_amount, summary.commission_amount)
          else 0 end)
          + (case when summary.va_endorser_user_id = (select auth.uid())
            then coalesce(summary.va_commission_markup_amount, summary.va_commission_amount)
            else 0 end)
      else null
    end,
    case
      when not access.can_manage and summary.preparator_user_id = (select auth.uid())
        then coalesce(preparator_profile.full_name, 'Sales & Pricing Officer')
      when not access.can_manage and summary.va_endorser_user_id = (select auth.uid())
        then coalesce(va_profile.full_name, 'Sales & Pricing Officer')
      else null
    end
  from public.commission_summaries summary
  cross join access
  left join public.profiles preparator_profile
    on preparator_profile.id = summary.preparator_user_id
  left join public.profiles va_profile
    on va_profile.id = summary.va_endorser_user_id
  where summary.organization_id = p_organization_id
    and (
      access.can_manage
      or (
        access.is_officer
        and (
          summary.preparator_user_id = (select auth.uid())
          or summary.va_endorser_user_id = (select auth.uid())
        )
      )
    )
  order by summary.created_at desc, summary.quotation_no asc;
$$;

revoke all on function public.commission_summary_rows(uuid) from public;
grant execute on function public.commission_summary_rows(uuid) to authenticated;

-- Direct table reads no longer expose the other officer's allocation. The
-- public RPC above is the only client read path for the Commission page.
drop policy if exists "commission summaries: authorized read"
  on public.commission_summaries;
create policy "commission summaries: authorized read"
on public.commission_summaries for select to authenticated
using (
  (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ))
);

-- Fill rows that were already approved before the trigger existed. Existing
-- unpaid rows are reconciled to the approved costing snapshot; paid rows are
-- intentionally untouched as historical payout records.
do $$
declare
  v_quote record;
begin
  for v_quote in
    select quotation.id
    from public.quotations quotation
    where quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
      and exists (
        select 1
        from public.organization_members preparator_member
        where preparator_member.organization_id = quotation.organization_id
          and preparator_member.user_id = coalesce(
            quotation.prepared_by_user_id,
            quotation.created_by
          )
          and preparator_member.role::text = 'sales_pricing_officer'
      )
      and exists (
        select 1
        from public.commission_summaries summary
        where summary.organization_id = quotation.organization_id
          and summary.quotation_id = quotation.id
          and summary.status = 'not_yet_paid'
      )
    order by quotation.created_at, quotation.id
  loop
    perform private.ensure_commission_summary_from_approved_quotation(v_quote.id, 0);
  end loop;

  for v_quote in
    select quotation.id
    from public.quotations quotation
    where quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
      and exists (
        select 1
        from public.organization_members preparator_member
        where preparator_member.organization_id = quotation.organization_id
          and preparator_member.user_id = coalesce(
            quotation.prepared_by_user_id,
            quotation.created_by
          )
          and preparator_member.role::text = 'sales_pricing_officer'
      )
      and not exists (
        select 1
        from public.commission_summaries summary
        where summary.organization_id = quotation.organization_id
          and summary.quotation_id = quotation.id
      )
    order by quotation.created_at, quotation.id
  loop
    perform private.ensure_commission_summary_from_approved_quotation(v_quote.id, 0);
  end loop;
end;
$$;

commit;
