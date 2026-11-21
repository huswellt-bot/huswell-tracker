-- Return both the client/company name and project name for the Production table.
-- Keep the quotation ID in its own UI column instead of using it as a name fallback.

begin;

drop function if exists public.list_production_operator_projects(uuid);

create function public.list_production_operator_projects(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
  client_name text,
  project_name text,
  project_type text,
  production_job_id uuid,
  job_no text,
  status_key text,
  status_label text,
  status_type_id uuid,
  operator_remark text,
  is_added boolean,
  pdf_available boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    nullif(btrim(quotation.client_name), ''),
    nullif(btrim(quotation.project_name), ''),
    quotation.project_types,
    case when job.production_added_at is not null and job.production_archived_at is null then job.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.job_no end,
    coalesce(job.status::text, 'queued'),
    case
      when job.production_added_at is null or job.production_archived_at is not null then 'Pending'
      else coalesce(status_type.name, initcap(replace(job.status::text, '_', ' ')))
    end,
    case when job.production_added_at is not null and job.production_archived_at is null then status_type.id end,
    case when job.production_added_at is not null and job.production_archived_at is null then job.production_operator_remark end,
    (job.production_added_at is not null and job.production_archived_at is null),
    (quotation.status::text = 'approved' and quotation.archived_at is null)
  from public.quotations quotation
  left join public.production_jobs job
    on job.quotation_id = quotation.id
   and job.organization_id = quotation.organization_id
  left join public.production_status_types status_type
    on status_type.id = job.production_status_type_id
   and status_type.organization_id = quotation.organization_id
   and status_type.legacy_status = job.status
  where quotation.organization_id = p_organization_id
    and quotation.document_type::text = 'price_quotation'
    and quotation.costing_source_id is null
    and (
      (job.production_added_at is not null and job.production_archived_at is null)
      or (
        quotation.status::text = 'approved'
        and quotation.archived_at is null
      )
    )
  order by quotation.updated_at desc, quotation.quotation_no asc;
end;
$$;

revoke all on function public.list_production_operator_projects(uuid) from public, anon;
grant execute on function public.list_production_operator_projects(uuid) to authenticated;

commit;
