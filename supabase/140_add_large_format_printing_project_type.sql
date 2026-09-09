-- Add Large Format Printing as a valid routeable quotation project type.
-- Prerequisite: 115_sales_pricing_officer_project_type_routing.sql.

begin;

alter table public.pricing_officer_project_types
  drop constraint if exists pricing_officer_project_types_project_type_check;

alter table public.pricing_officer_project_types
  add constraint pricing_officer_project_types_project_type_check
  check (project_type in (
    'Premium Rigid Box',
    'Regular Rigid Box',
    'Corrugated',
    'Offset',
    'Digital',
    'Mock Up',
    'Large Format Printing'
  ));

create or replace function private.normalize_price_quotation_project_type(
  target_project_type text
)
returns text
language sql
immutable
set search_path = public, private
as $$
  select case regexp_replace(
    lower(btrim(coalesce(target_project_type, ''))),
    '[[:space:]]+',
    ' ',
    'g'
  )
    when 'premium rigid box' then 'Premium Rigid Box'
    when 'regular rigid box' then 'Regular Rigid Box'
    when 'corrugated' then 'Corrugated'
    when 'offset' then 'Offset'
    when 'digital' then 'Digital'
    when 'mock up' then 'Mock Up'
    when 'mockup' then 'Mock Up'
    when 'large format printing' then 'Large Format Printing'
    else null
  end;
$$;

commit;

-- Rollback: restore the previous check constraint and normalizer from
-- 115_sales_pricing_officer_project_type_routing.sql.
