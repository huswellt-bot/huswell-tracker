-- PostgreSQL truncates identifiers at 63 characters. The previous commission
-- review RPC was therefore stored under a truncated name, while the client
-- called the longer source name and PostgREST could not resolve it.

begin;

alter function public.pricing_review_price_quotation_with_commission_and_approved_pri(
  uuid,
  text,
  numeric,
  text,
  jsonb,
  jsonb,
  text,
  text,
  numeric,
  text,
  text,
  integer,
  text,
  jsonb
) rename to pricing_review_price_quotation_commission_approved_prices;

revoke all on function public.pricing_review_price_quotation_commission_approved_prices(
  uuid,
  text,
  numeric,
  text,
  jsonb,
  jsonb,
  text,
  text,
  numeric,
  text,
  text,
  integer,
  text,
  jsonb
) from public, anon;

grant execute on function public.pricing_review_price_quotation_commission_approved_prices(
  uuid,
  text,
  numeric,
  text,
  jsonb,
  jsonb,
  text,
  text,
  numeric,
  text,
  text,
  integer,
  text,
  jsonb
) to authenticated;

commit;
