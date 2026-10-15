-- Store the two approved quotation payment-term options on the quotation
-- itself. The Sales & Pricing Officer chooses the option in the Quotation
-- Review Queue; the General Manager may edit it during review; approval locks
-- the option and records the confirmation timestamp used by the PDC wording.
-- Run after 206_finance_automatic_budget_pool.sql and before the matching
-- application update. Safe to re-run except when legacy payment records use
-- a non-50% target; that case stops so payment history is not reinterpreted.

begin;

alter table public.quotations
  add column if not exists payment_terms_option text not null default 'completion_50_50',
  add column if not exists pdc_term_days integer not null default 30,
  add column if not exists payment_terms_confirmed_at timestamptz;

do $$
begin
  if exists (
    select 1
    from public.quotations quote
    where (
      quote.payment_requirement is distinct from 'downpayment'
      or quote.downpayment_rate is distinct from 50
    )
      and exists (
        select 1
        from public.quotation_payment_records payment
        where payment.quotation_id = quote.id
      )
  ) then
    raise exception 'Cannot move quotation payment terms to the fixed 50/50 options while affected payment records exist';
  end if;
end;
$$;

drop trigger if exists quotation_payment_terms_guard on public.quotations;

-- Existing quotations use the new completion option by default. Historical
-- approved quotations are treated as already confirmed, but their receipt
-- history is not modified.
update public.quotations
set payment_requirement = 'downpayment',
    downpayment_rate = 50,
    payment_terms_option = case
      when payment_terms_option in ('completion_50_50', 'pdc_50_50')
        then payment_terms_option
      else 'completion_50_50'
    end,
    pdc_term_days = case
      when pdc_term_days in (15, 30, 60) then pdc_term_days
      else 30
    end,
    payment_terms_confirmed_at = case
      when status::text = 'approved'
        then coalesce(payment_terms_confirmed_at, approved_at, now())
      else null
    end;

alter table public.quotations
  drop constraint if exists quotations_payment_requirement_downpayment_only_check,
  drop constraint if exists quotations_downpayment_rate_positive_check,
  drop constraint if exists quotations_downpayment_rate_fixed_50_check,
  drop constraint if exists quotations_payment_terms_option_check,
  drop constraint if exists quotations_pdc_term_days_check;

alter table public.quotations
  add constraint quotations_payment_requirement_downpayment_only_check
    check (payment_requirement = 'downpayment'),
  add constraint quotations_downpayment_rate_fixed_50_check
    check (downpayment_rate = 50),
  add constraint quotations_payment_terms_option_check
    check (payment_terms_option in ('completion_50_50', 'pdc_50_50')),
  add constraint quotations_pdc_term_days_check
    check (pdc_term_days in (15, 30, 60));

create or replace function public.enforce_quotation_payment_terms()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_sync boolean := coalesce(current_setting('huswell.quotation_payment_terms_sync', true), '') = 'on';
  v_old_status text := case when tg_op = 'UPDATE' then old.status::text else null end;
  v_term_changed boolean := tg_op = 'UPDATE' and (
    new.payment_requirement is distinct from old.payment_requirement
    or new.downpayment_rate is distinct from old.downpayment_rate
    or new.payment_terms_option is distinct from old.payment_terms_option
    or new.pdc_term_days is distinct from old.pdc_term_days
  );
begin
  if new.payment_terms_option is null then
    new.payment_terms_option := 'completion_50_50';
  end if;
  if new.payment_terms_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if new.pdc_term_days is null or new.pdc_term_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;

  if v_term_changed
    and not v_sync
    and not (
      private.has_text_role(new.organization_id, array['super_admin', 'owner', 'admin'])
      or (
        new.status::text in ('draft', 'needs_revision')
        and (
          new.created_by = (select auth.uid())
          or new.prepared_by_user_id = (select auth.uid())
          or new.submitted_by = (select auth.uid())
          or private.is_pricing_officer_assigned(
            new.organization_id,
            (select auth.uid()),
            new.project_types
          )
        )
      )
    ) then
    raise exception 'Only the quotation preparer or General Manager can change payment terms before approval';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_terms_confirmed_at is not null
    and v_term_changed
    and not v_sync then
    raise exception 'Payment terms are locked after General Manager confirmation';
  end if;

  if tg_op = 'UPDATE'
    and new.payment_terms_confirmed_at is distinct from old.payment_terms_confirmed_at
    and not v_sync
    and not (
      v_old_status is distinct from 'approved'
      and new.status::text = 'approved'
      and new.payment_terms_confirmed_at is not null
    )
    and not (
      v_old_status = 'approved'
      and new.status::text <> 'approved'
      and new.payment_terms_confirmed_at is null
    ) then
    raise exception 'Payment-term confirmation is controlled by the quotation workflow';
  end if;

  -- Keep the legacy payment columns compatible with the existing payment
  -- receipt RPCs while making the business rule fixed at 50/50.
  new.payment_requirement := 'downpayment';
  new.downpayment_rate := 50;

  if new.status::text = 'approved'
    and (tg_op = 'INSERT' or v_old_status is distinct from 'approved')
    and new.payment_terms_confirmed_at is null then
    new.payment_terms_confirmed_at := coalesce(new.approved_at, now());
  elsif new.status::text <> 'approved' then
    new.payment_terms_confirmed_at := null;
  end if;

  return new;
end;
$$;

create trigger quotation_payment_terms_guard
before insert or update on public.quotations
for each row execute function public.enforce_quotation_payment_terms();

-- A PDC term must be represented as a check when the remaining balance is
-- recorded. The existing receipt-review workflow still decides when the
-- uploaded proof becomes verified Money In.
create or replace function public.enforce_quotation_payment_record_terms()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_option text;
begin
  select payment_terms_option
  into v_option
  from public.quotations
  where id = new.quotation_id;

  if v_option = 'pdc_50_50'
    and new.payment_kind = 'full_payment'
    and new.method is distinct from 'check'::public.payment_method then
    raise exception 'The remaining balance for this quotation must be recorded through a check (PDC)';
  end if;

  return new;
end;
$$;

drop trigger if exists quotation_payment_record_terms_guard
  on public.quotation_payment_records;
create trigger quotation_payment_record_terms_guard
before insert or update on public.quotation_payment_records
for each row execute function public.enforce_quotation_payment_record_terms();

-- Keep the old RPC signature callable during a rolling deployment, but make
-- it a compatibility no-op for the old rate input. New application code uses
-- the quotation review workflow instead.
create or replace function public.set_quotation_payment_terms(
  p_quotation_id uuid,
  p_payment_requirement text,
  p_downpayment_rate numeric default 50
)
returns public.quotations
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found
    or v_quote.document_type not in ('price_quotation', 'mockup_quotation')
    or v_quote.status::text is distinct from 'approved' then
    raise exception 'Payment terms can only be reviewed on an approved quotation';
  end if;
  if v_quote.payment_terms_confirmed_at is not null then
    raise exception 'Payment terms are locked after General Manager confirmation';
  end if;
  raise exception 'Payment terms are selected during quotation review preparation';
end;
$$;

-- Keep the legacy Costing Breakdown approval RPC aligned with the current GM
-- role set. The wrapper below reuses this function, so the role check must
-- include super_admin as well as owner/admin.
create or replace function public.review_costing_breakdown(
  p_costing_id uuid,
  p_decision text,
  p_profit_margin_rate numeric,
  p_overhead_rate numeric,
  p_buffer_margin_rate numeric,
  p_commission_rate numeric,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_revision_note text default null
)
returns table (costing_id uuid, price_quotation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_price_id uuid;
  v_price_no text;
  v_note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
  if p_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported Costing Breakdown decision';
  end if;
  if p_decision = 'needs_revision' and v_note is null then
    raise exception 'Enter revision notes before returning this Costing Breakdown';
  end if;

  select * into v_costing
  from public.quotations
  where id = p_costing_id
  for update;
  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;
  if not private.has_text_role(v_costing.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can review Costing Breakdowns';
  end if;
  if v_costing.status::text <> 'pending' then
    raise exception 'Only submitted Costing Breakdowns can be reviewed';
  end if;

  update public.quotations
  set profit_margin_rate = coalesce(p_profit_margin_rate, profit_margin_rate),
      overhead_rate = coalesce(p_overhead_rate, overhead_rate),
      buffer_margin_rate = coalesce(p_buffer_margin_rate, buffer_margin_rate),
      commission_rate = coalesce(p_commission_rate, commission_rate),
      vat_rate = coalesce(p_vat_rate, vat_rate),
      terms_conditions = coalesce(p_terms_conditions, terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      status = p_decision::public.quotation_status,
      revision_note = case when p_decision = 'needs_revision' then v_note else null end,
      revision_requested_by = case when p_decision = 'needs_revision' then (select auth.uid()) else null end,
      revision_requested_at = case when p_decision = 'needs_revision' then now() else null end,
      approved_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
      approved_at = case when p_decision = 'approved' then now() else null end
  where id = v_costing.id
  returning * into v_costing;

  perform private.refresh_quotation_totals(v_costing.id);
  select * into v_costing
  from public.quotations
  where id = v_costing.id;

  update public.approval_requests
  set status = (case when p_decision = 'approved' then 'approved' else 'needs_revision' end)::public.approval_status,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where organization_id = v_costing.organization_id
    and resource_type = 'quotation'
    and resource_id = v_costing.id;

  if p_decision = 'needs_revision' then
    return query select v_costing.id, null::uuid;
    return;
  end if;

  select id into v_price_id
  from public.quotations
  where costing_source_id = v_costing.id
    and document_type = 'price_quotation'
  for update;

  if v_price_id is null then
    v_price_no := format('QT-%s-%s', to_char(current_date, 'YYYY'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    insert into public.quotations (
      organization_id, quotation_no, document_type, costing_source_id, customer_id,
      lead_id, client_name, client_contact_name, client_phone, size_details,
      project_quantity, delivery_date, project_types, project_name, representative,
      prepared_by_user_id, prepared_by_signature_url,
      profit_margin_rate, overhead_rate, buffer_margin_rate, commission_rate, vat_rate,
      terms_conditions, bank_details, issue_date, valid_until, notes, status, created_by,
      approved_by, approved_at
    ) values (
      v_costing.organization_id, v_price_no, 'price_quotation', v_costing.id,
      v_costing.customer_id, v_costing.lead_id, v_costing.client_name,
      v_costing.client_contact_name, v_costing.client_phone, v_costing.size_details,
      v_costing.project_quantity, v_costing.delivery_date, v_costing.project_types,
      v_costing.project_name, v_costing.representative,
      v_costing.prepared_by_user_id, v_costing.prepared_by_signature_url,
      v_costing.profit_margin_rate, v_costing.overhead_rate, v_costing.buffer_margin_rate,
      v_costing.commission_rate, v_costing.vat_rate, v_costing.terms_conditions,
      v_costing.bank_details, current_date, v_costing.valid_until, v_costing.notes,
      'approved', (select auth.uid()), v_costing.approved_by, v_costing.approved_at
    ) returning id into v_price_id;
  else
    update public.quotations
    set customer_id = v_costing.customer_id,
        lead_id = v_costing.lead_id,
        client_name = v_costing.client_name,
        client_contact_name = v_costing.client_contact_name,
        client_phone = v_costing.client_phone,
        size_details = v_costing.size_details,
        project_quantity = v_costing.project_quantity,
        delivery_date = v_costing.delivery_date,
        project_types = v_costing.project_types,
        project_name = v_costing.project_name,
        representative = v_costing.representative,
        prepared_by_user_id = v_costing.prepared_by_user_id,
        prepared_by_signature_url = v_costing.prepared_by_signature_url,
        profit_margin_rate = v_costing.profit_margin_rate,
        overhead_rate = v_costing.overhead_rate,
        buffer_margin_rate = v_costing.buffer_margin_rate,
        commission_rate = v_costing.commission_rate,
        vat_rate = v_costing.vat_rate,
        terms_conditions = v_costing.terms_conditions,
        bank_details = v_costing.bank_details,
        issue_date = current_date,
        valid_until = v_costing.valid_until,
        notes = v_costing.notes,
        status = 'approved',
        approved_by = v_costing.approved_by,
        approved_at = v_costing.approved_at
    where id = v_price_id;

    delete from public.quotation_items
    where quotation_id = v_price_id;
  end if;

  insert into public.quotation_items (
    quotation_id, inventory_item_id, description, details, image_url, quantity, unit_cost, sort_order
  )
  select v_price_id, item.inventory_item_id, item.description, item.details,
      item.image_url, item.quantity, item.unit_cost, item.sort_order
  from public.quotation_items item
  where item.quotation_id = v_costing.id
  order by item.sort_order, item.created_at;

  perform private.refresh_quotation_totals(v_price_id);
  return query select v_costing.id, v_price_id;
end;
$$;

-- Apply the selected option to the generated Price Quotation in the same
-- General Manager approval transaction. This additive RPC carries the new
-- payment-term fields used by the current workspace.
create or replace function public.review_costing_breakdown_with_payment_terms(
  p_costing_id uuid,
  p_decision text,
  p_profit_margin_rate numeric,
  p_overhead_rate numeric,
  p_buffer_margin_rate numeric,
  p_commission_rate numeric,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_revision_note text,
  p_payment_terms_option text,
  p_pdc_term_days integer
)
returns table (costing_id uuid, price_quotation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_costing public.quotations%rowtype;
  v_result record;
  v_option text := coalesce(nullif(btrim(p_payment_terms_option), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
begin
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;

  select * into v_costing
  from public.quotations
  where id = p_costing_id
  for update;
  if not found or v_costing.document_type <> 'costing_breakdown' then
    raise exception 'Costing Breakdown not found';
  end if;
  if not private.has_text_role(v_costing.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can review Costing Breakdowns';
  end if;
  if v_costing.status::text <> 'pending' then
    raise exception 'Only submitted Costing Breakdowns can be reviewed';
  end if;

  update public.quotations
  set payment_terms_option = v_option,
      pdc_term_days = v_days
  where id = v_costing.id;

  -- The linked quotation is created by the existing approval function. This
  -- transaction-local marker lets this wrapper copy the approved option to
  -- that linked row without opening a client-edit path after approval.
  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);

  select * into v_result
  from public.review_costing_breakdown(
    p_costing_id,
    p_decision,
    p_profit_margin_rate,
    p_overhead_rate,
    p_buffer_margin_rate,
    p_commission_rate,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_revision_note
  );

  if p_decision = 'approved' and v_result.price_quotation_id is not null then
    select * into v_costing
    from public.quotations
    where id = v_costing.id;

    update public.quotations
    set payment_terms_option = v_option,
        pdc_term_days = v_days,
        payment_terms_confirmed_at = coalesce(v_costing.approved_at, now())
    where id = v_result.price_quotation_id;
  end if;

  return query select v_result.costing_id, v_result.price_quotation_id;
end;
$$;

revoke all on function public.review_costing_breakdown_with_payment_terms(
  uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text, text, integer
) from public;
grant execute on function public.review_costing_breakdown_with_payment_terms(
  uuid, text, numeric, numeric, numeric, numeric, numeric, text, jsonb, text, text, integer
) to authenticated;

-- Bring generated quotations from already-approved Costing Breakdowns into
-- the same option/timestamp state without touching payment records.
select set_config('huswell.quotation_payment_terms_sync', 'on', true);
update public.quotations as price
set payment_terms_option = costing.payment_terms_option,
    pdc_term_days = costing.pdc_term_days,
    payment_terms_confirmed_at = coalesce(costing.approved_at, price.payment_terms_confirmed_at, now())
from public.quotations as costing
where price.document_type = 'price_quotation'
  and price.costing_source_id = costing.id
  and costing.document_type = 'costing_breakdown'
  and costing.status::text = 'approved';

commit;
