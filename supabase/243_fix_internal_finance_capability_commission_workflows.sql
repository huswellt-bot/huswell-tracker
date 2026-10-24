-- Make capability-enabled Internal Finance accounts behave like the
-- internal_finance role in Commission Payables and commission payouts.
-- Run after 242_quotation_capability_read_boundary.sql.

begin;

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
  select (
    private.has_text_role(
      p_organization_id,
      array['super_admin', 'owner', 'admin', 'accountant']
    )
    or private.finance_is_internal(p_organization_id)
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
  and (
    access.can_view_all
    or exists (
      select 1
      from public.quotation_payment_records payment
      where payment.organization_id = summary.organization_id
        and payment.quotation_id = summary.quotation_id
        and payment.status = 'verified'
    )
  )
order by summary.created_at desc, summary.quotation_no asc;
$$;

create or replace function public.create_finance_transaction(
  p_transaction_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_category_id uuid,
  p_account_id uuid,
  p_note text,
  p_transaction_date date,
  p_transaction_time time,
  p_payment_status text,
  p_lead_id uuid,
  p_customer_id uuid,
  p_quotation_id uuid,
  p_supplier_payable_id uuid,
  p_commission_summary_id uuid,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_category public.finance_categories%rowtype;
  v_account public.finance_accounts%rowtype;
  v_role text;
  v_approval_status text;
  v_paid_at timestamptz;
begin
  select organization_id, role::text into v_organization_id, v_role
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;
  if v_organization_id is null or not private.finance_is_external_or_internal(v_organization_id) then
    raise exception 'Only Finance users can add a transaction';
  end if;
  if p_transaction_id is null or p_transaction_type not in ('income', 'expense') then
    raise exception 'Choose Money In or Money Out';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  select * into v_category from public.finance_categories
  where id = p_category_id and organization_id = v_organization_id and is_active;
  if not found or v_category.direction <> p_transaction_type then
    raise exception 'Choose an active category for this transaction';
  end if;
  if p_account_id is null then
    if v_role <> 'external_finance'
      or p_transaction_type <> 'expense'
      or p_payment_status <> 'unpaid' then
      raise exception 'Choose an active bank, e-wallet, or cash account';
    end if;
  else
    select * into v_account from public.finance_accounts
    where id = p_account_id and organization_id = v_organization_id and is_active;
    if not found then
      raise exception 'Choose an active bank, e-wallet, or cash account';
    end if;
  end if;
  if p_payment_status not in ('paid', 'unpaid') then
    raise exception 'Choose Paid or Unpaid';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760 then
    raise exception 'Upload a JPEG, PNG, or WebP receipt image no larger than 10 MB';
  end if;
  if split_part(p_receipt_storage_path, '/', 1) <> v_organization_id::text
    or split_part(p_receipt_storage_path, '/', 2) <> 'transactions'
    or split_part(split_part(p_receipt_storage_path, '/', 3), '.', 1) <> p_transaction_id::text
    or split_part(p_receipt_storage_path, '/', 4) <> ''
    or lower(reverse(split_part(reverse(p_receipt_file_name), '.', 1))) <> lower(split_part(split_part(p_receipt_storage_path, '/', 3), '.', 2)) then
    raise exception 'Transaction receipt storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'finance-receipts'
      and object.name = p_receipt_storage_path
  ) then
    raise exception 'Upload the transaction receipt image before saving the transaction';
  end if;
  if p_lead_id is not null and not exists (
    select 1 from public.leads lead_row
    where lead_row.id = p_lead_id and lead_row.organization_id = v_organization_id
  ) then
    raise exception 'The selected Name / Company lead does not belong to this workspace';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers customer
    where customer.id = p_customer_id and customer.organization_id = v_organization_id
  ) then
    raise exception 'The selected customer does not belong to this workspace';
  end if;
  if p_quotation_id is not null and not exists (
    select 1 from public.quotations quotation
    where quotation.id = p_quotation_id and quotation.organization_id = v_organization_id
  ) then
    raise exception 'The selected quotation does not belong to this workspace';
  end if;
  if p_transaction_type = 'income' and (p_supplier_payable_id is not null or p_commission_summary_id is not null) then
    raise exception 'Payables can only be linked to Money Out';
  end if;
  if p_supplier_payable_id is not null and p_commission_summary_id is not null then
    raise exception 'Link Money Out to a supplier payable or commission, not both';
  end if;
  if p_supplier_payable_id is not null and not exists (
    select 1 from public.supplier_payables payable
    where payable.id = p_supplier_payable_id and payable.organization_id = v_organization_id
      and payable.status not in ('paid', 'cancelled')
      and payable.amount_paid + round(p_amount, 2) <= payable.amount
  ) then
    raise exception 'The supplier payable amount exceeds its remaining balance';
  end if;
  if p_commission_summary_id is not null and not exists (
    select 1 from public.commission_summaries summary
    where summary.id = p_commission_summary_id and summary.organization_id = v_organization_id
      and summary.status = 'not_yet_paid'
      and round(summary.commission_amount + summary.va_commission_amount, 2) = round(p_amount, 2)
  ) then
    raise exception 'The Money Out amount must equal the selected commission';
  end if;
  v_approval_status := case
    when p_transaction_type = 'income' then 'not_required'
    when private.finance_is_internal(v_organization_id) then 'approved'
    else 'pending'
  end;
  v_paid_at := case when p_payment_status = 'paid' then now() else null end;
  insert into public.finance_transactions (
    id, organization_id, transaction_type, amount, category_id, account_id,
    note, transaction_date, transaction_time, payment_status, approval_status,
    paid_at, paid_by, approved_at, approved_by, lead_id, customer_id,
    quotation_id, supplier_payable_id, commission_summary_id,
    receipt_storage_path, receipt_file_name, receipt_content_type,
    receipt_file_size, submitted_by
  ) values (
    p_transaction_id, v_organization_id, p_transaction_type, round(p_amount, 2),
    p_category_id, p_account_id, nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_transaction_date, current_date), p_transaction_time,
    p_payment_status, v_approval_status, v_paid_at,
    case when p_payment_status = 'paid' then (select auth.uid()) else null end,
    case when v_approval_status = 'approved' then now() else null end,
    case when v_approval_status = 'approved' then (select auth.uid()) else null end,
    p_lead_id, p_customer_id, p_quotation_id, p_supplier_payable_id,
    p_commission_summary_id, p_receipt_storage_path, btrim(p_receipt_file_name),
    p_receipt_content_type, p_receipt_file_size, (select auth.uid())
  );
  if v_approval_status = 'approved' and p_payment_status = 'paid' then
    perform private.sync_paid_finance_source(p_transaction_id);
  end if;
  return p_transaction_id;
end;
$$;

revoke all on function public.create_finance_transaction(uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.create_finance_transaction(uuid, text, numeric, uuid, uuid, text, date, time, text, uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) to authenticated;

create or replace function public.mark_commission_summary_paid(p_summary_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_summary public.commission_summaries%rowtype;
begin
  select * into v_summary
  from public.commission_summaries
  where id = p_summary_id
  for update;
  if not found then
    raise exception 'Commission Summary not found';
  end if;
  if not (
    private.has_text_role(
      v_summary.organization_id,
      array['super_admin', 'owner', 'admin', 'accountant']
    )
    or private.finance_is_internal(v_summary.organization_id)
  ) then
    raise exception 'Only GM or Internal Finance can mark a Commission Summary paid';
  end if;
  if v_summary.status = 'paid' then
    raise exception 'This Commission Summary is already paid';
  end if;

  update public.commission_summaries
  set status = 'paid',
      paid_at = now(),
      paid_by = (select auth.uid())
  where id = v_summary.id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action, after_data
  ) values (
    v_summary.organization_id,
    (select auth.uid()),
    'commission_summary',
    v_summary.id,
    'paid',
    jsonb_build_object('paid_at', now(), 'paid_by', (select auth.uid()))
  );

  return v_summary.id;
end;
$$;

revoke all on function public.mark_commission_summary_paid(uuid) from public;
grant execute on function public.mark_commission_summary_paid(uuid) to authenticated;

commit;
