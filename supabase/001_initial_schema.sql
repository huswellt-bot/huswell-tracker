-- Huswell Trading: initial Supabase schema
-- Run this file once in Supabase Dashboard > SQL Editor, in a new project.
-- It creates the application data model, automatic totals/stock updates, and RLS.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;

do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'sales', 'production', 'warehouse', 'accountant', 'payroll', 'viewer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.quotation_status as enum ('draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.production_status as enum ('queued', 'artwork_approval', 'materials_ready', 'in_production', 'quality_check', 'completed', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.inventory_movement_type as enum ('opening', 'stock_in', 'production_use', 'sale', 'adjustment_in', 'adjustment_out', 'return');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invoice_status as enum ('draft', 'issued', 'partial', 'paid', 'void', 'overdue');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_method as enum ('cash', 'bank_transfer', 'gcash', 'card', 'check', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_status as enum ('draft', 'in_review', 'approved', 'paid', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  address text,
  phone text,
  email text,
  currency_code text not null default 'PHP' check (currency_code = 'PHP'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_id_idx on public.organization_members(user_id);

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_org_admin(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid) to authenticated;

create table if not exists public.business_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  vat_rate numeric(5,2) not null default 12 check (vat_rate between 0 and 100),
  default_profit_margin numeric(5,2) not null default 75 check (default_profit_margin between 0 and 100),
  default_buffer_margin numeric(5,2) not null default 20 check (default_buffer_margin between 0 and 100),
  production_commission numeric(5,2) not null default 5 check (production_commission between 0 and 100),
  quotation_prefix text not null default 'QT',
  invoice_prefix text not null default 'INV',
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null, contact_name text, email text, phone text, billing_address text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null, contact_name text, email text, phone text, address text, payment_terms text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_no text, full_name text not null, email text, phone text, position text, daily_rate numeric(14,2) not null default 0 check (daily_rate >= 0),
  hire_date date, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, employee_no)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text, name text not null, description text, item_type text not null default 'material' check (item_type in ('material', 'product', 'service')),
  unit text not null default 'piece', reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0), quantity_on_hand numeric(14,3) not null default 0,
  standard_cost numeric(14,2) not null default 0 check (standard_cost >= 0), supplier_id uuid references public.suppliers(id) on delete set null,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict, movement_type public.inventory_movement_type not null,
  quantity_change numeric(14,3) not null check (quantity_change <> 0), unit_cost numeric(14,2) check (unit_cost >= 0), reference_type text, reference_id uuid, notes text,
  occurred_at timestamptz not null default now(), created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists inventory_items_org_idx on public.inventory_items(organization_id);
create index if not exists inventory_movements_item_idx on public.inventory_movements(item_id, occurred_at desc);

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_no text not null, customer_id uuid references public.customers(id) on delete set null, project_name text, status public.quotation_status not null default 'draft',
  issue_date date not null default current_date, valid_until date, notes text, profit_margin_rate numeric(5,2) not null default 75,
  buffer_margin_rate numeric(5,2) not null default 20, commission_rate numeric(5,2) not null default 5, vat_rate numeric(5,2) not null default 12,
  total_cost numeric(14,2) not null default 0, subtotal numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0, total_amount numeric(14,2) not null default 0,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, quotation_no)
);
create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(), quotation_id uuid not null references public.quotations(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null, description text not null, quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0), line_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored, sort_order integer not null default 0
);
create index if not exists quotations_org_status_idx on public.quotations(organization_id, status, issue_date desc);

create table if not exists public.production_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  job_no text not null, quotation_id uuid unique references public.quotations(id) on delete set null, customer_id uuid references public.customers(id) on delete set null,
  title text not null, status public.production_status not null default 'queued', due_date date, started_at timestamptz, completed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, job_no)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_no text not null, customer_id uuid references public.customers(id) on delete set null, quotation_id uuid references public.quotations(id) on delete set null,
  status public.invoice_status not null default 'draft', issue_date date not null default current_date, due_date date, notes text,
  subtotal numeric(14,2) not null default 0, vat_rate numeric(5,2) not null default 12, vat_amount numeric(14,2) not null default 0, total_amount numeric(14,2) not null default 0,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, invoice_no)
);
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null, description text not null, quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0), line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored, sort_order integer not null default 0
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null, customer_id uuid references public.customers(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0), method public.payment_method not null default 'cash', paid_at timestamptz not null default now(), reference_no text, notes text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_date date not null default current_date, category text not null, description text not null, amount numeric(14,2) not null check (amount > 0),
  supplier_id uuid references public.suppliers(id) on delete set null, payment_method public.payment_method, reference_no text, created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade, leave_date date not null, leave_type text not null default 'unpaid', is_paid boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')), notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  start_date date not null, end_date date not null, status public.payroll_status not null default 'draft', notes text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (end_date >= start_date), unique (organization_id, start_date, end_date)
);
create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(), payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict, days_worked numeric(6,2) not null default 0 check (days_worked >= 0), daily_rate numeric(14,2) not null default 0 check (daily_rate >= 0),
  allowances numeric(14,2) not null default 0, deductions numeric(14,2) not null default 0, gross_pay numeric(14,2) generated always as (round(days_worked * daily_rate + allowances, 2)) stored,
  net_pay numeric(14,2) generated always as (round(days_worked * daily_rate + allowances - deductions, 2)) stored, unique (payroll_period_id, employee_id)
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function public.recalculate_quotation_totals() returns trigger language plpgsql as $$
declare target_id uuid; base_cost numeric(14,2); markup numeric(14,2); buffer numeric(14,2); commission numeric(14,2); vat numeric(14,2);
begin
  target_id := coalesce(new.quotation_id, old.quotation_id);
  select coalesce(sum(line_total), 0) into base_cost from public.quotation_items where quotation_id = target_id;
  select base_cost * profit_margin_rate / 100, base_cost * buffer_margin_rate / 100, base_cost * commission_rate / 100, vat_rate into markup, buffer, commission, vat from public.quotations where id = target_id;
  update public.quotations set total_cost = base_cost, subtotal = round(base_cost + markup + buffer + commission, 2), vat_amount = round((base_cost + markup + buffer + commission) * vat / 100, 2), total_amount = round((base_cost + markup + buffer + commission) * (1 + vat / 100), 2) where id = target_id;
  return null;
end; $$;
create or replace function public.recalculate_invoice_totals() returns trigger language plpgsql as $$
declare target_id uuid; amount numeric(14,2); rate numeric(5,2);
begin
  target_id := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(line_total), 0) into amount from public.invoice_items where invoice_id = target_id;
  select vat_rate into rate from public.invoices where id = target_id;
  update public.invoices set subtotal = amount, vat_amount = round(amount * rate / 100, 2), total_amount = round(amount * (1 + rate / 100), 2) where id = target_id;
  return null;
end; $$;
create or replace function public.apply_inventory_movement() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then update public.inventory_items set quantity_on_hand = quantity_on_hand + new.quantity_change where id = new.item_id;
  elsif tg_op = 'DELETE' then update public.inventory_items set quantity_on_hand = quantity_on_hand - old.quantity_change where id = old.item_id;
  elsif new.item_id = old.item_id then update public.inventory_items set quantity_on_hand = quantity_on_hand + new.quantity_change - old.quantity_change where id = new.item_id;
  else update public.inventory_items set quantity_on_hand = quantity_on_hand - old.quantity_change where id = old.item_id; update public.inventory_items set quantity_on_hand = quantity_on_hand + new.quantity_change where id = new.item_id;
  end if;
  return null;
end; $$;

drop trigger if exists quotation_items_totals on public.quotation_items;
drop trigger if exists invoice_items_totals on public.invoice_items;
drop trigger if exists inventory_movement_stock on public.inventory_movements;
create trigger quotation_items_totals after insert or update or delete on public.quotation_items for each row execute function public.recalculate_quotation_totals();
create trigger invoice_items_totals after insert or update or delete on public.invoice_items for each row execute function public.recalculate_invoice_totals();
create trigger inventory_movement_stock after insert or update or delete on public.inventory_movements for each row execute function public.apply_inventory_movement();

do $$ declare t text; begin
  foreach t in array array['profiles','organizations','business_settings','customers','suppliers','employees','inventory_items','quotations','production_jobs','invoices','expenses','leave_requests','payroll_periods'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists "profiles: users manage own profile" on public.profiles;
create policy "profiles: users manage own profile" on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.organizations enable row level security;
drop policy if exists "organizations: members read" on public.organizations;
drop policy if exists "organizations: users create" on public.organizations;
drop policy if exists "organizations: admins update" on public.organizations;
create policy "organizations: members read" on public.organizations for select to authenticated using ((select private.is_org_member(id)));
create policy "organizations: users create" on public.organizations for insert to authenticated with check ((select auth.uid()) = created_by);
create policy "organizations: admins update" on public.organizations for update to authenticated using ((select private.is_org_admin(id))) with check ((select private.is_org_admin(id)));

alter table public.organization_members enable row level security;
drop policy if exists "members: organization members read" on public.organization_members;
drop policy if exists "members: owners bootstrap or admins manage" on public.organization_members;
drop policy if exists "members: admins update" on public.organization_members;
drop policy if exists "members: admins delete" on public.organization_members;
create policy "members: organization members read" on public.organization_members for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "members: owners bootstrap or admins manage" on public.organization_members for insert to authenticated with check ((user_id = (select auth.uid()) and role = 'owner' and exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = (select auth.uid()))) or (select private.is_org_admin(organization_id)));
create policy "members: admins update" on public.organization_members for update to authenticated using ((select private.is_org_admin(organization_id))) with check ((select private.is_org_admin(organization_id)));
create policy "members: admins delete" on public.organization_members for delete to authenticated using ((select private.is_org_admin(organization_id)));

do $$ declare t text; begin
  foreach t in array array['business_settings','customers','suppliers','employees','inventory_items','inventory_movements','quotations','production_jobs','invoices','payments','expenses','leave_requests','payroll_periods'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ': members read', t);
    execute format('drop policy if exists %I on public.%I', t || ': members insert', t);
    execute format('drop policy if exists %I on public.%I', t || ': members update', t);
    execute format('drop policy if exists %I on public.%I', t || ': members delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_org_member(organization_id)))', t || ': members read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_org_member(organization_id)))', t || ': members insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_org_member(organization_id))) with check ((select private.is_org_member(organization_id)))', t || ': members update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_org_member(organization_id)))', t || ': members delete', t);
  end loop;
end $$;

-- Child records derive their organization through their parent, so their RLS policies follow the parent.
alter table public.quotation_items enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payroll_entries enable row level security;
drop policy if exists "quotation items: members manage" on public.quotation_items;
drop policy if exists "invoice items: members manage" on public.invoice_items;
drop policy if exists "payroll entries: members manage" on public.payroll_entries;
create policy "quotation items: members manage" on public.quotation_items for all to authenticated using (exists (select 1 from public.quotations q where q.id = quotation_id and (select private.is_org_member(q.organization_id)))) with check (exists (select 1 from public.quotations q where q.id = quotation_id and (select private.is_org_member(q.organization_id))));
create policy "invoice items: members manage" on public.invoice_items for all to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_id and (select private.is_org_member(i.organization_id)))) with check (exists (select 1 from public.invoices i where i.id = invoice_id and (select private.is_org_member(i.organization_id))));
create policy "payroll entries: members manage" on public.payroll_entries for all to authenticated using (exists (select 1 from public.payroll_periods p where p.id = payroll_period_id and (select private.is_org_member(p.organization_id)))) with check (exists (select 1 from public.payroll_periods p where p.id = payroll_period_id and (select private.is_org_member(p.organization_id))));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email)); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- First-run sequence after this script:
-- 1. Sign up in the app. 2. Insert an organization using the signed-in user. 3. Insert that user as the owner in organization_members.
