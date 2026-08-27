-- One-time combined update for the revised Huswell workflow.
-- Run this single file after the original setup migrations 001 through 009.
-- It safely includes the changes from 010 through 014.

-- 010: roles, Leads / Projects, and finance support.
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

drop policy if exists "suppliers: project officers manage" on public.suppliers;
create policy "suppliers: project officers manage" on public.suppliers for all to authenticated
using ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])))
with check ((select private.has_text_role(organization_id,array['owner','admin','project_manager'])));

-- 011 and 013: Costing Breakdown -> Price Quotation workflow.
alter table public.quotations add column if not exists document_type text not null default 'price_quotation'
  check (document_type in ('costing_breakdown','price_quotation'));
alter table public.quotations add column if not exists costing_source_id uuid references public.quotations(id) on delete restrict;
alter table public.quotations add column if not exists terms_conditions text;
alter table public.quotations add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists quotations_org_document_status_idx
  on public.quotations(organization_id,document_type,status,issue_date desc);
create index if not exists quotations_lead_id_idx on public.quotations(lead_id);

create or replace function public.validate_quotation_document_workflow()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare source_status text; source_type text; source_lead uuid;
begin
  if new.document_type='costing_breakdown' and new.lead_id is null then
    raise exception 'A Costing Breakdown must be created from a Lead / Project';
  end if;

  if new.document_type='price_quotation' and new.costing_source_id is null then
    raise exception 'A Price Quotation must be created from an approved Costing Breakdown';
  end if;

  if new.document_type='price_quotation' then
    select status::text, document_type, lead_id
      into source_status, source_type, source_lead
      from public.quotations
      where id=new.costing_source_id and organization_id=new.organization_id;
    if source_type is distinct from 'costing_breakdown' or source_status is distinct from 'approved' then
      raise exception 'A Price Quotation requires an approved Costing Breakdown';
    end if;
    if new.lead_id is distinct from source_lead then
      raise exception 'A Price Quotation must use the same Lead / Project as its Costing Breakdown';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_document_workflow on public.quotations;
create trigger quotation_document_workflow
before insert or update of document_type,costing_source_id,status
on public.quotations for each row execute function public.validate_quotation_document_workflow();

-- Production jobs are created only for approved client-facing Price Quotations.
create or replace function public.create_production_job_from_approved_quotation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.document_type='price_quotation'
    and new.status='approved'
    and old.status is distinct from 'approved'
  then
    insert into public.production_jobs(organization_id,job_no,quotation_id,customer_id,title,status,due_date,notes)
    values(new.organization_id,'JOB-'||to_char(current_date,'YYYY')||'-'||substr(replace(new.id::text,'-',''),1,6),new.id,new.customer_id,coalesce(new.project_name,'Quotation '||new.quotation_no),'queued',new.valid_until,new.notes)
    on conflict(quotation_id) do nothing;
  end if;
  return new;
end;
$$;

-- 012: Owner / General Manager can identify workspace staff.
alter table public.profiles enable row level security;
drop policy if exists "profiles: workspace owners read staff" on public.profiles;
create policy "profiles: workspace owners read staff"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1 from public.organization_members target_member
    where target_member.user_id = profiles.id
      and (select private.is_org_admin(target_member.organization_id))
  )
);

-- 014: Automatically assign Lead / Project numbers.
create sequence if not exists public.lead_no_sequence;

create or replace function public.assign_lead_number()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.lead_no is null or btrim(new.lead_no) = '' then
    new.lead_no := format(
      'LD-%s-%s',
      to_char(current_date, 'YYYY'),
      lpad(nextval('public.lead_no_sequence')::text, 4, '0')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_number on public.leads;
create trigger leads_assign_number
before insert on public.leads
for each row execute function public.assign_lead_number();
