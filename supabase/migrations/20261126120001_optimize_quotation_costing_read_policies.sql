-- Avoid recursive RLS planning across quotation costing child tables.
-- The helper performs one authorization decision under a controlled
-- SECURITY DEFINER boundary, while the exposed tables keep one row policy.

begin;

create or replace function private.can_read_price_quotation_costing(
  p_organization_id uuid,
  p_product_costing_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  select quote.*
  into v_quote
  from public.price_quotation_product_costings costing
  join public.quotations quote
    on quote.id = costing.quotation_id
   and quote.organization_id = costing.organization_id
  where costing.id = p_product_costing_id
    and costing.organization_id = p_organization_id;
  if not found then
    return false;
  end if;

  -- Preserve the restrictive draft policy for management users.
  if v_quote.document_type = 'price_quotation'
    and v_quote.status::text = 'draft'
    and private.has_text_role(
      v_quote.organization_id,
      array['super_admin', 'owner', 'admin']
    ) then
    return false;
  end if;

  -- Preserve the exact reviewer boundary for Sales & Pricing Officers.
  if private.has_text_role(
    v_quote.organization_id,
    array['sales_pricing_officer']
  ) and not (
    v_quote.created_by = (select auth.uid())
    or v_quote.prepared_by_user_id = (select auth.uid())
    or v_quote.submitted_by = (select auth.uid())
    or private.is_assigned_pricing_officer_quotation_visible(
      v_quote.assigned_pricing_officer_user_id,
      v_quote.status::text,
      v_quote.revision_requested_to
    )
    or (
      v_quote.assigned_pricing_officer_user_id is null
      and private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
    )
  ) then
    return false;
  end if;

  return
    private.has_text_role(
      v_quote.organization_id,
      array['super_admin', 'owner', 'admin']
    )
    or (
      v_quote.status::text = 'pending'
      and v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid())
      and private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
    )
    or (
      v_quote.pricing_reviewed_by = (select auth.uid())
      and v_quote.status::text = any(array[
        'pending_gm_approval', 'approved', 'needs_revision'
      ])
    )
    or (
      v_quote.document_type = 'price_quotation'
      and v_quote.costing_source_id is null
      and v_quote.status::text = 'pending'
      and private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
    )
    or (
      v_quote.document_type = any(array['price_quotation', 'mockup_quotation'])
      and v_quote.status::text = 'needs_revision'
      and v_quote.revision_requested_to = 'pricing_officer'
      and private.is_pricing_officer_assigned(
        v_quote.organization_id,
        (select auth.uid()),
        v_quote.project_types
      )
    );
end;
$$;

revoke all on function private.can_read_price_quotation_costing(uuid, uuid)
  from public, anon;
grant execute on function private.can_read_price_quotation_costing(uuid, uuid)
  to authenticated;

drop policy if exists "price quotation product costings: GM only"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: assigned self review"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: pricing revision read"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: authorized read"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: management hidden"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_product_costings;

create policy "price quotation product costings: authorized read"
on public.price_quotation_product_costings
for select to authenticated
using (
  (select private.can_read_price_quotation_costing(
    organization_id,
    id
  ))
);

drop policy if exists "price quotation costing lines: GM only"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: assigned self review"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: pricing revision read"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: authorized read"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: management hidden"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_costing_lines;

create policy "price quotation costing lines: authorized read"
on public.price_quotation_costing_lines
for select to authenticated
using (
  (select private.can_read_price_quotation_costing(
    organization_id,
    product_costing_id
  ))
);

drop policy if exists "price quotation costing markups: GM only"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: assigned self review"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: pricing revision read"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: authorized read"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: management hidden"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation submissions: child exact reviewer read"
  on public.price_quotation_costing_markups;

create policy "price quotation costing markups: authorized read"
on public.price_quotation_costing_markups
for select to authenticated
using (
  (select private.can_read_price_quotation_costing(
    organization_id,
    product_costing_id
  ))
);

commit;
