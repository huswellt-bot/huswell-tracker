-- Keep direct Price Quotation drafts visible only to the preparing workflow
-- roles. General Managers retain access to submitted, returned, and approved
-- Price Quotations. This is a restrictive read boundary layered over the
-- existing quotation workflow policies.
--
-- Run after 184_hide_costing_drafts_from_management.sql and after deploying
-- the matching Price Quotations workspace update.

begin;

drop policy if exists "price quotation drafts: management hidden" on public.quotations;
create policy "price quotation drafts: management hidden"
on public.quotations as restrictive
for select to authenticated
using (
  document_type <> 'price_quotation'
  or status::text <> 'draft'
  or not coalesce(
    (select private.has_text_role(
      organization_id,
      array['super_admin', 'owner', 'admin']
    )),
    false
  )
);

drop policy if exists "price quotation item drafts: management hidden" on public.quotation_items;
create policy "price quotation item drafts: management hidden"
on public.quotation_items as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation illustrations: management hidden" on public.price_quotation_illustrations;
create policy "price quotation illustrations: management hidden"
on public.price_quotation_illustrations as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation mockups: management hidden" on public.price_quotation_mockups;
create policy "price quotation mockups: management hidden"
on public.price_quotation_mockups as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation product costings: management hidden" on public.price_quotation_product_costings;
create policy "price quotation product costings: management hidden"
on public.price_quotation_product_costings as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation costing lines: management hidden" on public.price_quotation_costing_lines;
create policy "price quotation costing lines: management hidden"
on public.price_quotation_costing_lines as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation costing markups: management hidden" on public.price_quotation_costing_markups;
create policy "price quotation costing markups: management hidden"
on public.price_quotation_costing_markups as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.price_quotation_product_costings costing
    join public.quotations quote on quote.id = costing.quotation_id
    where costing.id = product_costing_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "price quotation revision requests: management hidden" on public.price_quotation_revision_requests;
create policy "price quotation revision requests: management hidden"
on public.price_quotation_revision_requests as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "quotation payment records: management hidden drafts" on public.quotation_payment_records;
create policy "quotation payment records: management hidden drafts"
on public.quotation_payment_records as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

drop policy if exists "quotation signed proofs: management hidden drafts" on public.quotation_signed_proofs;
create policy "quotation signed proofs: management hidden drafts"
on public.quotation_signed_proofs as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.quotations quote
    where quote.id = quotation_id
      and (
        quote.document_type <> 'price_quotation'
        or quote.status::text <> 'draft'
        or not coalesce(
          (select private.has_text_role(
            quote.organization_id,
            array['super_admin', 'owner', 'admin']
          )),
          false
        )
      )
  )
);

commit;
