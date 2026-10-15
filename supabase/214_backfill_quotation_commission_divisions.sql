-- Set the default commission division and migrate legacy approved quotations.
--
-- Run after 213_quotation_commission_assignment_and_split.sql and before
-- deploying the matching Price Quotation and Finance workspace update.
-- This migration is additive and intentionally does not run against the live
-- database from the application.
--
-- Historical approved quotations are classified from their existing
-- Commission Summary/preparator and endorsement data:
--   * valid legacy S.E. Origin + preparator pair -> shared 60/40;
--   * otherwise a valid Sales & Pricing Officer preparator -> self-handled
--     100/0.
--
-- Paid or active commission payout history, legacy VA commission data, and
-- officer data that cannot satisfy the current assignment rules are left
-- unchanged and recorded in activity_log for manual review. A missing summary
-- is rebuilt through the existing server-side summary function so the
-- quotation and its allocation data stay together.

begin;

-- 60/40 is the default for a shared commission. Self-handled quotations set
-- self_handled_100_0 explicitly through the quotation workflow.
alter table public.quotations
  alter column commission_split_option set default '60_40';

alter table public.commission_summaries
  alter column commission_split_option set default '60_40';

do $$
declare
  v_quote record;
  v_summary public.commission_summaries%rowtype;
  v_lead public.leads%rowtype;
  v_summary_found boolean;
  v_preparator_user_id uuid;
  v_origin_candidate uuid;
  v_co_worker_candidate uuid;
  v_origin_role text;
  v_co_worker_role text;
  v_preparator_role text;
  v_origin_user_id uuid;
  v_co_worker_user_id uuid;
  v_assigned_user_id uuid;
  v_handling_mode text;
  v_split_option text;
  v_reason text;
  v_error text;
  v_note text;
  v_summary_id uuid;
  v_downpayment_amount numeric;
begin
  for v_quote in
    select
      quotation.id,
      quotation.organization_id,
      quotation.lead_id,
      quotation.quotation_no,
      quotation.project_types,
      quotation.created_by,
      quotation.prepared_by_user_id
    from public.quotations quotation
    where quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
      and quotation.commission_handling_mode is null
    order by quotation.created_at, quotation.id
    for update
  loop
    v_summary := null;
    v_lead := null;
    v_summary_found := false;
    v_preparator_user_id := null;
    v_origin_candidate := null;
    v_co_worker_candidate := null;
    v_origin_role := null;
    v_co_worker_role := null;
    v_preparator_role := null;
    v_origin_user_id := null;
    v_co_worker_user_id := null;
    v_assigned_user_id := null;
    v_handling_mode := null;
    v_split_option := null;
    v_reason := null;
    v_error := null;
    v_note := null;
    v_summary_id := null;
    v_downpayment_amount := 0;

    select summary.*
      into v_summary
    from public.commission_summaries summary
    where summary.organization_id = v_quote.organization_id
      and summary.quotation_id = v_quote.id
    for update;
    v_summary_found := found;

    if v_reason is null
      and v_summary_found
      and (
        v_summary.status = 'paid'
        or exists (
          select 1
          from public.commission_summary_allocations allocation
          where allocation.commission_summary_id = v_summary.id
            and allocation.status = 'paid'
        )
        or exists (
          select 1
          from public.finance_transactions transaction
          where transaction.organization_id = v_quote.organization_id
            and not coalesce(transaction.is_voided, false)
            and transaction.approval_status not in ('rejected', 'cancelled')
            and (
              transaction.commission_summary_id = v_summary.id
              or transaction.commission_allocation_id in (
                select allocation.id
                from public.commission_summary_allocations allocation
                where allocation.commission_summary_id = v_summary.id
              )
            )
        )
      ) then
      v_reason := 'Commission Summary or one of its allocations already has paid or active payout history';
    end if;

    if v_reason is null
      and v_summary_found
      and (
        v_summary.va_endorser_user_id is not null
        or coalesce(v_summary.va_commission_rate, 0) <> 0
        or coalesce(v_summary.va_commission_markup_amount, 0) <> 0
      ) then
      v_reason := 'Legacy VA Commission data requires manual review';
    end if;

    if v_reason is null then
      if v_quote.lead_id is not null then
        select lead_row.*
          into v_lead
        from public.leads lead_row
        where lead_row.id = v_quote.lead_id
          and lead_row.organization_id = v_quote.organization_id;
      end if;

      if not v_summary_found then
        select round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2)
          into v_downpayment_amount
        from public.quotation_payment_records payment
        where payment.organization_id = v_quote.organization_id
          and payment.quotation_id = v_quote.id;
      end if;

      v_preparator_user_id := coalesce(
        v_summary.preparator_user_id,
        v_quote.prepared_by_user_id,
        v_quote.created_by
      );
      v_origin_candidate := coalesce(
        v_summary.lead_endorser_user_id,
        v_lead.endorsed_by
      );
      v_co_worker_candidate := coalesce(
        v_summary.lead_endorsed_to_user_id,
        v_lead.endorsed_to,
        v_summary.preparator_user_id,
        v_quote.prepared_by_user_id,
        v_quote.created_by
      );

      select member.role::text
        into v_origin_role
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_origin_candidate
      limit 1;

      select member.role::text
        into v_co_worker_role
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_co_worker_candidate
      limit 1;

      select member.role::text
        into v_preparator_role
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_preparator_user_id
      limit 1;

      -- Match the old commission trigger's shared rule: the endorsement
      -- origin and the preparing officer must both be active S&P Officers,
      -- and the endorsed-to officer must be the preparator.
      if v_origin_candidate is not null
        and v_origin_candidate is distinct from v_preparator_user_id
        and coalesce(v_summary.lead_endorsed_to_user_id, v_lead.endorsed_to) is not null
        and v_co_worker_candidate is not null
        and v_co_worker_candidate is not distinct from v_preparator_user_id
        and v_origin_role = 'sales_pricing_officer'
        and v_co_worker_role = 'sales_pricing_officer' then
        v_origin_user_id := v_origin_candidate;
        v_co_worker_user_id := v_co_worker_candidate;
        v_assigned_user_id := v_co_worker_candidate;
        v_handling_mode := 'shared';
        v_split_option := '60_40';
      elsif v_preparator_role = 'sales_pricing_officer' then
        v_origin_user_id := v_preparator_user_id;
        v_assigned_user_id := v_preparator_user_id;
        v_handling_mode := 'self_handled';
        v_split_option := 'self_handled_100_0';
      else
        v_reason := 'No valid Sales & Pricing Officer preparator or legacy shared pair was found';
      end if;
    end if;

    if v_reason is not null then
      v_note := 'Migration 214 skipped this quotation: ' || v_reason;
      if not exists (
        select 1
        from public.activity_log audit
        where audit.organization_id = v_quote.organization_id
          and audit.resource_type = 'quotation'
          and audit.resource_id = v_quote.id
          and audit.action = 'commission_assignment_backfill_skipped'
          and audit.note = v_note
      ) then
        insert into public.activity_log (
          organization_id,
          actor_id,
          resource_type,
          resource_id,
          action,
          after_data,
          note
        ) values (
          v_quote.organization_id,
          null,
          'quotation',
          v_quote.id,
          'commission_assignment_backfill_skipped',
          jsonb_build_object(
            'migration', '214_backfill_quotation_commission_divisions',
            'reason', v_reason,
            'legacy_preparator_user_id', v_preparator_user_id,
            'legacy_origin_user_id', v_origin_candidate,
            'legacy_co_worker_user_id', v_co_worker_candidate
          ),
          v_note
        );
      end if;
      continue;
    end if;

    begin
      -- Migration 213 protects assignment columns from direct client writes.
      -- This transaction-local marker is limited to this controlled migration.
      perform set_config('huswell.commission_assignment_rpc', 'on', true);

      update public.quotations
      set se_origin_user_id = v_origin_user_id,
          assigned_pricing_officer_user_id = v_assigned_user_id,
          commission_handling_mode = v_handling_mode,
          commission_co_worker_user_id = case
            when v_handling_mode = 'shared' then v_co_worker_user_id
            else null
          end,
          commission_split_option = v_split_option
      where id = v_quote.id;

      if v_summary_found then
        update public.commission_summaries
        set preparator_user_id = v_assigned_user_id,
            commission_calculation_source = 'sales_executive_split',
            va_endorser_user_id = null,
            va_commission_rate = 0,
            va_commission_markup_amount = 0,
            se_origin_user_id = v_origin_user_id,
            commission_co_worker_user_id = case
              when v_handling_mode = 'shared' then v_co_worker_user_id
              else null
            end,
            commission_handling_mode = v_handling_mode,
            commission_split_option = v_split_option,
            commission_markup_snapshot = coalesce(
              commission_markup_snapshot,
              '{}'::jsonb
            ) || jsonb_build_object(
              'commission_handling_mode', v_handling_mode,
              'commission_split_option', v_split_option,
              'se_origin_user_id', v_origin_user_id,
              'commission_co_worker_user_id', case
                when v_handling_mode = 'shared' then v_co_worker_user_id
                else null
              end,
              'backfilled_by_migration', '214_backfill_quotation_commission_divisions'
            )
        where organization_id = v_quote.organization_id
          and quotation_id = v_quote.id
        returning id into v_summary_id;
      else
        select private.ensure_commission_summary_from_approved_quotation(
          v_quote.id,
          v_downpayment_amount
        ) into v_summary_id;
      end if;

      perform set_config('huswell.commission_assignment_rpc', 'off', true);

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
        v_quote.organization_id,
        null,
        'quotation',
        v_quote.id,
        'commission_assignment_backfilled',
        jsonb_build_object(
          'commission_handling_mode', null,
          'commission_split_option', null,
          'se_origin_user_id', v_origin_candidate,
          'commission_co_worker_user_id', v_co_worker_candidate,
          'preparator_user_id', v_preparator_user_id
        ),
        jsonb_build_object(
          'migration', '214_backfill_quotation_commission_divisions',
          'commission_handling_mode', v_handling_mode,
          'commission_split_option', v_split_option,
          'se_origin_user_id', v_origin_user_id,
          'commission_co_worker_user_id', case
            when v_handling_mode = 'shared' then v_co_worker_user_id
            else null
          end,
          'assigned_pricing_officer_user_id', v_assigned_user_id,
          'commission_summary_id', v_summary_id
        ),
        'Legacy approved quotation classified by migration 214'
      );
    exception when others then
      perform set_config('huswell.commission_assignment_rpc', 'off', true);
      get stacked diagnostics v_error = message_text;
      v_note := 'Migration 214 skipped this quotation after a transactional error: ' || coalesce(v_error, 'unknown error');
      if not exists (
        select 1
        from public.activity_log audit
        where audit.organization_id = v_quote.organization_id
          and audit.resource_type = 'quotation'
          and audit.resource_id = v_quote.id
          and audit.action = 'commission_assignment_backfill_skipped'
          and audit.note = v_note
      ) then
        insert into public.activity_log (
          organization_id,
          actor_id,
          resource_type,
          resource_id,
          action,
          after_data,
          note
        ) values (
          v_quote.organization_id,
          null,
          'quotation',
          v_quote.id,
          'commission_assignment_backfill_skipped',
          jsonb_build_object(
            'migration', '214_backfill_quotation_commission_divisions',
            'reason', v_note,
            'legacy_preparator_user_id', v_preparator_user_id,
            'legacy_origin_user_id', v_origin_candidate,
            'legacy_co_worker_user_id', v_co_worker_candidate
          ),
          v_note
        );
      end if;
    end;
  end loop;
end;
$$;

commit;
