begin;

-- Production page access is split into a read boundary and a CRUD boundary.
-- Management and Finance may inspect Production, while only the delegated
-- Production Operations user may change it.
create or replace function private.can_view_production(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and (
        member.role::text = any (array['super_admin', 'owner', 'admin', 'accountant'])
        or exists (
          select 1
          from public.organization_member_capabilities capability
          where capability.organization_id = member.organization_id
            and capability.user_id = member.user_id
            and capability.capability::text = 'revised_finance'
        )
        or exists (
          select 1
          from public.production_operations_permissions permission
          where permission.organization_id = member.organization_id
            and permission.user_id = member.user_id
            and permission.is_active
        )
      )
  );
$$;

revoke all on function private.can_view_production(uuid) from public, anon;
grant execute on function private.can_view_production(uuid) to authenticated;

-- Keep the existing helper as the write guard. If a management or Finance
-- account has a stale/accidental Production Operations row, it still cannot
-- use any CRUD RPC.
create or replace function private.has_production_operations(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.production_operations_permissions permission
      on permission.organization_id = member.organization_id
     and permission.user_id = member.user_id
     and permission.is_active
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role::text <> all (array['super_admin', 'owner', 'admin', 'accountant'])
      and not exists (
        select 1
        from public.organization_member_capabilities capability
        where capability.organization_id = member.organization_id
          and capability.user_id = member.user_id
          and capability.capability::text = 'revised_finance'
      )
  );
$$;

revoke all on function private.has_production_operations(uuid) from public, anon;
grant execute on function private.has_production_operations(uuid) to authenticated;

drop policy if exists "production status types: operations read"
  on public.production_status_types;
create policy "production status types: operations read"
on public.production_status_types for select to authenticated
using (
  (select private.can_view_production(organization_id))
);

drop policy if exists "production box makers: operations read"
  on public.production_box_makers;
create policy "production box makers: operations read"
on public.production_box_makers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production project tiers: operations read"
  on public.production_project_tiers;
create policy "production project tiers: operations read"
on public.production_project_tiers for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production box maker assignments: operations read"
  on public.production_box_maker_assignments;
create policy "production box maker assignments: operations read"
on public.production_box_maker_assignments for select to authenticated
using ((select private.can_view_production(organization_id)));

drop policy if exists "production cash advance requests: operations or management read"
  on public.production_cash_advance_requests;
create policy "production cash advance requests: operations or management read"
on public.production_cash_advance_requests for select to authenticated
using ((select private.can_view_production(organization_id)));

create or replace function public.list_production_operator_projects(
  p_organization_id uuid
)
returns table (
  quotation_id uuid,
  quotation_no text,
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
    coalesce(nullif(btrim(quotation.project_name), ''), quotation.quotation_no),
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

create or replace function public.get_production_operator_quotation_pdf(
  p_organization_id uuid,
  p_quotation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quotation public.quotations%rowtype;
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
  end if;

  select * into v_quotation
  from public.quotations
  where id = p_quotation_id
    and organization_id = p_organization_id
    and document_type::text = 'price_quotation'
    and costing_source_id is null
    and status::text = 'approved'
    and archived_at is null;

  if not found then
    raise exception 'Only an active approved direct Price Quotation can be opened';
  end if;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quotation.id,
      'quotation_no', v_quotation.quotation_no,
      'document_type', v_quotation.document_type,
      'quotation_source', v_quotation.quotation_source,
      'source_price_quotation_id', v_quotation.source_price_quotation_id,
      'issue_date', v_quotation.issue_date,
      'status', v_quotation.status,
      'customer_id', v_quotation.customer_id,
      'lead_id', v_quotation.lead_id,
      'project_name', v_quotation.project_name,
      'client_name', v_quotation.client_name,
      'client_contact_name', v_quotation.client_contact_name,
      'client_phone', v_quotation.client_phone,
      'client_address', v_quotation.client_address,
      'project_types', v_quotation.project_types,
      'representative', coalesce(
        (
          select profile.full_name
          from public.profiles profile
          where profile.id = coalesce(v_quotation.prepared_by_user_id, v_quotation.created_by)
        ),
        v_quotation.representative
      ),
      'prepared_by_signature_url', v_quotation.prepared_by_signature_url,
      'approved_by_name', (
        select profile.full_name
        from public.profiles profile
        where profile.id = v_quotation.approved_by
      ),
      'terms_conditions', v_quotation.terms_conditions,
      'payment_terms_option', v_quotation.payment_terms_option,
      'pdc_term_days', v_quotation.pdc_term_days,
      'bank_details', v_quotation.bank_details,
      'vat_rate', v_quotation.vat_rate,
      'vat_calculation_type', v_quotation.vat_calculation_type,
      'subtotal', v_quotation.subtotal,
      'vat_amount', v_quotation.vat_amount,
      'shipping_handling', v_quotation.shipping_handling,
      'total_amount', v_quotation.total_amount
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'quotation_id', item.quotation_id,
            'inventory_item_id', item.inventory_item_id,
            'description', item.description,
            'details', item.details,
            'image_url', item.image_url,
            'quantity', item.quantity,
            'unit_cost', item.unit_cost,
            'line_total', item.line_total,
            'sort_order', item.sort_order
          )
          order by item.sort_order, item.id
        )
        from public.quotation_items item
        where item.quotation_id = v_quotation.id
      ),
      '[]'::jsonb
    ),
    'customer', (
      select jsonb_build_object(
        'id', customer.id,
        'company_name', customer.company_name,
        'contact_name', customer.contact_name,
        'email', customer.email,
        'phone', customer.phone,
        'billing_address', customer.billing_address
      )
      from public.customers customer
      where customer.id = v_quotation.customer_id
        and customer.organization_id = p_organization_id
    ),
    'lead', (
      select jsonb_build_object(
        'id', lead.id,
        'client_name', lead.client_name,
        'contact_name', lead.contact_name,
        'email', lead.email,
        'phone', lead.phone,
        'address', lead.address,
        'date_sent', lead.date_sent,
        'created_at', lead.created_at
      )
      from public.leads lead
      where lead.id = v_quotation.lead_id
        and lead.organization_id = p_organization_id
    )
  );
end;
$$;

create or replace function public.list_production_status_types(
  p_organization_id uuid
)
returns table (
  id uuid,
  name text,
  legacy_status text,
  sort_order integer,
  is_active boolean,
  is_system boolean
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
  select status_type.id,
    status_type.name,
    status_type.legacy_status::text,
    status_type.sort_order,
    status_type.is_active,
    status_type.is_system
  from public.production_status_types status_type
  where status_type.organization_id = p_organization_id
  order by status_type.sort_order, status_type.name;
end;
$$;

create or replace function public.get_production_operator_details(
  p_organization_id uuid,
  p_production_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.can_view_production(p_organization_id) then
    raise exception 'Production page access is required';
  end if;

  if not exists (
    select 1
    from public.production_jobs job
    where job.id = p_production_job_id
      and job.organization_id = p_organization_id
      and job.production_added_at is not null
      and job.production_archived_at is null
  ) then
    raise exception 'The Production project is no longer active';
  end if;

  return jsonb_build_object(
    'tiers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', tier.id,
            'tier_number', tier.display_number,
            'percentage', tier.percentage
          )
          order by tier.display_number
        )
        from (
          select tier.id,
            tier.percentage,
            row_number() over (order by tier.tier_number, tier.created_at, tier.id) as display_number
          from public.production_project_tiers tier
          where tier.organization_id = p_organization_id
            and tier.production_job_id = p_production_job_id
            and tier.is_active
        ) tier
      ),
      '[]'::jsonb
    ),
    'box_makers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', maker.id,
            'name', maker.name,
            'is_active', maker.is_active
          )
          order by maker.name
        )
        from public.production_box_makers maker
        where maker.organization_id = p_organization_id
      ),
      '[]'::jsonb
    ),
    'assignments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'box_maker_id', assignment.box_maker_id,
            'box_maker_name', maker.name,
            'labor_cost', assignment.labor_cost,
            'cash_advance', assignment.cash_advance,
            'pending_cash_advance', coalesce((
              select sum(request.requested_amount)
              from public.production_cash_advance_requests request
              where request.assignment_id = assignment.id
                and request.status = 'pending'
            ), 0)::numeric(14,2),
            'balance', round(assignment.labor_cost - assignment.cash_advance, 2),
            'due_date', assignment.due_date
          )
          order by maker.name, assignment.created_at, assignment.id
        )
        from public.production_box_maker_assignments assignment
        join public.production_box_makers maker
          on maker.id = assignment.box_maker_id
         and maker.organization_id = p_organization_id
        where assignment.organization_id = p_organization_id
          and assignment.production_job_id = p_production_job_id
          and assignment.is_active
      ),
      '[]'::jsonb
    ),
    'cash_advance_requests', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', request.id,
            'assignment_id', request.assignment_id,
            'requested_amount', request.requested_amount,
            'approved_amount', request.approved_amount,
            'status', request.status,
            'request_note', request.request_note,
            'decision_note', request.decision_note,
            'requested_at', request.requested_at,
            'decided_at', request.decided_at
          )
          order by request.requested_at desc, request.id desc
        )
        from public.production_cash_advance_requests request
        where request.organization_id = p_organization_id
          and request.production_job_id = p_production_job_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.list_production_operator_projects(uuid) from public, anon;
grant execute on function public.list_production_operator_projects(uuid) to authenticated;
revoke all on function public.get_production_operator_quotation_pdf(uuid, uuid) from public, anon;
grant execute on function public.get_production_operator_quotation_pdf(uuid, uuid) to authenticated;
revoke all on function public.list_production_status_types(uuid) from public, anon;
grant execute on function public.list_production_status_types(uuid) to authenticated;
revoke all on function public.get_production_operator_details(uuid, uuid) from public, anon;
grant execute on function public.get_production_operator_details(uuid, uuid) to authenticated;

commit;
