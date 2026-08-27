-- Separate internal Costing Breakdowns from client-facing Price Quotations.
-- Run after 010. Existing quotation records remain available as Price Quotations.

alter table public.quotations add column if not exists document_type text not null default 'price_quotation'
  check (document_type in ('costing_breakdown','price_quotation'));
alter table public.quotations add column if not exists costing_source_id uuid references public.quotations(id) on delete restrict;
alter table public.quotations add column if not exists terms_conditions text;

create index if not exists quotations_org_document_status_idx
  on public.quotations(organization_id,document_type,status,issue_date desc);

create or replace function public.validate_quotation_document_workflow()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare source_status text; source_type text;
begin
  if new.document_type='price_quotation' and new.costing_source_id is null then
    raise exception 'A Price Quotation must be created from an approved Costing Breakdown';
  end if;

  if new.document_type='price_quotation' then
    select status::text,document_type into source_status,source_type
    from public.quotations where id=new.costing_source_id and organization_id=new.organization_id;
    if source_type is distinct from 'costing_breakdown' or source_status is distinct from 'approved' then
      raise exception 'A Price Quotation requires an approved Costing Breakdown';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists quotation_document_workflow on public.quotations;
create trigger quotation_document_workflow before insert or update of document_type,costing_source_id,status
on public.quotations for each row execute function public.validate_quotation_document_workflow();

-- A production job starts only after the client-facing Price Quotation is approved.
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
