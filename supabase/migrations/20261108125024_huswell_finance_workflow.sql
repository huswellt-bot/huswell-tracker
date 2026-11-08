-- Huswell Finance workflow improvement.
--
-- External Finance prepares and releases payments. Internal Finance verifies
-- submissions, manages accounts/categories, and approves budget/labor work.
-- Project Funds remain isolated from one another and every actual release is
-- represented by an authoritative Finance transaction with proof.

begin;

alter table public.finance_transactions
  add column if not exists operating_cost_entry_id uuid
    references public.operating_cost_entries(id) on delete restrict,
  add column if not exists company_advance_id uuid
    references public.project_company_advances(id) on delete restrict,
  add column if not exists labor_payment_run_id uuid
    references public.labor_payment_runs(id) on delete restrict;

alter table public.operating_cost_entries
  add column if not exists finance_transaction_id uuid
    references public.finance_transactions(id) on delete restrict;

alter table public.project_company_advances
  add column if not exists finance_transaction_id uuid
    references public.finance_transactions(id) on delete restrict;

alter table public.labor_payment_runs
  add column if not exists finance_transaction_id uuid
    references public.finance_transactions(id) on delete restrict;

alter table public.project_fund_entries
  add column if not exists labor_payment_transaction_id uuid
    references public.finance_transactions(id) on delete restrict;

create unique index if not exists operating_cost_entries_finance_transaction_idx
  on public.operating_cost_entries(finance_transaction_id)
  where finance_transaction_id is not null;

create unique index if not exists project_company_advances_finance_transaction_idx
  on public.project_company_advances(finance_transaction_id)
  where finance_transaction_id is not null;

create unique index if not exists labor_payment_runs_finance_transaction_idx
  on public.labor_payment_runs(finance_transaction_id)
  where finance_transaction_id is not null;

create index if not exists finance_transactions_operating_cost_idx
  on public.finance_transactions(organization_id, operating_cost_entry_id)
  where operating_cost_entry_id is not null;

create index if not exists finance_transactions_company_advance_idx
  on public.finance_transactions(organization_id, company_advance_id)
  where company_advance_id is not null;

create index if not exists finance_transactions_labor_payment_run_idx
  on public.finance_transactions(organization_id, labor_payment_run_id)
  where labor_payment_run_id is not null;

-- Categories are shared configuration. External Finance may add a category
-- while Internal Finance remains responsible for archiving/editing policy.
create or replace function private.finance_category_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    if not private.finance_is_external_or_internal(new.organization_id) then
      raise exception 'Only Finance users can create categories';
    end if;
  elsif not private.finance_is_internal(new.organization_id) then
    raise exception 'Only Internal Finance can change or archive categories';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_categories_role_guard on public.finance_categories;
create trigger finance_categories_role_guard
before insert or update on public.finance_categories
for each row execute function private.finance_category_role_guard();

-- A controlled foundation release is the only path that may create a paid
-- transaction while the caller is External Finance. The flag is set only
-- inside the security-definer release RPCs below.
create or replace function private.finance_transaction_submission_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_commission_context boolean := coalesce(current_setting('huswell.allow_commission_allocation_insert', true), '') = 'on';
  v_resubmission_context boolean := coalesce(current_setting('huswell.allow_finance_transaction_resubmission', true), '') = 'on';
  v_manual_income_insert_context boolean := coalesce(current_setting('huswell.allow_manual_income_insert', true), '') = 'on';
  v_manual_income_resubmission_context boolean := coalesce(current_setting('huswell.allow_manual_income_resubmission', true), '') = 'on';
  v_foundation_release_context boolean := coalesce(current_setting('huswell.allow_foundation_release', true), '') = 'on';
begin
  if v_foundation_release_context then
    return new;
  end if;

  if tg_op = 'INSERT'
    and private.finance_is_internal(new.organization_id)
    and new.source_payment_id is null
    and new.commission_allocation_id is null
    and not v_commission_context
    and not v_manual_income_insert_context then
    raise exception 'Internal Finance cannot create generic Money In or Money Out. Use payment verification, expense approval, or the commission payout workflow';
  end if;

  if private.finance_is_internal(new.organization_id)
    and (v_manual_income_insert_context or v_manual_income_resubmission_context) then
    raise exception 'Manual Money In is an External Finance submission workflow';
  end if;

  if private.has_text_role(new.organization_id, array['external_finance'])
    and not private.finance_is_internal(new.organization_id) then
    if v_manual_income_insert_context or v_manual_income_resubmission_context then
      if new.transaction_type <> 'income'
        or new.income_source <> 'manual'
        or new.income_review_status <> 'pending'
        or new.payment_status <> 'unpaid'
        or new.approval_status <> 'not_required'
        or new.source_payment_id is not null
        or new.lead_id is not null
        or new.customer_id is not null
        or new.quotation_id is not null
        or new.supplier_payable_id is not null
        or new.commission_summary_id is not null
        or new.commission_allocation_id is not null
        or new.budget_request_id is not null then
        raise exception 'Manual Money In must remain an unverified standalone income record';
      end if;
      if new.account_id is null or not exists (
        select 1
        from public.finance_accounts account
        where account.id = new.account_id
          and account.organization_id = new.organization_id
          and account.is_active
      ) then
        raise exception 'Choose an active Finance receiving account';
      end if;
      if tg_op = 'UPDATE' then
        if not v_manual_income_resubmission_context
          or old.income_source <> 'manual'
          or old.income_review_status <> 'revision_requested'
          or new.income_review_status <> 'pending'
          or old.payment_status <> 'unpaid'
          or new.payment_status <> 'unpaid'
          or old.source_payment_id is distinct from new.source_payment_id
          or old.quotation_id is distinct from new.quotation_id
          or old.supplier_payable_id is distinct from new.supplier_payable_id
          or old.commission_summary_id is distinct from new.commission_summary_id
          or old.commission_allocation_id is distinct from new.commission_allocation_id
          or old.budget_request_id is distinct from new.budget_request_id then
          raise exception 'This Money In is not in a valid correction state';
        end if;
      elsif not v_manual_income_insert_context then
        raise exception 'Only the controlled Money In submission workflow can create this record';
      end if;
    else
      if new.transaction_type <> 'expense' then
        raise exception 'External Finance can submit Money Out or use the manual Money In workflow';
      end if;
      if new.payment_status <> 'unpaid' then
        raise exception 'External Finance cannot confirm a payment as paid';
      end if;
      if new.approval_status <> 'pending' then
        raise exception 'External Finance submissions must remain pending approval';
      end if;
      if new.income_source is not null or new.income_review_status <> 'none' then
        raise exception 'Only the manual Money In workflow can set income review fields';
      end if;
      if new.account_id is not null and not exists (
        select 1
        from public.finance_accounts account
        where account.id = new.account_id
          and account.organization_id = new.organization_id
          and account.is_active
      ) then
        raise exception 'Choose an active Finance payment account';
      end if;
      if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id and not v_resubmission_context then
        raise exception 'Only Internal Finance or the controlled resubmission workflow can change the Money Out payment account';
      end if;
      if v_resubmission_context and (
        old.approval_status <> 'revision_requested'
        or new.approval_status <> 'pending'
        or old.payment_status <> 'unpaid'
        or new.payment_status <> 'unpaid'
        or old.source_payment_id is distinct from new.source_payment_id
        or old.commission_summary_id is distinct from new.commission_summary_id
        or old.commission_allocation_id is distinct from new.commission_allocation_id
      ) then
        raise exception 'This transaction is not in a valid revision state';
      end if;
      if new.commission_summary_id is not null
        or new.commission_allocation_id is not null then
        raise exception 'External Finance cannot submit commission payouts';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_submission_guard
  on public.finance_transactions;
create trigger finance_transactions_submission_guard
before insert or update of transaction_type, amount, category_id, account_id,
  note, transaction_date, transaction_time, payment_status, approval_status,
  paid_at, paid_by, approved_at, approved_by, decision_note, lead_id,
  customer_id, quotation_id, supplier_payable_id, commission_summary_id,
  commission_allocation_id, source_payment_id, receipt_storage_path,
  receipt_file_name, receipt_content_type, receipt_file_size, budget_request_id,
  income_source, income_review_status, reference_number, is_voided,
  operating_cost_entry_id, company_advance_id, labor_payment_run_id
on public.finance_transactions
for each row execute function private.finance_transaction_submission_guard();

-- Actual Finance transaction state is authoritative for operating costs. A
-- planned operating cost becomes paid only after the linked Cash Out is
-- approved and released by External Finance.
create or replace function private.sync_foundation_transaction_entry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_fund_id uuid := new.project_fund_id;
  v_entry_id uuid;
  v_item record;
begin
  if new.transaction_type <> 'expense' then
    return new;
  end if;

  if new.company_advance_id is not null then
    if new.payment_status = 'paid' and new.approval_status = 'approved' and not new.is_voided then
      select id into v_entry_id
      from public.company_working_fund_entries
      where source_transaction_id = new.id
      limit 1;
      if v_entry_id is null then
        insert into public.company_working_fund_entries (
          organization_id, entry_type, direction, amount, entry_date,
          project_fund_id, note, source_advance_id, source_transaction_id, created_by
        ) values (
          new.organization_id, 'company_advance', 'debit', new.amount, new.transaction_date,
          (select project_fund_id from public.project_company_advances where id = new.company_advance_id),
          coalesce(new.note, 'Company Working Fund advance released'), new.company_advance_id,
          new.id, new.submitted_by
        );
      else
        update public.company_working_fund_entries
        set amount = new.amount, entry_date = new.transaction_date, note = coalesce(new.note, note)
        where id = v_entry_id;
      end if;
    end if;
    return new;
  end if;

  if new.operating_cost_entry_id is not null then
    if new.payment_status = 'paid' and new.approval_status = 'approved' and not new.is_voided then
      update public.operating_cost_entries
      set status = 'paid', paid_at = coalesce(new.paid_at, now()), paid_by = coalesce(new.paid_by, new.submitted_by),
          finance_transaction_id = new.id, updated_at = now()
      where id = new.operating_cost_entry_id
        and organization_id = new.organization_id;

      select id into v_entry_id
      from public.company_working_fund_entries
      where source_transaction_id = new.id
      limit 1;
      if v_entry_id is null then
        insert into public.company_working_fund_entries (
          organization_id, entry_type, direction, amount, entry_date,
          note, source_operating_cost_entry_id, source_transaction_id, created_by
        ) values (
          new.organization_id, 'operating_expense', 'debit', new.amount, new.transaction_date,
          coalesce(new.note, 'Operating cost'), new.operating_cost_entry_id, new.id, new.submitted_by
        );
      else
        update public.company_working_fund_entries
        set amount = new.amount, entry_date = new.transaction_date, note = coalesce(new.note, note)
        where id = v_entry_id;
      end if;
    end if;
    return new;
  end if;

  if new.labor_payment_run_id is not null then
    for v_item in
      select item.*
      from public.labor_payment_items item
      where item.payment_run_id = new.labor_payment_run_id
      order by item.id
    loop
      if new.payment_status = 'paid' and new.approval_status = 'approved' and not new.is_voided then
        select id into v_entry_id
        from public.project_fund_entries
        where source_labor_payment_item_id = v_item.id
        limit 1;
        if v_entry_id is null then
          insert into public.project_fund_entries (
            organization_id, project_fund_id, entry_type, direction, amount,
            entry_date, note, source_labor_payment_item_id,
            labor_payment_transaction_id, created_by, is_voided
          ) values (
            v_item.organization_id, v_item.project_fund_id, 'labor_payment', 'debit', v_item.amount,
            (select payment_date from public.labor_payment_runs where id = v_item.payment_run_id),
            coalesce(new.note, 'Tuesday/Friday box-maker labor payment'), v_item.id,
            new.id, new.submitted_by, false
          );
        else
          update public.project_fund_entries
          set amount = v_item.amount, labor_payment_transaction_id = new.id, is_voided = false,
              note = coalesce(new.note, note)
          where id = v_entry_id;
        end if;
      else
        update public.project_fund_entries
        set is_voided = true
        where source_labor_payment_item_id = v_item.id;
      end if;
    end loop;
    return new;
  end if;

  if v_fund_id is null and new.quotation_id is not null then
    select fund.id into v_fund_id
    from public.project_funds fund
    where fund.organization_id = new.organization_id
      and fund.quotation_id = new.quotation_id
    limit 1;
  end if;
  if v_fund_id is null then
    return new;
  end if;

  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount,
    entry_date, reference_no, note, source_transaction_id, created_by, is_voided
  ) values (
    new.organization_id, v_fund_id, 'project_expense', 'debit', new.amount,
    new.transaction_date, new.reference_number, coalesce(new.note, 'Project expense'),
    new.id, new.submitted_by,
    not (new.payment_status = 'paid' and new.approval_status = 'approved' and not new.is_voided)
  ) on conflict (source_transaction_id) do update set
    project_fund_id = excluded.project_fund_id,
    amount = excluded.amount,
    entry_date = excluded.entry_date,
    reference_no = excluded.reference_no,
    note = excluded.note,
    is_voided = excluded.is_voided;
  return new;
end;
$$;

drop trigger if exists finance_transaction_foundation_sync on public.finance_transactions;
create trigger finance_transaction_foundation_sync
after insert or update of project_fund_id, operating_cost_entry_id, company_advance_id,
  labor_payment_run_id, quotation_id, amount, transaction_date, reference_number,
  note, payment_status, approval_status, is_voided
on public.finance_transactions
for each row execute function private.sync_foundation_transaction_entry();

-- Project Funds are created by the approved-quotation trigger. Keep the old
-- callable signature as a hard stop so no user can create an unlinked fund.
drop function if exists public.create_project_fund(uuid, uuid, uuid, uuid, text, text, numeric, text);

create or replace function public.create_project_fund(
  p_organization_id uuid,
  p_quotation_id uuid,
  p_project_schedule_id uuid,
  p_production_job_id uuid,
  p_project_name text,
  p_client_name text,
  p_contract_amount numeric,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
begin
  raise exception 'Project Funds are created automatically when a Price Quotation is approved';
end;
$$;

create or replace function public.request_project_company_advance(
  p_project_fund_id uuid,
  p_requested_amount numeric,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_fund public.project_funds%rowtype;
  v_id uuid;
begin
  select * into v_fund from public.project_funds where id = p_project_fund_id for update;
  if not found or not private.has_text_role(v_fund.organization_id, array['project_manager', 'external_finance']) then
    raise exception 'Only External Finance or the Project Manager can request Company Working Fund support';
  end if;
  if coalesce(p_requested_amount, 0) <= 0 or v_fund.status = 'closed' then
    raise exception 'A positive amount is required for an open Project Fund';
  end if;
  insert into public.project_company_advances (
    organization_id, project_fund_id, requested_amount, note, requested_by
  ) values (
    v_fund.organization_id, v_fund.id, round(p_requested_amount, 2), nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_project_company_advance(
  p_advance_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_note text default null
)
returns public.project_company_advances
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_advance public.project_company_advances;
  v_amount numeric(14,2);
begin
  select * into v_advance from public.project_company_advances where id = p_advance_id for update;
  if not found or not private.finance_is_internal(v_advance.organization_id) then
    raise exception 'Only Internal Finance can review a Company Working Fund advance';
  end if;
  if p_decision not in ('approved', 'rejected') or v_advance.status <> 'requested' then
    raise exception 'This advance is not waiting for an Internal Finance decision';
  end if;
  v_amount := round(coalesce(p_approved_amount, v_advance.requested_amount), 2);
  if p_decision = 'approved' and (v_amount <= 0 or v_amount > v_advance.requested_amount) then
    raise exception 'Approved amount must be positive and cannot exceed the request';
  end if;
  update public.project_company_advances
  set status = p_decision,
      approved_amount = case when p_decision = 'approved' then v_amount else null end,
      approved_by = (select auth.uid()), approved_at = now(),
      decision_note = nullif(btrim(p_note), ''), updated_at = now()
  where id = p_advance_id
  returning * into v_advance;
  return v_advance;
end;
$$;

-- Old clients cannot accidentally bypass the account/proof release modal.
create or replace function public.release_project_company_advance(
  p_advance_id uuid,
  p_note text default null
)
returns public.project_company_advances
language plpgsql security definer
set search_path = public, private
as $$
begin
  raise exception 'Choose a payment account and upload proof before releasing a Company Working Fund advance';
end;
$$;

create or replace function public.release_project_company_advance(
  p_advance_id uuid,
  p_account_id uuid,
  p_note text,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns public.project_company_advances
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_advance public.project_company_advances;
  v_fund public.project_funds%rowtype;
  v_settings public.finance_foundation_settings;
  v_available numeric(14,2);
  v_amount numeric(14,2);
  v_category_id uuid;
  v_transaction_id uuid := gen_random_uuid();
begin
  select * into v_advance from public.project_company_advances where id = p_advance_id for update;
  if not found or not private.has_text_role(v_advance.organization_id, array['external_finance']) then
    raise exception 'Only External Finance can release a Company Working Fund advance';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_advance.organization_id::text));
  if v_advance.status <> 'approved' or v_advance.finance_transaction_id is not null then
    raise exception 'Only an approved, unreleased advance can be released';
  end if;
  select * into v_fund from public.project_funds where id = v_advance.project_fund_id for update;
  if not found or v_fund.status <> 'open' then
    raise exception 'The Project Fund is not open';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id and account.organization_id = v_advance.organization_id and account.is_active
  ) then
    raise exception 'Choose an active Finance payment account';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760
    or p_receipt_storage_path !~* ('^' || v_advance.organization_id::text || '/foundation-releases/advances/' || v_advance.id::text || '\.(jpg|jpeg|png|webp)$') then
    raise exception 'Upload a valid advance release proof image no larger than 10 MB';
  end if;
  if not exists (select 1 from storage.objects object where object.bucket_id = 'finance-receipts' and object.name = p_receipt_storage_path) then
    raise exception 'Upload the advance release proof before saving the release';
  end if;

  select * into v_settings from public.finance_foundation_settings where organization_id = v_advance.organization_id;
  select coalesce(v_settings.opening_working_funds, 0)
    + coalesce(sum(case when entry.direction = 'credit' then entry.amount else -entry.amount end), 0)
  into v_available
  from public.company_working_fund_entries entry
  where entry.organization_id = v_advance.organization_id;
  v_amount := coalesce(v_advance.approved_amount, v_advance.requested_amount);
  if v_amount > greatest(v_available, 0) + 0.001 then
    raise exception 'Working Funds are insufficient for this advance';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.organization_id = v_advance.organization_id
    and category.direction = 'expense'
    and category.is_active
    and lower(category.name) = 'miscellaneous expenses'
  limit 1;
  if v_category_id is null then
    select category.id into v_category_id
    from public.finance_categories category
    where category.organization_id = v_advance.organization_id
      and category.direction = 'expense'
      and category.is_active
    order by category.is_system desc, category.name
    limit 1;
  end if;
  if v_category_id is null then
    raise exception 'Create an active Cash Out category before releasing the advance';
  end if;

  perform set_config('huswell.allow_foundation_release', 'on', true);
  insert into public.finance_transactions (
    id, organization_id, transaction_type, amount, category_id, account_id,
    note, reference_number, transaction_date, payment_status, approval_status,
    paid_at, paid_by, approved_at, approved_by, receipt_storage_path,
    receipt_file_name, receipt_content_type, receipt_file_size, submitted_by,
    company_advance_id
  ) values (
    v_transaction_id, v_advance.organization_id, 'expense', v_amount, v_category_id, p_account_id,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance released'),
    'ADV-' || left(replace(v_advance.id::text, '-', ''), 12), current_date, 'paid', 'approved',
    now(), (select auth.uid()), now(), (select auth.uid()), p_receipt_storage_path,
    btrim(p_receipt_file_name), p_receipt_content_type, p_receipt_file_size, (select auth.uid()),
    v_advance.id
  );
  perform set_config('huswell.allow_foundation_release', 'off', true);

  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount, entry_date,
    note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, v_fund.id, 'company_advance', 'credit', v_amount, current_date,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance released'), v_advance.id, (select auth.uid())
  );

  update public.project_company_advances
  set status = 'released', released_amount = v_amount, released_by = (select auth.uid()),
      released_at = now(), finance_transaction_id = v_transaction_id, updated_at = now()
  where id = v_advance.id
  returning * into v_advance;
  return v_advance;
end;
$$;

create or replace function public.record_project_company_advance_repayment(
  p_advance_id uuid,
  p_amount numeric,
  p_note text default null
)
returns public.project_company_advances
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_advance public.project_company_advances;
  v_repaid numeric(14,2);
  v_outstanding numeric(14,2);
begin
  select * into v_advance from public.project_company_advances where id = p_advance_id for update;
  if not found or not private.has_text_role(v_advance.organization_id, array[
    'super_admin', 'owner', 'admin', 'internal_finance', 'external_finance'
  ]) then
    raise exception 'Advance not found or not accessible';
  end if;
  select coalesce(sum(entry.amount), 0) into v_repaid
  from public.project_fund_entries entry
  where entry.source_advance_id = v_advance.id
    and entry.entry_type = 'company_advance_repayment'
    and entry.direction = 'debit' and not entry.is_voided;
  v_outstanding := round(coalesce(v_advance.released_amount, 0) - v_repaid, 2);
  if coalesce(p_amount, 0) <= 0 or p_amount > v_outstanding + 0.001 then
    raise exception 'Repayment must be positive and cannot exceed the outstanding advance';
  end if;
  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount, entry_date,
    note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, v_advance.project_fund_id, 'company_advance_repayment', 'debit', round(p_amount, 2), current_date,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance repayment'), v_advance.id, (select auth.uid())
  );
  insert into public.company_working_fund_entries (
    organization_id, entry_type, direction, amount, entry_date, project_fund_id,
    note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, 'advance_repayment', 'credit', round(p_amount, 2), current_date, v_advance.project_fund_id,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance repayment'), v_advance.id, (select auth.uid())
  );
  v_repaid := v_repaid + round(p_amount, 2);
  update public.project_company_advances
  set status = case when v_repaid >= v_advance.released_amount - 0.001 then 'repaid' else 'partially_repaid' end,
      updated_at = now()
  where id = v_advance.id
  returning * into v_advance;
  return v_advance;
end;
$$;

-- Labor flow: Production/Project Manager submits accomplishment, Internal
-- Finance verifies and approves the run, and External Finance releases it.
create or replace function public.create_labor_payment_run(
  p_organization_id uuid,
  p_payment_date date,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_run_id uuid;
  v_run_status text;
  v_day integer := extract(isodow from p_payment_date);
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can prepare labor payment runs';
  end if;
  if p_payment_date is null or v_day not in (2, 5) then
    raise exception 'Labor payments can only be scheduled for Tuesday or Friday';
  end if;
  insert into public.labor_payment_runs (organization_id, payment_date, schedule_day, note, created_by)
  values (p_organization_id, p_payment_date, case when v_day = 2 then 'tuesday' else 'friday' end, nullif(btrim(p_note), ''), (select auth.uid()))
  on conflict (organization_id, payment_date) do update set note = excluded.note
  returning id, status into v_run_id, v_run_status;
  if v_run_status in ('paid', 'cancelled') then
    raise exception 'This payment date already has a closed labor payment run';
  end if;
  insert into public.labor_payment_items (
    organization_id, payment_run_id, labor_rate_id, accomplishment_id, project_fund_id, amount
  )
  select accomplishment.organization_id, v_run_id, accomplishment.labor_rate_id, accomplishment.id,
    accomplishment.project_fund_id, accomplishment.payable_amount
  from public.labor_accomplishments accomplishment
  where accomplishment.organization_id = p_organization_id
    and accomplishment.status = 'verified'
    and accomplishment.accomplishment_date <= p_payment_date
    and not exists (select 1 from public.labor_payment_items item where item.accomplishment_id = accomplishment.id)
  on conflict (accomplishment_id) do nothing;
  if not exists (select 1 from public.labor_payment_items item where item.payment_run_id = v_run_id) then
    raise exception 'There are no verified unpaid accomplishments for this payment run';
  end if;
  return v_run_id;
end;
$$;

create or replace function public.approve_labor_payment_run(
  p_payment_run_id uuid,
  p_note text default null
)
returns public.labor_payment_runs
language plpgsql security definer
set search_path = public, private
as $$
declare v_run public.labor_payment_runs;
begin
  select * into v_run from public.labor_payment_runs where id = p_payment_run_id for update;
  if not found or not private.finance_is_internal(v_run.organization_id) then
    raise exception 'Only Internal Finance can approve a labor payment run';
  end if;
  if v_run.status <> 'draft' then raise exception 'Only draft labor payment runs can be approved'; end if;
  update public.labor_payment_runs
  set status = 'approved', note = coalesce(nullif(btrim(p_note), ''), note), approved_by = (select auth.uid()), approved_at = now(), updated_at = now()
  where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;

-- Keep the old signature only as a hard stop so Internal Finance cannot post
-- a labor run without a real payment account and proof.
create or replace function public.pay_labor_payment_run(
  p_payment_run_id uuid,
  p_note text default null
)
returns public.labor_payment_runs
language plpgsql security definer
set search_path = public, private
as $$
begin
  raise exception 'Labor payment runs must be released by External Finance with an account and proof';
end;
$$;

create or replace function public.release_labor_payment_run(
  p_payment_run_id uuid,
  p_account_id uuid,
  p_note text,
  p_receipt_storage_path text,
  p_receipt_file_name text,
  p_receipt_content_type text,
  p_receipt_file_size bigint
)
returns public.labor_payment_runs
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_run public.labor_payment_runs;
  v_item record;
  v_available numeric(14,2);
  v_category_id uuid;
  v_transaction_id uuid := gen_random_uuid();
begin
  select * into v_run from public.labor_payment_runs where id = p_payment_run_id for update;
  if not found or not private.has_text_role(v_run.organization_id, array['external_finance']) then
    raise exception 'Only External Finance can release a labor payment run';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_run.organization_id::text));
  if v_run.status <> 'approved' or v_run.finance_transaction_id is not null then
    raise exception 'Only an approved, unreleased labor payment run can be released';
  end if;
  if not exists (
    select 1 from public.finance_accounts account
    where account.id = p_account_id and account.organization_id = v_run.organization_id and account.is_active
  ) then
    raise exception 'Choose an active Finance payment account';
  end if;
  if p_receipt_storage_path is null
    or p_receipt_file_name is null
    or p_receipt_content_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_receipt_file_size is null
    or p_receipt_file_size not between 1 and 10485760
    or p_receipt_storage_path !~* ('^' || v_run.organization_id::text || '/foundation-releases/labor-runs/' || v_run.id::text || '\.(jpg|jpeg|png|webp)$') then
    raise exception 'Upload a valid labor payment proof image no larger than 10 MB';
  end if;
  if not exists (select 1 from storage.objects object where object.bucket_id = 'finance-receipts' and object.name = p_receipt_storage_path) then
    raise exception 'Upload the labor payment proof before saving the release';
  end if;

  for v_item in
    select item.project_fund_id, sum(item.amount)::numeric(14,2) as amount
    from public.labor_payment_items item
    where item.payment_run_id = v_run.id
    group by item.project_fund_id
  loop
    perform 1
    from public.project_funds fund
    where fund.id = v_item.project_fund_id
      and fund.organization_id = v_run.organization_id
      and fund.status = 'open'
    for update;
    if not found then
      raise exception 'The Project Fund for this labor payment is not open';
    end if;
    select summary.available_balance into v_available
    from public.finance_project_fund_summary summary
    where summary.id = v_item.project_fund_id;
    if coalesce(v_available, 0) < v_item.amount - 0.001 then
      raise exception 'Project Fund does not have enough available money for this labor payment';
    end if;
  end loop;

  select category.id into v_category_id
  from public.finance_categories category
  where category.organization_id = v_run.organization_id
    and category.direction = 'expense'
    and category.is_active
    and lower(category.name) = 'salaries and wages'
  limit 1;
  if v_category_id is null then
    select category.id into v_category_id
    from public.finance_categories category
    where category.organization_id = v_run.organization_id
      and category.direction = 'expense'
      and category.is_active
    order by category.is_system desc, category.name
    limit 1;
  end if;
  if v_category_id is null then
    raise exception 'Create an active Cash Out category before releasing labor';
  end if;

  perform set_config('huswell.allow_foundation_release', 'on', true);
  insert into public.finance_transactions (
    id, organization_id, transaction_type, amount, category_id, account_id,
    note, reference_number, transaction_date, payment_status, approval_status,
    paid_at, paid_by, approved_at, approved_by, receipt_storage_path,
    receipt_file_name, receipt_content_type, receipt_file_size, submitted_by,
    labor_payment_run_id
  )
  select
    v_transaction_id, v_run.organization_id, 'expense', coalesce(sum(item.amount), 0), v_category_id, p_account_id,
    coalesce(nullif(btrim(p_note), ''), 'Tuesday/Friday box-maker labor payment'),
    'LABOR-' || left(replace(v_run.id::text, '-', ''), 12), v_run.payment_date, 'paid', 'approved',
    now(), (select auth.uid()), now(), (select auth.uid()), p_receipt_storage_path,
    btrim(p_receipt_file_name), p_receipt_content_type, p_receipt_file_size, (select auth.uid()),
    v_run.id
  from public.labor_payment_items item
  where item.payment_run_id = v_run.id;
  perform set_config('huswell.allow_foundation_release', 'off', true);

  update public.labor_payment_runs
  set status = 'paid', note = coalesce(nullif(btrim(p_note), ''), note), paid_by = (select auth.uid()),
      paid_at = now(), finance_transaction_id = v_transaction_id, updated_at = now()
  where id = v_run.id
  returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.create_operating_cost_template(
  p_organization_id uuid,
  p_name text,
  p_category text,
  p_cost_class text,
  p_expected_monthly_amount numeric,
  p_due_day smallint default null,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can manage operating cost templates';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or nullif(btrim(coalesce(p_category, '')), '') is null
    or p_cost_class not in ('fixed', 'variable') or coalesce(p_expected_monthly_amount, 0) < 0 then
    raise exception 'Operating cost template values are invalid';
  end if;
  insert into public.operating_cost_templates (
    organization_id, name, category, cost_class, expected_monthly_amount, due_day, note, created_by
  ) values (
    p_organization_id, btrim(p_name), btrim(p_category), p_cost_class, round(p_expected_monthly_amount, 2), p_due_day,
    nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_operating_cost_entry(
  p_organization_id uuid,
  p_cost_date date,
  p_name text,
  p_category text,
  p_cost_class text,
  p_amount numeric,
  p_status text default 'planned',
  p_template_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can record operating costs';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null
    or nullif(btrim(coalesce(p_category, '')), '') is null
    or coalesce(p_amount, 0) <= 0
    or p_cost_class not in ('fixed', 'variable')
    or p_status <> 'planned' then
    raise exception 'Operating costs must be created as Planned and paid through Finance Cash Out';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.operating_cost_templates template
    where template.id = p_template_id and template.organization_id = p_organization_id
  ) then
    raise exception 'The selected operating cost template does not belong to this organization';
  end if;
  insert into public.operating_cost_entries (
    organization_id, template_id, cost_date, month_start, name, category, cost_class, amount, status,
    note, created_by
  ) values (
    p_organization_id, p_template_id, coalesce(p_cost_date, current_date), date_trunc('month', coalesce(p_cost_date, current_date))::date,
    btrim(p_name), btrim(p_category), p_cost_class, round(p_amount, 2), 'planned',
    nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Internal Finance verifies Cash Out and then External Finance releases it.
create or replace function public.approve_and_pay_finance_transaction(
  p_transaction_id uuid,
  p_decision_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_transaction public.finance_transactions%rowtype;
begin
  select * into v_transaction from public.finance_transactions where id = p_transaction_id for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense'
    or v_transaction.is_voided
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status not in ('pending', 'approved') then
    raise exception 'Only an unpaid pending or approved Cash Out can be verified';
  end if;
  update public.finance_transactions
  set approval_status = 'approved',
      approved_at = coalesce(v_transaction.approved_at, now()),
      approved_by = coalesce(v_transaction.approved_by, (select auth.uid())),
      decision_note = coalesce(nullif(btrim(coalesce(p_decision_note, '')), ''), v_transaction.decision_note)
  where id = v_transaction.id;
  return v_transaction.id;
end;
$$;

create or replace function public.review_finance_transaction(
  p_transaction_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_transaction public.finance_transactions%rowtype;
begin
  select * into v_transaction from public.finance_transactions where id = p_transaction_id for update;
  if not found or not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense' or v_transaction.approval_status <> 'pending' then
    raise exception 'Only pending Cash Out transactions can be reviewed';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose Approved or Rejected';
  end if;
  update public.finance_transactions
  set approval_status = p_decision,
      approved_by = (select auth.uid()),
      approved_at = now(),
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = v_transaction.id;
  return v_transaction.id;
end;
$$;

-- Marking an approved Cash Out paid is the External Finance release action.
-- Internal Finance can still settle legacy supplier/commission records, but
-- ordinary project/operating/labor releases must use External Finance.
create or replace function public.mark_finance_transaction_paid(
  p_transaction_id uuid,
  p_paid_at timestamptz default now()
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_transaction public.finance_transactions%rowtype;
  v_fund_id uuid;
  v_available numeric(14,2);
begin
  select * into v_transaction from public.finance_transactions where id = p_transaction_id for update;
  if not found or not private.finance_is_external_or_internal(v_transaction.organization_id) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.payment_status = 'paid' then
    return v_transaction.id;
  end if;
  if v_transaction.transaction_type <> 'expense' or v_transaction.approval_status <> 'approved' then
    raise exception 'Only an approved Cash Out can be released';
  end if;
  if v_transaction.account_id is null or not exists (
    select 1 from public.finance_accounts account
    where account.id = v_transaction.account_id
      and account.organization_id = v_transaction.organization_id
      and account.is_active
  ) then
    raise exception 'Assign an active Finance payment account before releasing this Cash Out';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_transaction.organization_id::text));
  if v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    v_fund_id := v_transaction.project_fund_id;
    if v_fund_id is null and v_transaction.quotation_id is not null then
      select fund.id into v_fund_id
      from public.project_funds fund
      where fund.organization_id = v_transaction.organization_id
        and fund.quotation_id = v_transaction.quotation_id
      limit 1;
    end if;
    if v_fund_id is not null then
      perform 1
      from public.project_funds fund
      where fund.id = v_fund_id
        and fund.organization_id = v_transaction.organization_id
        and fund.status = 'open'
      for update;
      if not found then
        raise exception 'The Project Fund for this Cash Out is not open';
      end if;
      select summary.available_balance into v_available
      from public.finance_project_fund_summary summary
      where summary.id = v_fund_id;
      if coalesce(v_available, 0) < v_transaction.amount - 0.001 then
        raise exception 'Project Fund does not have enough available money for this Cash Out';
      end if;
    end if;
  end if;
  if private.has_text_role(v_transaction.organization_id, array['external_finance'])
    and v_transaction.supplier_payable_id is null
    and v_transaction.commission_summary_id is null
    and v_transaction.commission_allocation_id is null then
    null;
  elsif not private.finance_is_internal(v_transaction.organization_id) then
    raise exception 'Only External Finance can release this Cash Out';
  end if;
  update public.finance_transactions
  set payment_status = 'paid', paid_at = coalesce(p_paid_at, now()), paid_by = (select auth.uid())
  where id = v_transaction.id;
  perform private.sync_paid_finance_source(v_transaction.id);
  return v_transaction.id;
end;
$$;

-- Link a planned operational cost to the single Cash Out that will verify and
-- release it. The entry remains planned until External Finance releases the
-- linked transaction, so operating-cost reporting cannot drift from cash.
create or replace function public.link_operating_cost_finance_transaction(
  p_transaction_id uuid,
  p_operating_cost_entry_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_transaction public.finance_transactions%rowtype;
  v_entry public.operating_cost_entries%rowtype;
begin
  select * into v_transaction
  from public.finance_transactions
  where id = p_transaction_id
  for update;
  if not found or not private.has_text_role(v_transaction.organization_id, array['external_finance']) then
    raise exception 'Finance transaction not found';
  end if;
  if v_transaction.transaction_type <> 'expense'
    or v_transaction.payment_status <> 'unpaid'
    or v_transaction.approval_status <> 'pending' then
    raise exception 'Only a pending unpaid Cash Out can be linked to an operating cost';
  end if;
  if v_transaction.operating_cost_entry_id is not null
    and v_transaction.operating_cost_entry_id <> p_operating_cost_entry_id then
    raise exception 'This Cash Out is already linked to another operating cost';
  end if;

  select * into v_entry
  from public.operating_cost_entries
  where id = p_operating_cost_entry_id
  for update;
  if not found or v_entry.organization_id <> v_transaction.organization_id then
    raise exception 'Operating cost not found or not accessible';
  end if;
  if v_entry.status <> 'planned' or v_entry.finance_transaction_id is not null then
    raise exception 'Only an unlinked Planned operating cost can be submitted';
  end if;
  if round(v_entry.amount, 2) <> round(v_transaction.amount, 2) then
    raise exception 'Cash Out amount must match the planned operating cost amount';
  end if;

  update public.finance_transactions
  set operating_cost_entry_id = v_entry.id
  where id = v_transaction.id;
  update public.operating_cost_entries
  set finance_transaction_id = v_transaction.id, updated_at = now()
  where id = v_entry.id;
  return v_transaction.id;
end;
$$;

-- Existing UI callers need the new function after this migration.
revoke all on function public.release_project_company_advance(uuid, text) from public, anon;
revoke all on function public.release_project_company_advance(uuid, uuid, text, text, text, text, bigint) from public, anon;
revoke all on function public.release_labor_payment_run(uuid, uuid, text, text, text, text, bigint) from public, anon;
revoke all on function public.link_operating_cost_finance_transaction(uuid, uuid) from public, anon;
grant execute on function public.release_project_company_advance(uuid, text) to authenticated;
grant execute on function public.release_project_company_advance(uuid, uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.release_labor_payment_run(uuid, uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.link_operating_cost_finance_transaction(uuid, uuid) to authenticated;

-- The existing read policy resolves foundation release proof through its
-- Finance transaction after release. These insert/delete rules cover the
-- short window before the transaction row exists.
drop policy if exists "finance receipts: foundation release upload" on storage.objects;
create policy "finance receipts: foundation release upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'finance-receipts'
  and (
    (
      storage.objects.name ~* '^[0-9a-f-]{36}/foundation-releases/advances/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.project_company_advances advance
        where advance.organization_id::text = split_part(storage.objects.name, '/', 1)
          and advance.id::text = split_part(split_part(storage.objects.name, '/', 4), '.', 1)
          and private.has_text_role(advance.organization_id, array['external_finance'])
      )
    )
    or (
      storage.objects.name ~* '^[0-9a-f-]{36}/foundation-releases/labor-runs/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      and exists (
        select 1 from public.labor_payment_runs run
        where run.organization_id::text = split_part(storage.objects.name, '/', 1)
          and run.id::text = split_part(split_part(storage.objects.name, '/', 4), '.', 1)
          and private.has_text_role(run.organization_id, array['external_finance'])
      )
    )
  )
);

drop policy if exists "finance receipts: foundation release delete" on storage.objects;
create policy "finance receipts: foundation release delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'finance-receipts'
  and (
    exists (
      select 1 from public.project_company_advances advance
      where advance.organization_id::text = split_part(storage.objects.name, '/', 1)
        and advance.id::text = split_part(split_part(storage.objects.name, '/', 4), '.', 1)
        and private.has_text_role(advance.organization_id, array['external_finance'])
    )
    or exists (
      select 1 from public.labor_payment_runs run
      where run.organization_id::text = split_part(storage.objects.name, '/', 1)
        and run.id::text = split_part(split_part(storage.objects.name, '/', 4), '.', 1)
        and private.has_text_role(run.organization_id, array['external_finance'])
    )
  )
);

commit;
