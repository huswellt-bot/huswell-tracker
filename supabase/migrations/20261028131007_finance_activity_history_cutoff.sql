-- Start the Finance Activity History at this rollout without deleting any
-- historical Finance, commission, or budget records.
alter table public.business_settings
  add column if not exists finance_activity_history_started_at timestamptz
    not null default now();

create or replace function public.get_finance_activity_history(
  p_organization_id uuid
)
returns table(
  id uuid,
  activity_at timestamptz,
  activity text,
  status text,
  amount numeric,
  source_account text,
  destination_account text,
  performed_by text
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_started_at timestamptz := '2026-10-28 13:09:49+00'::timestamptz;
begin
  if p_organization_id is null or not private.finance_is_budget_viewer(p_organization_id) then
    raise exception 'Only the General Manager or Internal Finance can view Finance activity history';
  end if;

  select coalesce(settings.finance_activity_history_started_at, v_started_at)
  into v_started_at
  from public.business_settings settings
  where settings.organization_id = p_organization_id;

  return query
  select grant_row.id, grant_row.granted_at,
    case when grant_row.grant_type = 'initial' then 'Budget top-up' else 'Budget top-up' end,
    grant_row.grant_type, grant_row.amount, null::text, null::text,
    coalesce(profile.full_name, '—')
  from public.finance_budget_grants grant_row
  left join public.profiles profile on profile.id = grant_row.granted_by
  where grant_row.organization_id = p_organization_id
    and grant_row.granted_at >= v_started_at

  union all

  select event.id, event.created_at,
    case event.event_type
      when 'allocation' then 'Budget allocation'
      when 'reallocation_out' then 'Budget reallocation out'
      when 'reallocation_in' then 'Budget reallocation in'
      when 'return_to_pool' then 'Budget returned to pool'
      else 'Budget allocation activity'
    end,
    'completed', event.amount,
    from_account.account_name, to_account.account_name,
    coalesce(profile.full_name, '—')
  from public.finance_account_budget_allocation_events event
  left join public.finance_accounts from_account on from_account.id = event.from_account_id
  left join public.finance_accounts to_account on to_account.id = event.to_account_id
  left join public.profiles profile on profile.id = event.created_by
  where event.organization_id = p_organization_id
    and event.created_at >= v_started_at

  union all

  select transaction.id, transaction.updated_at,
    case when transaction.transaction_type = 'income' then 'Cash In' else 'Cash Out' end,
    case
      when transaction.is_voided then 'voided'
      when transaction.transaction_type = 'income' then coalesce(nullif(transaction.income_review_status, 'none'), transaction.payment_status)
      when transaction.payment_status = 'paid' and transaction.approval_status = 'approved' then 'paid'
      else transaction.approval_status
    end,
    transaction.amount, account.account_name, null::text,
    coalesce(paid_profile.full_name, approved_profile.full_name, submitted_profile.full_name, '—')
  from public.finance_transactions transaction
  left join public.finance_accounts account on account.id = transaction.account_id
  left join public.profiles paid_profile on paid_profile.id = transaction.paid_by
  left join public.profiles approved_profile on approved_profile.id = transaction.approved_by
  left join public.profiles submitted_profile on submitted_profile.id = transaction.submitted_by
  where transaction.organization_id = p_organization_id
    and transaction.updated_at >= v_started_at

  union all

  select request.id, coalesce(request.decided_at, request.requested_at),
    'Account funding request', request.status,
    coalesce(request.approved_amount, request.requested_amount),
    account.account_name, null::text,
    coalesce(decider.full_name, requester.full_name, '—')
  from public.finance_account_funding_requests request
  left join public.finance_accounts account on account.id = request.account_id
  left join public.profiles decider on decider.id = request.decided_by
  left join public.profiles requester on requester.id = request.requested_by
  where request.organization_id = p_organization_id
    and coalesce(request.decided_at, request.requested_at) >= v_started_at

  union all

  select log.id, log.created_at, 'Commission activity', log.action,
    coalesce(nullif(log.after_data->>'sales_commission_markup_amount', '')::numeric, 0)
      + coalesce(nullif(log.after_data->>'va_commission_markup_amount', '')::numeric, 0),
    null::text, null::text, coalesce(profile.full_name, '—')
  from public.activity_log log
  left join public.profiles profile on profile.id = log.actor_id
  where log.organization_id = p_organization_id
    and log.resource_type = 'commission_summary'
    and log.created_at >= v_started_at;
end;
$$;

revoke all on function public.get_finance_activity_history(uuid) from public, anon;
grant execute on function public.get_finance_activity_history(uuid) to authenticated;
