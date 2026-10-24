-- Allow Finance custom categories and account types to be removed safely.
-- Unused records are deleted. Referenced records are archived so historical
-- transactions and accounts keep their existing references and labels.
-- Run after 235_finance_account_custom_types.sql and before deploying the
-- matching Finance workspace update. Safe to re-run.

begin;

create or replace function public.remove_finance_category(p_category_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_category public.finance_categories%rowtype;
begin
  select * into v_category
  from public.finance_categories
  where id = p_category_id
  for update;

  if not found or not private.finance_is_internal(v_category.organization_id) then
    raise exception 'Finance category not found';
  end if;
  if v_category.is_system then
    raise exception 'Default categories cannot be deleted';
  end if;

  if exists (select 1 from public.finance_transactions where category_id = v_category.id) then
    update public.finance_categories set is_active = false where id = v_category.id;
    return 'archived';
  end if;

  delete from public.finance_categories where id = v_category.id;
  return 'deleted';
end;
$$;

revoke all on function public.remove_finance_category(uuid) from public;
grant execute on function public.remove_finance_category(uuid) to authenticated;

create or replace function public.remove_finance_account_type(p_account_type_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_type public.finance_account_types%rowtype;
begin
  select * into v_type
  from public.finance_account_types
  where id = p_account_type_id
  for update;

  if not found or not private.finance_is_internal(v_type.organization_id) then
    raise exception 'Finance account type not found';
  end if;

  if exists (select 1 from public.finance_accounts where custom_account_type_id = v_type.id) then
    update public.finance_account_types set is_active = false where id = v_type.id;
    return 'archived';
  end if;

  delete from public.finance_account_types where id = v_type.id;
  return 'deleted';
end;
$$;

revoke all on function public.remove_finance_account_type(uuid) from public;
grant execute on function public.remove_finance_account_type(uuid) to authenticated;

commit;
