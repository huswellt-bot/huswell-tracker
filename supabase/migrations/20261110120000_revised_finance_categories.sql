-- Add organization-scoped categories to the revised project-ledger Finance flow.
-- Cash In uses income categories; project and operating Cash Out use expense
-- categories. Category edits and removals are handled through Finance RPCs so
-- the browser never receives direct write access to the shared category table.

begin;

alter table public.finance_revised_transactions
  add column if not exists category_id uuid
  references public.finance_categories(id)
  on delete restrict;

create index if not exists finance_revised_transactions_org_category_idx
  on public.finance_revised_transactions(organization_id, category_id)
  where category_id is not null;

-- The revised Finance flow has one Finance capability. Keep the legacy table
-- trigger aligned with that capability for category management.
create or replace function private.finance_category_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.finance_revised_can_operate(new.organization_id) then
    raise exception 'Only Accounting & Finance can manage categories';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_categories_role_guard on public.finance_categories;
create trigger finance_categories_role_guard
before insert or update on public.finance_categories
for each row execute function private.finance_category_role_guard();

create or replace function public.list_finance_revised_categories(
  p_organization_id uuid,
  p_direction text default null
)
returns table (
  category_id uuid,
  direction text,
  name text,
  expense_class text,
  is_system boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can view Finance categories';
  end if;
  if p_direction is not null and p_direction not in ('income', 'expense') then
    raise exception 'Unsupported Finance category direction';
  end if;

  return query
  select
    category.id,
    category.direction,
    category.name,
    category.expense_class,
    category.is_system
  from public.finance_categories category
  where category.organization_id = p_organization_id
    and category.is_active
    and (p_direction is null or category.direction = p_direction)
  order by category.direction, category.name;
end;
$$;

create or replace function public.create_finance_revised_category(
  p_organization_id uuid,
  p_direction text,
  p_name text,
  p_expense_class text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_expense_class text;
  v_id uuid;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can add Finance categories';
  end if;
  if p_direction not in ('income', 'expense') or v_name is null then
    raise exception 'Category direction and name are required';
  end if;

  v_expense_class := case
    when p_direction = 'expense' then coalesce(nullif(btrim(coalesce(p_expense_class, '')), ''), 'operating')
    else null
  end;
  if v_expense_class is not null and v_expense_class not in ('operating', 'non_operating') then
    raise exception 'Choose Operating or Non Operating Expense';
  end if;

  insert into public.finance_categories (
    organization_id,
    direction,
    name,
    expense_class,
    is_system,
    created_by
  )
  values (
    p_organization_id,
    p_direction,
    v_name,
    v_expense_class,
    false,
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'That Finance category already exists';
end;
$$;

create or replace function public.update_finance_revised_category(
  p_organization_id uuid,
  p_category_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can edit Finance categories';
  end if;
  if v_name is null then
    raise exception 'Category name is required';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.is_active
  for update;

  if not found then
    raise exception 'Finance category not found';
  end if;

  update public.finance_categories
  set name = v_name,
      updated_at = now()
  where id = v_category.id;

  return v_category.id;
exception
  when unique_violation then
    raise exception 'That Finance category already exists';
end;
$$;

create or replace function public.delete_finance_revised_category(
  p_organization_id uuid,
  p_category_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can delete Finance categories';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.is_active
  for update;

  if not found then
    raise exception 'Finance category not found';
  end if;

  if exists (
    select 1
    from public.finance_transactions transaction
    where transaction.category_id = v_category.id
  ) or exists (
    select 1
    from public.finance_revised_transactions transaction
    where transaction.organization_id = p_organization_id
      and transaction.category_id = v_category.id
  ) then
    update public.finance_categories
    set is_active = false,
        updated_at = now()
    where id = v_category.id;
    return 'archived';
  end if;

  delete from public.finance_categories
  where id = v_category.id;
  return 'deleted';
end;
$$;

create or replace function public.create_finance_revised_cash_in_with_category(
  p_organization_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_category_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_status text;
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can record project Cash In';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash In amount must be greater than zero';
  end if;

  select status
  into v_status
  from public.project_funds
  where id = p_project_fund_id
    and organization_id = p_organization_id;

  if not found or v_status not in ('open', 'on_hold', 'closed') then
    raise exception 'Choose an existing project for Cash In';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.direction = 'income'
    and category.is_active
  for share;

  if not found then
    raise exception 'Choose an active Cash In category';
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    category_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    'project_cash_in',
    p_project_fund_id,
    v_category.id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    v_category.name,
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_finance_revised_cash_out_with_category(
  p_organization_id uuid,
  p_project_fund_id uuid default null,
  p_amount numeric default null,
  p_category_id uuid default null,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null,
  p_daily_fund_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_kind text;
  v_status text;
  v_balance numeric;
  v_category public.finance_categories%rowtype;
begin
  if (select auth.uid()) is null
    or not private.finance_revised_can_operate(p_organization_id) then
    raise exception 'Only Accounting & Finance can record Cash Out';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash Out amount must be greater than zero';
  end if;

  select *
  into v_category
  from public.finance_categories category
  where category.id = p_category_id
    and category.organization_id = p_organization_id
    and category.direction = 'expense'
    and category.is_active
  for share;

  if not found then
    raise exception 'Choose an active Cash Out category';
  end if;

  if p_project_fund_id is null then
    v_kind := 'operating_cash_out';
    if p_daily_fund_request_id is null then
      raise exception 'Choose an approved Daily Fund request for a non-project Cash Out';
    end if;
    if not exists (
      select 1
      from public.finance_daily_fund_requests request
      where request.id = p_daily_fund_request_id
        and request.organization_id = p_organization_id
        and request.status in ('approved', 'partially_returned')
    ) then
      raise exception 'Choose an approved Daily Fund request for this non-project Cash Out';
    end if;
    v_balance := private.finance_revised_balance(p_organization_id, 'daily');
    if v_balance < round(p_amount, 2) then
      raise exception 'Daily Fund balance is not enough for this non-project Cash Out';
    end if;
  else
    if p_daily_fund_request_id is not null then
      raise exception 'A project Cash Out cannot use a Daily Fund request';
    end if;
    v_kind := 'project_cash_out';
    select status
    into v_status
    from public.project_funds
    where id = p_project_fund_id
      and organization_id = p_organization_id;

    if not found or v_status not in ('open', 'on_hold') then
      raise exception 'Choose an open project for project Cash Out';
    end if;
    v_balance := private.finance_revised_balance(
      p_organization_id,
      'project',
      p_project_fund_id
    );
    if v_balance < round(p_amount, 2) then
      raise exception 'Project balance is not enough. Request Working Funds for this project first';
    end if;
  end if;

  insert into public.finance_revised_transactions (
    organization_id,
    transaction_kind,
    project_fund_id,
    daily_fund_request_id,
    category_id,
    amount,
    transaction_date,
    category,
    reference_number,
    note,
    submitted_by
  )
  values (
    p_organization_id,
    v_kind,
    p_project_fund_id,
    p_daily_fund_request_id,
    v_category.id,
    round(p_amount, 2),
    coalesce(p_transaction_date, current_date),
    v_category.name,
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace view public.finance_revised_transaction_feed
with (security_invoker = true)
as
select
  txn.id,
  txn.organization_id,
  txn.transaction_kind,
  txn.project_fund_id,
  txn.working_fund_request_id,
  txn.daily_fund_request_id,
  txn.commission_allocation_id,
  txn.reversal_of_transaction_id,
  txn.amount,
  txn.transaction_date,
  txn.period_label,
  coalesce(txn.category, finance_category.name) as category,
  txn.reference_number,
  txn.note,
  txn.status,
  txn.submitted_by,
  txn.submitted_at,
  txn.approved_by,
  txn.approved_at,
  txn.decision_note,
  txn.created_at,
  txn.updated_at,
  fund.project_name,
  fund.client_name,
  quotation.quotation_no,
  request.purpose as working_fund_purpose,
  allocation.recipient_user_id as commission_recipient_user_id,
  coalesce(profile.full_name, 'Sales & Pricing Officer') as commission_recipient_name,
  allocation.allocation_role as commission_allocation_role,
  allocation.share_rate as commission_share_rate,
  coalesce(submitted_profile.full_name, txn.submitted_by::text) as submitted_by_name,
  coalesce(approved_profile.full_name, txn.approved_by::text) as approved_by_name,
  txn.category_id
from public.finance_revised_transactions txn
left join public.project_funds fund
  on fund.id = txn.project_fund_id
left join public.quotations quotation
  on quotation.id = fund.quotation_id
left join public.finance_working_fund_requests request
  on request.id = txn.working_fund_request_id
left join public.finance_categories finance_category
  on finance_category.id = txn.category_id
  and finance_category.organization_id = txn.organization_id
left join public.commission_summary_allocations allocation
  on allocation.id = txn.commission_allocation_id
  and allocation.organization_id = txn.organization_id
left join public.profiles profile
  on profile.id = allocation.recipient_user_id
left join public.profiles submitted_profile
  on submitted_profile.id = txn.submitted_by
left join public.profiles approved_profile
  on approved_profile.id = txn.approved_by;

revoke all on function public.list_finance_revised_categories(uuid, text) from public, anon;
revoke all on function public.create_finance_revised_category(uuid, text, text, text) from public, anon;
revoke all on function public.update_finance_revised_category(uuid, uuid, text) from public, anon;
revoke all on function public.delete_finance_revised_category(uuid, uuid) from public, anon;
revoke all on function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text) from public, anon;
revoke all on function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon;

grant execute on function public.list_finance_revised_categories(uuid, text) to authenticated;
grant execute on function public.create_finance_revised_category(uuid, text, text, text) to authenticated;
grant execute on function public.update_finance_revised_category(uuid, uuid, text) to authenticated;
grant execute on function public.delete_finance_revised_category(uuid, uuid) to authenticated;
grant execute on function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text) to authenticated;
grant execute on function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid) to authenticated;

commit;
