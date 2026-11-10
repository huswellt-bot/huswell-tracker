-- Reduce RLS planning work for Price Quotation costing reads.
-- The previous workflow migrations accumulated several permissive SELECT
-- policies on the same tables. The expressions are equivalent when combined
-- into one policy, but a single policy gives Postgres a simpler predicate to
-- plan for the review and organization-scoped costing queries.

begin;

create index if not exists price_quotation_costing_lines_org_product_costing_idx
  on public.price_quotation_costing_lines (organization_id, product_costing_id);

create index if not exists price_quotation_costing_markups_org_product_costing_idx
  on public.price_quotation_costing_markups (organization_id, product_costing_id);

drop policy if exists "price quotation product costings: GM only"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: assigned self review"
  on public.price_quotation_product_costings;
drop policy if exists "price quotation product costings: pricing revision read"
  on public.price_quotation_product_costings;

create policy "price quotation product costings: authorized read"
on public.price_quotation_product_costings
for select to authenticated
using (
  (select private.has_text_role(
    price_quotation_product_costings.organization_id,
    array['super_admin', 'owner', 'admin']
  ))
  or exists (
    select 1
    from public.quotations quote
    where quote.id = price_quotation_product_costings.quotation_id
      and (
        (
          (quote.status)::text = 'pending'
          and quote.created_by is distinct from (select auth.uid())
          and quote.prepared_by_user_id is distinct from (select auth.uid())
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.pricing_reviewed_by = (select auth.uid())
          and (quote.status)::text = any(array[
            'pending_gm_approval', 'approved', 'needs_revision'
          ])
        )
      )
  )
  or exists (
    select 1
    from public.quotations quote
    where quote.id = price_quotation_product_costings.quotation_id
      and quote.document_type = 'price_quotation'
      and quote.costing_source_id is null
      and (quote.status)::text = 'pending'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
  or exists (
    select 1
    from public.quotations quote
    where quote.id = price_quotation_product_costings.quotation_id
      and quote.document_type = any(array['price_quotation', 'mockup_quotation'])
      and (quote.status)::text = 'needs_revision'
      and quote.revision_requested_to = 'pricing_officer'
      and (select private.is_pricing_officer_assigned(
        quote.organization_id,
        (select auth.uid()),
        quote.project_types
      ))
  )
);

drop policy if exists "price quotation costing lines: GM only"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: assigned self review"
  on public.price_quotation_costing_lines;
drop policy if exists "price quotation costing lines: pricing revision read"
  on public.price_quotation_costing_lines;

create policy "price quotation costing lines: authorized read"
on public.price_quotation_costing_lines
for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = price_quotation_costing_lines.product_costing_id
      and (
        (
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          ))
          or (
            (quote.status)::text = 'pending'
            and quote.created_by is distinct from (select auth.uid())
            and quote.prepared_by_user_id is distinct from (select auth.uid())
            and (select private.is_pricing_officer_assigned(
              quote.organization_id,
              (select auth.uid()),
              quote.project_types
            ))
          )
          or (
            quote.pricing_reviewed_by = (select auth.uid())
            and (quote.status)::text = any(array[
              'pending_gm_approval', 'approved', 'needs_revision'
            ])
          )
        )
        or (
          quote.document_type = 'price_quotation'
          and quote.costing_source_id is null
          and (quote.status)::text = 'pending'
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.document_type = any(array['price_quotation', 'mockup_quotation'])
          and (quote.status)::text = 'needs_revision'
          and quote.revision_requested_to = 'pricing_officer'
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
      )
  )
);

drop policy if exists "price quotation costing markups: GM only"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: assigned self review"
  on public.price_quotation_costing_markups;
drop policy if exists "price quotation costing markups: pricing revision read"
  on public.price_quotation_costing_markups;

create policy "price quotation costing markups: authorized read"
on public.price_quotation_costing_markups
for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = price_quotation_costing_markups.product_costing_id
      and (
        (
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          ))
          or (
            (quote.status)::text = 'pending'
            and quote.created_by is distinct from (select auth.uid())
            and quote.prepared_by_user_id is distinct from (select auth.uid())
            and (select private.is_pricing_officer_assigned(
              quote.organization_id,
              (select auth.uid()),
              quote.project_types
            ))
          )
          or (
            quote.pricing_reviewed_by = (select auth.uid())
            and (quote.status)::text = any(array[
              'pending_gm_approval', 'approved', 'needs_revision'
            ])
          )
        )
        or (
          quote.document_type = 'price_quotation'
          and quote.costing_source_id is null
          and (quote.status)::text = 'pending'
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
        or (
          quote.document_type = any(array['price_quotation', 'mockup_quotation'])
          and (quote.status)::text = 'needs_revision'
          and quote.revision_requested_to = 'pricing_officer'
          and (select private.is_pricing_officer_assigned(
            quote.organization_id,
            (select auth.uid()),
            quote.project_types
          ))
        )
      )
  )
);

drop policy if exists "lead costing printing quotations read" on public.quotations;
drop policy if exists "quotations: finance read" on public.quotations;
drop policy if exists "quotations: price workflow read" on public.quotations;
drop policy if exists "quotations: pricing revision read" on public.quotations;
drop policy if exists "quotations: production approver read" on public.quotations;

create policy "quotations: authorized read"
on public.quotations
for select to authenticated
using (
  (
    quotation_source = 'lead_costing_printing'
    and (
      created_by = (select auth.uid())
      or prepared_by_user_id = (select auth.uid())
      or (select private.has_text_role(
        organization_id,
        array['super_admin', 'owner', 'admin']
      ))
    )
  )
  or (select private.has_text_role(
    organization_id,
    array['super_admin', 'owner', 'admin', 'accountant']
  ))
  or (select private.finance_is_external_or_internal(organization_id))
  or created_by = (select auth.uid())
  or (
    prepared_by_user_id = (select auth.uid())
    and document_type = any(array['price_quotation', 'mockup_quotation'])
  )
  or (
    document_type = any(array['price_quotation', 'mockup_quotation'])
    and pricing_reviewed_by = (select auth.uid())
  )
  or (
    document_type = any(array['price_quotation', 'mockup_quotation'])
    and (status)::text = any(array['pending', 'pending_gm_approval', 'approved'])
    and created_by is distinct from (select auth.uid())
    and prepared_by_user_id is distinct from (select auth.uid())
    and (select private.is_pricing_officer_assigned(
      organization_id,
      (select auth.uid()),
      project_types
    ))
  )
  or (
    document_type = any(array['price_quotation', 'mockup_quotation'])
    and (status)::text = 'needs_revision'
    and revision_requested_to = 'pricing_officer'
    and (
      (select private.is_assigned_pricing_officer_quotation_visible(
        assigned_pricing_officer_user_id,
        (status)::text,
        revision_requested_to
      ))
      or (
        assigned_pricing_officer_user_id is null
        and (select private.is_pricing_officer_assigned(
          organization_id,
          (select auth.uid()),
          project_types
        ))
      )
    )
  )
  or (
    (select private.can_approve_production(organization_id))
    and document_type = 'price_quotation'
    and costing_source_id is null
    and (status)::text = 'approved'
  )
);

commit;
