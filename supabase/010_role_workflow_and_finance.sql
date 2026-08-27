-- Role workflow revision: Project Officer operations and Accountant finance.
-- Run after 001 through 009. This migration is additive and preserves records.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_no text not null,
  client_name text not null,
  contact_name text,
  email text,
  phone text,
  project_name text not null,
  project_description text,
  estimated_value numeric(14,2) not null default 0 check (estimated_value >= 0),
  due_date date,
  status text not null default 'new' check (status in ('new','qualified','costing','quoted','won','lost','on_hold')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lead_no)
);
create index if not exists leads_org_status_idx on public.leads(organization_id,status,created_at desc);

create table if not exists public.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  payable_no text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  due_date date,
  status text not null default 'open' check (status in ('open','partial','paid','overdue','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, payable_no)
);
create index if not exists supplier_payables_org_status_idx on public.supplier_payables(organization_id,status,due_date);

alter table public.payments add column if not exists payment_kind text not null default 'payment'
  check (payment_kind in ('downpayment','partial_payment','full_payment','payment'));
alter table public.cash_flow_entries add column if not exists finance_category text not null default 'general'
  check (finance_category in ('general','loan','credit_card','tax','income_tax_reserve','owner_withdrawal','dividend','cash_advance','benefits','payroll','salary','bills','transportation','commission'));

-- The role matrix is the database authority. Project Officers cannot read or
-- mutate finance records; Accountants cannot read or mutate project costing.
create or replace function private.can_access(target_organization_id uuid, resource text, action text)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(
    select 1 from public.organization_members m
    where m.organization_id=target_organization_id and m.user_id=(select auth.uid()) and (
      m.role::text in ('owner','admin')
      or (m.role::text='project_manager' and (
        (action='read' and resource=any(array['leads','customers','suppliers','inventory_items','quotations','quotation_items']))
        or (action='create' and resource=any(array['leads','customers','suppliers','quotations','quotation_items']))
        or (action='update' and resource=any(array['leads','customers','suppliers','quotations']))
      ))
      or (m.role::text='accountant' and (
        (action='read' and resource=any(array['customers','suppliers','invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
        or (action='create' and resource=any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
        or (action='update' and resource=any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables','suppliers']))
        or (action='delete' and resource=any(array['expenses','supplier_payables']))
      ))
    )
  );
$$;
grant execute on function private.can_access(uuid,text,text) to authenticated;

alter table public.leads enable row level security;
alter table public.supplier_payables enable row level security;

drop policy if exists "leads: project officers manage" on public.leads;
create policy "leads: project officers manage" on public.leads for all to authenticated
using ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])))
with check ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])));

drop policy if exists "supplier payables: finance manage" on public.supplier_payables;
create policy "supplier payables: finance manage" on public.supplier_payables for all to authenticated
using ((select private.has_text_role(organization_id,array['owner','admin','accountant'])))
with check ((select private.has_text_role(organization_id,array['owner','admin','accountant'])));

-- Project Officers manage the supplier directory used for quotations and costing.
drop policy if exists "suppliers: project officers manage" on public.suppliers;
create policy "suppliers: project officers manage" on public.suppliers for all to authenticated
using ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])))
with check ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])));
