-- Make the Lead / Project the source record for Costing Breakdowns and the
-- Price Quotations created from them.

alter table public.quotations add column if not exists lead_id uuid references public.leads(id) on delete set null;
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
    select status::text,document_type,lead_id into source_status,source_type,source_lead
    from public.quotations where id=new.costing_source_id and organization_id=new.organization_id;
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
