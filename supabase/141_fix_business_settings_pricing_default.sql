-- Keep partial business_settings upserts compatible with the current pricing
-- default validator. Migration 137 removed Discount from organization-level
-- defaults, but the column default inherited from migration 131 still included
-- the obsolete `discounts` key. An upsert that only saves bank details still
-- attempts the insert path and is rejected by the pricing-default trigger.
-- Run after 140_add_large_format_printing_project_type.sql.

begin;

alter table public.business_settings
  alter column pricing_markup_defaults set default '{
    "target_profit_margin": {"label":"Target Profit Margin", "calculation_type":"percentage", "value":75},
    "overhead_allocation": {"label":"Overhead Allocation", "calculation_type":"percentage", "value":0},
    "contingency_allowance": {"label":"Contingency Allowance", "calculation_type":"percentage", "value":20},
    "sales_commission": {"label":"Sales Commission", "calculation_type":"percentage", "value":0},
    "incentives": {"label":"Incentives", "calculation_type":"percentage", "value":0},
    "third_party_markup": {"label":"Third Party Mark Up", "calculation_type":"percentage", "value":15},
    "vat": {"label":"VAT", "calculation_type":"percentage", "value":12}
  }'::jsonb;

-- Migration 137 intended to remove this obsolete organization-level key. Keep
-- this cleanup idempotent for databases where that update was not applied.
update public.business_settings
set pricing_markup_defaults = pricing_markup_defaults - 'discounts'
where coalesce(pricing_markup_defaults, '{}'::jsonb) ? 'discounts';

commit;
