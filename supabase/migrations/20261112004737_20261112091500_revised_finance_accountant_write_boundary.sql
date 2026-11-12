-- GM owns fund setup and approval. Accounting & Finance owns operational
-- Finance submissions: project Cash In, Cash Out, requests, returns, and
-- corrections. Keep GM read access while closing the write boundary at the
-- public RPC layer.

begin;

create or replace function private.finance_revised_is_accountant(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_organization_id is not null
    and private.has_text_role(
      p_organization_id,
      array['accountant']
    );
$$;

revoke all on function private.finance_revised_is_accountant(uuid)
from public, anon, authenticated;
grant execute on function private.finance_revised_is_accountant(uuid)
to authenticated;

-- Category table writes are only used by the Accountant-facing category RPCs.
create or replace function private.finance_category_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.finance_revised_is_accountant(new.organization_id) then
    raise exception 'Only Accounting & Finance can manage categories';
  end if;
  return new;
end;
$$;

-- Rename the released implementations so they remain available only to the
-- guarded wrappers below and preserve their existing business validation.
alter function public.create_finance_revised_category(uuid, text, text, text)
  rename to create_finance_revised_category_accountant_legacy;
alter function public.update_finance_revised_category(uuid, uuid, text)
  rename to update_finance_revised_category_accountant_legacy;
alter function public.delete_finance_revised_category(uuid, uuid)
  rename to delete_finance_revised_category_accountant_legacy;
alter function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text)
  rename to create_finance_revised_cash_in_with_category_accountant_legacy;
alter function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid)
  rename to create_finance_revised_cash_out_with_category_accountant_legacy;
alter function public.create_finance_revised_daily_fund_request(uuid, numeric, date, text, text)
  rename to create_finance_revised_daily_fund_request_accountant_legacy;
alter function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text)
  rename to create_finance_revised_daily_fund_return_accountant_legacy;
alter function public.create_finance_revised_commission_payout(uuid, uuid, date, text, text)
  rename to create_finance_revised_commission_payout_accountant_legacy;
alter function public.create_finance_working_fund_request(uuid, uuid, text, text, jsonb)
  rename to create_finance_working_fund_request_accountant_legacy;
alter function public.create_finance_revised_repayment(uuid, numeric, date, text)
  rename to create_finance_revised_repayment_accountant_legacy;
alter function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid)
  rename to resubmit_finance_revised_transaction_accountant_legacy;

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
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can add Finance categories';
  end if;
  return public.create_finance_revised_category_accountant_legacy(
    p_organization_id, p_direction, p_name, p_expense_class
  );
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
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can edit Finance categories';
  end if;
  return public.update_finance_revised_category_accountant_legacy(
    p_organization_id, p_category_id, p_name
  );
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
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can delete Finance categories';
  end if;
  return public.delete_finance_revised_category_accountant_legacy(
    p_organization_id, p_category_id
  );
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
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can record project Cash In';
  end if;
  return public.create_finance_revised_cash_in_with_category_accountant_legacy(
    p_organization_id, p_project_fund_id, p_amount, p_category_id,
    p_transaction_date, p_reference_number, p_note
  );
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
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can record Cash Out';
  end if;
  return public.create_finance_revised_cash_out_with_category_accountant_legacy(
    p_organization_id, p_project_fund_id, p_amount, p_category_id,
    p_transaction_date, p_reference_number, p_note, p_daily_fund_request_id
  );
end;
$$;

create or replace function public.create_finance_revised_daily_fund_request(
  p_organization_id uuid,
  p_requested_amount numeric,
  p_fund_date date default current_date,
  p_purpose text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can request Daily Funds';
  end if;
  return public.create_finance_revised_daily_fund_request_accountant_legacy(
    p_organization_id, p_requested_amount, p_fund_date, p_purpose, p_note
  );
end;
$$;

create or replace function public.create_finance_revised_daily_fund_return(
  p_request_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
begin
  select organization_id
  into v_organization_id
  from public.finance_daily_fund_requests
  where id = p_request_id;
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(v_organization_id) then
    raise exception 'Only Accounting & Finance can return Daily Funds';
  end if;
  return public.create_finance_revised_daily_fund_return_accountant_legacy(
    p_request_id, p_amount, p_transaction_date, p_note
  );
end;
$$;

create or replace function public.create_finance_revised_commission_payout(
  p_organization_id uuid,
  p_commission_allocation_id uuid,
  p_transaction_date date default current_date,
  p_reference_number text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can submit commission payouts';
  end if;
  return public.create_finance_revised_commission_payout_accountant_legacy(
    p_organization_id, p_commission_allocation_id, p_transaction_date,
    p_reference_number, p_note
  );
end;
$$;

create or replace function public.create_finance_working_fund_request(
  p_organization_id uuid,
  p_project_fund_id uuid,
  p_purpose text,
  p_note text default null,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(p_organization_id) then
    raise exception 'Only Accounting & Finance can request Working Funds';
  end if;
  return public.create_finance_working_fund_request_accountant_legacy(
    p_organization_id, p_project_fund_id, p_purpose, p_note, p_lines
  );
end;
$$;

create or replace function public.create_finance_revised_repayment(
  p_request_id uuid,
  p_amount numeric,
  p_transaction_date date default current_date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
begin
  select organization_id
  into v_organization_id
  from public.finance_working_fund_requests
  where id = p_request_id;
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(v_organization_id) then
    raise exception 'Only Accounting & Finance can record a repayment';
  end if;
  return public.create_finance_revised_repayment_accountant_legacy(
    p_request_id, p_amount, p_transaction_date, p_note
  );
end;
$$;

create or replace function public.resubmit_finance_revised_transaction(
  p_original_transaction_id uuid,
  p_project_fund_id uuid,
  p_amount numeric,
  p_category_id uuid,
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
  v_organization_id uuid;
begin
  select organization_id
  into v_organization_id
  from public.finance_revised_transactions
  where id = p_original_transaction_id;
  if (select auth.uid()) is null
    or not private.finance_revised_is_accountant(v_organization_id) then
    raise exception 'Only Accounting & Finance can resubmit Finance transactions';
  end if;
  return public.resubmit_finance_revised_transaction_accountant_legacy(
    p_original_transaction_id, p_project_fund_id, p_amount, p_category_id,
    p_transaction_date, p_reference_number, p_note, p_daily_fund_request_id
  );
end;
$$;

-- The legacy implementations are internal call targets only.
revoke all on function public.create_finance_revised_category_accountant_legacy(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.update_finance_revised_category_accountant_legacy(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_finance_revised_category_accountant_legacy(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_finance_revised_cash_in_with_category_accountant_legacy(uuid, uuid, numeric, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.create_finance_revised_cash_out_with_category_accountant_legacy(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_finance_revised_daily_fund_request_accountant_legacy(uuid, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.create_finance_revised_daily_fund_return_accountant_legacy(uuid, numeric, date, text) from public, anon, authenticated;
revoke all on function public.create_finance_revised_commission_payout_accountant_legacy(uuid, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.create_finance_working_fund_request_accountant_legacy(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_finance_revised_repayment_accountant_legacy(uuid, numeric, date, text) from public, anon, authenticated;
revoke all on function public.resubmit_finance_revised_transaction_accountant_legacy(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon, authenticated;

revoke all on function public.create_finance_revised_category(uuid, text, text, text) from public, anon;
grant execute on function public.create_finance_revised_category(uuid, text, text, text) to authenticated;
revoke all on function public.update_finance_revised_category(uuid, uuid, text) from public, anon;
grant execute on function public.update_finance_revised_category(uuid, uuid, text) to authenticated;
revoke all on function public.delete_finance_revised_category(uuid, uuid) from public, anon;
grant execute on function public.delete_finance_revised_category(uuid, uuid) to authenticated;
revoke all on function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text) from public, anon;
grant execute on function public.create_finance_revised_cash_in_with_category(uuid, uuid, numeric, uuid, date, text, text) to authenticated;
revoke all on function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon;
grant execute on function public.create_finance_revised_cash_out_with_category(uuid, uuid, numeric, uuid, date, text, text, uuid) to authenticated;
revoke all on function public.create_finance_revised_daily_fund_request(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.create_finance_revised_daily_fund_request(uuid, numeric, date, text, text) to authenticated;
revoke all on function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text) from public, anon;
grant execute on function public.create_finance_revised_daily_fund_return(uuid, numeric, date, text) to authenticated;
revoke all on function public.create_finance_revised_commission_payout(uuid, uuid, date, text, text) from public, anon;
grant execute on function public.create_finance_revised_commission_payout(uuid, uuid, date, text, text) to authenticated;
revoke all on function public.create_finance_working_fund_request(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_finance_working_fund_request(uuid, uuid, text, text, jsonb) to authenticated;
revoke all on function public.create_finance_revised_repayment(uuid, numeric, date, text) from public, anon;
grant execute on function public.create_finance_revised_repayment(uuid, numeric, date, text) to authenticated;
revoke all on function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid) from public, anon;
grant execute on function public.resubmit_finance_revised_transaction(uuid, uuid, numeric, uuid, date, text, text, uuid) to authenticated;

commit;
