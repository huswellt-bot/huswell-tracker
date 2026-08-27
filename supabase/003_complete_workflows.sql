-- Huswell Trading complete workflow migration.
-- Run after 001_initial_schema.sql and 002_initialize_huswell_trading.sql.
-- Additive and rerunnable: no business data is dropped.

alter type public.member_role add value if not exists 'project_manager';
-- Staff can no longer create their own workspace through this bootstrap RPC.
-- Accounts and organization membership are provisioned manually in Supabase.
revoke execute on function public.initialize_huswell_trading() from authenticated;
alter type public.quotation_status add value if not exists 'pending';
alter type public.quotation_status add value if not exists 'needs_revision';
do $$ begin create type public.approval_status as enum ('draft','pending','approved','rejected','needs_revision','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.cash_flow_type as enum ('starting_capital','additional_capital','loan_received','loan_payment','owner_withdrawal','reimbursement','payment_received','expense_paid','adjustment'); exception when duplicate_object then null; end $$;

-- Enrich core records while preserving the initial schema and its data.
alter table public.organizations add column if not exists tin text;
alter table public.organizations add column if not exists logo_url text;
alter table public.business_settings add column if not exists default_overhead_rate numeric(5,2) not null default 0 check (default_overhead_rate between 0 and 100);
alter table public.business_settings add column if not exists sales_target_monthly numeric(14,2) not null default 0;
alter table public.business_settings add column if not exists sales_target_annual numeric(14,2) not null default 0;
alter table public.business_settings add column if not exists expense_approval_threshold numeric(14,2) not null default 5000;
alter table public.business_settings add column if not exists created_at timestamptz not null default now();
alter table public.customers add column if not exists tin text;
alter table public.suppliers add column if not exists tin text;
alter table public.employees add column if not exists role text;
alter table public.inventory_items add column if not exists category text;
alter table public.inventory_items add column if not exists units_per_piece numeric(14,3) not null default 1;
alter table public.inventory_items add column if not exists selling_price numeric(14,2) not null default 0;
alter table public.inventory_items add column if not exists tax_amount numeric(14,2) not null default 0;
alter table public.inventory_items add column if not exists other_costs numeric(14,2) not null default 0;
alter table public.inventory_items add column if not exists notes text;
alter table public.quotations add column if not exists representative text;
alter table public.quotations add column if not exists version integer not null default 1;
alter table public.quotations add column if not exists overhead_rate numeric(5,2) not null default 0;
alter table public.quotations add column if not exists submitted_at timestamptz;
alter table public.quotations add column if not exists submitted_by uuid references auth.users(id);
alter table public.quotations add column if not exists approved_at timestamptz;
alter table public.quotations add column if not exists approved_by uuid references auth.users(id);
alter table public.quotations add column if not exists decision_note text;
alter table public.quotations add column if not exists archived_at timestamptz;
alter table public.quotation_items add column if not exists created_at timestamptz not null default now();
alter table public.production_jobs add column if not exists delivered_at timestamptz;
alter table public.invoices add column if not exists receipt_no text;
alter table public.invoices add column if not exists sales_channel text;
alter table public.invoices add column if not exists discount_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists voided_by uuid references auth.users(id);
alter table public.invoices add column if not exists void_reason text;
alter table public.payments add column if not exists reversed_at timestamptz;
alter table public.payments add column if not exists reversed_by uuid references auth.users(id);
alter table public.payments add column if not exists reversal_reason text;
alter table public.invoice_items add column if not exists created_at timestamptz not null default now();
alter table public.invoice_items add column if not exists discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0);
alter table public.expenses add column if not exists status text not null default 'unfulfilled' check (status in ('unfulfilled','fulfilled','pending_approval','approved','rejected','cancelled'));
alter table public.expenses add column if not exists receipt_no text;
alter table public.expenses add column if not exists tin text;
alter table public.expenses add column if not exists business_address text;
alter table public.expenses add column if not exists notes text;
alter table public.expenses add column if not exists archived_at timestamptz;
alter table public.leave_requests add column if not exists days numeric(6,2) not null default 1;
alter table public.leave_requests add column if not exists approved_by uuid references auth.users(id);
alter table public.payroll_periods add column if not exists approved_by uuid references auth.users(id);
alter table public.payroll_periods add column if not exists approved_at timestamptz;
alter table public.payroll_periods add column if not exists paid_at timestamptz;
alter table public.payroll_entries add column if not exists created_at timestamptz not null default now();

create table if not exists public.production_material_usage (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, item_id uuid not null references public.inventory_items(id) on delete restrict, quantity numeric(14,3) not null check (quantity > 0), unit_cost numeric(14,2) not null default 0, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(production_job_id,item_id));
create table if not exists public.finished_product_stock_ins (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, item_id uuid not null references public.inventory_items(id) on delete restrict, stock_in_date date not null default current_date, quantity numeric(14,3) not null check(quantity > 0), status text not null default 'in_process' check(status in ('in_process','completed','cancelled')), notes text, production_job_id uuid references public.production_jobs(id) on delete set null, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.production_job_activity (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, action text not null, note text, actor_id uuid references auth.users(id), created_at timestamptz not null default now());
create table if not exists public.cash_flow_entries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, entry_type public.cash_flow_type not null, occurred_on date not null default current_date, description text not null, amount numeric(14,2) not null check(amount > 0), status public.approval_status not null default 'draft', notes text, created_by uuid references auth.users(id), approved_by uuid references auth.users(id), approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.target_goals (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, title text not null, goal_type text not null check(goal_type in ('monthly_item','monthly_sales','annual_sales','daily_task','weekly_task','monthly_task','annual_task')), target_value numeric(14,2) not null default 0, current_value numeric(14,2) not null default 0, period_start date, period_end date, is_completed boolean not null default false, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.approval_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, resource_type text not null check(resource_type in ('quotation','expense','inventory_adjustment','payroll','cash_flow','invoice_void','payment_reversal')), resource_id uuid not null, status public.approval_status not null default 'draft', submitted_by uuid not null references auth.users(id), submitted_at timestamptz, decided_by uuid references auth.users(id), decided_at timestamptz, decision_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(resource_type,resource_id));
create table if not exists public.activity_log (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, actor_id uuid references auth.users(id), resource_type text not null, resource_id uuid, action text not null, before_data jsonb, after_data jsonb, note text, created_at timestamptz not null default now());
create index if not exists production_usage_job_idx on public.production_material_usage(production_job_id);
create index if not exists finished_product_stock_ins_org_idx on public.finished_product_stock_ins(organization_id,stock_in_date desc);
create index if not exists production_activity_job_idx on public.production_job_activity(production_job_id,created_at desc);
create index if not exists cash_flow_org_date_idx on public.cash_flow_entries(organization_id,occurred_on desc);
create index if not exists target_goals_org_idx on public.target_goals(organization_id,goal_type);
create index if not exists approval_requests_org_status_idx on public.approval_requests(organization_id,status,created_at desc);
create index if not exists activity_log_org_created_idx on public.activity_log(organization_id,created_at desc);

create or replace function private.has_role(target_organization_id uuid, allowed public.member_role[]) returns boolean language sql stable security definer set search_path = public, private as $$ select exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=(select auth.uid()) and role=any(allowed)); $$;
-- Compare role labels as text here so this migration can add project_manager and
-- remain valid when a SQL editor executes the entire script in one transaction.
create or replace function private.can_manage_quotation(target_organization_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$ select exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=(select auth.uid()) and role::text in ('owner','admin','project_manager','sales')); $$;
grant execute on function private.has_role(uuid,public.member_role[]),private.can_manage_quotation(uuid) to authenticated;

-- Cost sheet calculation: total cost + markup + overhead + buffer + commission, then VAT.
create or replace function public.recalculate_quotation_totals() returns trigger language plpgsql as $$
declare target_id uuid; base_cost numeric(14,2); markup numeric(14,2); overhead numeric(14,2); buffer numeric(14,2); commission numeric(14,2); vat numeric(14,2);
begin target_id:=coalesce(new.quotation_id,old.quotation_id); select coalesce(sum(line_total),0) into base_cost from public.quotation_items where quotation_id=target_id; select base_cost*profit_margin_rate/100,base_cost*overhead_rate/100,base_cost*buffer_margin_rate/100,base_cost*commission_rate/100,vat_rate into markup,overhead,buffer,commission,vat from public.quotations where id=target_id; update public.quotations set total_cost=base_cost,subtotal=round(base_cost+markup+overhead+buffer+commission,2),vat_amount=round((base_cost+markup+overhead+buffer+commission)*vat/100,2),total_amount=round((base_cost+markup+overhead+buffer+commission)*(1+vat/100),2) where id=target_id; return null; end; $$;
create or replace function public.create_production_job_from_approved_quotation() returns trigger language plpgsql security definer set search_path=public as $$ begin if new.status='approved' and old.status is distinct from 'approved' then insert into public.production_jobs(organization_id,job_no,quotation_id,customer_id,title,status,due_date,notes) values(new.organization_id,'JOB-'||to_char(current_date,'YYYY')||'-'||substr(replace(new.id::text,'-',''),1,6),new.id,new.customer_id,coalesce(new.project_name,'Quotation '||new.quotation_no),'queued',new.valid_until,new.notes) on conflict(quotation_id) do nothing; end if; return new; end; $$;
drop trigger if exists quotation_approved_creates_production_job on public.quotations;
create trigger quotation_approved_creates_production_job after update of status on public.quotations for each row execute function public.create_production_job_from_approved_quotation();
create or replace function public.apply_production_material_usage() returns trigger language plpgsql security definer set search_path=public as $$
declare usage_id uuid:=coalesce(new.id,old.id); org_id uuid:=coalesce(new.organization_id,old.organization_id); material_id uuid:=coalesce(new.item_id,old.item_id); delta numeric; begin if tg_op='INSERT' then delta:=-new.quantity; elsif tg_op='DELETE' then delta:=old.quantity; else delete from public.inventory_movements where reference_type='production_material_usage' and reference_id=usage_id; delta:=-new.quantity; end if; insert into public.inventory_movements(organization_id,item_id,movement_type,quantity_change,unit_cost,reference_type,reference_id,notes,created_by) values(org_id,material_id,'production_use',delta,coalesce(new.unit_cost,old.unit_cost),'production_material_usage',usage_id,coalesce(new.notes,old.notes),auth.uid()); return null; end; $$;
drop trigger if exists production_usage_updates_stock on public.production_material_usage;
create trigger production_usage_updates_stock after insert or update or delete on public.production_material_usage for each row execute function public.apply_production_material_usage();
create or replace function public.sync_invoice_payment_status() returns trigger language plpgsql security definer set search_path=public as $$
declare target_invoice_id uuid:=coalesce(new.invoice_id,old.invoice_id); invoice_total numeric(14,2); paid_total numeric(14,2); begin if target_invoice_id is null then return null; end if; select total_amount into invoice_total from public.invoices where id=target_invoice_id; select coalesce(sum(amount),0) into paid_total from public.payments where invoice_id=target_invoice_id and reversed_at is null; update public.invoices set status=case when paid_total>=invoice_total and invoice_total>0 then 'paid' when paid_total>0 then 'partial' else 'issued' end where id=target_invoice_id and status not in ('void','draft'); return null; end; $$;
drop trigger if exists payment_syncs_invoice_status on public.payments;
create trigger payment_syncs_invoice_status after insert or update or delete on public.payments for each row execute function public.sync_invoice_payment_status();
create or replace function public.recalculate_invoice_totals() returns trigger language plpgsql as $$
declare target_id uuid; amount numeric(14,2); rate numeric(5,2);
begin
  target_id:=coalesce(new.invoice_id,old.invoice_id);
  select coalesce(sum(line_total-discount_amount),0) into amount from public.invoice_items where invoice_id=target_id;
  select vat_rate into rate from public.invoices where id=target_id;
  update public.invoices set subtotal=round(amount,2),vat_amount=round(amount*rate/100,2),total_amount=round(amount*(1+rate/100),2) where id=target_id;
  return null;
end; $$;
create or replace function public.apply_finished_product_stock_in() returns trigger language plpgsql security definer set search_path=public as $$
declare stock_id uuid:=coalesce(new.id,old.id); org_id uuid:=coalesce(new.organization_id,old.organization_id);
begin
  delete from public.inventory_movements where reference_type='finished_product_stock_in' and reference_id=stock_id;
  if tg_op <> 'DELETE' and new.status='completed' then
    insert into public.inventory_movements(organization_id,item_id,movement_type,quantity_change,unit_cost,reference_type,reference_id,notes,created_by)
    values(org_id,new.item_id,'stock_in',new.quantity,(select standard_cost from public.inventory_items where id=new.item_id),'finished_product_stock_in',stock_id,new.notes,auth.uid());
  end if;
  return null;
end; $$;
drop trigger if exists finished_product_stock_in_updates_inventory on public.finished_product_stock_ins;
create trigger finished_product_stock_in_updates_inventory after insert or update or delete on public.finished_product_stock_ins for each row execute function public.apply_finished_product_stock_in();
create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path=public as $$ declare target_org uuid:=coalesce(new.organization_id,old.organization_id); target_id uuid:=coalesce(new.id,old.id); begin insert into public.activity_log(organization_id,actor_id,resource_type,resource_id,action,before_data,after_data) values(target_org,auth.uid(),tg_table_name,target_id,lower(tg_op),case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end); return coalesce(new,old); end; $$;
create or replace function public.set_approval_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
do $$ declare t text; begin foreach t in array array['quotations','production_jobs','invoices','expenses','cash_flow_entries','target_goals','approval_requests','finished_product_stock_ins'] loop execute format('drop trigger if exists %I on public.%I',t||'_activity_log',t); execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_activity()',t||'_activity_log',t); end loop; foreach t in array array['cash_flow_entries','target_goals','approval_requests','finished_product_stock_ins'] loop execute format('drop trigger if exists %I on public.%I',t||'_updated_at',t); execute format('create trigger %I before update on public.%I for each row execute function public.set_approval_updated_at()',t||'_updated_at',t); end loop; end $$;

-- Role-aware quotation changes; other members retain the scoped policies from 001.
drop policy if exists "quotations: members update" on public.quotations;
drop policy if exists "quotations: authorized update" on public.quotations;
create policy "quotations: authorized update" on public.quotations for update to authenticated using ((select private.can_manage_quotation(organization_id))) with check ((select private.can_manage_quotation(organization_id)));
alter table public.approval_requests enable row level security; alter table public.activity_log enable row level security;
drop policy if exists "approval requests: members read" on public.approval_requests; drop policy if exists "approval requests: members create" on public.approval_requests; drop policy if exists "approval requests: admins decide" on public.approval_requests; drop policy if exists "activity log: members read" on public.activity_log;
create policy "approval requests: members read" on public.approval_requests for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "approval requests: members create" on public.approval_requests for insert to authenticated with check ((select private.is_org_member(organization_id)) and submitted_by=(select auth.uid()));
create policy "approval requests: admins decide" on public.approval_requests for update to authenticated using ((select private.is_org_admin(organization_id))) with check ((select private.is_org_admin(organization_id)));
create policy "activity log: members read" on public.activity_log for select to authenticated using ((select private.is_org_member(organization_id)));
do $$ declare t text; begin foreach t in array array['production_material_usage','production_job_activity','cash_flow_entries','target_goals','finished_product_stock_ins'] loop execute format('alter table public.%I enable row level security',t); execute format('drop policy if exists %I on public.%I',t||': members read',t); execute format('drop policy if exists %I on public.%I',t||': members insert',t); execute format('drop policy if exists %I on public.%I',t||': members update',t); execute format('drop policy if exists %I on public.%I',t||': members delete',t); execute format('create policy %I on public.%I for select to authenticated using ((select private.is_org_member(organization_id)))',t||': members read',t); execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_org_member(organization_id)))',t||': members insert',t); execute format('create policy %I on public.%I for update to authenticated using ((select private.is_org_member(organization_id))) with check ((select private.is_org_member(organization_id)))',t||': members update',t); execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_org_admin(organization_id)))',t||': members delete',t); end loop; end $$;
create or replace view public.finance_monthly_summary with (security_invoker=true) as select organization_id,date_trunc('month',occurred_on)::date as month,sum(cash_in) as cash_in,sum(cash_out) as cash_out,sum(cash_in-cash_out) as net_cash from (select organization_id,paid_at::date as occurred_on,amount as cash_in,0::numeric as cash_out from public.payments union all select organization_id,expense_date,0::numeric,amount from public.expenses where archived_at is null and status not in ('rejected','cancelled') union all select organization_id,occurred_on,case when entry_type in ('starting_capital','additional_capital','loan_received','reimbursement') then amount else 0 end,case when entry_type in ('loan_payment','owner_withdrawal','expense_paid') then amount else 0 end from public.cash_flow_entries where status='approved') movements group by organization_id,date_trunc('month',occurred_on);

-- Use explicit trigger returns for delete events (rather than a polymorphic record expression).
create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path=public as $$
declare target_org uuid:=coalesce(new.organization_id,old.organization_id); target_id uuid:=coalesce(new.id,old.id);
begin
  insert into public.activity_log(organization_id,actor_id,resource_type,resource_id,action,before_data,after_data)
  values(target_org,auth.uid(),tg_table_name,target_id,lower(tg_op),case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

-- Role-specific mutation guards for settings, finance, payroll, and sales.
create or replace function private.has_text_role(target_organization_id uuid, allowed text[]) returns boolean language sql stable security definer set search_path=public,private as $$ select exists(select 1 from public.organization_members where organization_id=target_organization_id and user_id=(select auth.uid()) and role::text=any(allowed)); $$;
grant execute on function private.has_text_role(uuid,text[]) to authenticated;
drop policy if exists "business_settings: members update" on public.business_settings;
drop policy if exists "business settings: privileged update" on public.business_settings;
create policy "business settings: privileged update" on public.business_settings for update to authenticated using ((select private.has_text_role(organization_id,array['owner','admin']))) with check ((select private.has_text_role(organization_id,array['owner','admin'])));
drop policy if exists "cash_flow_entries: members update" on public.cash_flow_entries;
drop policy if exists "cash flow: finance update" on public.cash_flow_entries;
create policy "cash flow: finance update" on public.cash_flow_entries for update to authenticated using ((select private.has_text_role(organization_id,array['owner','admin','accountant']))) with check ((select private.has_text_role(organization_id,array['owner','admin','accountant'])));
drop policy if exists "payroll_periods: members update" on public.payroll_periods;
drop policy if exists "payroll: privileged update" on public.payroll_periods;
create policy "payroll: privileged update" on public.payroll_periods for update to authenticated using ((select private.has_text_role(organization_id,array['owner','admin','payroll']))) with check ((select private.has_text_role(organization_id,array['owner','admin','payroll'])));
drop policy if exists "leave_requests: members update" on public.leave_requests;
drop policy if exists "leave: privileged update" on public.leave_requests;
create policy "leave: privileged update" on public.leave_requests for update to authenticated using ((select private.has_text_role(organization_id,array['owner','admin','payroll']))) with check ((select private.has_text_role(organization_id,array['owner','admin','payroll'])));

-- Operations automation: production status history, high-value expense review, and finished-good sales deductions.
create or replace function public.log_production_status_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.production_job_activity(organization_id,production_job_id,action,note,actor_id)
    values(new.organization_id,new.id,'status_changed','Stage: ' || replace(new.status::text,'_',' '),auth.uid());
  end if;
  return new;
end; $$;
drop trigger if exists production_status_activity on public.production_jobs;
create trigger production_status_activity after insert or update of status on public.production_jobs for each row execute function public.log_production_status_change();
create or replace function public.queue_high_value_expense_approval() returns trigger language plpgsql security definer set search_path=public as $$
declare threshold numeric(14,2);
begin
  select expense_approval_threshold into threshold from public.business_settings where organization_id=new.organization_id;
  if new.amount >= coalesce(threshold,5000) and new.status not in ('approved','rejected','cancelled') then
    new.status := 'pending_approval';
  end if;
  return new;
end; $$;
drop trigger if exists expense_threshold_approval on public.expenses;
create trigger expense_threshold_approval before insert or update of amount on public.expenses for each row execute function public.queue_high_value_expense_approval();
create or replace function public.create_expense_approval_request() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='pending_approval' then
    insert into public.approval_requests(organization_id,resource_type,resource_id,status,submitted_by,submitted_at)
    values(new.organization_id,'expense',new.id,'pending',coalesce(new.created_by,auth.uid()),now())
    on conflict(resource_type,resource_id) do update set status='pending',submitted_at=excluded.submitted_at;
  end if;
  return new;
end; $$;
drop trigger if exists expense_approval_request on public.expenses;
create trigger expense_approval_request after insert or update of status on public.expenses for each row execute function public.create_expense_approval_request();
create or replace function public.sync_finished_goods_sale() returns trigger language plpgsql security definer set search_path=public as $$
declare invoice_id uuid:=coalesce(new.id,old.id); org_id uuid:=coalesce(new.organization_id,old.organization_id); item record;
begin
  delete from public.inventory_movements where reference_type='invoice_sale' and reference_id=invoice_id;
  if tg_op <> 'DELETE' and new.status='paid' then
    for item in select ii.inventory_item_id,ii.quantity,ii.unit_price,ii.description from public.invoice_items ii join public.inventory_items i on i.id=ii.inventory_item_id where ii.invoice_id=new.id and i.item_type='product' loop
      insert into public.inventory_movements(organization_id,item_id,movement_type,quantity_change,unit_cost,reference_type,reference_id,notes,created_by)
      values(org_id,item.inventory_item_id,'sale',-item.quantity,item.unit_price,'invoice_sale',invoice_id,item.description,auth.uid());
    end loop;
  end if;
  return null;
end; $$;
drop trigger if exists invoice_paid_deducts_finished_goods on public.invoices;
create trigger invoice_paid_deducts_finished_goods after update of status or delete on public.invoices for each row execute function public.sync_finished_goods_sale();
create or replace view public.product_sales_summary with (security_invoker=true) as
select i.organization_id,i.id as inventory_item_id,i.name,i.sku,coalesce(sum(case when inv.status <> 'void' then li.quantity else 0 end),0) as all_time_items_sold,coalesce(sum(case when inv.status <> 'void' then li.line_total-li.discount_amount else 0 end),0) as all_time_sales,dense_rank() over(partition by i.organization_id order by coalesce(sum(case when inv.status <> 'void' then li.line_total-li.discount_amount else 0 end),0) desc) as sales_rank from public.inventory_items i left join public.invoice_items li on li.inventory_item_id=i.id left join public.invoices inv on inv.id=li.invoice_id where i.item_type in ('product','service') group by i.organization_id,i.id,i.name,i.sku;
create or replace view public.customer_history_summary with (security_invoker=true) as
select c.organization_id,c.id as customer_id,c.company_name,count(distinct q.id) as quotation_count,count(distinct i.id) as invoice_count,coalesce(sum(case when i.status <> 'void' then i.total_amount else 0 end),0) as invoice_total,coalesce(sum(p.amount),0) as payment_total from public.customers c left join public.quotations q on q.customer_id=c.id left join public.invoices i on i.customer_id=c.id left join public.payments p on p.customer_id=c.id group by c.organization_id,c.id,c.company_name;
create or replace view public.supplier_history_summary with (security_invoker=true) as
select s.organization_id,s.id as supplier_id,s.company_name,count(distinct it.id) as linked_material_count,count(distinct e.id) as expense_count,coalesce(sum(e.amount),0) as expense_total from public.suppliers s left join public.inventory_items it on it.supplier_id=s.id left join public.expenses e on e.supplier_id=s.id and e.archived_at is null group by s.organization_id,s.id,s.company_name;

create or replace function public.queue_cash_flow_approval() returns trigger language plpgsql as $$ begin if new.entry_type in ('starting_capital','additional_capital','loan_received','loan_payment','owner_withdrawal','adjustment') then new.status:='pending'; end if; return new; end; $$;
drop trigger if exists cash_flow_requires_approval on public.cash_flow_entries;
create trigger cash_flow_requires_approval before insert on public.cash_flow_entries for each row execute function public.queue_cash_flow_approval();
create or replace function public.create_sensitive_approval_request() returns trigger language plpgsql security definer set search_path=public as $$
declare resource_kind text; target_id uuid; target_org uuid; actor uuid; should_queue boolean:=false;
begin
  target_id:=coalesce(new.id,old.id); target_org:=coalesce(new.organization_id,old.organization_id); actor:=coalesce(new.created_by,auth.uid());
  if tg_table_name='cash_flow_entries' and new.status='pending' then resource_kind:='cash_flow'; should_queue:=true; end if;
  if tg_table_name='payroll_periods' and new.status='in_review' then resource_kind:='payroll'; should_queue:=true; end if;
  if tg_table_name='inventory_movements' and new.movement_type in ('adjustment_in','adjustment_out') then resource_kind:='inventory_adjustment'; should_queue:=true; end if;
  if should_queue then insert into public.approval_requests(organization_id,resource_type,resource_id,status,submitted_by,submitted_at) values(target_org,resource_kind,target_id,'pending',actor,now()) on conflict(resource_type,resource_id) do update set status='pending',submitted_at=excluded.submitted_at; end if;
  return new;
end; $$;
drop trigger if exists cash_flow_approval_request on public.cash_flow_entries;
create trigger cash_flow_approval_request after insert or update of status on public.cash_flow_entries for each row execute function public.create_sensitive_approval_request();
drop trigger if exists payroll_approval_request on public.payroll_periods;
create trigger payroll_approval_request after update of status on public.payroll_periods for each row execute function public.create_sensitive_approval_request();
drop trigger if exists inventory_adjustment_approval_request on public.inventory_movements;
create trigger inventory_adjustment_approval_request after insert on public.inventory_movements for each row execute function public.create_sensitive_approval_request();

-- Final role matrix. The UI uses the same role boundaries; these policies are the
-- authority that prevents direct API calls from bypassing the interface.
create or replace function private.can_access(target_organization_id uuid, resource text, action text)
returns boolean language sql stable security definer set search_path=public,private as $$
  select exists(
    select 1 from public.organization_members m
    where m.organization_id=target_organization_id and m.user_id=(select auth.uid()) and (
      m.role::text in ('owner','admin') or
      (m.role::text='project_manager' and (
        (action='read' and resource=any(array['business_settings','customers','suppliers','employees','inventory_items','inventory_movements','quotations','quotation_items','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins','invoices','invoice_items','payments','expenses'])) or
        (action='create' and resource=any(array['customers','quotations','quotation_items','production_material_usage','expenses'])) or
        (action='update' and resource=any(array['customers','quotations','production_jobs','expenses'])) or
        (action='delete' and resource='expenses')
      )) or
      (m.role::text='sales' and (
        (action='read' and resource=any(array['business_settings','customers','suppliers','employees','inventory_items','quotations','quotation_items','invoices','invoice_items','payments'])) or
        (action='create' and resource=any(array['quotations','quotation_items','invoices','invoice_items','payments'])) or
        (action='update' and resource=any(array['quotations','invoices','invoice_items','payments','customers']))
      )) or
      (m.role::text='warehouse' and (
        (action='read' and resource=any(array['customers','employees','inventory_items','inventory_movements','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins'])) or
        (action='create' and resource=any(array['inventory_items','inventory_movements','finished_product_stock_ins','production_material_usage'])) or
        (action='update' and resource=any(array['inventory_items','production_jobs','finished_product_stock_ins']))
      )) or
      (m.role::text='accountant' and (
        (action='read' and resource=any(array['customers','suppliers','employees','inventory_items','invoices','invoice_items','payments','expenses','cash_flow_entries'])) or
        (action='create' and resource=any(array['expenses','cash_flow_entries','invoices','invoice_items','payments'])) or
        (action='update' and resource=any(array['expenses','cash_flow_entries','invoices','invoice_items','payments','suppliers'])) or
        (action='delete' and resource='expenses')
      )) or
      (m.role::text='payroll' and (
        (action='read' and resource=any(array['employees','payroll_periods','payroll_entries','leave_requests'])) or
        (action='create' and resource=any(array['payroll_periods','payroll_entries','leave_requests'])) or
        (action='update' and resource=any(array['payroll_periods','payroll_entries','leave_requests']))
      )) or
      (m.role::text='production' and (
        (action='read' and resource=any(array['customers','employees','inventory_items','inventory_movements','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins'])) or
        (action='create' and resource=any(array['production_material_usage','finished_product_stock_ins','inventory_movements'])) or
        (action='update' and resource=any(array['production_jobs','finished_product_stock_ins']))
      )) or
      (m.role::text='viewer' and action='read' and resource=any(array['customers','suppliers','employees','inventory_items','inventory_movements','quotations','quotation_items','production_jobs','production_material_usage','production_job_activity','finished_product_stock_ins','invoices','invoice_items','payments','expenses','target_goals']))
    )
  );
$$;
grant execute on function private.can_access(uuid,text,text) to authenticated;

-- Direct organization tables share four role-aware policies.
do $$ declare t text; begin
  foreach t in array array['business_settings','customers','suppliers','employees','inventory_items','inventory_movements','quotations','production_jobs','invoices','payments','expenses','cash_flow_entries','payroll_periods','leave_requests','target_goals','production_material_usage','production_job_activity','finished_product_stock_ins'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||': members read',t); execute format('drop policy if exists %I on public.%I',t||': members insert',t); execute format('drop policy if exists %I on public.%I',t||': members update',t); execute format('drop policy if exists %I on public.%I',t||': members delete',t);
    execute format('drop policy if exists %I on public.%I',t||': role read',t); execute format('drop policy if exists %I on public.%I',t||': role insert',t); execute format('drop policy if exists %I on public.%I',t||': role update',t); execute format('drop policy if exists %I on public.%I',t||': role delete',t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access(organization_id,%L,''read'')))',t||': role read',t,t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.can_access(organization_id,%L,''create'')))',t||': role insert',t,t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.can_access(organization_id,%L,''update''))) with check ((select private.can_access(organization_id,%L,''update'')))',t||': role update',t,t,t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.can_access(organization_id,%L,''delete'')))',t||': role delete',t,t);
  end loop;
end $$;

-- Child rows inherit the role of their parent record.
drop policy if exists "quotation items: members manage" on public.quotation_items; drop policy if exists "quotation items: role read" on public.quotation_items; drop policy if exists "quotation items: role insert" on public.quotation_items; drop policy if exists "quotation items: role update" on public.quotation_items; drop policy if exists "quotation items: role delete" on public.quotation_items;
create policy "quotation items: role read" on public.quotation_items for select to authenticated using (exists(select 1 from public.quotations q where q.id=quotation_id and (select private.can_access(q.organization_id,'quotation_items','read'))));
create policy "quotation items: role insert" on public.quotation_items for insert to authenticated with check (exists(select 1 from public.quotations q where q.id=quotation_id and q.status::text in ('draft','needs_revision') and (select private.can_access(q.organization_id,'quotation_items','create'))));
create policy "quotation items: role update" on public.quotation_items for update to authenticated using (exists(select 1 from public.quotations q where q.id=quotation_id and q.status::text in ('draft','needs_revision') and (select private.can_access(q.organization_id,'quotation_items','update')))) with check (exists(select 1 from public.quotations q where q.id=quotation_id and q.status::text in ('draft','needs_revision') and (select private.can_access(q.organization_id,'quotation_items','update'))));
create policy "quotation items: role delete" on public.quotation_items for delete to authenticated using (exists(select 1 from public.quotations q where q.id=quotation_id and q.status::text in ('draft','needs_revision') and (select private.can_access(q.organization_id,'quotation_items','delete'))));
drop policy if exists "invoice items: members manage" on public.invoice_items; drop policy if exists "invoice items: role read" on public.invoice_items; drop policy if exists "invoice items: role insert" on public.invoice_items; drop policy if exists "invoice items: role update" on public.invoice_items; drop policy if exists "invoice items: role delete" on public.invoice_items;
create policy "invoice items: role read" on public.invoice_items for select to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id and (select private.can_access(i.organization_id,'invoice_items','read'))));
create policy "invoice items: role insert" on public.invoice_items for insert to authenticated with check (exists(select 1 from public.invoices i where i.id=invoice_id and i.status='draft' and (select private.can_access(i.organization_id,'invoice_items','create'))));
create policy "invoice items: role update" on public.invoice_items for update to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id and i.status='draft' and (select private.can_access(i.organization_id,'invoice_items','update')))) with check (exists(select 1 from public.invoices i where i.id=invoice_id and i.status='draft' and (select private.can_access(i.organization_id,'invoice_items','update'))));
create policy "invoice items: role delete" on public.invoice_items for delete to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id and i.status='draft' and (select private.can_access(i.organization_id,'invoice_items','delete'))));
drop policy if exists "payroll entries: members manage" on public.payroll_entries; drop policy if exists "payroll entries: role read" on public.payroll_entries; drop policy if exists "payroll entries: role insert" on public.payroll_entries; drop policy if exists "payroll entries: role update" on public.payroll_entries; drop policy if exists "payroll entries: role delete" on public.payroll_entries;
create policy "payroll entries: role read" on public.payroll_entries for select to authenticated using (exists(select 1 from public.payroll_periods p where p.id=payroll_period_id and (select private.can_access(p.organization_id,'payroll_entries','read'))));
create policy "payroll entries: role insert" on public.payroll_entries for insert to authenticated with check (exists(select 1 from public.payroll_periods p where p.id=payroll_period_id and (select private.can_access(p.organization_id,'payroll_entries','create'))));
create policy "payroll entries: role update" on public.payroll_entries for update to authenticated using (exists(select 1 from public.payroll_periods p where p.id=payroll_period_id and (select private.can_access(p.organization_id,'payroll_entries','update')))) with check (exists(select 1 from public.payroll_periods p where p.id=payroll_period_id and (select private.can_access(p.organization_id,'payroll_entries','update'))));
create policy "payroll entries: role delete" on public.payroll_entries for delete to authenticated using (exists(select 1 from public.payroll_periods p where p.id=payroll_period_id and (select private.can_access(p.organization_id,'payroll_entries','delete'))));

drop policy if exists "quotations: authorized update" on public.quotations;
drop policy if exists "business settings: privileged update" on public.business_settings;
drop policy if exists "cash flow: finance update" on public.cash_flow_entries;
drop policy if exists "payroll: privileged update" on public.payroll_periods;
drop policy if exists "leave: privileged update" on public.leave_requests;
drop policy if exists "approval requests: members read" on public.approval_requests; drop policy if exists "approval requests: members create" on public.approval_requests; drop policy if exists "approval requests: admins decide" on public.approval_requests; drop policy if exists "approval requests: role read" on public.approval_requests; drop policy if exists "approval requests: role create" on public.approval_requests; drop policy if exists "approval requests: role decide" on public.approval_requests;
create policy "approval requests: role read" on public.approval_requests for select to authenticated using ((select private.has_text_role(organization_id,array['owner','admin'])) or submitted_by=(select auth.uid()));
create policy "approval requests: role create" on public.approval_requests for insert to authenticated with check (submitted_by=(select auth.uid()) and ((resource_type='quotation' and (select private.can_access(organization_id,'quotations','update'))) or (resource_type='expense' and (select private.can_access(organization_id,'expenses','update'))) or (resource_type='invoice_void' and (select private.can_access(organization_id,'invoices','update'))) or (resource_type='payment_reversal' and (select private.can_access(organization_id,'payments','update'))) or (resource_type='payroll' and (select private.can_access(organization_id,'payroll_periods','update'))) or (resource_type='cash_flow' and (select private.can_access(organization_id,'cash_flow_entries','update'))) or (resource_type='inventory_adjustment' and (select private.can_access(organization_id,'inventory_movements','create')))));
create policy "approval requests: role decide" on public.approval_requests for update to authenticated using ((select private.has_text_role(organization_id,array['owner','admin']))) with check ((select private.has_text_role(organization_id,array['owner','admin'])));
drop policy if exists "activity log: members read" on public.activity_log; drop policy if exists "activity log: admins read" on public.activity_log; create policy "activity log: admins read" on public.activity_log for select to authenticated using ((select private.has_text_role(organization_id,array['owner','admin'])));
drop policy if exists "members: organization members read" on public.organization_members; drop policy if exists "members: admins read" on public.organization_members; create policy "members: admins read" on public.organization_members for select to authenticated using (user_id=(select auth.uid()) or (select private.is_org_admin(organization_id)));
drop policy if exists "organizations: users create" on public.organizations;
drop policy if exists "members: owners bootstrap or admins manage" on public.organization_members;

-- Non-admins can prepare and submit records, but only an owner/admin can make
-- an approval decision or force a final financial state.
create or replace function public.enforce_role_sensitive_transitions() returns trigger language plpgsql security definer set search_path=public,private as $$
declare current_role text;
begin
  -- Allow status changes produced by the controlled workflow triggers (for
  -- example, payment collection changing an invoice to paid).
  if pg_trigger_depth() > 1 then return new; end if;
  select role::text into current_role from public.organization_members where organization_id=new.organization_id and user_id=auth.uid();
  if current_role in ('owner','admin') then return new; end if;
  if tg_table_name='quotations' and (new.status::text not in ('draft','needs_revision','pending') or (tg_op='UPDATE' and old.status::text not in ('draft','needs_revision'))) then raise exception 'Only an administrator can approve or finalize a quotation'; end if;
  if tg_table_name='expenses' and (new.status::text not in ('unfulfilled','fulfilled','pending_approval') or (tg_op='UPDATE' and old.status::text not in ('unfulfilled','fulfilled','pending_approval'))) then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;
  if tg_table_name='invoices' and (new.status::text not in ('draft','issued','partial') or (tg_op='UPDATE' and old.status::text not in ('draft','issued','partial'))) then raise exception 'Only an administrator can set this invoice status directly'; end if;
  if tg_table_name='payroll_periods' and (new.status::text not in ('draft','in_review') or (tg_op='UPDATE' and old.status::text not in ('draft','in_review'))) then raise exception 'Only an administrator can approve or mark payroll paid'; end if;
  if tg_table_name='cash_flow_entries' and (new.status::text not in ('draft','pending') or (tg_op='UPDATE' and old.status::text not in ('draft','pending'))) then raise exception 'Only an administrator can approve cash flow'; end if;
  return new;
end; $$;
do $$ declare t text; begin foreach t in array array['quotations','expenses','invoices','payroll_periods','cash_flow_entries'] loop execute format('drop trigger if exists role_sensitive_transition on public.%I',t); execute format('create trigger role_sensitive_transition before insert or update on public.%I for each row execute function public.enforce_role_sensitive_transitions()',t); end loop; end $$;
