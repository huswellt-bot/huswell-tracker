-- The production-confirmation guard is only applicable to commission payouts.
-- Ordinary Cash In/Cash Out rows must not be rejected because they have no
-- commission allocation or commission summary.
create or replace function private.enforce_commission_production_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation_id uuid;
begin
  if new.commission_allocation_id is null
    and new.commission_summary_id is null then
    return new;
  end if;

  -- Preserve immutable paid history when an unrelated finance field is edited.
  if tg_op = 'UPDATE'
    and old.payment_status = 'paid'
    and new.payment_status = 'paid'
    and old.commission_allocation_id is not distinct from new.commission_allocation_id
    and old.commission_summary_id is not distinct from new.commission_summary_id then
    return new;
  end if;

  if new.commission_allocation_id is not null then
    select allocation.quotation_id
    into v_quotation_id
    from public.commission_summary_allocations allocation
    where allocation.id = new.commission_allocation_id
      and allocation.organization_id = new.organization_id;
  elsif new.commission_summary_id is not null then
    select summary.quotation_id
    into v_quotation_id
    from public.commission_summaries summary
    where summary.id = new.commission_summary_id
      and summary.organization_id = new.organization_id;
  end if;

  if v_quotation_id is null
    or not private.commission_quotation_is_production_confirmed(new.organization_id, v_quotation_id) then
    raise exception 'Commission payouts require an approved Production schedule';
  end if;

  return new;
end;
$$;
