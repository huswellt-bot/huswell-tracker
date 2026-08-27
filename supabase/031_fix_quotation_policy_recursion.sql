-- Fix the recursive quotation RLS policy introduced by 030.
-- Run this after 030_general_manager_costing_workflow.sql.

create or replace function private.can_view_price_quotation_from_own_costing(
  target_quotation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select exists (
    select 1
    from public.quotations price
    join public.quotations costing on costing.id=price.costing_source_id
    where price.id=target_quotation_id
      and price.document_type='price_quotation'
      and costing.created_by=(select auth.uid())
  );
$$;
grant execute on function private.can_view_price_quotation_from_own_costing(uuid) to authenticated;

drop policy if exists "quotations: workflow read" on public.quotations;
create policy "quotations: workflow read" on public.quotations for select to authenticated using (
  (select private.has_text_role(organization_id, array['owner','admin']))
  or (created_by=(select auth.uid()) and document_type='costing_breakdown')
  or (select private.can_view_price_quotation_from_own_costing(id))
);
