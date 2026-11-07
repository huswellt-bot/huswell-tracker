-- Huswell Trading financial foundation.
-- Additive control layer for company working funds, project funds, labor,
-- operating costs, and break-even reporting. Existing Finance transactions
-- remain authoritative for actual account balances.

begin;

create table if not exists public.finance_foundation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opening_capital_funds numeric(14,2) not null default 0 check (opening_capital_funds >= 0),
  opening_working_funds numeric(14,2) not null default 0 check (opening_working_funds >= 0),
  minimum_working_funds numeric(14,2) not null default 0 check (minimum_working_funds >= 0),
  desired_monthly_profit numeric(14,2) not null default 0 check (desired_monthly_profit >= 0),
  default_vat_rate numeric(5,2) not null default 12 check (default_vat_rate >= 0 and default_vat_rate <= 100),
  revenue_basis text not null default 'net_sales' check (revenue_basis in ('net_sales', 'collections')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists public.project_funds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid references public.quotations(id) on delete restrict,
  project_schedule_id uuid references public.project_schedules(id) on delete set null,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  project_name text not null check (btrim(project_name) <> ''),
  client_name text,
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  status text not null default 'open' check (status in ('open', 'on_hold', 'closed')),
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quotation_id)
);

create index if not exists project_funds_org_status_idx
  on public.project_funds(organization_id, status, created_at desc);

create table if not exists public.project_fund_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'client_payment', 'company_advance', 'company_advance_repayment',
    'project_expense', 'labor_payment', 'refund', 'adjustment'
  )),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(14,2) not null check (amount > 0),
  entry_date date not null default current_date,
  reference_no text,
  note text,
  source_payment_id uuid unique references public.quotation_payment_records(id) on delete restrict,
  source_transaction_id uuid unique references public.finance_transactions(id) on delete restrict,
  source_advance_id uuid,
  source_labor_payment_item_id uuid,
  is_voided boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (entry_type in ('client_payment', 'company_advance', 'adjustment') and direction = 'credit')
    or (entry_type in ('company_advance_repayment', 'project_expense', 'labor_payment', 'refund') and direction = 'debit')
  )
);

create index if not exists project_fund_entries_org_fund_date_idx
  on public.project_fund_entries(organization_id, project_fund_id, entry_date desc, created_at desc);

create table if not exists public.company_working_fund_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'capital_in', 'transfer_in', 'transfer_out', 'company_advance',
    'advance_repayment', 'operating_expense', 'other_in', 'other_out', 'adjustment'
  )),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(14,2) not null check (amount > 0),
  entry_date date not null default current_date,
  project_fund_id uuid references public.project_funds(id) on delete restrict,
  reference_no text,
  note text,
  source_advance_id uuid,
  source_operating_cost_entry_id uuid,
  source_transaction_id uuid references public.finance_transactions(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (entry_type in ('capital_in', 'transfer_in', 'advance_repayment', 'other_in', 'adjustment') and direction = 'credit')
    or (entry_type in ('transfer_out', 'company_advance', 'operating_expense', 'other_out') and direction = 'debit')
  )
);

create index if not exists company_working_fund_entries_org_date_idx
  on public.company_working_fund_entries(organization_id, entry_date desc, created_at desc);

create table if not exists public.project_company_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  approved_amount numeric(14,2) check (approved_amount is null or approved_amount > 0),
  released_amount numeric(14,2) not null default 0 check (released_amount >= 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'released', 'partially_repaid', 'repaid', 'cancelled')),
  note text,
  decision_note text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or approved_amount <= requested_amount),
  check (released_amount <= coalesce(approved_amount, requested_amount))
);

alter table public.project_fund_entries
  drop constraint if exists project_fund_entries_source_advance_id_fkey;
alter table public.project_fund_entries
  add constraint project_fund_entries_source_advance_id_fkey
  foreign key (source_advance_id) references public.project_company_advances(id) on delete restrict;

alter table public.company_working_fund_entries
  drop constraint if exists company_working_fund_entries_source_advance_id_fkey;
alter table public.company_working_fund_entries
  add constraint company_working_fund_entries_source_advance_id_fkey
  foreign key (source_advance_id) references public.project_company_advances(id) on delete restrict;

create index if not exists project_company_advances_org_status_idx
  on public.project_company_advances(organization_id, status, requested_at desc);

create table if not exists public.project_box_maker_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  box_maker_name text not null check (btrim(box_maker_name) <> ''),
  task_name text not null check (btrim(task_name) <> ''),
  unit_label text not null default 'task' check (btrim(unit_label) <> ''),
  unit_rate numeric(14,2) not null check (unit_rate > 0),
  planned_quantity numeric(14,3) not null default 0 check (planned_quantity >= 0),
  agreed_total_rate numeric(14,2) not null check (agreed_total_rate > 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_box_maker_rates_org_project_idx
  on public.project_box_maker_rates(organization_id, project_fund_id, status);

create table if not exists public.labor_accomplishments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  labor_rate_id uuid not null references public.project_box_maker_rates(id) on delete restrict,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  accomplishment_date date not null default current_date,
  completed_quantity numeric(14,3) not null check (completed_quantity >= 0),
  accepted_quantity numeric(14,3) not null check (accepted_quantity >= 0),
  rejected_quantity numeric(14,3) not null default 0 check (rejected_quantity >= 0),
  unit_rate numeric(14,2) not null check (unit_rate > 0),
  payable_amount numeric(14,2) generated always as (round(accepted_quantity * unit_rate, 2)) stored,
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
  note text,
  evidence_path text,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (accepted_quantity <= completed_quantity),
  check (rejected_quantity <= completed_quantity)
);

create index if not exists labor_accomplishments_org_status_date_idx
  on public.labor_accomplishments(organization_id, status, accomplishment_date desc);

create table if not exists public.labor_payment_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_date date not null,
  schedule_day text not null check (schedule_day in ('tuesday', 'friday')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'cancelled')),
  note text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, payment_date)
);

create table if not exists public.labor_payment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_run_id uuid not null references public.labor_payment_runs(id) on delete cascade,
  labor_rate_id uuid not null references public.project_box_maker_rates(id) on delete restrict,
  accomplishment_id uuid not null unique references public.labor_accomplishments(id) on delete restrict,
  project_fund_id uuid not null references public.project_funds(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.project_fund_entries
  drop constraint if exists project_fund_entries_source_labor_payment_item_id_fkey;
alter table public.project_fund_entries
  add constraint project_fund_entries_source_labor_payment_item_id_fkey
  foreign key (source_labor_payment_item_id) references public.labor_payment_items(id) on delete restrict;

create table if not exists public.operating_cost_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  category text not null check (btrim(category) <> ''),
  cost_class text not null default 'fixed' check (cost_class in ('fixed', 'variable')),
  expected_monthly_amount numeric(14,2) not null default 0 check (expected_monthly_amount >= 0),
  due_day smallint check (due_day is null or due_day between 1 and 31),
  is_active boolean not null default true,
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operating_cost_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid references public.operating_cost_templates(id) on delete set null,
  cost_date date not null default current_date,
  month_start date not null,
  name text not null check (btrim(name) <> ''),
  category text not null check (btrim(category) <> ''),
  cost_class text not null check (cost_class in ('fixed', 'variable')),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'planned' check (status in ('planned', 'paid', 'voided')),
  note text,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (month_start = date_trunc('month', cost_date)::date),
  check ((status = 'paid' and paid_at is not null) or (status <> 'paid' and paid_at is null))
);

alter table public.company_working_fund_entries
  drop constraint if exists company_working_fund_entries_source_operating_cost_entry_id_fkey;
alter table public.company_working_fund_entries
  add constraint company_working_fund_entries_source_operating_cost_entry_id_fkey
  foreign key (source_operating_cost_entry_id) references public.operating_cost_entries(id) on delete restrict;

create index if not exists operating_cost_templates_org_active_idx
  on public.operating_cost_templates(organization_id, is_active, category);
create index if not exists operating_cost_entries_org_month_idx
  on public.operating_cost_entries(organization_id, month_start desc, status, cost_class);

alter table public.finance_transactions
  add column if not exists project_fund_id uuid references public.project_funds(id) on delete restrict;
create index if not exists finance_transactions_project_fund_idx
  on public.finance_transactions(organization_id, project_fund_id, transaction_date desc)
  where project_fund_id is not null;

create or replace view public.finance_project_fund_summary
with (security_invoker = true)
as
select
  fund.organization_id,
  fund.id,
  fund.quotation_id,
  fund.project_schedule_id,
  fund.production_job_id,
  fund.project_name,
  fund.client_name,
  fund.contract_amount,
  fund.status,
  fund.note,
  fund.created_at,
  coalesce(entry_totals.client_payments, 0)::numeric(14,2) as client_payments,
  coalesce(entry_totals.company_advances, 0)::numeric(14,2) as company_advances,
  coalesce(entry_totals.company_advance_repayments, 0)::numeric(14,2) as company_advance_repayments,
  coalesce(entry_totals.project_expenses, 0)::numeric(14,2) as project_expenses,
  coalesce(entry_totals.labor_payments, 0)::numeric(14,2) as labor_payments,
  coalesce(entry_totals.total_credits, 0)::numeric(14,2) as total_credits,
  coalesce(entry_totals.total_debits, 0)::numeric(14,2) as total_debits,
  round(coalesce(entry_totals.total_credits, 0) - coalesce(entry_totals.total_debits, 0), 2)::numeric(14,2) as available_balance,
  coalesce(rate_totals.agreed_labor, 0)::numeric(14,2) as agreed_labor,
  coalesce(rate_totals.verified_labor, 0)::numeric(14,2) as verified_labor,
  coalesce(rate_totals.paid_labor, 0)::numeric(14,2) as paid_labor,
  greatest(round(coalesce(rate_totals.agreed_labor, 0) - coalesce(rate_totals.paid_labor, 0), 2), 0)::numeric(14,2) as remaining_labor,
  greatest(round(coalesce(entry_totals.company_advances, 0) - coalesce(entry_totals.company_advance_repayments, 0), 2), 0)::numeric(14,2) as outstanding_advance
from public.project_funds fund
left join lateral (
  select
    sum(entry.amount) filter (where not entry.is_voided and entry.entry_type = 'client_payment' and entry.direction = 'credit') as client_payments,
    sum(entry.amount) filter (where not entry.is_voided and entry.entry_type = 'company_advance' and entry.direction = 'credit') as company_advances,
    sum(entry.amount) filter (where not entry.is_voided and entry.entry_type = 'company_advance_repayment' and entry.direction = 'debit') as company_advance_repayments,
    sum(entry.amount) filter (where not entry.is_voided and entry.entry_type = 'project_expense' and entry.direction = 'debit') as project_expenses,
    sum(entry.amount) filter (where not entry.is_voided and entry.entry_type = 'labor_payment' and entry.direction = 'debit') as labor_payments,
    sum(entry.amount) filter (where not entry.is_voided and entry.direction = 'credit') as total_credits,
    sum(entry.amount) filter (where not entry.is_voided and entry.direction = 'debit') as total_debits
  from public.project_fund_entries entry
  where entry.project_fund_id = fund.id
) entry_totals on true
left join lateral (
  select
    sum(rate.agreed_total_rate) filter (where rate.status = 'active') as agreed_labor,
    coalesce((select sum(accomplishment.payable_amount) from public.labor_accomplishments accomplishment join public.project_box_maker_rates rate2 on rate2.id = accomplishment.labor_rate_id where rate2.project_fund_id = fund.id and accomplishment.status = 'verified'), 0) as verified_labor,
    coalesce((select sum(item.amount) from public.labor_payment_items item join public.labor_payment_runs payment_run on payment_run.id = item.payment_run_id where item.project_fund_id = fund.id and payment_run.status = 'paid'), 0) as paid_labor
  from public.project_box_maker_rates rate
  where rate.project_fund_id = fund.id
) rate_totals on true;

create or replace view public.finance_project_labor_summary
with (security_invoker = true)
as
select
  rate.organization_id,
  rate.id,
  rate.project_fund_id,
  fund.project_name,
  fund.client_name,
  rate.production_job_id,
  rate.employee_id,
  rate.box_maker_name,
  rate.task_name,
  rate.unit_label,
  rate.unit_rate,
  rate.planned_quantity,
  rate.agreed_total_rate,
  rate.status,
  coalesce(accomplishment_totals.completed_quantity, 0)::numeric(14,3) as completed_quantity,
  coalesce(accomplishment_totals.accepted_quantity, 0)::numeric(14,3) as accepted_quantity,
  coalesce(accomplishment_totals.verified_amount, 0)::numeric(14,2) as verified_amount,
  coalesce(payment_totals.paid_amount, 0)::numeric(14,2) as paid_amount,
  coalesce(payment_totals.pending_amount, 0)::numeric(14,2) as pending_amount,
  greatest(round(rate.agreed_total_rate - coalesce(payment_totals.paid_amount, 0) - coalesce(payment_totals.pending_amount, 0), 2), 0)::numeric(14,2) as remaining_amount
from public.project_box_maker_rates rate
join public.project_funds fund on fund.id = rate.project_fund_id
left join lateral (
  select
    sum(accomplishment.completed_quantity) filter (where accomplishment.status <> 'rejected') as completed_quantity,
    sum(accomplishment.accepted_quantity) filter (where accomplishment.status = 'verified') as accepted_quantity,
    sum(accomplishment.payable_amount) filter (where accomplishment.status = 'verified') as verified_amount
  from public.labor_accomplishments accomplishment
  where accomplishment.labor_rate_id = rate.id
) accomplishment_totals on true
left join lateral (
  select
    sum(item.amount) filter (where run.status = 'paid') as paid_amount,
    sum(item.amount) filter (where run.status in ('draft', 'approved')) as pending_amount
  from public.labor_payment_items item
  join public.labor_payment_runs run on run.id = item.payment_run_id
  where item.labor_rate_id = rate.id
) payment_totals on true;

create or replace view public.finance_operating_cost_summary
with (security_invoker = true)
as
select
  entry.organization_id,
  entry.month_start,
  entry.cost_class,
  count(*) filter (where entry.status <> 'voided')::integer as entry_count,
  coalesce(sum(entry.amount) filter (where entry.status = 'paid'), 0)::numeric(14,2) as actual_amount,
  coalesce(sum(entry.amount) filter (where entry.status = 'planned'), 0)::numeric(14,2) as planned_amount
from public.operating_cost_entries entry
group by entry.organization_id, entry.month_start, entry.cost_class;

insert into public.finance_foundation_settings (organization_id, created_by)
select organization.id, organization.created_by
from public.organizations organization
on conflict (organization_id) do nothing;

insert into public.project_funds (
  organization_id, quotation_id, project_name, client_name, contract_amount, created_by
)
select
  quotation.organization_id,
  quotation.id,
  coalesce(nullif(btrim(quotation.project_name), ''), quotation.quotation_no, 'Project'),
  nullif(btrim(quotation.client_name), ''),
  coalesce(quotation.total_amount, 0),
  coalesce(quotation.created_by, organization.created_by)
from public.quotations quotation
join public.organizations organization on organization.id = quotation.organization_id
where quotation.status::text = 'approved'
  and quotation.document_type = 'price_quotation'
on conflict (organization_id, quotation_id) do nothing;

insert into public.project_fund_entries (
  organization_id, project_fund_id, entry_type, direction, amount, entry_date,
  reference_no, note, source_payment_id, created_by
)
select
  payment.organization_id,
  fund.id,
  'client_payment', 'credit', payment.amount, payment.paid_at,
  payment.reference_no, coalesce(payment.notes, 'Verified client payment'),
  payment.id, coalesce(payment.verified_by, payment.submitted_by)
from public.quotation_payment_records payment
join public.project_funds fund
  on fund.organization_id = payment.organization_id
 and fund.quotation_id = payment.quotation_id
where payment.status = 'verified'
on conflict (source_payment_id) do nothing;

insert into public.project_fund_entries (
  organization_id, project_fund_id, entry_type, direction, amount, entry_date,
  reference_no, note, source_transaction_id, created_by
)
select
  transaction.organization_id,
  fund.id,
  'project_expense', 'debit', transaction.amount, transaction.transaction_date,
  transaction.reference_number, coalesce(transaction.note, 'Historical project expense'),
  transaction.id, transaction.submitted_by
from public.finance_transactions transaction
join public.project_funds fund
  on fund.organization_id = transaction.organization_id
 and fund.quotation_id = transaction.quotation_id
where transaction.transaction_type = 'expense'
  and transaction.payment_status = 'paid'
  and transaction.approval_status = 'approved'
  and not transaction.is_voided
  and transaction.quotation_id is not null
on conflict (source_transaction_id) do nothing;

create or replace function private.foundation_project_fund_from_quotation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status::text = 'approved'
    and new.document_type = 'price_quotation' then
    insert into public.project_funds (
      organization_id, quotation_id, project_name, client_name, contract_amount, created_by
    ) values (
      new.organization_id,
      new.id,
      coalesce(nullif(btrim(new.project_name), ''), new.quotation_no, 'Project'),
      nullif(btrim(new.client_name), ''),
      coalesce(new.total_amount, 0),
      coalesce(new.created_by, (select auth.uid()))
    ) on conflict (organization_id, quotation_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_project_fund_creation on public.quotations;
create trigger quotation_project_fund_creation
after insert or update of status on public.quotations
for each row execute function private.foundation_project_fund_from_quotation();

create or replace function private.sync_foundation_payment_entry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_fund_id uuid;
begin
  select fund.id into v_fund_id
  from public.project_funds fund
  where fund.organization_id = new.organization_id
    and fund.quotation_id = new.quotation_id
  limit 1;
  if v_fund_id is null then
    return new;
  end if;

  if new.status = 'verified' then
    insert into public.project_fund_entries (
      organization_id, project_fund_id, entry_type, direction, amount,
      entry_date, reference_no, note, source_payment_id, created_by, is_voided
    ) values (
      new.organization_id, v_fund_id, 'client_payment', 'credit', new.amount,
      new.paid_at, new.reference_no, coalesce(new.notes, 'Verified client payment'),
      new.id, coalesce(new.verified_by, new.submitted_by), false
    ) on conflict (source_payment_id) do update set
      project_fund_id = excluded.project_fund_id,
      amount = excluded.amount,
      entry_date = excluded.entry_date,
      reference_no = excluded.reference_no,
      note = excluded.note,
      is_voided = false;
  elsif new.status in ('rejected', 'reversed') then
    update public.project_fund_entries set is_voided = true where source_payment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_payment_foundation_sync on public.quotation_payment_records;
create trigger quotation_payment_foundation_sync
after insert or update of status, amount, paid_at, reference_no, notes, verified_by
on public.quotation_payment_records
for each row execute function private.sync_foundation_payment_entry();

create or replace function private.sync_foundation_transaction_entry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_fund_id uuid := new.project_fund_id;
begin
  if new.transaction_type <> 'expense' then
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
after insert or update of project_fund_id, quotation_id, amount, transaction_date,
  reference_number, note, payment_status, approval_status, is_voided
on public.finance_transactions
for each row execute function private.sync_foundation_transaction_entry();

create or replace function private.foundation_finance_access(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance']
  );
$$;

create or replace function private.foundation_project_access(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance', 'external_finance', 'project_manager', 'production', 'payroll']
  );
$$;

grant execute on function private.foundation_finance_access(uuid), private.foundation_project_access(uuid) to authenticated;

alter table public.finance_foundation_settings enable row level security;
alter table public.project_funds enable row level security;
alter table public.project_fund_entries enable row level security;
alter table public.company_working_fund_entries enable row level security;
alter table public.project_company_advances enable row level security;
alter table public.project_box_maker_rates enable row level security;
alter table public.labor_accomplishments enable row level security;
alter table public.labor_payment_runs enable row level security;
alter table public.labor_payment_items enable row level security;
alter table public.operating_cost_templates enable row level security;
alter table public.operating_cost_entries enable row level security;

revoke all on public.finance_foundation_settings,
  public.project_funds,
  public.project_fund_entries,
  public.company_working_fund_entries,
  public.project_company_advances,
  public.project_box_maker_rates,
  public.labor_accomplishments,
  public.labor_payment_runs,
  public.labor_payment_items,
  public.operating_cost_templates,
  public.operating_cost_entries
from anon, authenticated;

grant select on public.finance_foundation_settings,
  public.project_funds,
  public.project_fund_entries,
  public.company_working_fund_entries,
  public.project_company_advances,
  public.project_box_maker_rates,
  public.labor_accomplishments,
  public.labor_payment_runs,
  public.labor_payment_items,
  public.operating_cost_templates,
  public.operating_cost_entries,
  public.finance_project_fund_summary,
  public.finance_project_labor_summary,
  public.finance_operating_cost_summary
to authenticated;

drop policy if exists "foundation settings: finance read" on public.finance_foundation_settings;
create policy "foundation settings: finance read"
on public.finance_foundation_settings for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

drop policy if exists "project funds: project access read" on public.project_funds;
create policy "project funds: project access read"
on public.project_funds for select to authenticated
using ((select private.foundation_project_access(organization_id)));

drop policy if exists "project fund entries: project access read" on public.project_fund_entries;
create policy "project fund entries: project access read"
on public.project_fund_entries for select to authenticated
using ((select private.foundation_project_access(organization_id)));

drop policy if exists "working fund entries: finance read" on public.company_working_fund_entries;
create policy "working fund entries: finance read"
on public.company_working_fund_entries for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

drop policy if exists "company advances: project access read" on public.project_company_advances;
create policy "company advances: project access read"
on public.project_company_advances for select to authenticated
using ((select private.foundation_project_access(organization_id)));

drop policy if exists "box maker rates: project access read" on public.project_box_maker_rates;
create policy "box maker rates: project access read"
on public.project_box_maker_rates for select to authenticated
using ((select private.foundation_project_access(organization_id)));

drop policy if exists "labor accomplishments: project access read" on public.labor_accomplishments;
create policy "labor accomplishments: project access read"
on public.labor_accomplishments for select to authenticated
using ((select private.foundation_project_access(organization_id)));

drop policy if exists "labor payment runs: finance read" on public.labor_payment_runs;
create policy "labor payment runs: finance read"
on public.labor_payment_runs for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

drop policy if exists "labor payment items: finance read" on public.labor_payment_items;
create policy "labor payment items: finance read"
on public.labor_payment_items for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

drop policy if exists "operating cost templates: finance read" on public.operating_cost_templates;
create policy "operating cost templates: finance read"
on public.operating_cost_templates for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

drop policy if exists "operating cost entries: finance read" on public.operating_cost_entries;
create policy "operating cost entries: finance read"
on public.operating_cost_entries for select to authenticated
using ((select private.foundation_finance_access(organization_id)));

create or replace function public.upsert_finance_foundation_settings(
  p_organization_id uuid,
  p_opening_capital_funds numeric default 0,
  p_opening_working_funds numeric default 0,
  p_minimum_working_funds numeric default 0,
  p_desired_monthly_profit numeric default 0,
  p_default_vat_rate numeric default 12,
  p_revenue_basis text default 'net_sales'
)
returns public.finance_foundation_settings
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_row public.finance_foundation_settings;
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Finance management can update foundation settings';
  end if;
  if p_revenue_basis not in ('net_sales', 'collections') then
    raise exception 'Unsupported revenue basis';
  end if;
  insert into public.finance_foundation_settings (
    organization_id, opening_capital_funds, opening_working_funds,
    minimum_working_funds, desired_monthly_profit, default_vat_rate,
    revenue_basis, created_by
  ) values (
    p_organization_id, greatest(coalesce(p_opening_capital_funds, 0), 0),
    greatest(coalesce(p_opening_working_funds, 0), 0),
    greatest(coalesce(p_minimum_working_funds, 0), 0),
    greatest(coalesce(p_desired_monthly_profit, 0), 0),
    greatest(least(coalesce(p_default_vat_rate, 12), 100), 0),
    p_revenue_basis, (select auth.uid())
  ) on conflict (organization_id) do update set
    opening_capital_funds = excluded.opening_capital_funds,
    opening_working_funds = excluded.opening_working_funds,
    minimum_working_funds = excluded.minimum_working_funds,
    desired_monthly_profit = excluded.desired_monthly_profit,
    default_vat_rate = excluded.default_vat_rate,
    revenue_basis = excluded.revenue_basis,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_finance_foundation_snapshot(
  p_organization_id uuid,
  p_month date default current_date
)
returns jsonb
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_next_month date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  v_settings public.finance_foundation_settings;
  v_cash_position numeric(14,2);
  v_cash_in numeric(14,2);
  v_cash_out numeric(14,2);
  v_working_funds numeric(14,2);
  v_capital_funds numeric(14,2);
  v_project_funds numeric(14,2);
  v_advances numeric(14,2);
  v_sales numeric(14,2);
  v_collections numeric(14,2);
  v_direct_costs numeric(14,2);
  v_variable_costs numeric(14,2);
  v_fixed_actual numeric(14,2);
  v_fixed_budget numeric(14,2);
  v_contribution_ratio numeric(14,6);
  v_break_even_sales numeric(14,2);
  v_required_sales numeric(14,2);
  v_profit numeric(14,2);
begin
  if (select auth.uid()) is null or not private.foundation_finance_access(p_organization_id) then
    raise exception 'Not authorized for the Finance Foundation';
  end if;
  select * into v_settings from public.finance_foundation_settings where organization_id = p_organization_id;

  select coalesce(sum(account.opening_balance + coalesce(flow.net_flow, 0)), 0)::numeric(14,2)
  into v_cash_position
  from public.finance_accounts account
  left join lateral (
    select sum(case
      when entry.transaction_type = 'income' and entry.payment_status = 'paid' and entry.approval_status = 'not_required' and not entry.is_voided then entry.amount
      when entry.transaction_type = 'expense' and entry.payment_status = 'paid' and entry.approval_status = 'approved' and not entry.is_voided then -entry.amount
      else 0 end) as net_flow
    from public.finance_transactions entry
    where entry.account_id = account.id and entry.organization_id = p_organization_id
  ) flow on true
  where account.organization_id = p_organization_id and account.is_active;

  select
    coalesce(sum(case when transaction_type = 'income' then amount else 0 end), 0),
    coalesce(sum(case when transaction_type = 'expense' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.finance_transactions
  where organization_id = p_organization_id
    and transaction_date >= v_month_start and transaction_date < v_next_month
    and not is_voided
    and ((transaction_type = 'income' and payment_status = 'paid' and approval_status = 'not_required')
      or (transaction_type = 'expense' and payment_status = 'paid' and approval_status = 'approved'));

  select coalesce(v_settings.opening_capital_funds, 0) + coalesce(sum(entry.amount) filter (where entry.entry_type = 'capital_in'), 0)
  into v_capital_funds from public.company_working_fund_entries entry where entry.organization_id = p_organization_id;

  select coalesce(v_settings.opening_working_funds, 0)
    + coalesce(sum(case when entry.direction = 'credit' then entry.amount else -entry.amount end), 0)
  into v_working_funds from public.company_working_fund_entries entry where entry.organization_id = p_organization_id;

  select coalesce(sum(summary.available_balance), 0)
  into v_project_funds from public.finance_project_fund_summary summary
  where summary.organization_id = p_organization_id and summary.status <> 'closed' and summary.available_balance > 0;

  select coalesce(sum(summary.outstanding_advance), 0)
  into v_advances from public.finance_project_fund_summary summary
  where summary.organization_id = p_organization_id and summary.status <> 'closed';

  select coalesce(sum(quotation.subtotal), 0)
  into v_sales from public.quotations quotation
  where quotation.organization_id = p_organization_id
    and quotation.status::text = 'approved' and quotation.document_type = 'price_quotation'
    and quotation.issue_date >= v_month_start and quotation.issue_date < v_next_month;

  select coalesce(sum(entry.amount), 0)
  into v_collections from public.project_fund_entries entry
  where entry.organization_id = p_organization_id and entry.entry_type = 'client_payment'
    and entry.direction = 'credit' and not entry.is_voided
    and entry.entry_date >= v_month_start and entry.entry_date < v_next_month;

  select coalesce(sum(transaction.amount), 0)
    + coalesce((
      select sum(entry.amount)
      from public.project_fund_entries entry
      where entry.organization_id = p_organization_id
        and entry.entry_type = 'labor_payment'
        and entry.direction = 'debit'
        and not entry.is_voided
        and entry.entry_date >= v_month_start and entry.entry_date < v_next_month
    ), 0)
  into v_direct_costs from public.finance_transactions transaction
  where transaction.organization_id = p_organization_id and transaction.transaction_type = 'expense'
    and transaction.quotation_id is not null and transaction.payment_status = 'paid'
    and transaction.approval_status = 'approved' and not transaction.is_voided
    and transaction.transaction_date >= v_month_start and transaction.transaction_date < v_next_month;

  select v_direct_costs + coalesce(sum(entry.amount), 0)
  into v_variable_costs from public.operating_cost_entries entry
  where entry.organization_id = p_organization_id and entry.cost_class = 'variable'
    and entry.status = 'paid' and entry.cost_date >= v_month_start and entry.cost_date < v_next_month;

  select coalesce(sum(entry.amount), 0)
  into v_fixed_actual from public.operating_cost_entries entry
  where entry.organization_id = p_organization_id and entry.cost_class = 'fixed'
    and entry.status = 'paid' and entry.cost_date >= v_month_start and entry.cost_date < v_next_month;

  select coalesce(sum(template.expected_monthly_amount), 0)
  into v_fixed_budget from public.operating_cost_templates template
  where template.organization_id = p_organization_id and template.is_active and template.cost_class = 'fixed';

  if coalesce(v_settings.revenue_basis, 'net_sales') = 'collections' then
    v_sales := v_collections;
  end if;
  v_contribution_ratio := case when v_sales > 0 then greatest((v_sales - v_variable_costs) / v_sales, 0) else 0 end;
  v_break_even_sales := case when v_contribution_ratio > 0 then round(v_fixed_budget / v_contribution_ratio, 2) else 0 end;
  v_required_sales := case when v_contribution_ratio > 0 then round((v_fixed_budget + coalesce(v_settings.desired_monthly_profit, 0)) / v_contribution_ratio, 2) else 0 end;
  v_profit := round(v_sales - v_variable_costs - v_fixed_actual, 2);

  return jsonb_build_object(
    'month_start', v_month_start,
    'capital_funds', round(coalesce(v_capital_funds, 0), 2),
    'working_funds', round(coalesce(v_working_funds, 0), 2),
    'minimum_working_funds', round(coalesce(v_settings.minimum_working_funds, 0), 2),
    'working_funds_above_threshold', coalesce(v_working_funds, 0) >= coalesce(v_settings.minimum_working_funds, 0),
    'cash_position', round(coalesce(v_cash_position, 0), 2),
    'cash_in', round(coalesce(v_cash_in, 0), 2),
    'cash_out', round(coalesce(v_cash_out, 0), 2),
    'project_funds', round(coalesce(v_project_funds, 0), 2),
    'outstanding_advances', round(coalesce(v_advances, 0), 2),
    'sales', round(coalesce(v_sales, 0), 2),
    'collections', round(coalesce(v_collections, 0), 2),
    'direct_costs', round(coalesce(v_direct_costs, 0), 2),
    'variable_costs', round(coalesce(v_variable_costs, 0), 2),
    'fixed_operating_actual', round(coalesce(v_fixed_actual, 0), 2),
    'fixed_operating_budget', round(coalesce(v_fixed_budget, 0), 2),
    'contribution_margin_ratio', round(coalesce(v_contribution_ratio, 0), 6),
    'break_even_sales', round(coalesce(v_break_even_sales, 0), 2),
    'required_sales', round(coalesce(v_required_sales, 0), 2),
    'desired_monthly_profit', round(coalesce(v_settings.desired_monthly_profit, 0), 2),
    'profit', round(coalesce(v_profit, 0), 2),
    'revenue_basis', coalesce(v_settings.revenue_basis, 'net_sales'),
    'status', case
      when coalesce(v_profit, 0) < 0 then 'negative'
      when coalesce(v_sales, 0) >= coalesce(v_required_sales, 0) and coalesce(v_required_sales, 0) > 0 then 'target_hit'
      when coalesce(v_sales, 0) >= coalesce(v_break_even_sales, 0) and coalesce(v_break_even_sales, 0) > 0 then 'profitable'
      else 'below_break_even'
    end
  );
end;
$$;

create or replace function public.record_company_working_fund_entry(
  p_organization_id uuid,
  p_entry_type text,
  p_direction text,
  p_amount numeric,
  p_entry_date date default current_date,
  p_reference_no text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can record Working Fund entries';
  end if;
  if p_entry_type not in ('capital_in', 'transfer_in', 'transfer_out', 'other_in', 'other_out', 'adjustment')
    or p_direction not in ('credit', 'debit') or coalesce(p_amount, 0) <= 0 then
    raise exception 'Working Fund entry values are invalid';
  end if;
  insert into public.company_working_fund_entries (
    organization_id, entry_type, direction, amount, entry_date, reference_no, note, created_by
  ) values (
    p_organization_id, p_entry_type, p_direction, round(p_amount, 2), coalesce(p_entry_date, current_date),
    nullif(btrim(p_reference_no), ''), nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_project_fund(
  p_organization_id uuid,
  p_quotation_id uuid default null,
  p_project_schedule_id uuid default null,
  p_production_job_id uuid default null,
  p_project_name text default null,
  p_client_name text default null,
  p_contract_amount numeric default 0,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'project_manager', 'internal_finance']) then
    raise exception 'Not authorized to create a Project Fund';
  end if;
  if p_quotation_id is not null then
    select * into v_quote from public.quotations where id = p_quotation_id and organization_id = p_organization_id;
    if not found or v_quote.status::text <> 'approved' or v_quote.document_type <> 'price_quotation' then
      raise exception 'Project Funds can only be created from an approved Price Quotation';
    end if;
  elsif nullif(btrim(coalesce(p_project_name, '')), '') is null then
    raise exception 'Project name is required when no quotation is selected';
  end if;
  if p_project_schedule_id is not null and not exists (
    select 1 from public.project_schedules schedule
    where schedule.id = p_project_schedule_id and schedule.organization_id = p_organization_id
  ) then
    raise exception 'The selected Project Schedule does not belong to this organization';
  end if;
  if p_production_job_id is not null and not exists (
    select 1 from public.production_jobs job
    where job.id = p_production_job_id and job.organization_id = p_organization_id
  ) then
    raise exception 'The selected Production Job does not belong to this organization';
  end if;
  insert into public.project_funds (
    organization_id, quotation_id, project_schedule_id, production_job_id,
    project_name, client_name, contract_amount, note, created_by
  ) values (
    p_organization_id, p_quotation_id, p_project_schedule_id, p_production_job_id,
    coalesce(nullif(btrim(p_project_name), ''), nullif(btrim(v_quote.project_name), ''), v_quote.quotation_no, 'Project'),
    coalesce(nullif(btrim(p_client_name), ''), nullif(btrim(v_quote.client_name), '')),
    coalesce(nullif(p_contract_amount, 0), v_quote.total_amount, 0), nullif(btrim(p_note), ''), (select auth.uid())
  ) on conflict (organization_id, quotation_id) do update set
    project_schedule_id = coalesce(excluded.project_schedule_id, project_funds.project_schedule_id),
    production_job_id = coalesce(excluded.production_job_id, project_funds.production_job_id)
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.project_funds where organization_id = p_organization_id and quotation_id = p_quotation_id;
  end if;
  return v_id;
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
  if not found or not private.has_text_role(v_fund.organization_id, array['super_admin', 'owner', 'admin', 'project_manager', 'internal_finance']) then
    raise exception 'Project Fund not found or not accessible';
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
  if not found or not private.has_text_role(v_advance.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only management can review a Company Working Fund advance';
  end if;
  if p_decision not in ('approved', 'rejected') or v_advance.status <> 'requested' then
    raise exception 'This advance is not waiting for a management decision';
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

create or replace function public.release_project_company_advance(
  p_advance_id uuid,
  p_note text default null
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
begin
  select * into v_advance from public.project_company_advances where id = p_advance_id for update;
  if not found or not private.has_text_role(v_advance.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can release a Company Working Fund advance';
  end if;
  if v_advance.status <> 'approved' then
    raise exception 'Only an approved advance can be released';
  end if;
  select * into v_fund from public.project_funds where id = v_advance.project_fund_id for update;
  select * into v_settings from public.finance_foundation_settings where organization_id = v_advance.organization_id;
  select coalesce(v_settings.opening_working_funds, 0)
    + coalesce(sum(case when entry.direction = 'credit' then entry.amount else -entry.amount end), 0)
  into v_available from public.company_working_fund_entries entry
  where entry.organization_id = v_advance.organization_id;
  v_amount := coalesce(v_advance.approved_amount, v_advance.requested_amount);
  if v_amount > greatest(v_available, 0) + 0.001 then
    raise exception 'Working Funds are insufficient for this advance';
  end if;

  insert into public.project_fund_entries (
    organization_id, project_fund_id, entry_type, direction, amount, entry_date, note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, v_fund.id, 'company_advance', 'credit', v_amount, current_date,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance released'), v_advance.id, (select auth.uid())
  );
  insert into public.company_working_fund_entries (
    organization_id, entry_type, direction, amount, entry_date, project_fund_id, note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, 'company_advance', 'debit', v_amount, current_date, v_fund.id,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance released'), v_advance.id, (select auth.uid())
  );
  update public.project_company_advances
  set status = 'released', released_amount = v_amount, released_by = (select auth.uid()), released_at = now(), updated_at = now()
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
  if not found or not private.has_text_role(v_advance.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can record advance repayment';
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
    organization_id, project_fund_id, entry_type, direction, amount, entry_date, note, source_advance_id, created_by
  ) values (
    v_advance.organization_id, v_advance.project_fund_id, 'company_advance_repayment', 'debit', round(p_amount, 2), current_date,
    coalesce(nullif(btrim(p_note), ''), 'Company Working Fund advance repayment'), v_advance.id, (select auth.uid())
  );
  insert into public.company_working_fund_entries (
    organization_id, entry_type, direction, amount, entry_date, project_fund_id, note, source_advance_id, created_by
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

create or replace function public.create_project_labor_rate(
  p_project_fund_id uuid,
  p_box_maker_name text,
  p_task_name text,
  p_unit_label text,
  p_unit_rate numeric,
  p_planned_quantity numeric,
  p_agreed_total_rate numeric,
  p_production_job_id uuid default null,
  p_employee_id uuid default null,
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
  select * into v_fund from public.project_funds where id = p_project_fund_id;
  if not found or not private.has_text_role(v_fund.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance', 'project_manager', 'production']) then
    raise exception 'Not authorized to assign project labor';
  end if;
  if nullif(btrim(coalesce(p_box_maker_name, '')), '') is null
    or nullif(btrim(coalesce(p_task_name, '')), '') is null
    or coalesce(p_unit_rate, 0) <= 0
    or coalesce(p_agreed_total_rate, 0) <= 0 then
    raise exception 'Box maker, task, unit rate, and agreed total rate are required';
  end if;
  if p_production_job_id is not null and not exists (
    select 1 from public.production_jobs job
    where job.id = p_production_job_id and job.organization_id = v_fund.organization_id
  ) then
    raise exception 'The selected Production Job does not belong to this organization';
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.employees employee
    where employee.id = p_employee_id and employee.organization_id = v_fund.organization_id
  ) then
    raise exception 'The selected box maker employee does not belong to this organization';
  end if;
  insert into public.project_box_maker_rates (
    organization_id, project_fund_id, production_job_id, employee_id, box_maker_name,
    task_name, unit_label, unit_rate, planned_quantity, agreed_total_rate, note, created_by
  ) values (
    v_fund.organization_id, v_fund.id, p_production_job_id, p_employee_id, btrim(p_box_maker_name),
    btrim(p_task_name), coalesce(nullif(btrim(p_unit_label), ''), 'task'), round(p_unit_rate, 2),
    greatest(coalesce(p_planned_quantity, 0), 0), round(p_agreed_total_rate, 2), nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_labor_accomplishment(
  p_labor_rate_id uuid,
  p_accomplishment_date date,
  p_completed_quantity numeric,
  p_accepted_quantity numeric,
  p_rejected_quantity numeric default 0,
  p_note text default null,
  p_evidence_path text default null
)
returns uuid
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_rate public.project_box_maker_rates%rowtype;
  v_existing numeric(14,2);
  v_amount numeric(14,2);
  v_id uuid;
begin
  select * into v_rate from public.project_box_maker_rates where id = p_labor_rate_id for update;
  if not found or not private.has_text_role(v_rate.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance', 'project_manager', 'production']) then
    raise exception 'Labor rate not found or not accessible';
  end if;
  if coalesce(p_completed_quantity, 0) < 0 or coalesce(p_accepted_quantity, 0) < 0
    or coalesce(p_rejected_quantity, 0) < 0 or p_accepted_quantity > p_completed_quantity
    or p_rejected_quantity > p_completed_quantity then
    raise exception 'Accomplishment quantities are invalid';
  end if;
  v_amount := round(p_accepted_quantity * v_rate.unit_rate, 2);
  select coalesce(sum(accomplishment.payable_amount), 0) into v_existing
  from public.labor_accomplishments accomplishment
  where accomplishment.labor_rate_id = v_rate.id and accomplishment.status <> 'rejected';
  if v_existing + v_amount > v_rate.agreed_total_rate + 0.001 then
    raise exception 'The accomplishment exceeds the box maker''s agreed labor rate';
  end if;
  insert into public.labor_accomplishments (
    organization_id, project_fund_id, labor_rate_id, production_job_id, accomplishment_date,
    completed_quantity, accepted_quantity, rejected_quantity, unit_rate, note, evidence_path, submitted_by
  ) values (
    v_rate.organization_id, v_rate.project_fund_id, v_rate.id, v_rate.production_job_id, coalesce(p_accomplishment_date, current_date),
    p_completed_quantity, p_accepted_quantity, coalesce(p_rejected_quantity, 0), v_rate.unit_rate,
    nullif(btrim(p_note), ''), nullif(btrim(p_evidence_path), ''), (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.verify_labor_accomplishment(
  p_accomplishment_id uuid,
  p_decision text,
  p_note text default null
)
returns public.labor_accomplishments
language plpgsql security definer
set search_path = public, private
as $$
declare v_row public.labor_accomplishments;
begin
  select * into v_row from public.labor_accomplishments where id = p_accomplishment_id for update;
  if not found or not private.has_text_role(v_row.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance', 'project_manager']) then
    raise exception 'Not authorized to verify this accomplishment';
  end if;
  if p_decision not in ('verified', 'rejected') or v_row.status <> 'submitted' then
    raise exception 'This accomplishment is not waiting for verification';
  end if;
  update public.labor_accomplishments
  set status = p_decision, verified_by = (select auth.uid()), verified_at = now(),
      verification_note = nullif(btrim(p_note), ''), updated_at = now()
  where id = p_accomplishment_id returning * into v_row;
  return v_row;
end;
$$;

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
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can prepare labor payment runs';
  end if;
  if p_payment_date is null then
    raise exception 'A Tuesday or Friday payment date is required';
  end if;
  if v_day not in (2, 5) then
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
  if not found or not private.has_text_role(v_run.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Not authorized to approve this labor payment run';
  end if;
  if v_run.status <> 'draft' then raise exception 'Only draft labor payment runs can be approved'; end if;
  update public.labor_payment_runs
  set status = 'approved', note = coalesce(nullif(btrim(p_note), ''), note), approved_by = (select auth.uid()), approved_at = now(), updated_at = now()
  where id = v_run.id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.pay_labor_payment_run(
  p_payment_run_id uuid,
  p_note text default null
)
returns public.labor_payment_runs
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_run public.labor_payment_runs;
  v_item public.labor_payment_items%rowtype;
  v_fund public.project_funds%rowtype;
  v_balance numeric(14,2);
begin
  select * into v_run from public.labor_payment_runs where id = p_payment_run_id for update;
  if not found or not private.has_text_role(v_run.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can pay a labor run';
  end if;
  if v_run.status <> 'approved' then raise exception 'Only an approved labor payment run can be paid'; end if;
  for v_item in select * from public.labor_payment_items where payment_run_id = v_run.id order by id loop
    if exists (select 1 from public.project_fund_entries entry where entry.source_labor_payment_item_id = v_item.id and not entry.is_voided) then
      continue;
    end if;
    select * into v_fund from public.project_funds where id = v_item.project_fund_id for update;
    if not found or v_fund.status <> 'open' then
      raise exception 'The Project Fund for this labor payment is not open';
    end if;
    select summary.available_balance into v_balance from public.finance_project_fund_summary summary where summary.id = v_item.project_fund_id;
    if coalesce(v_balance, 0) < v_item.amount - 0.001 then
      raise exception 'Project Fund does not have enough available money for this labor payment';
    end if;
    insert into public.project_fund_entries (
      organization_id, project_fund_id, entry_type, direction, amount, entry_date, note, source_labor_payment_item_id, created_by
    ) values (
      v_item.organization_id, v_item.project_fund_id, 'labor_payment', 'debit', v_item.amount, v_run.payment_date,
      coalesce(nullif(btrim(p_note), ''), 'Tuesday/Friday box-maker labor payment'), v_item.id, (select auth.uid())
    );
  end loop;
  update public.labor_payment_runs
  set status = 'paid', note = coalesce(nullif(btrim(p_note), ''), note), paid_by = (select auth.uid()), paid_at = now(), updated_at = now()
  where id = v_run.id returning * into v_run;
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
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can manage operating cost templates';
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
  if (select auth.uid()) is null or not private.has_text_role(p_organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Internal Finance can record operating costs';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null
    or nullif(btrim(coalesce(p_category, '')), '') is null
    or coalesce(p_amount, 0) <= 0
    or p_cost_class not in ('fixed', 'variable')
    or p_status not in ('planned', 'paid') then
    raise exception 'Operating cost values are invalid';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.operating_cost_templates template
    where template.id = p_template_id and template.organization_id = p_organization_id
  ) then
    raise exception 'The selected operating cost template does not belong to this organization';
  end if;
  insert into public.operating_cost_entries (
    organization_id, template_id, cost_date, month_start, name, category, cost_class, amount, status,
    paid_at, paid_by, note, created_by
  ) values (
    p_organization_id, p_template_id, coalesce(p_cost_date, current_date), date_trunc('month', coalesce(p_cost_date, current_date))::date,
    btrim(p_name), btrim(p_category), p_cost_class, round(p_amount, 2), p_status,
    case when p_status = 'paid' then now() else null end,
    case when p_status = 'paid' then (select auth.uid()) else null end,
    nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_id;
  if p_status = 'paid' then
    insert into public.company_working_fund_entries (
      organization_id, entry_type, direction, amount, entry_date, note, source_operating_cost_entry_id, created_by
    ) values (
      p_organization_id, 'operating_expense', 'debit', round(p_amount, 2), coalesce(p_cost_date, current_date),
      'Operating cost: ' || btrim(p_name), v_id, (select auth.uid())
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.close_project_fund(
  p_project_fund_id uuid,
  p_note text default null
)
returns public.project_funds
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_fund public.project_funds;
  v_summary public.finance_project_fund_summary;
begin
  select * into v_fund from public.project_funds where id = p_project_fund_id for update;
  if not found or not private.has_text_role(v_fund.organization_id, array['super_admin', 'owner', 'admin', 'internal_finance']) then
    raise exception 'Only Finance management can close a Project Fund';
  end if;
  select * into v_summary from public.finance_project_fund_summary where id = v_fund.id;
  if coalesce(v_summary.outstanding_advance, 0) > 0.01 then
    raise exception 'The Project Fund still has an outstanding Company Working Fund advance';
  end if;
  if abs(coalesce(v_summary.available_balance, 0)) > 0.01 then
    raise exception 'The Project Fund must be fully reconciled before closeout';
  end if;
  update public.project_funds
  set status = 'closed', note = coalesce(nullif(btrim(p_note), ''), note), closed_by = (select auth.uid()), closed_at = now(), updated_at = now()
  where id = v_fund.id returning * into v_fund;
  return v_fund;
end;
$$;

revoke all on function public.upsert_finance_foundation_settings(uuid, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.get_finance_foundation_snapshot(uuid, date) from public, anon;
revoke all on function public.record_company_working_fund_entry(uuid, text, text, numeric, date, text, text) from public, anon;
revoke all on function public.create_project_fund(uuid, uuid, uuid, uuid, text, text, numeric, text) from public, anon;
revoke all on function public.request_project_company_advance(uuid, numeric, text) from public, anon;
revoke all on function public.review_project_company_advance(uuid, text, numeric, text) from public, anon;
revoke all on function public.release_project_company_advance(uuid, text) from public, anon;
revoke all on function public.record_project_company_advance_repayment(uuid, numeric, text) from public, anon;
revoke all on function public.create_project_labor_rate(uuid, text, text, text, numeric, numeric, numeric, uuid, uuid, text) from public, anon;
revoke all on function public.record_labor_accomplishment(uuid, date, numeric, numeric, numeric, text, text) from public, anon;
revoke all on function public.verify_labor_accomplishment(uuid, text, text) from public, anon;
revoke all on function public.create_labor_payment_run(uuid, date, text) from public, anon;
revoke all on function public.approve_labor_payment_run(uuid, text) from public, anon;
revoke all on function public.pay_labor_payment_run(uuid, text) from public, anon;
revoke all on function public.create_operating_cost_template(uuid, text, text, text, numeric, smallint, text) from public, anon;
revoke all on function public.record_operating_cost_entry(uuid, date, text, text, text, numeric, text, uuid, text) from public, anon;
revoke all on function public.close_project_fund(uuid, text) from public, anon;

grant execute on function public.upsert_finance_foundation_settings(uuid, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.get_finance_foundation_snapshot(uuid, date) to authenticated;
grant execute on function public.record_company_working_fund_entry(uuid, text, text, numeric, date, text, text) to authenticated;
grant execute on function public.create_project_fund(uuid, uuid, uuid, uuid, text, text, numeric, text) to authenticated;
grant execute on function public.request_project_company_advance(uuid, numeric, text) to authenticated;
grant execute on function public.review_project_company_advance(uuid, text, numeric, text) to authenticated;
grant execute on function public.release_project_company_advance(uuid, text) to authenticated;
grant execute on function public.record_project_company_advance_repayment(uuid, numeric, text) to authenticated;
grant execute on function public.create_project_labor_rate(uuid, text, text, text, numeric, numeric, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.record_labor_accomplishment(uuid, date, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.verify_labor_accomplishment(uuid, text, text) to authenticated;
grant execute on function public.create_labor_payment_run(uuid, date, text) to authenticated;
grant execute on function public.approve_labor_payment_run(uuid, text) to authenticated;
grant execute on function public.pay_labor_payment_run(uuid, text) to authenticated;
grant execute on function public.create_operating_cost_template(uuid, text, text, text, numeric, smallint, text) to authenticated;
grant execute on function public.record_operating_cost_entry(uuid, date, text, text, text, numeric, text, uuid, text) to authenticated;
grant execute on function public.close_project_fund(uuid, text) to authenticated;

commit;
