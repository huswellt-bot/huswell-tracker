-- Add the direct Price Quotation self-handled/shared commission workflow.
--
-- This migration is additive. Existing quotations with NULL commission
-- assignment fields continue to use the legacy endorsement fallback until
-- migration 214 performs the authorized historical backfill.
-- Run after 212_restrict_external_finance_account_data.sql and before the
-- matching workspace update. Do not execute this file from the browser.

begin;

alter table public.quotations
  add column if not exists se_origin_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_pricing_officer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists commission_handling_mode text,
  add column if not exists commission_co_worker_user_id uuid references auth.users(id) on delete set null,
  add column if not exists commission_split_option text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and conname = 'quotations_commission_handling_mode_check'
  ) then
    alter table public.quotations
      add constraint quotations_commission_handling_mode_check
      check (
        commission_handling_mode is null
        or commission_handling_mode in ('self_handled', 'shared')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quotations'::regclass
      and conname = 'quotations_commission_split_option_check'
  ) then
    alter table public.quotations
      add constraint quotations_commission_split_option_check
      check (
        commission_split_option is null
        or commission_split_option in (
          'self_handled_100_0',
          '50_50',
          '60_40',
          '70_30',
          '80_20'
        )
      );
  end if;
end;
$$;

create index if not exists quotations_assigned_pricing_officer_idx
  on public.quotations (organization_id, assigned_pricing_officer_user_id, status, created_at desc);
create index if not exists quotations_se_origin_idx
  on public.quotations (organization_id, se_origin_user_id, created_at desc);

alter table public.commission_summaries
  add column if not exists se_origin_user_id uuid references auth.users(id) on delete set null,
  add column if not exists commission_co_worker_user_id uuid references auth.users(id) on delete set null,
  add column if not exists commission_handling_mode text,
  add column if not exists commission_split_option text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commission_summaries'::regclass
      and conname = 'commission_summaries_handling_mode_check'
  ) then
    alter table public.commission_summaries
      add constraint commission_summaries_handling_mode_check
      check (
        commission_handling_mode is null
        or commission_handling_mode in ('self_handled', 'shared')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commission_summaries'::regclass
      and conname = 'commission_summaries_split_option_check'
  ) then
    alter table public.commission_summaries
      add constraint commission_summaries_split_option_check
      check (
        commission_split_option is null
        or commission_split_option in (
          'self_handled_100_0',
          '50_50',
          '60_40',
          '70_30',
          '80_20'
        )
      );
  end if;
end;
$$;

create index if not exists commission_summaries_commission_mode_idx
  on public.commission_summaries (organization_id, commission_handling_mode, created_at desc);

-- The first percentage is always the S.E. Origin share. The second percentage
-- is the Co-Worker share. The residual amount is calculated from the total so
-- the two rounded allocation rows always add back to the exact commission.
create or replace function private.commission_split_rates(
  p_split_option text
)
returns table (
  origin_rate numeric,
  coworker_rate numeric,
  self_handled boolean
)
language sql
immutable
set search_path = public, private
as $$
  select
    case p_split_option
      when 'self_handled_100_0' then 100::numeric
      when '50_50' then 50::numeric
      when '60_40' then 60::numeric
      when '70_30' then 70::numeric
      when '80_20' then 80::numeric
      else null
    end,
    case p_split_option
      when 'self_handled_100_0' then 0::numeric
      when '50_50' then 50::numeric
      when '60_40' then 40::numeric
      when '70_30' then 30::numeric
      when '80_20' then 20::numeric
      else null
    end,
    p_split_option = 'self_handled_100_0';
$$;

revoke all on function private.commission_split_rates(text) from public, anon, authenticated;
grant execute on function private.commission_split_rates(text) to authenticated;

create or replace function private.validate_quotation_commission_assignment(
  p_organization_id uuid,
  p_project_type text,
  p_origin_user_id uuid,
  p_handling_mode text,
  p_co_worker_user_id uuid,
  p_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_origin_role text;
  v_co_worker_role text;
  v_origin_rate numeric;
  v_coworker_rate numeric;
  v_self_handled boolean;
begin
  if p_origin_user_id is null then
    raise exception 'The S.E. Origin is required';
  end if;
  if p_handling_mode not in ('self_handled', 'shared') then
    raise exception 'Choose whether the quotation is self-handled or shared';
  end if;

  select member.role::text into v_origin_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_origin_user_id;
  if v_origin_role not in ('project_manager', 'sales_pricing_officer') then
    raise exception 'The S.E. Origin must be an active Sales Executive or Sales & Pricing Officer';
  end if;

  select rates.origin_rate, rates.coworker_rate, rates.self_handled
    into v_origin_rate, v_coworker_rate, v_self_handled
  from private.commission_split_rates(p_split_option) rates;
  if v_origin_rate is null then
    raise exception 'Choose a valid commission division';
  end if;

  if p_handling_mode = 'self_handled' then
    if not v_self_handled or v_origin_role <> 'sales_pricing_officer' then
      raise exception 'Only a Sales & Pricing Officer can use self-handled mode';
    end if;
    if p_co_worker_user_id is not null then
      raise exception 'Self-handled quotations cannot have a Co-Worker';
    end if;
    if not private.is_pricing_officer_assigned(
      p_organization_id,
      p_origin_user_id,
      p_project_type
    ) then
      raise exception 'The self-handling officer is not assigned to this project type';
    end if;
    return;
  end if;

  if v_self_handled or p_co_worker_user_id is null then
    raise exception 'Shared quotations require a Co-Worker and a shared division';
  end if;
  if p_co_worker_user_id = p_origin_user_id then
    raise exception 'The Co-Worker must be different from the S.E. Origin';
  end if;

  select member.role::text into v_co_worker_role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_co_worker_user_id;
  if v_co_worker_role <> 'sales_pricing_officer' then
    raise exception 'The Co-Worker must be an active Sales & Pricing Officer';
  end if;
  if not private.is_pricing_officer_assigned(
    p_organization_id,
    p_co_worker_user_id,
    p_project_type
  ) then
    raise exception 'The selected Co-Worker is not assigned to this project type';
  end if;
end;
$$;

revoke all on function private.validate_quotation_commission_assignment(
  uuid, text, uuid, text, uuid, text
) from public;
grant execute on function private.validate_quotation_commission_assignment(
  uuid, text, uuid, text, uuid, text
) to authenticated;

-- Assigned Pricing Officers may read the quotation only while it is in a
-- reviewable or completed state. A draft belongs to the S.E. Origin, and a
-- quotation returned to the S.E. Origin must not reappear in the assigned
-- reviewer's queue unless the GM explicitly routed the revision back to that
-- reviewer.
create or replace function private.is_assigned_pricing_officer_quotation_visible(
  p_assigned_pricing_officer_user_id uuid,
  p_status text,
  p_revision_requested_to text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_assigned_pricing_officer_user_id = (select auth.uid())
    and (
      p_status in ('pending', 'pending_gm_approval', 'approved')
      or (
        p_status = 'needs_revision'
        and p_revision_requested_to = 'pricing_officer'
      )
    );
$$;

revoke all on function private.is_assigned_pricing_officer_quotation_visible(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function private.is_assigned_pricing_officer_quotation_visible(
  uuid, text, text
) to authenticated;

-- Assignment fields are sensitive workflow fields. Client writes must go
-- through the RPCs below, where the actor and project-type checks are applied.
create or replace function private.enforce_quotation_commission_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(current_setting('huswell.commission_assignment_rpc', true), '') = 'on' then
    return new;
  end if;

  -- An unassigned draft may be created before the assignment modal is used.
  -- Once an existing quotation has assignment data, however, a direct client
  -- update must not be able to clear the assignment and bypass the workflow.
  if new.commission_handling_mode is null
    and new.se_origin_user_id is null
    and new.assigned_pricing_officer_user_id is null
    and new.commission_co_worker_user_id is null
    and new.commission_split_option is null then
    if tg_op = 'INSERT' then
      return new;
    end if;
    if old.commission_handling_mode is null
      and old.se_origin_user_id is null
      and old.assigned_pricing_officer_user_id is null
      and old.commission_co_worker_user_id is null
      and old.commission_split_option is null then
      return new;
    end if;
  end if;

  raise exception 'Quotation commission assignment must be changed through its workflow';
end;
$$;

drop trigger if exists quotation_commission_assignment_guard on public.quotations;
create trigger quotation_commission_assignment_guard
before insert or update of se_origin_user_id, assigned_pricing_officer_user_id,
  commission_handling_mode, commission_co_worker_user_id, commission_split_option
on public.quotations
for each row execute function private.enforce_quotation_commission_assignment();

-- The old restrictive policy only recognized creator/preparer/submitter. Add
-- the authoritative assigned reviewer so a shared quotation reaches Officer B.
drop policy if exists "price quotation submissions: own officer read"
  on public.quotations;
create policy "price quotation submissions: own officer read"
on public.quotations as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or created_by = (select auth.uid())
  or prepared_by_user_id = (select auth.uid())
  or submitted_by = (select auth.uid())
  or private.is_assigned_pricing_officer_quotation_visible(
    assigned_pricing_officer_user_id,
    status::text,
    revision_requested_to
  )
  or (
    assigned_pricing_officer_user_id is null
    and private.is_pricing_officer_assigned(
      organization_id,
      (select auth.uid()),
      project_types
    )
  )
);

-- Keep GM-revision data available only to the selected reviewer. Legacy rows
-- without an assignment retain the existing project-type fallback.
drop policy if exists "quotations: pricing revision read" on public.quotations;
create policy "quotations: pricing revision read"
on public.quotations for select to authenticated
using (
  document_type in ('price_quotation', 'mockup_quotation')
  and status::text = 'needs_revision'
  and revision_requested_to = 'pricing_officer'
  and (
    private.is_assigned_pricing_officer_quotation_visible(
      assigned_pricing_officer_user_id,
      status::text,
      revision_requested_to
    )
    or (
      assigned_pricing_officer_user_id is null
      and (select private.is_pricing_officer_assigned(
        organization_id,
        (select auth.uid()),
        project_types
      ))
    )
  )
);

-- The review modal reads several child tables. Keep their existing GM and
-- creator access, but apply the same exact-assignee boundary to Pricing
-- Officers so another officer cannot bypass the quotation policy by reading
-- child rows directly.
drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.quotation_items;
create policy "price quotation submissions: child exact reviewer read"
on public.quotation_items as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        not private.has_text_role(quote.organization_id, array['sales_pricing_officer'])
        or quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_illustrations;
create policy "price quotation submissions: child exact reviewer read"
on public.price_quotation_illustrations as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_product_costings;
create policy "price quotation submissions: child exact reviewer read"
on public.price_quotation_product_costings as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_costing_lines;
create policy "price quotation submissions: child exact reviewer read"
on public.price_quotation_costing_lines as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_costing_markups;
create policy "price quotation submissions: child exact reviewer read"
on public.price_quotation_costing_markups as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_revision_requests;
create policy "price quotation submissions: child exact reviewer read"
on public.price_quotation_revision_requests as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or submitted_by = (select auth.uid())
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.quotation_payment_records;
create policy "price quotation submissions: child exact reviewer read"
on public.quotation_payment_records as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['sales_pricing_officer'])
  or exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.created_by = (select auth.uid())
        or quote.prepared_by_user_id = (select auth.uid())
        or quote.submitted_by = (select auth.uid())
        or private.is_assigned_pricing_officer_quotation_visible(
          quote.assigned_pricing_officer_user_id,
          quote.status::text,
          quote.revision_requested_to
        )
        or (
          quote.assigned_pricing_officer_user_id is null
          and private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          )
        )
      )
  )
);

-- External Finance needs quotation identity and payment-term context for
-- approved direct Price Quotations, but must not receive the full quotations
-- row because it contains internal commission assignment and split fields.
-- Draft, revision, costing, and Mockup Quotations are not payment-submission
-- sources. The application uses this server-authoritative projection instead
-- of reading public.quotations directly.
create or replace function public.external_finance_quotation_rows(
  p_organization_id uuid
)
returns table (
  id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  lead_id uuid,
  customer_id uuid,
  document_type text,
  status text,
  total_amount numeric,
  payment_terms_option text,
  pdc_term_days integer
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.has_text_role(p_organization_id, array['external_finance']) then
    raise exception 'Only External Finance can read this quotation projection';
  end if;

  return query
  select
    quotation.id,
    quotation.quotation_no,
    quotation.project_name,
    quotation.client_name,
    quotation.lead_id,
    quotation.customer_id,
    quotation.document_type::text,
    quotation.status::text,
    quotation.total_amount,
    quotation.payment_terms_option,
    quotation.pdc_term_days
  from public.quotations quotation
  where quotation.organization_id = p_organization_id
    and quotation.document_type = 'price_quotation'
    and quotation.costing_source_id is null
    and quotation.status::text = 'approved'
  order by quotation.created_at desc, quotation.id desc;
end;
$$;

revoke all on function public.external_finance_quotation_rows(uuid)
  from public, anon;
grant execute on function public.external_finance_quotation_rows(uuid)
  to authenticated;

-- Keep full quotation rows internal. External Finance continues to use the
-- limited projection above for payment monitoring and receipt workflows.
drop policy if exists "quotations: finance read" on public.quotations;
create policy "quotations: finance read"
on public.quotations for select to authenticated
using (private.has_text_role(organization_id, array[
  'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
]));

drop policy if exists "quotations: external finance direct read denied"
  on public.quotations;
create policy "quotations: external finance direct read denied"
on public.quotations as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['external_finance'])
);

-- Migration 192 added External Finance to this broad policy. The Commission
-- page already uses commission_summary_rows_v3, and direct summary rows must
-- remain unavailable to External Finance.
drop policy if exists "commission summaries: finance read"
  on public.commission_summaries;
drop policy if exists "commission summaries: external finance direct read denied"
  on public.commission_summaries;
create policy "commission summaries: external finance direct read denied"
on public.commission_summaries as restrictive
for select to authenticated
using (
  not private.has_text_role(organization_id, array['external_finance'])
);

-- External Finance records receipts, but commission allocation and recipient
-- data belong to Internal Finance and management.
drop policy if exists "commission allocations: authorized read"
  on public.commission_summary_allocations;
create policy "commission allocations: authorized read"
on public.commission_summary_allocations for select to authenticated
using (
  private.has_text_role(organization_id, array[
    'super_admin', 'owner', 'admin', 'accountant', 'internal_finance'
  ])
  or (
    private.has_text_role(organization_id, array['sales_pricing_officer'])
    and recipient_user_id = (select auth.uid())
  )
);

-- Save the request and its routing decision atomically. The existing draft
-- RPC remains available for older clients; this new entry point is used by
-- the updated Prepare Price Quotation modal and by returned originators.
create or replace function public.save_price_quotation_draft_with_commission(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean,
  p_quotation_illustrations jsonb,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_lead public.leads%rowtype;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
  v_quote_id uuid;
begin
  select * into v_lead
  from public.leads lead_row
  where lead_row.id = p_lead_id
  for share;
  if not found then
    raise exception 'Lead not found';
  end if;

  if p_quotation_id is not null then
    select * into v_quote
    from public.quotations quotation
    where quotation.id = p_quotation_id
    for update;
    if not found
      or v_quote.document_type <> 'price_quotation'
      or v_quote.costing_source_id is not null then
      raise exception 'Price Quotation not found';
    end if;
    if v_quote.status::text not in ('draft', 'needs_revision') then
      raise exception 'Only draft or returned quotations can be edited';
    end if;
    if coalesce(v_quote.se_origin_user_id, v_quote.created_by) is distinct from (select auth.uid()) then
      raise exception 'Only the S.E. Origin can edit this quotation request';
    end if;
    v_origin_user_id := coalesce(v_quote.se_origin_user_id, v_quote.created_by);
  else
    v_origin_user_id := (select auth.uid());
  end if;

  perform private.validate_quotation_commission_assignment(
    v_lead.organization_id,
    p_project_type,
    v_origin_user_id,
    p_commission_handling_mode,
    p_commission_co_worker_user_id,
    p_commission_split_option
  );

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items,
    coalesce(p_has_illustrations, false),
    coalesce(p_quotation_illustrations, '[]'::jsonb)
  );

  v_assigned_user_id := case
    when p_commission_handling_mode = 'self_handled' then v_origin_user_id
    else p_commission_co_worker_user_id
  end;

  update public.quotations
  set se_origin_user_id = v_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = p_commission_handling_mode,
      commission_co_worker_user_id = p_commission_co_worker_user_id,
      commission_split_option = p_commission_split_option,
      revision_requested_to = null
  where id = v_quote_id;

  return v_quote_id;
end;
$$;

revoke all on function public.save_price_quotation_draft_with_commission(
  uuid, uuid, text, jsonb, boolean, jsonb, text, uuid, text
) from public, anon;
grant execute on function public.save_price_quotation_draft_with_commission(
  uuid, uuid, text, jsonb, boolean, jsonb, text, uuid, text
) to authenticated;

create or replace function public.submit_price_quotation_with_commission(
  p_quotation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('draft', 'needs_revision') then
    raise exception 'Only draft or returned Price Quotations can be submitted';
  end if;
  if not exists (
    select 1 from public.quotation_items item where item.quotation_id = v_quote.id
  ) then
    raise exception 'Add at least one item before submitting the quotation';
  end if;

  if v_quote.commission_handling_mode is null then
    -- Preserve the old workflow for historical drafts that have not been
    -- opened through the new assignment modal.
    perform public.submit_price_quotation(p_quotation_id);
    return;
  end if;

  v_origin_user_id := coalesce(v_quote.se_origin_user_id, v_quote.created_by);
  if v_origin_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the S.E. Origin can submit this quotation request';
  end if;
  if not private.has_text_role(
    v_quote.organization_id,
    array['project_manager', 'pricing_officer']
  ) then
    raise exception 'Only an active Sales Executive or Sales & Pricing Officer can submit this quotation request';
  end if;

  perform private.validate_quotation_commission_assignment(
    v_quote.organization_id,
    v_quote.project_types,
    v_origin_user_id,
    v_quote.commission_handling_mode,
    v_quote.commission_co_worker_user_id,
    v_quote.commission_split_option
  );

  v_assigned_user_id := case
    when v_quote.commission_handling_mode = 'self_handled' then v_origin_user_id
    else v_quote.commission_co_worker_user_id
  end;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set status = 'pending',
      assigned_pricing_officer_user_id = v_assigned_user_id,
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      revision_requested_to = null,
      resubmission_count = case
        when v_quote.status::text = 'needs_revision' then v_quote.resubmission_count + 1
        else v_quote.resubmission_count
      end
  where id = v_quote.id;

  insert into public.approval_requests (
    organization_id, resource_type, resource_id, status, submitted_by, submitted_at
  ) values (
    v_quote.organization_id, 'quotation', v_quote.id, 'pending',
    (select auth.uid()), now()
  )
  on conflict (resource_type, resource_id) do update
    set status = 'pending',
        submitted_by = excluded.submitted_by,
        submitted_at = excluded.submitted_at,
        decided_by = null,
        decided_at = null,
        decision_note = null;
end;
$$;

revoke all on function public.submit_price_quotation_with_commission(uuid)
  from public, anon;
grant execute on function public.submit_price_quotation_with_commission(uuid)
  to authenticated;

-- Pricing Officer review may change the division, but not the S.E. Origin,
-- handling mode, or selected Co-Worker. Those ownership changes are reserved
-- for the originator's draft request and the General Manager's final review.
create or replace function public.pricing_review_price_quotation_with_commission(
  p_quotation_id uuid,
  p_decision text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_revision_note text,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_submission_note text,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_split_option text;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.status::text not in ('pending', 'needs_revision') then
    raise exception 'Only submitted Price Quotations can be reviewed';
  end if;
  if v_quote.status::text = 'needs_revision'
    and v_quote.revision_requested_to <> 'pricing_officer' then
    raise exception 'This quotation is not awaiting Pricing Officer revision';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer']) then
    raise exception 'Only a Sales & Pricing Officer can review this quotation';
  end if;

  if v_quote.commission_handling_mode is null then
    -- Keep the old project-type routing path available to older records.
    perform public.pricing_review_price_quotation(
      p_quotation_id,
      p_decision,
      p_vat_rate,
      p_terms_conditions,
      p_bank_details,
      p_costings,
      p_revision_note,
      p_vat_calculation_type,
      p_vat_fixed_amount,
      p_submission_note,
      p_payment_terms_option,
      p_pdc_term_days
    );
    return;
  end if;

  if v_quote.assigned_pricing_officer_user_id is distinct from (select auth.uid())
    or not private.is_pricing_officer_assigned(
      v_quote.organization_id,
      (select auth.uid()),
      v_quote.project_types
    ) then
    raise exception 'Only the selected Pricing Officer can review this quotation';
  end if;

  v_split_option := coalesce(
    nullif(btrim(coalesce(p_commission_split_option, '')), ''),
    v_quote.commission_split_option
  );
  perform private.validate_quotation_commission_assignment(
    v_quote.organization_id,
    v_quote.project_types,
    v_quote.se_origin_user_id,
    v_quote.commission_handling_mode,
    v_quote.commission_co_worker_user_id,
    v_split_option
  );

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set commission_split_option = v_split_option
  where id = v_quote.id;

  perform public.pricing_review_price_quotation(
    p_quotation_id,
    p_decision,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_revision_note,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_submission_note,
    p_payment_terms_option,
    p_pdc_term_days
  );
end;
$$;

revoke all on function public.pricing_review_price_quotation_with_commission(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text
) from public, anon;
grant execute on function public.pricing_review_price_quotation_with_commission(
  uuid, text, numeric, text, jsonb, jsonb, text, text, numeric, text, text, integer, text
) to authenticated;

-- GM approval is the final authority for the assignment and division. The
-- approved quotation trigger snapshots these values into Commission Summary.
create or replace function public.final_approve_price_quotation_with_commission(
  p_quotation_id uuid,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can finally approve this quotation';
  end if;

  v_origin_user_id := coalesce(
    v_quote.se_origin_user_id,
    v_quote.prepared_by_user_id,
    v_quote.created_by
  );
  perform private.validate_quotation_commission_assignment(
    v_quote.organization_id,
    v_quote.project_types,
    v_origin_user_id,
    p_commission_handling_mode,
    p_commission_co_worker_user_id,
    p_commission_split_option
  );
  v_assigned_user_id := case
    when p_commission_handling_mode = 'self_handled' then v_origin_user_id
    else p_commission_co_worker_user_id
  end;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set se_origin_user_id = v_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = p_commission_handling_mode,
      commission_co_worker_user_id = p_commission_co_worker_user_id,
      commission_split_option = p_commission_split_option
  where id = v_quote.id;

  perform public.final_approve_price_quotation_with_edits(
    p_quotation_id,
    p_vat_rate,
    p_terms_conditions,
    p_bank_details,
    p_costings,
    p_vat_calculation_type,
    p_vat_fixed_amount,
    p_payment_terms_option,
    p_pdc_term_days
  );
end;
$$;

revoke all on function public.final_approve_price_quotation_with_commission(
  uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.final_approve_price_quotation_with_commission(
  uuid, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) to authenticated;

create or replace function public.return_price_quotation_from_gm_with_commission(
  p_quotation_id uuid,
  p_note text,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;

  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can return this quotation';
  end if;

  v_origin_user_id := coalesce(
    v_quote.se_origin_user_id,
    v_quote.prepared_by_user_id,
    v_quote.created_by
  );
  perform private.validate_quotation_commission_assignment(
    v_quote.organization_id,
    v_quote.project_types,
    v_origin_user_id,
    p_commission_handling_mode,
    p_commission_co_worker_user_id,
    p_commission_split_option
  );
  v_assigned_user_id := case
    when p_commission_handling_mode = 'self_handled' then v_origin_user_id
    else p_commission_co_worker_user_id
  end;

  perform set_config('huswell.commission_assignment_rpc', 'on', true);
  update public.quotations
  set terms_conditions = coalesce(nullif(btrim(p_terms_conditions), ''), terms_conditions),
      bank_details = coalesce(p_bank_details, bank_details),
      payment_terms_option = coalesce(nullif(btrim(p_payment_terms_option), ''), payment_terms_option),
      pdc_term_days = coalesce(p_pdc_term_days, pdc_term_days),
      se_origin_user_id = v_origin_user_id,
      assigned_pricing_officer_user_id = v_assigned_user_id,
      commission_handling_mode = p_commission_handling_mode,
      commission_co_worker_user_id = p_commission_co_worker_user_id,
      commission_split_option = p_commission_split_option,
      status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now(),
      approved_by = null,
      approved_at = null
  where id = v_quote.id;

  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation'
    and resource_id = v_quote.id;
end;
$$;

revoke all on function public.return_price_quotation_from_gm_with_commission(
  uuid, text, text, jsonb, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.return_price_quotation_from_gm_with_commission(
  uuid, text, text, jsonb, text, integer, text, uuid, text
) to authenticated;

-- Keep the older return RPC above callable for rolling deployments, but give
-- the current GM review UI an atomic path that also persists edited costing,
-- VAT, payment terms, and bank details before routing the quotation back.
create or replace function public.return_price_quotation_from_gm_with_edits_and_costings(
  p_quotation_id uuid,
  p_note text,
  p_vat_rate numeric,
  p_terms_conditions text,
  p_bank_details jsonb,
  p_costings jsonb,
  p_vat_calculation_type text,
  p_vat_fixed_amount numeric,
  p_payment_terms_option text,
  p_pdc_term_days integer,
  p_commission_handling_mode text,
  p_commission_co_worker_user_id uuid,
  p_commission_split_option text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_option text := coalesce(nullif(btrim(coalesce(p_payment_terms_option, '')), ''), 'completion_50_50');
  v_days integer := coalesce(p_pdc_term_days, 30);
  v_vat_type text := coalesce(nullif(btrim(coalesce(p_vat_calculation_type, '')), ''), 'percentage');
  v_item_count bigint;
  v_origin_user_id uuid;
  v_assigned_user_id uuid;
begin
  if v_note is null then
    raise exception 'Enter revision notes before returning this quotation';
  end if;
  if v_option not in ('completion_50_50', 'pdc_50_50') then
    raise exception 'Unsupported quotation payment terms option';
  end if;
  if v_days not in (15, 30, 60) then
    raise exception 'PDC term must be 15, 30, or 60 days';
  end if;
  if v_vat_type not in ('percentage', 'fixed_amount') then
    raise exception 'VAT needs a percentage or amount basis';
  end if;
  if v_vat_type = 'percentage'
    and (coalesce(p_vat_rate, 0) < 0 or p_vat_rate > 100) then
    raise exception 'VAT percentage must be between 0 and 100';
  end if;
  if v_vat_type = 'fixed_amount'
    and coalesce(p_vat_fixed_amount, 0) < 0 then
    raise exception 'VAT amount cannot be negative';
  end if;

  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;
  if not found
    or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'Price Quotation is not awaiting General Manager approval';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin', 'owner', 'admin']) then
    raise exception 'Only the General Manager can return this quotation';
  end if;
  if coalesce(jsonb_typeof(p_costings), '') <> 'array' then
    raise exception 'Quotation costing data must be an array';
  end if;

  select count(*) into v_item_count
  from public.quotation_items item
  where item.quotation_id = v_quote.id;
  if jsonb_array_length(p_costings) = 0
    or jsonb_array_length(p_costings) <> v_item_count then
    raise exception 'Add one costing table for every quotation product';
  end if;

  if v_quote.commission_handling_mode is not null
    and p_commission_handling_mode is null then
    raise exception 'Commission assignment is required for this quotation';
  end if;
  if p_commission_handling_mode is not null then
    v_origin_user_id := coalesce(
      v_quote.se_origin_user_id,
      v_quote.prepared_by_user_id,
      v_quote.created_by
    );
    perform private.validate_quotation_commission_assignment(
      v_quote.organization_id,
      v_quote.project_types,
      v_origin_user_id,
      p_commission_handling_mode,
      p_commission_co_worker_user_id,
      p_commission_split_option
    );
    v_assigned_user_id := case
      when p_commission_handling_mode = 'self_handled' then v_origin_user_id
      else p_commission_co_worker_user_id
    end;
    perform set_config('huswell.commission_assignment_rpc', 'on', true);
  end if;

  perform set_config('huswell.quotation_payment_terms_sync', 'on', true);
  perform private.apply_product_costings(
    v_quote.organization_id,
    v_quote.id,
    p_costings,
    (select auth.uid())
  );
  perform private.persist_product_quotation_totals(
    v_quote.id,
    'needs_revision',
    v_vat_type,
    p_vat_rate,
    p_vat_fixed_amount,
    p_terms_conditions,
    p_bank_details,
    (select auth.uid())
  );

  update public.quotations
  set payment_terms_option = v_option,
      pdc_term_days = v_days,
      se_origin_user_id = case
        when p_commission_handling_mode is null then se_origin_user_id
        else v_origin_user_id
      end,
      assigned_pricing_officer_user_id = case
        when p_commission_handling_mode is null then assigned_pricing_officer_user_id
        else v_assigned_user_id
      end,
      commission_handling_mode = coalesce(p_commission_handling_mode, commission_handling_mode),
      commission_co_worker_user_id = case
        when p_commission_handling_mode is null then commission_co_worker_user_id
        else p_commission_co_worker_user_id
      end,
      commission_split_option = coalesce(p_commission_split_option, commission_split_option),
      status = 'needs_revision',
      revision_note = v_note,
      revision_requested_to = 'pricing_officer',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now(),
      approved_by = null,
      approved_at = null
  where id = v_quote.id;

  update public.approval_requests
  set status = 'needs_revision',
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = v_note
  where resource_type = 'quotation'
    and resource_id = v_quote.id;
end;
$$;

revoke all on function public.return_price_quotation_from_gm_with_edits_and_costings(
  uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) from public, anon;
grant execute on function public.return_price_quotation_from_gm_with_edits_and_costings(
  uuid, text, numeric, text, jsonb, jsonb, text, numeric, text, integer, text, uuid, text
) to authenticated;

-- Snapshot the approved quotation's routing decision on the Commission
-- Summary. This keeps Internal Finance's payout record stable even if the
-- quotation is later revised, and leaves legacy summaries untouched.
create or replace function private.sync_commission_summary_assignment_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = new.quotation_id;

  if found and v_quote.commission_handling_mode is not null then
    new.se_origin_user_id := v_quote.se_origin_user_id;
    new.commission_co_worker_user_id := v_quote.commission_co_worker_user_id;
    new.commission_handling_mode := v_quote.commission_handling_mode;
    new.commission_split_option := v_quote.commission_split_option;
  end if;
  return new;
end;
$$;

drop trigger if exists commission_summary_assignment_snapshot
  on public.commission_summaries;
create trigger commission_summary_assignment_snapshot
before insert or update on public.commission_summaries
for each row execute function private.sync_commission_summary_assignment_snapshot();

create or replace function private.upsert_commission_summary_allocation(
  p_organization_id uuid,
  p_summary_id uuid,
  p_quotation_id uuid,
  p_allocation_role text,
  p_recipient_user_id uuid,
  p_share_rate numeric,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_existing public.commission_summary_allocations%rowtype;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
begin
  select * into v_existing
  from public.commission_summary_allocations allocation
  where allocation.commission_summary_id = p_summary_id
    and allocation.allocation_role = p_allocation_role
  for update;

  if found and v_existing.status = 'paid'
    and (
      v_existing.recipient_user_id is distinct from p_recipient_user_id
      or v_existing.share_rate is distinct from round(p_share_rate, 2)
      or v_existing.amount is distinct from v_amount
    ) then
    raise exception 'Paid commission allocation cannot be changed; undo or reverse the payout first';
  end if;

  if found then
    update public.commission_summary_allocations
    set recipient_user_id = p_recipient_user_id,
        quotation_id = p_quotation_id,
        share_rate = round(p_share_rate, 2),
        amount = v_amount,
        status = case
          when v_existing.status = 'paid' then v_existing.status
          when v_amount = 0 then 'not_applicable'
          else 'not_yet_paid'
        end,
        eligible_at = case when v_existing.status = 'paid' then v_existing.eligible_at else null end,
        paid_at = case when v_existing.status = 'paid' then v_existing.paid_at else null end,
        paid_by = case when v_existing.status = 'paid' then v_existing.paid_by else null end
    where id = v_existing.id;
  else
    insert into public.commission_summary_allocations (
      organization_id, commission_summary_id, quotation_id, recipient_user_id,
      allocation_role, share_rate, amount, status
    ) values (
      p_organization_id, p_summary_id, p_quotation_id, p_recipient_user_id,
      p_allocation_role, round(p_share_rate, 2), v_amount,
      case when v_amount = 0 then 'not_applicable' else 'not_yet_paid' end
    );
  end if;
end;
$$;

revoke all on function private.upsert_commission_summary_allocation(
  uuid, uuid, uuid, text, uuid, numeric, numeric
) from public, anon, authenticated;

create or replace function private.sync_commission_summary_allocations()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_total numeric := round(coalesce(new.sales_commission_markup_amount, new.commission_amount, 0), 2);
  v_origin_user_id uuid;
  v_co_worker_user_id uuid;
  v_origin_rate numeric;
  v_co_worker_rate numeric;
  v_self_handled boolean;
  v_new_assignment boolean := new.commission_handling_mode is not null;
  v_is_legacy_shared boolean := false;
  v_origin_amount numeric;
  v_co_worker_amount numeric;
begin
  if pg_trigger_depth() > 1 or new.status = 'paid' then
    return new;
  end if;

  if v_new_assignment then
    select rates.origin_rate, rates.coworker_rate, rates.self_handled
      into v_origin_rate, v_co_worker_rate, v_self_handled
    from private.commission_split_rates(new.commission_split_option) rates;
    v_origin_user_id := new.se_origin_user_id;
    v_co_worker_user_id := new.commission_co_worker_user_id;
  else
    -- Legacy endorsement rows retain the historical 60/40 behavior. New
    -- direct requests never use these columns to determine their split.
    v_origin_user_id := new.lead_endorser_user_id;
    v_co_worker_user_id := coalesce(new.lead_endorsed_to_user_id, new.preparator_user_id);
    v_is_legacy_shared := v_origin_user_id is not null
      and v_co_worker_user_id is not null
      and v_origin_user_id is distinct from v_co_worker_user_id
      and new.lead_endorsed_to_user_id = new.preparator_user_id
      and exists (
        select 1 from public.organization_members member
        where member.organization_id = new.organization_id
          and member.user_id = v_origin_user_id
          and member.role::text = 'sales_pricing_officer'
      )
      and exists (
        select 1 from public.organization_members member
        where member.organization_id = new.organization_id
          and member.user_id = v_co_worker_user_id
          and member.role::text = 'sales_pricing_officer'
      );
    if v_is_legacy_shared then
      v_origin_rate := 60;
      v_co_worker_rate := 40;
      v_self_handled := false;
    else
      v_origin_user_id := new.preparator_user_id;
      v_co_worker_user_id := null;
      v_origin_rate := 100;
      v_co_worker_rate := 0;
      v_self_handled := true;
    end if;
  end if;

  if v_origin_user_id is null then
    raise exception 'Commission Summary is missing the S.E. Origin';
  end if;

  if not v_self_handled then
    if v_co_worker_user_id is null or v_origin_rate is null or v_co_worker_rate is null then
      raise exception 'Commission Summary is missing a valid Co-Worker division';
    end if;
    v_origin_amount := round(v_total * v_origin_rate / 100, 2);
    v_co_worker_amount := round(v_total - v_origin_amount, 2);

    if exists (
      select 1 from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = new.id
        and allocation.allocation_role = 'self_handled_se'
        and allocation.status = 'paid'
    ) then
      raise exception 'Paid self-handled commission allocation cannot be removed';
    end if;
    delete from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = new.id
      and allocation.allocation_role = 'self_handled_se'
      and allocation.status <> 'paid';

    perform private.upsert_commission_summary_allocation(
      new.organization_id, new.id, new.quotation_id, 'originating_se',
      v_origin_user_id, v_origin_rate, v_origin_amount
    );
    perform private.upsert_commission_summary_allocation(
      new.organization_id, new.id, new.quotation_id, 'costing_se',
      v_co_worker_user_id, v_co_worker_rate, v_co_worker_amount
    );
  else
    if exists (
      select 1 from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = new.id
        and allocation.allocation_role in ('originating_se', 'costing_se')
        and allocation.status = 'paid'
    ) then
      raise exception 'Paid shared commission allocation cannot be removed';
    end if;
    delete from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = new.id
      and allocation.allocation_role in ('originating_se', 'costing_se')
      and allocation.status <> 'paid';

    perform private.upsert_commission_summary_allocation(
      new.organization_id, new.id, new.quotation_id, 'self_handled_se',
      v_origin_user_id, 100, v_total
    );
  end if;

  if v_new_assignment then
    update public.commission_summaries summary
    set commission_calculation_source = 'sales_executive_split',
        va_endorser_user_id = null,
        va_commission_rate = 0,
        va_commission_markup_amount = 0
    where summary.id = new.id
      and (
        summary.commission_calculation_source is distinct from 'sales_executive_split'
        or summary.va_endorser_user_id is not null
        or coalesce(summary.va_commission_rate, 0) <> 0
        or coalesce(summary.va_commission_markup_amount, 0) <> 0
      );
  end if;
  return new;
end;
$$;

drop trigger if exists commission_summary_allocations_sync
  on public.commission_summaries;
create trigger commission_summary_allocations_sync
after insert or update of preparator_user_id, lead_endorser_user_id,
  lead_endorsed_to_user_id, lead_endorsement_at, sales_commission_markup_amount,
  commission_rate, commission_calculation_source, grand_total,
  se_origin_user_id, commission_co_worker_user_id, commission_handling_mode,
  commission_split_option
on public.commission_summaries
for each row execute function private.sync_commission_summary_allocations();

-- Replace the legacy summary creator so an approved direct quotation can use
-- the selected S.E. Origin / Co-Worker assignment. Legacy quotations keep
-- their historical preparator and endorsement fallback.
create or replace function private.ensure_commission_summary_from_approved_quotation(
  p_quotation_id uuid,
  p_downpayment_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
  v_summary public.commission_summaries%rowtype;
  v_job_id uuid;
  v_preparator uuid;
  v_va_endorser uuid;
  v_lead_endorsed_by uuid;
  v_lead_endorsed_to uuid;
  v_lead_endorsed_at timestamptz;
  v_grand_total numeric;
  v_downpayment numeric;
  v_sales_amount numeric;
  v_va_amount numeric;
  v_sales_rate numeric;
  v_va_rate numeric;
  v_costing_count integer;
  v_costing_snapshot jsonb;
  v_source text;
  v_compat_sales_rate numeric;
  v_compat_va_rate numeric;
  v_summary_snapshot jsonb;
  v_before jsonb;
  v_summary_id uuid;
  v_new_assignment boolean := false;
  v_origin_user_id uuid;
  v_co_worker_user_id uuid;
  v_assigned_user_id uuid;
begin
  select * into v_quote
  from public.quotations quotation
  where quotation.id = p_quotation_id
  for update;

  if not found then
    raise exception 'Price Quotation not found';
  end if;
  if v_quote.document_type is distinct from 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved direct Price Quotation can have a Commission Summary';
  end if;

  v_new_assignment := v_quote.commission_handling_mode is not null;
  if v_new_assignment then
    v_origin_user_id := coalesce(v_quote.se_origin_user_id, v_quote.created_by);
    v_co_worker_user_id := v_quote.commission_co_worker_user_id;
    v_assigned_user_id := case
      when v_quote.commission_handling_mode = 'self_handled' then v_origin_user_id
      else v_co_worker_user_id
    end;
    perform private.validate_quotation_commission_assignment(
      v_quote.organization_id,
      v_quote.project_types,
      v_origin_user_id,
      v_quote.commission_handling_mode,
      v_co_worker_user_id,
      v_quote.commission_split_option
    );
    if v_quote.assigned_pricing_officer_user_id is distinct from v_assigned_user_id then
      raise exception 'The approved quotation has an inconsistent Pricing Officer assignment';
    end if;
    v_preparator := coalesce(
      v_quote.assigned_pricing_officer_user_id,
      v_quote.prepared_by_user_id,
      v_quote.created_by
    );
  else
    -- Existing direct quotations must continue to satisfy the old rule.
    v_preparator := coalesce(v_quote.prepared_by_user_id, v_quote.created_by);
    if not exists (
      select 1
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_preparator
        and member.role::text = 'sales_pricing_officer'
    ) then
      raise exception 'The quotation preparator must be a Sales & Pricing Officer';
    end if;
  end if;

  if v_quote.lead_id is not null then
    select lead_row.endorsed_by,
           lead_row.endorsed_to,
           lead_row.endorsed_at
    into v_lead_endorsed_by,
         v_lead_endorsed_to,
         v_lead_endorsed_at
    from public.leads lead_row
    where lead_row.id = v_quote.lead_id
      and lead_row.organization_id = v_quote.organization_id;
  end if;

  if not v_new_assignment
    and v_lead_endorsed_to = v_preparator
    and v_lead_endorsed_by is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = v_quote.organization_id
        and member.user_id = v_lead_endorsed_by
        and member.role::text = 'sales_pricing_officer'
    ) then
    v_va_endorser := v_lead_endorsed_by;
  end if;

  select job.id into v_job_id
  from public.production_jobs job
  where job.organization_id = v_quote.organization_id
    and job.quotation_id = v_quote.id
  order by job.created_at
  limit 1;

  v_grand_total := round(greatest(coalesce(v_quote.total_amount, 0), 0), 2);
  if p_downpayment_amount is null or p_downpayment_amount < 0 then
    raise exception 'Downpayment Amount is required and cannot be negative';
  end if;
  v_downpayment := round(p_downpayment_amount, 2);
  if v_downpayment > v_grand_total then
    raise exception 'Downpayment Amount cannot exceed the Grand Total';
  end if;

  select costing_commission.costing_count,
         costing_commission.sales_amount,
         costing_commission.va_amount,
         costing_commission.sales_rate,
         costing_commission.va_rate,
         costing_commission.snapshot
  into v_costing_count,
       v_sales_amount,
       v_va_amount,
       v_sales_rate,
       v_va_rate,
       v_costing_snapshot
  from private.calculate_approved_quotation_commissions(v_quote.id) costing_commission;

  if coalesce(v_costing_count, 0) > 0 then
    v_sales_amount := round(coalesce(v_sales_amount, 0), 2);
    v_va_amount := round(coalesce(v_va_amount, 0), 2);
    if v_new_assignment then
      v_source := 'sales_executive_split';
      v_va_endorser := null;
      v_va_amount := 0;
      v_compat_va_rate := 0;
    else
      v_source := 'approved_costing_markup';
      if v_va_endorser is null and v_va_amount > 0 then
        raise exception
          'This approved quotation has a non-zero VA Commission markup but no valid lead endorsement; correct the costing or endorsement before approval.';
      end if;
      v_compat_va_rate := case
        when v_va_endorser is null then 0
        when v_va_rate is not null then round(v_va_rate, 2)
        when v_grand_total > 0 then round(v_va_amount / v_grand_total * 100, 2)
        else 0
      end;
    end if;
    v_compat_sales_rate := case
      when v_sales_rate is not null then round(v_sales_rate, 2)
      when v_grand_total > 0 then round(v_sales_amount / v_grand_total * 100, 2)
      else 0
    end;
    if v_new_assignment then
      v_summary_snapshot := jsonb_build_object(
        'source', v_source,
        'quotation_id', v_quote.id,
        'grand_total', v_grand_total,
        'sales_commission_markup_amount', v_sales_amount,
        'va_commission_markup_amount', 0,
        'costings', v_costing_snapshot,
        'commission_handling_mode', v_quote.commission_handling_mode,
        'commission_split_option', v_quote.commission_split_option,
        'se_origin_user_id', v_origin_user_id,
        'commission_co_worker_user_id', v_co_worker_user_id
      );
    else
      v_summary_snapshot := jsonb_build_object(
        'source', v_source,
        'quotation_id', v_quote.id,
        'grand_total', v_grand_total,
        'sales_commission_markup_amount', v_sales_amount,
        'va_commission_markup_amount', case when v_va_endorser is null then 0 else v_va_amount end,
        'costings', v_costing_snapshot
      );
    end if;
  else
    -- Older direct quotations may predate saved product costings.
    v_source := case when v_new_assignment then 'sales_executive_split' else 'legacy_grand_total_rate' end;
    v_sales_amount := null;
    v_va_amount := null;
    v_compat_sales_rate := round(greatest(coalesce(v_quote.commission_rate, 0), 0), 2);
    v_compat_va_rate := 0;
    if v_new_assignment then
      v_va_endorser := null;
      v_summary_snapshot := jsonb_build_object(
        'source', v_source,
        'quotation_id', v_quote.id,
        'grand_total', v_grand_total,
        'sales_commission_markup_amount', null,
        'va_commission_markup_amount', 0,
        'costings', null,
        'commission_handling_mode', v_quote.commission_handling_mode,
        'commission_split_option', v_quote.commission_split_option,
        'se_origin_user_id', v_origin_user_id,
        'commission_co_worker_user_id', v_co_worker_user_id
      );
    else
      v_summary_snapshot := null;
    end if;
  end if;

  v_compat_sales_rate := least(greatest(coalesce(v_compat_sales_rate, 0), 0), 100);
  v_compat_va_rate := least(greatest(coalesce(v_compat_va_rate, 0), 0), 100);

  select * into v_summary
  from public.commission_summaries summary
  where summary.organization_id = v_quote.organization_id
    and summary.quotation_id = v_quote.id
  for update;

  if found then
    if v_summary.status = 'paid' then
      raise exception
        'Paid Commission Summary must be undone before the quotation can be approved again';
    end if;

    if v_summary.production_job_id is not distinct from coalesce(v_job_id, v_summary.production_job_id)
      and v_summary.quotation_no is not distinct from v_quote.quotation_no
      and v_summary.project_name is not distinct from v_quote.project_name
      and v_summary.client_name is not distinct from v_quote.client_name
      and v_summary.grand_total is not distinct from v_grand_total
      and v_summary.preparator_user_id is not distinct from v_preparator
      and v_summary.lead_endorser_user_id is not distinct from v_lead_endorsed_by
      and v_summary.lead_endorsed_to_user_id is not distinct from v_lead_endorsed_to
      and v_summary.lead_endorsement_at is not distinct from v_lead_endorsed_at
      and v_summary.va_endorser_user_id is not distinct from (
        case when v_new_assignment then null else v_va_endorser end
      )
      and v_summary.commission_rate is not distinct from v_compat_sales_rate
      and v_summary.va_commission_rate is not distinct from v_compat_va_rate
      and v_summary.sales_commission_markup_amount is not distinct from v_sales_amount
      and v_summary.va_commission_markup_amount is not distinct from (
        case when v_new_assignment then 0 else case when v_va_endorser is null then 0 else v_va_amount end end
      )
      and v_summary.commission_calculation_source is not distinct from v_source
      and v_summary.commission_markup_snapshot is not distinct from v_summary_snapshot
      and v_summary.se_origin_user_id is not distinct from (
        case when v_new_assignment then v_origin_user_id else null end
      )
      and v_summary.commission_co_worker_user_id is not distinct from (
        case when v_new_assignment then v_co_worker_user_id else null end
      )
      and v_summary.commission_handling_mode is not distinct from (
        case when v_new_assignment then v_quote.commission_handling_mode else null end
      )
      and v_summary.commission_split_option is not distinct from (
        case when v_new_assignment then v_quote.commission_split_option else null end
      ) then
      return v_summary.id;
    end if;

    v_before := to_jsonb(v_summary);
    update public.commission_summaries
    set production_job_id = coalesce(v_job_id, production_job_id),
        quotation_no = v_quote.quotation_no,
        project_name = v_quote.project_name,
        client_name = v_quote.client_name,
        grand_total = v_grand_total,
        preparator_user_id = v_preparator,
        lead_endorser_user_id = v_lead_endorsed_by,
        lead_endorsed_to_user_id = v_lead_endorsed_to,
        lead_endorsement_at = v_lead_endorsed_at,
        va_endorser_user_id = case when v_new_assignment then null else v_va_endorser end,
        commission_rate = v_compat_sales_rate,
        va_commission_rate = v_compat_va_rate,
        sales_commission_markup_amount = v_sales_amount,
        va_commission_markup_amount = case when v_new_assignment or v_va_endorser is null then 0 else v_va_amount end,
        commission_calculation_source = v_source,
        commission_markup_snapshot = v_summary_snapshot,
        se_origin_user_id = case when v_new_assignment then v_origin_user_id else null end,
        commission_co_worker_user_id = case when v_new_assignment then v_co_worker_user_id else null end,
        commission_handling_mode = case when v_new_assignment then v_quote.commission_handling_mode else null end,
        commission_split_option = case when v_new_assignment then v_quote.commission_split_option else null end
    where id = v_summary.id
    returning id into v_summary_id;

    insert into public.activity_log (
      organization_id, actor_id, resource_type, resource_id, action,
      before_data, after_data
    ) values (
      v_quote.organization_id,
      coalesce((select auth.uid()), v_quote.created_by),
      'commission_summary',
      v_summary_id,
      'automatic_markup_reconciled',
      v_before,
      jsonb_build_object(
        'quotation_id', v_quote.id,
        'source', v_source,
        'sales_commission_markup_amount', v_sales_amount,
        'va_commission_markup_amount', case when v_new_assignment or v_va_endorser is null then 0 else v_va_amount end,
        'grand_total', v_grand_total,
        'commission_split_option', case when v_new_assignment then v_quote.commission_split_option else null end
      )
    );
    return v_summary_id;
  end if;

  insert into public.commission_summaries (
    organization_id,
    quotation_id,
    production_job_id,
    quotation_no,
    project_name,
    client_name,
    grand_total,
    preparator_user_id,
    lead_endorser_user_id,
    lead_endorsed_to_user_id,
    lead_endorsement_at,
    va_endorser_user_id,
    commission_rate,
    va_commission_rate,
    sales_commission_markup_amount,
    va_commission_markup_amount,
    commission_calculation_source,
    commission_markup_snapshot,
    se_origin_user_id,
    commission_co_worker_user_id,
    commission_handling_mode,
    commission_split_option,
    downpayment_amount,
    receivable_balance,
    created_by
  ) values (
    v_quote.organization_id,
    v_quote.id,
    v_job_id,
    v_quote.quotation_no,
    v_quote.project_name,
    v_quote.client_name,
    v_grand_total,
    v_preparator,
    v_lead_endorsed_by,
    v_lead_endorsed_to,
    v_lead_endorsed_at,
    case when v_new_assignment then null else v_va_endorser end,
    v_compat_sales_rate,
    v_compat_va_rate,
    v_sales_amount,
    case when v_new_assignment or v_va_endorser is null then 0 else v_va_amount end,
    v_source,
    v_summary_snapshot,
    case when v_new_assignment then v_origin_user_id else null end,
    case when v_new_assignment then v_co_worker_user_id else null end,
    case when v_new_assignment then v_quote.commission_handling_mode else null end,
    case when v_new_assignment then v_quote.commission_split_option else null end,
    v_downpayment,
    round(greatest(v_grand_total - v_downpayment, 0), 2),
    coalesce((select auth.uid()), v_quote.created_by, v_preparator)
  ) returning id into v_summary_id;

  insert into public.activity_log (
    organization_id, actor_id, resource_type, resource_id, action, after_data
  ) values (
    v_quote.organization_id,
    coalesce((select auth.uid()), v_quote.created_by),
    'commission_summary',
    v_summary_id,
    'created_automatically',
    jsonb_build_object(
      'quotation_id', v_quote.id,
      'source', v_source,
      'preparator_user_id', v_preparator,
      'se_origin_user_id', case when v_new_assignment then v_origin_user_id else null end,
      'commission_co_worker_user_id', case when v_new_assignment then v_co_worker_user_id else null end,
      'commission_split_option', case when v_new_assignment then v_quote.commission_split_option else null end,
      'grand_total', v_grand_total,
      'sales_commission_markup_amount', v_sales_amount,
      'va_commission_markup_amount', case when v_new_assignment or v_va_endorser is null then 0 else v_va_amount end,
      'downpayment', v_downpayment,
      'receivable_balance', round(greatest(v_grand_total - v_downpayment, 0), 2)
    )
  );

  return v_summary_id;
end;
$$;

-- commission_summary_rows_v3 is security-definer, so its role filter must
-- match the allocation RLS above. External Finance receives quotation payment
-- data through its own payment-monitoring paths, not commission payouts.
create or replace function public.commission_summary_rows_v3(
  p_organization_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  grand_total numeric,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  my_commission_type text,
  my_commission_amount numeric,
  my_officer_name text,
  allocations jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
with access as (
  select private.has_text_role(
    p_organization_id,
    array['super_admin', 'owner', 'admin', 'accountant', 'internal_finance']
  ) as can_view_all
)
select
  summary.id,
  summary.organization_id,
  summary.quotation_id,
  summary.quotation_no,
  summary.project_name,
  summary.client_name,
  summary.grand_total,
  summary.status,
  summary.created_at,
  summary.updated_at,
  visible.my_type,
  coalesce(visible.my_amount, 0),
  visible.my_name,
  visible.allocation_rows
from public.commission_summaries summary
cross join access
left join lateral (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', allocation.id,
          'commission_summary_id', allocation.commission_summary_id,
          'quotation_id', allocation.quotation_id,
          'recipient_user_id', allocation.recipient_user_id,
          'recipient_name', coalesce(profile.full_name, 'Sales & Pricing Officer'),
          'allocation_role', allocation.allocation_role,
          'share_rate', allocation.share_rate,
          'amount', allocation.amount,
          'status', allocation.status,
          'eligible_at', allocation.eligible_at,
          'paid_at', allocation.paid_at,
          'paid_by', allocation.paid_by
        ) order by allocation.allocation_role
      ),
      '[]'::jsonb
    ) as allocation_rows,
    round(coalesce(sum(allocation.amount) filter (
      where allocation.recipient_user_id = (select auth.uid())
    ), 0), 2) as my_amount,
    string_agg(
      case allocation.allocation_role
        when 'originating_se' then 'S.E. Origin'
        when 'costing_se' then 'Co-Worker'
        when 'self_handled_se' then 'Self-handled'
        else allocation.allocation_role
      end,
      ', ' order by allocation.allocation_role
    ) filter (where allocation.recipient_user_id = (select auth.uid())) as my_type,
    max(profile.full_name) filter (where allocation.recipient_user_id = (select auth.uid())) as my_name
  from public.commission_summary_allocations allocation
  left join public.profiles profile on profile.id = allocation.recipient_user_id
  where allocation.commission_summary_id = summary.id
    and (
      access.can_view_all
      or allocation.recipient_user_id = (select auth.uid())
    )
) visible on true
where summary.organization_id = p_organization_id
  and exists (
    select 1
    from public.commission_summary_allocations allocation
    where allocation.commission_summary_id = summary.id
  )
  and (
    access.can_view_all
    or exists (
      select 1
      from public.commission_summary_allocations allocation
      where allocation.commission_summary_id = summary.id
        and allocation.recipient_user_id = (select auth.uid())
    )
  )
order by summary.created_at desc, summary.quotation_no asc;
$$;

commit;
