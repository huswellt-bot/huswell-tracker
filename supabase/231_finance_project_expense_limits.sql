-- Expose approved quotation project-expense capacity and enforce it for
-- External Finance quote-linked Money Out submissions.
-- Run after 230_finance_quotation_direct_cost_projection.sql and before the
-- matching Finance workspace update.

begin;

create index if not exists finance_transactions_project_expense_idx
  on public.finance_transactions(organization_id, quotation_id, approval_status)
  where quotation_id is not null and transaction_type = 'expense';

create or replace function public.finance_project_expense_rows(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  client_contact_name text,
  lead_id uuid,
  total_direct_cost numeric,
  committed_project_expense numeric,
  remaining_direct_cost numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance'
  ]) then
    raise exception 'Only Finance can read project expense capacity';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    quotation.project_name,
    quotation.client_name,
    quotation.client_contact_name,
    quotation.lead_id,
    direct_cost.total_direct_cost,
    commitments.committed_project_expense,
    round(greatest(
      direct_cost.total_direct_cost - commitments.committed_project_expense,
      0::numeric
    ), 2)
  from public.quotations quotation
  left join lateral (
    select round(coalesce(sum(
      case
        when costing_line.calculation_type = 'fixed_amount'
          then round(costing_line.unit_cost, 2)
        else round(costing_line.quantity * costing_line.unit_cost, 2)
      end
    ), 0), 2) as total_direct_cost
    from public.price_quotation_product_costings product_costing
    left join public.price_quotation_costing_lines costing_line
      on costing_line.product_costing_id = product_costing.id
    where product_costing.quotation_id = quotation.id
  ) direct_cost on true
  left join lateral (
    select round(coalesce(sum(transaction.amount), 0), 2) as committed_project_expense
    from public.finance_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.quotation_id = quotation.id
      and transaction.transaction_type = 'expense'
      and coalesce(transaction.is_voided, false) = false
      and transaction.approval_status::text not in (
        'rejected', 'revision_requested', 'cancelled'
      )
      and transaction.commission_summary_id is null
      and transaction.commission_allocation_id is null
  ) commitments on true
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved';
end;
$$;

revoke all on function public.finance_project_expense_rows(uuid)
  from public, anon;
grant execute on function public.finance_project_expense_rows(uuid)
  to authenticated;

create or replace function private.finance_project_expense_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
  v_total_direct_cost numeric;
  v_committed_project_expense numeric;
  v_payable_quotation_id uuid;
  v_commission_context boolean;
  v_external boolean;
  v_regular_lead_resubmission_context boolean;
begin
  v_commission_context := coalesce(
    current_setting('huswell.allow_commission_allocation_insert', true),
    ''
  ) = 'on';
  v_external := private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id);
  v_regular_lead_resubmission_context := coalesce(
    current_setting('huswell.allow_regular_lead_resubmission', true),
    ''
  ) = 'on';

  if v_commission_context or new.transaction_type <> 'expense' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.approval_status::text = 'revision_requested'
    and new.approval_status::text = 'pending'
    and new.quotation_id is null then
    if old.quotation_id is not null
      or (v_external and old.lead_id is not null and not v_regular_lead_resubmission_context) then
      raise exception 'This returned project expense needs an approved quotation before resubmission';
    end if;
  end if;

  if new.supplier_payable_id is not null then
    select payable.quotation_id
    into v_payable_quotation_id
    from public.supplier_payables payable
    where payable.id = new.supplier_payable_id
      and payable.organization_id = new.organization_id
    for share;

    if not found or v_payable_quotation_id is distinct from new.quotation_id then
      raise exception 'The supplier payable quotation must match the selected project quotation';
    end if;
  end if;

  if new.quotation_id is null then
    return new;
  end if;

  select * into v_quotation
  from public.quotations quotation
  where quotation.id = new.quotation_id
    and quotation.organization_id = new.organization_id
  for update;

  if not found
    or v_quotation.document_type <> 'price_quotation'
    or v_quotation.costing_source_id is not null
    or v_quotation.status::text <> 'approved' then
    raise exception 'Choose an approved direct quotation for this project expense';
  end if;

  if coalesce(new.is_voided, false)
    or new.approval_status::text in ('rejected', 'revision_requested', 'cancelled')
    or new.commission_summary_id is not null
    or new.commission_allocation_id is not null then
    return new;
  end if;

  select round(coalesce(sum(
    case
      when costing_line.calculation_type = 'fixed_amount'
        then round(costing_line.unit_cost, 2)
      else round(costing_line.quantity * costing_line.unit_cost, 2)
    end
  ), 0), 2)
  into v_total_direct_cost
  from public.price_quotation_product_costings product_costing
  left join public.price_quotation_costing_lines costing_line
    on costing_line.product_costing_id = product_costing.id
  where product_costing.quotation_id = v_quotation.id;

  select round(coalesce(sum(transaction.amount), 0), 2)
  into v_committed_project_expense
  from public.finance_transactions transaction
  where transaction.organization_id = new.organization_id
    and transaction.quotation_id = new.quotation_id
    and transaction.transaction_type = 'expense'
    and transaction.id is distinct from new.id
    and coalesce(transaction.is_voided, false) = false
    and transaction.approval_status::text not in (
      'rejected', 'revision_requested', 'cancelled'
    )
    and transaction.commission_summary_id is null
    and transaction.commission_allocation_id is null;

  if round(v_committed_project_expense + new.amount, 2) > v_total_direct_cost then
    raise exception 'The project expense exceeds the quotation Total Direct Cost. Available capacity: %',
      round(greatest(v_total_direct_cost - v_committed_project_expense, 0::numeric), 2);
  end if;

  return new;
end;
$$;

drop trigger if exists finance_transactions_project_expense_guard
  on public.finance_transactions;
create trigger finance_transactions_project_expense_guard
before insert or update of amount, transaction_type, approval_status,
  quotation_id, supplier_payable_id, commission_summary_id,
  commission_allocation_id, is_voided
on public.finance_transactions
for each row execute function private.finance_project_expense_guard();

create or replace function public.resubmit_finance_transaction_as_regular(
  p_transaction_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_transaction_date date,
  p_transaction_time time,
  p_lead_id uuid,
  p_quotation_id uuid,
  p_supplier_payable_id uuid,
  p_receipt_storage_path text default null,
  p_receipt_file_name text default null,
  p_receipt_content_type text default null,
  p_receipt_file_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;

  if not found
    or not private.has_text_role(v_transaction.organization_id, array['external_finance'])
    or private.finance_is_internal(v_transaction.organization_id)
    or v_transaction.transaction_type <> 'expense'
    or v_transaction.quotation_id is not null
    or v_transaction.lead_id is null
    or p_quotation_id is not null
    or p_supplier_payable_id is not null then
    raise exception 'Only a returned lead-linked regular expense can use this resubmission path';
  end if;

  perform set_config('huswell.allow_regular_lead_resubmission', 'on', true);
  return public.resubmit_finance_transaction(
    p_transaction_id,
    p_amount,
    p_category_id,
    p_account_id,
    p_note,
    p_transaction_date,
    p_transaction_time,
    p_lead_id,
    p_quotation_id,
    p_supplier_payable_id,
    p_receipt_storage_path,
    p_receipt_file_name,
    p_receipt_content_type,
    p_receipt_file_size
  );
end;
$$;

revoke all on function public.resubmit_finance_transaction_as_regular(
  uuid, numeric, uuid, uuid, text, date, time, uuid, uuid, uuid,
  text, text, text, bigint
) from public, anon;
grant execute on function public.resubmit_finance_transaction_as_regular(
  uuid, numeric, uuid, uuid, text, date, time, uuid, uuid, uuid,
  text, text, text, bigint
) to authenticated;

commit;
