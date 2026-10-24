-- Reconcile historical Commission Summary rows with the allocation-based
-- Finance payout workflow without changing historical commission amounts or
-- paid payout history.
--
-- Run after 237_internal_finance_member_capability.sql and before relying on
-- the Finance Commission payouts page for legacy quotations. This migration
-- is intentionally server-side and idempotent. It does not run from the
-- application.

begin;

do $$
declare
  v_summary public.commission_summaries%rowtype;
  v_quote record;
  v_downpayment numeric;
  v_total numeric;
  v_origin_user_id uuid;
  v_co_worker_user_id uuid;
  v_origin_rate numeric;
  v_co_worker_rate numeric;
  v_self_handled boolean;
  v_is_shared_legacy boolean;
  v_summary_id uuid;
  v_error text;
  v_note text;
begin
  -- Existing summaries already contain the historical commission amount.
  -- Rebuild only missing/unpaid allocation state and leave paid or actively
  -- settled history untouched for manual review.
  for v_summary in
    select summary.*
    from public.commission_summaries summary
    where summary.status::text <> 'paid'
      and not exists (
        select 1
        from public.commission_summary_allocations allocation
        where allocation.commission_summary_id = summary.id
          and allocation.status = 'paid'
      )
      and not exists (
        select 1
        from public.finance_transactions transaction
        where transaction.organization_id = summary.organization_id
          and not coalesce(transaction.is_voided, false)
          and transaction.approval_status not in ('rejected', 'cancelled')
          and (
            transaction.commission_summary_id = summary.id
            or transaction.commission_allocation_id in (
              select allocation.id
              from public.commission_summary_allocations allocation
              where allocation.commission_summary_id = summary.id
            )
          )
      )
  loop
    begin
      if v_summary.va_endorser_user_id is not null
        or coalesce(v_summary.va_commission_rate, 0) <> 0
        or coalesce(v_summary.va_commission_markup_amount, 0) <> 0 then
        raise exception 'Legacy VA Commission data requires manual review';
      end if;

      v_total := round(coalesce(v_summary.sales_commission_markup_amount, v_summary.commission_amount, 0), 2);
      v_origin_user_id := null;
      v_co_worker_user_id := null;
      v_origin_rate := null;
      v_co_worker_rate := null;
      v_self_handled := false;
      v_is_shared_legacy := false;

      if v_summary.commission_handling_mode is not null then
        select rates.origin_rate, rates.coworker_rate, rates.self_handled
        into v_origin_rate, v_co_worker_rate, v_self_handled
        from private.commission_split_rates(v_summary.commission_split_option) rates;

        v_origin_user_id := v_summary.se_origin_user_id;
        v_co_worker_user_id := v_summary.commission_co_worker_user_id;
      else
        -- Match the legacy endorsement rule used by the existing allocation
        -- trigger. This preserves the old 60/40 relationship when it can be
        -- proven, otherwise the preparator receives the historical total.
        v_origin_user_id := v_summary.lead_endorser_user_id;
        v_co_worker_user_id := coalesce(v_summary.lead_endorsed_to_user_id, v_summary.preparator_user_id);
        v_is_shared_legacy := v_origin_user_id is not null
          and v_co_worker_user_id is not null
          and v_origin_user_id is distinct from v_co_worker_user_id
          and v_summary.lead_endorsed_to_user_id = v_summary.preparator_user_id
          and exists (
            select 1
            from public.organization_members member
            where member.organization_id = v_summary.organization_id
              and member.user_id = v_origin_user_id
              and member.role::text = 'sales_pricing_officer'
          )
          and exists (
            select 1
            from public.organization_members member
            where member.organization_id = v_summary.organization_id
              and member.user_id = v_co_worker_user_id
              and member.role::text = 'sales_pricing_officer'
          );

        if v_is_shared_legacy then
          v_origin_rate := 60;
          v_co_worker_rate := 40;
          v_self_handled := false;
        else
          v_origin_user_id := v_summary.preparator_user_id;
          v_co_worker_user_id := null;
          v_origin_rate := 100;
          v_co_worker_rate := 0;
          v_self_handled := true;
        end if;
      end if;

      if v_origin_user_id is null then
        raise exception 'Commission Summary is missing a valid Pricing Officer recipient';
      end if;

      -- Keep the quotation-side display consistent with the allocation that
      -- Finance will now see. The local setting is required by the existing
      -- assignment guard and is limited to this controlled migration.
      perform set_config('huswell.commission_assignment_rpc', 'on', true);
      update public.quotations
      set se_origin_user_id = v_origin_user_id,
          assigned_pricing_officer_user_id = case
            when v_self_handled then v_origin_user_id
            else v_co_worker_user_id
          end,
          commission_handling_mode = case
            when v_self_handled then 'self_handled'
            else 'shared'
          end,
          commission_co_worker_user_id = case
            when v_self_handled then null
            else v_co_worker_user_id
          end,
          commission_split_option = case
            when v_self_handled then 'self_handled_100_0'
            when v_origin_rate = 50 and v_co_worker_rate = 50 then '50_50'
            when v_origin_rate = 60 and v_co_worker_rate = 40 then '60_40'
            when v_origin_rate = 70 and v_co_worker_rate = 30 then '70_30'
            when v_origin_rate = 80 and v_co_worker_rate = 20 then '80_20'
            else null
          end
      where id = v_summary.quotation_id
        and status::text = 'approved';
      perform set_config('huswell.commission_assignment_rpc', 'off', true);

      if v_self_handled then
        delete from public.commission_summary_allocations allocation
        where allocation.commission_summary_id = v_summary.id
          and allocation.status <> 'paid'
          and allocation.allocation_role in ('originating_se', 'costing_se');

        perform private.upsert_commission_summary_allocation(
          v_summary.organization_id,
          v_summary.id,
          v_summary.quotation_id,
          'self_handled_se',
          v_origin_user_id,
          100,
          v_total
        );
      else
        if v_co_worker_user_id is null or v_origin_rate is null or v_co_worker_rate is null then
          raise exception 'Commission Summary is missing a valid Co-Worker division';
        end if;

        delete from public.commission_summary_allocations allocation
        where allocation.commission_summary_id = v_summary.id
          and allocation.status <> 'paid'
          and allocation.allocation_role = 'self_handled_se';

        perform private.upsert_commission_summary_allocation(
          v_summary.organization_id,
          v_summary.id,
          v_summary.quotation_id,
          'originating_se',
          v_origin_user_id,
          v_origin_rate,
          round(v_total * v_origin_rate / 100, 2)
        );
        perform private.upsert_commission_summary_allocation(
          v_summary.organization_id,
          v_summary.id,
          v_summary.quotation_id,
          'costing_se',
          v_co_worker_user_id,
          v_co_worker_rate,
          round(v_total - round(v_total * v_origin_rate / 100, 2), 2)
        );
      end if;

      if not exists (
        select 1
        from public.activity_log audit
        where audit.organization_id = v_summary.organization_id
          and audit.resource_type = 'commission_summary'
          and audit.resource_id = v_summary.id
          and audit.action = 'commission_allocations_reconciled'
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
          v_summary.organization_id,
          null,
          'commission_summary',
          v_summary.id,
          'commission_allocations_reconciled',
          jsonb_build_object(
            'migration', '238_reconcile_legacy_commission_allocations',
            'quotation_id', v_summary.quotation_id,
            'historical_commission_amount', v_total,
            'handling_mode', case when v_self_handled then 'self_handled' else 'shared' end,
            'origin_user_id', v_origin_user_id,
            'co_worker_user_id', v_co_worker_user_id,
            'origin_rate', v_origin_rate,
            'co_worker_rate', v_co_worker_rate
          ),
          'Historical Commission Summary reconciled into Finance payout allocations'
        );
      end if;
    exception when others then
      perform set_config('huswell.commission_assignment_rpc', 'off', true);
      get stacked diagnostics v_error = message_text;
      v_note := 'Migration 238 skipped this Commission Summary: ' || coalesce(v_error, 'unknown error');
      if not exists (
        select 1
        from public.activity_log audit
        where audit.organization_id = v_summary.organization_id
          and audit.resource_type = 'commission_summary'
          and audit.resource_id = v_summary.id
          and audit.action = 'commission_allocations_reconciliation_skipped'
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
          v_summary.organization_id,
          null,
          'commission_summary',
          v_summary.id,
          'commission_allocations_reconciliation_skipped',
          jsonb_build_object(
            'migration', '238_reconcile_legacy_commission_allocations',
            'quotation_id', v_summary.quotation_id,
            'reason', v_error
          ),
          v_note
        );
      end if;
    end;
  end loop;

  -- If an approved direct quotation has no summary at all, use the existing
  -- server-side calculator. It reads the saved quotation costing markup (or
  -- the legacy quotation rate), never the current GM defaults.
  for v_quote in
    select quotation.*
    from public.quotations quotation
    where quotation.document_type = 'price_quotation'
      and quotation.costing_source_id is null
      and quotation.status::text = 'approved'
      and not exists (
        select 1
        from public.commission_summaries summary
        where summary.organization_id = quotation.organization_id
          and summary.quotation_id = quotation.id
      )
  loop
    begin
      select round(coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0), 2)
      into v_downpayment
      from public.quotation_payment_records payment
      where payment.organization_id = v_quote.organization_id
        and payment.quotation_id = v_quote.id;

      select private.ensure_commission_summary_from_approved_quotation(
        v_quote.id,
        coalesce(v_downpayment, 0)
      ) into v_summary_id;

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
        'commission_summary_rebuilt',
        jsonb_build_object(
          'migration', '238_reconcile_legacy_commission_allocations',
          'commission_summary_id', v_summary_id,
          'quotation_id', v_quote.id
        ),
        'Missing Commission Summary rebuilt from the approved quotation''s saved commission data'
      );
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_note := 'Migration 238 could not rebuild this quotation Commission Summary: ' || coalesce(v_error, 'unknown error');
      if not exists (
        select 1
        from public.activity_log audit
        where audit.organization_id = v_quote.organization_id
          and audit.resource_type = 'quotation'
          and audit.resource_id = v_quote.id
          and audit.action = 'commission_summary_rebuild_skipped'
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
          'commission_summary_rebuild_skipped',
          jsonb_build_object(
            'migration', '238_reconcile_legacy_commission_allocations',
            'reason', v_error
          ),
          v_note
        );
      end if;
    end;
  end loop;
end;
$$;

commit;
