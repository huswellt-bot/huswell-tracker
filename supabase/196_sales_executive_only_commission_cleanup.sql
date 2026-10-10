-- Make Sales Executive commission allocations the only active commission
-- workflow. Run after 195_sales_executive_commission_split_and_ownership.sql
-- and before deploying the matching application update.
--
-- This migration intentionally does not drop legacy columns from the schema.
-- It removes their active settings, UI/RPC access, and write paths while
-- keeping the migration chain safe to roll back before live data verification.

begin;

-- Stop safely if the old feature was actually used. The application update
-- assumes there are no non-zero VA Commission records to recalculate.
do $$
begin
  if exists (
    select 1
    from public.commission_summaries summary
    where summary.va_endorser_user_id is not null
      or coalesce(summary.va_commission_rate, 0) <> 0
      or coalesce(summary.va_commission_markup_amount, 0) <> 0
  ) then
    raise exception 'VA Commission data exists; review it before running the Sales Executive-only cleanup';
  end if;

  if exists (
    select 1
    from public.price_quotation_costing_markups markup
    where private.canonical_pricing_markup_key(
      coalesce(nullif(btrim(markup.markup_key), ''), nullif(btrim(markup.label), ''), '')
    ) = 'va_commission'
    and greatest(coalesce(markup.rate, 0), coalesce(markup.amount, 0)) <> 0
  ) then
    raise exception 'Non-zero VA Commission costing markup exists; review it before cleanup';
  end if;

  if exists (
    select 1
    from public.finance_transactions transaction
    where transaction.commission_summary_id is not null
      and transaction.commission_allocation_id is null
  ) then
    raise exception 'Legacy commission Finance transactions exist; review them before cleanup';
  end if;

  if exists (
    select 1
    from public.commission_summaries summary
    where summary.status = 'paid'
      and not exists (
        select 1
        from public.commission_summary_allocations allocation
        where allocation.commission_summary_id = summary.id
      )
  ) then
    raise exception 'Paid legacy commission summaries exist; review them before cleanup';
  end if;
end;
$$;

-- Remove the old category from every active organization setting.
update public.business_settings
set pricing_markup_defaults = coalesce(pricing_markup_defaults, '{}'::jsonb) - 'va_commission',
    va_commission_default_rate = 0;

-- No insert or update may write the retired markup again.
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
    raise exception 'VA Commission has been removed. Use Sales Executive Commission.';
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_costing_markups_retired_va_guard
  on public.price_quotation_costing_markups;
create trigger price_quotation_costing_markups_retired_va_guard
before insert or update on public.price_quotation_costing_markups
for each row execute function private.reject_retired_va_markup();

-- Only External Finance owns the supplier-costing logbook. Internal Finance
-- continues to view the logbook and record the actual approved Money Out.
create or replace function public.create_supplier_payable(
  p_payable_id uuid,
  p_supplier_id uuid,
  p_quotation_id uuid,
  p_lead_id uuid,
  p_description text,
  p_amount numeric,
  p_due_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_lead_id uuid := p_lead_id;
  v_quotation public.quotations%rowtype;
  v_payable_no text;
begin
  select organization_id into v_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if v_organization_id is null
    or not private.has_text_role(v_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can record supplier costing';
  end if;
  if p_payable_id is null or p_supplier_id is null then
    raise exception 'Choose a supplier before recording supplier costing';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'Description is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Supplier costing amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id
      and supplier.organization_id = v_organization_id
  ) then
    raise exception 'The selected supplier does not belong to this workspace';
  end if;
  if p_quotation_id is not null then
    select * into v_quotation
    from public.quotations quotation
    where quotation.id = p_quotation_id
      and quotation.organization_id = v_organization_id;
    if not found then
      raise exception 'The selected quotation does not belong to this workspace';
    end if;
    if p_lead_id is not null
      and v_quotation.lead_id is not null
      and p_lead_id is distinct from v_quotation.lead_id then
      raise exception 'The selected Name / Company does not match the quotation';
    end if;
    v_lead_id := coalesce(p_lead_id, v_quotation.lead_id);
  end if;
  if v_lead_id is not null and not exists (
    select 1 from public.leads lead_row
    where lead_row.id = v_lead_id
      and lead_row.organization_id = v_organization_id
  ) then
    raise exception 'The selected Name / Company lead does not belong to this workspace';
  end if;

  v_payable_no := format(
    'SUP-%s-%s',
    to_char(current_date, 'YYYYMMDD'),
    upper(substr(replace(p_payable_id::text, '-', ''), 1, 6))
  );

  insert into public.supplier_payables (
    id, organization_id, supplier_id, payable_no, description, amount,
    amount_paid, due_date, status, notes, created_by, quotation_id, lead_id,
    confirmed_at, confirmed_by
  ) values (
    p_payable_id, v_organization_id, p_supplier_id, v_payable_no,
    btrim(p_description), round(p_amount, 2), 0, p_due_date, 'open',
    nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()),
    p_quotation_id, v_lead_id, now(), (select auth.uid())
  );
  return p_payable_id;
end;
$$;

revoke all on function public.create_supplier_payable(
  uuid, uuid, uuid, uuid, text, numeric, date, text
) from public, anon, authenticated;
grant execute on function public.create_supplier_payable(
  uuid, uuid, uuid, uuid, text, numeric, date, text
) to authenticated;

-- Commission Summary reads now come only from allocation rows. This removes
-- the old VA fields and legacy parent-summary fallback from the active API.
create or replace function public.commission_summary_rows_v3(
  p_organization_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  grand_total numeric,
  status text,
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
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance']
  ) as can_view_all
)
select
  summary.id,
  summary.organization_id,
  summary.quotation_id,
  summary.quotation_no,
  summary.project_name,
  summary.client_name,
  summary.grand_total,
  summary.status,
  summary.created_at,
  summary.updated_at,
  visible.my_type,
  coalesce(visible.my_amount, 0),
  visible.my_name,
  visible.allocation_rows
from public.commission_summaries summary
cross join access
left join lateral (
  select
    coalesce(
      jsonb_agg(
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
        ) order by allocation.allocation_role
      ),
      '[]'::jsonb
    ) as allocation_rows,
    round(coalesce(sum(allocation.amount) filter (
      where allocation.recipient_user_id = (select auth.uid())
    ), 0), 2) as my_amount,
    string_agg(
      case allocation.allocation_role
        when 'originating_se' then 'S.E. Origin'
        when 'costing_se' then 'Co-Worker'
        when 'self_handled_se' then 'Self-handled'
        else allocation.allocation_role
      end,
      ', ' order by allocation.allocation_role
    ) filter (where allocation.recipient_user_id = (select auth.uid())) as my_type,
    max(profile.full_name) filter (where allocation.recipient_user_id = (select auth.uid())) as my_name
  from public.commission_summary_allocations allocation
  left join public.profiles profile on profile.id = allocation.recipient_user_id
  where allocation.commission_summary_id = summary.id
    and (
      access.can_view_all
      or allocation.recipient_user_id = (select auth.uid())
    )
) visible on true
where summary.organization_id = p_organization_id
  and exists (
    select 1
    from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = summary.id
  )
  and (
    access.can_view_all
    or exists (
      select 1
      from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = summary.id
        and allocation.recipient_user_id = (select auth.uid())
    )
  )
order by summary.created_at desc, summary.quotation_no asc;
$$;

revoke all on function public.commission_summary_rows_v3(uuid) from public, anon, authenticated;
grant execute on function public.commission_summary_rows_v3(uuid) to authenticated;

-- Backfill the new allocation rows for any not-yet-paid summaries that were
-- created before 195. The trigger remains authoritative for all future rows.
drop trigger if exists commission_summary_allocations_sync
  on public.commission_summaries;
create trigger commission_summary_allocations_sync
after insert or update of preparator_user_id, lead_endorser_user_id,
  lead_endorsed_to_user_id, lead_endorsement_at, sales_commission_markup_amount,
  commission_rate, commission_calculation_source, grand_total
on public.commission_summaries
for each row execute function private.sync_commission_summary_allocations();

update public.commission_summaries
set commission_rate = commission_rate
where status <> 'paid'
  and preparator_user_id is not null;

-- A new Money Out may link only to an individual allocation. The old parent
-- commission_summary_id path is no longer accepted for new transactions.
create or replace function private.reject_legacy_commission_finance_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.commission_summary_id is not null
    and new.commission_allocation_id is null then
    raise exception 'Select a Sales Executive commission allocation instead of a legacy commission record';
  end if;
  if new.commission_allocation_id is not null
    and new.transaction_type <> 'expense' then
    raise exception 'Commission allocations can only be linked to Money Out';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_commission_allocation_only_guard
  on public.finance_transactions;
create trigger finance_transactions_commission_allocation_only_guard
before insert or update of commission_summary_id, commission_allocation_id,
  transaction_type on public.finance_transactions
for each row execute function private.reject_legacy_commission_finance_link();

-- Disable old public commission-summary views and payout/edit RPCs. The new
-- allocation API and Finance transaction RPC remain available.
revoke all on function public.commission_summary_rows(uuid) from public, anon, authenticated;
revoke all on function public.commission_summary_rows_v2(uuid) from public, anon, authenticated;
revoke all on function public.save_commission_defaults(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.update_commission_summary(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.update_commission_summary(uuid, numeric, numeric, date, numeric, numeric) from public, anon, authenticated;
revoke all on function public.mark_commission_summary_paid(uuid) from public, anon, authenticated;
revoke all on function public.undo_commission_summary_paid(uuid, text) from public, anon, authenticated;

commit;
