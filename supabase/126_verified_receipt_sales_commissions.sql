-- Earn Sales Executive / Sales & Pricing Officer commissions from verified
-- quotation receipts. Commission uses the VAT-exclusive quotation subtotal.
-- Run after 125_enforce_quotation_payment_amounts.sql.
-- Safe to re-run.

begin;

alter table public.business_settings
  alter column sales_commission_tiers
  set default '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb;

-- Move organizations still using the previous shipped default to the agreed
-- policy without overwriting a tier set that was intentionally customized.
update public.business_settings
set sales_commission_tiers = '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
where sales_commission_tiers = '[{"up_to":400000,"rate":3},{"up_to":null,"rate":5}]'::jsonb;

alter table public.quotations
  add column if not exists commission_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists sales_commission_tiers_snapshot jsonb;

create index if not exists quotations_commission_owner_idx
  on public.quotations (organization_id, commission_owner_user_id)
  where commission_owner_user_id is not null;

create or replace function private.quotation_sales_commission_owner(
  p_organization_id uuid,
  p_pricing_reviewer_id uuid,
  p_submitted_by uuid,
  p_prepared_by_user_id uuid,
  p_created_by uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select candidate.user_id
  from unnest(array[
    p_pricing_reviewer_id,
    p_submitted_by,
    p_prepared_by_user_id,
    p_created_by
  ]) with ordinality as candidate(user_id, priority)
  join public.organization_members member
    on member.organization_id = p_organization_id
   and member.user_id = candidate.user_id
  where candidate.user_id is not null
    and member.role::text in ('project_manager', 'sales_pricing_officer')
  order by candidate.priority
  limit 1;
$$;

revoke all on function private.quotation_sales_commission_owner(uuid, uuid, uuid, uuid, uuid) from public;

create or replace function public.capture_quotation_sales_commission_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tiers jsonb;
begin
  if new.document_type = 'price_quotation'
    and new.costing_source_id is null
    and new.status::text = 'approved' then
    if new.commission_owner_user_id is null then
      new.commission_owner_user_id := private.quotation_sales_commission_owner(
        new.organization_id,
        new.pricing_reviewed_by,
        new.submitted_by,
        new.prepared_by_user_id,
        new.created_by
      );
    end if;

    if new.sales_commission_tiers_snapshot is null then
      select settings.sales_commission_tiers
      into v_tiers
      from public.business_settings settings
      where settings.organization_id = new.organization_id;
      new.sales_commission_tiers_snapshot := coalesce(
        v_tiers,
        '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists quotation_sales_commission_owner on public.quotations;
create trigger quotation_sales_commission_owner
before insert or update on public.quotations
for each row execute function public.capture_quotation_sales_commission_owner();

-- Capture current ownership and tiers for already-approved direct quotations.
update public.quotations quote
set commission_owner_user_id = coalesce(
      quote.commission_owner_user_id,
      private.quotation_sales_commission_owner(
        quote.organization_id,
        quote.pricing_reviewed_by,
        quote.submitted_by,
        quote.prepared_by_user_id,
        quote.created_by
      )
    ),
    sales_commission_tiers_snapshot = coalesce(
      quote.sales_commission_tiers_snapshot,
      settings.sales_commission_tiers,
      '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
    )
from public.business_settings settings
where settings.organization_id = quote.organization_id
  and quote.document_type = 'price_quotation'
  and quote.costing_source_id is null
  and quote.status::text = 'approved'
  and (
    quote.commission_owner_user_id is null
    or quote.sales_commission_tiers_snapshot is null
  );

create or replace function private.calculate_sales_commission(
  p_amount numeric,
  p_tiers jsonb
)
returns numeric
language sql
stable
set search_path = public, private
as $$
  select round(coalesce(sum(
    (
      case
        when tier.value->>'up_to' is null then greatest(greatest(coalesce(p_amount, 0), 0) - coalesce(previous.cap, 0), 0)
        else greatest(least(greatest(coalesce(p_amount, 0), 0), (tier.value->>'up_to')::numeric) - coalesce(previous.cap, 0), 0)
      end
    ) * coalesce((tier.value->>'rate')::numeric, 0) / 100
  ), 0), 2)
  from jsonb_array_elements(coalesce(
    p_tiers,
    '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
  )) with ordinality as tier(value, ordinal)
  left join lateral (
    select max((prior.value->>'up_to')::numeric) as cap
    from jsonb_array_elements(coalesce(
      p_tiers,
      '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
    )) with ordinality as prior(value, ordinal)
    where prior.ordinal < tier.ordinal
      and prior.value->>'up_to' is not null
  ) previous on true;
$$;

revoke all on function private.calculate_sales_commission(numeric, jsonb) from public;

drop function if exists public.sales_project_officer_commissions();
create function public.sales_project_officer_commissions()
returns table (
  organization_id uuid,
  officer_user_id uuid,
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  quoted_amount numeric,
  paid_amount numeric,
  commissionable_paid_amount numeric,
  pending_payment_amount numeric,
  payment_status text,
  projected_commission numeric,
  earned_commission numeric,
  paid_out_commission numeric,
  payable_commission numeric,
  payout_status text,
  last_verified_at timestamptz
)
language sql
stable
security definer
set search_path = public, private
as $$
  with receipt_collections as (
    select
      payment.quotation_id,
      coalesce(sum(payment.amount) filter (where payment.status = 'verified'), 0) as verified_paid,
      coalesce(sum(payment.amount) filter (where payment.status = 'pending'), 0) as pending_paid,
      max(payment.verified_at) filter (where payment.status = 'verified') as last_verified_at,
      count(*) > 0 as has_receipts
    from public.quotation_payment_records payment
    group by payment.quotation_id
  ),
  legacy_collections as (
    select
      invoice.quotation_id,
      coalesce(sum(payment.amount) filter (where payment.reversed_at is null), 0) as paid_amount
    from public.invoices invoice
    left join public.payments payment on payment.invoice_id = invoice.id
    where invoice.quotation_id is not null
      and invoice.status <> 'void'
    group by invoice.quotation_id
  ),
  commission_payouts as (
    select payout.quotation_id, coalesce(sum(payout.amount), 0) as paid_out
    from public.sales_commission_payouts payout
    group by payout.quotation_id
  ),
  base as (
    select
      quote.organization_id,
      quote.commission_owner_user_id as officer_user_id,
      quote.id as quotation_id,
      quote.quotation_no,
      quote.project_name,
      quote.client_name,
      round(greatest(coalesce(quote.subtotal, 0), 0), 2) as quoted_amount,
      round(greatest(coalesce(quote.total_amount, 0), 0), 2) as quotation_total,
      round(least(
        case
          when coalesce(receipt.has_receipts, false) then coalesce(receipt.verified_paid, 0)
          else coalesce(legacy.paid_amount, 0)
        end,
        greatest(coalesce(quote.total_amount, 0), 0)
      ), 2) as paid_amount,
      round(coalesce(receipt.pending_paid, 0), 2) as pending_payment_amount,
      receipt.last_verified_at,
      coalesce(
        quote.sales_commission_tiers_snapshot,
        settings.sales_commission_tiers,
        '[{"up_to":300000,"rate":3},{"up_to":null,"rate":5}]'::jsonb
      ) as tiers,
      round(coalesce(payout.paid_out, 0), 2) as paid_out_commission
    from public.quotations quote
    left join receipt_collections receipt on receipt.quotation_id = quote.id
    left join legacy_collections legacy on legacy.quotation_id = quote.id
    left join commission_payouts payout on payout.quotation_id = quote.id
    left join public.business_settings settings on settings.organization_id = quote.organization_id
    where quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and quote.status::text = 'approved'
      and quote.commission_owner_user_id is not null
      and (
        private.has_text_role(quote.organization_id, array['super_admin', 'owner', 'admin'])
        or (
          private.has_text_role(quote.organization_id, array['project_manager', 'pricing_officer'])
          and quote.commission_owner_user_id = (select auth.uid())
        )
      )
  ),
  amounts as (
    select
      base.*,
      round(
        case
          when base.quotation_total > 0 then least(
            base.quoted_amount,
            base.quoted_amount * base.paid_amount / base.quotation_total
          )
          else 0
        end,
        2
      ) as commissionable_paid_amount
    from base
  ),
  calculated as (
    select
      amounts.*,
      private.calculate_sales_commission(amounts.quoted_amount, amounts.tiers) as projected_commission,
      private.calculate_sales_commission(amounts.commissionable_paid_amount, amounts.tiers) as earned_commission
    from amounts
  )
  select
    calculated.organization_id,
    calculated.officer_user_id,
    calculated.quotation_id,
    calculated.quotation_no,
    calculated.project_name,
    calculated.client_name,
    calculated.quoted_amount,
    calculated.paid_amount,
    calculated.commissionable_paid_amount,
    calculated.pending_payment_amount,
    case
      when calculated.paid_amount >= calculated.quotation_total and calculated.quotation_total > 0 then 'paid'
      when calculated.paid_amount > 0 then 'partially_paid'
      when calculated.pending_payment_amount > 0 then 'pending_review'
      else 'unpaid'
    end,
    calculated.projected_commission,
    calculated.earned_commission,
    calculated.paid_out_commission,
    round(greatest(calculated.earned_commission - calculated.paid_out_commission, 0), 2),
    case
      when calculated.paid_out_commission > calculated.earned_commission then 'overpaid'
      when calculated.earned_commission <= 0 then 'not_earned'
      when calculated.paid_out_commission >= calculated.earned_commission then 'paid'
      when calculated.paid_out_commission > 0 then 'partially_paid'
      else 'payable'
    end,
    calculated.last_verified_at
  from calculated;
$$;

create or replace function public.mark_sales_commission_paid(
  p_quotation_id uuid,
  p_amount numeric,
  p_reference_no text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_earned numeric;
  v_paid_out numeric;
  v_payable numeric;
  v_id uuid;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved direct Price Quotation can have commission paid';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can mark commission paid';
  end if;
  if v_quote.commission_owner_user_id is null then
    raise exception 'This quotation does not have an eligible commission owner';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a commission payout amount with no more than two decimal places';
  end if;

  select commission.earned_commission, commission.paid_out_commission
  into v_earned, v_paid_out
  from public.sales_project_officer_commissions() commission
  where commission.quotation_id = v_quote.id;

  v_payable := round(greatest(coalesce(v_earned, 0) - coalesce(v_paid_out, 0), 0), 2);
  if v_payable <= 0 then
    raise exception 'There is no earned unpaid commission for this quotation';
  end if;
  if round(p_amount, 2) > v_payable then
    raise exception 'Commission payout cannot exceed the earned unpaid amount of %', v_payable;
  end if;

  insert into public.sales_commission_payouts (
    organization_id,
    quotation_id,
    officer_user_id,
    amount,
    reference_no,
    notes,
    paid_by
  )
  values (
    v_quote.organization_id,
    v_quote.id,
    v_quote.commission_owner_user_id,
    round(p_amount, 2),
    nullif(btrim(coalesce(p_reference_no, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.sales_project_officer_commissions() from public;
revoke all on function public.mark_sales_commission_paid(uuid, numeric, text, text) from public;
grant execute on function public.sales_project_officer_commissions() to authenticated;
grant execute on function public.mark_sales_commission_paid(uuid, numeric, text, text) to authenticated;

commit;

-- Rollback: restore the commission functions from migrations 107 and 108,
-- then remove the quotation snapshot columns only after dependent app code is removed.
