-- GM-controlled costing defaults and payment-earned Sales Project Officer commissions.
-- Run after 104_price_quotation_endorsements.sql.

begin;

alter table public.business_settings
  add column if not exists default_additional_markup numeric(5,2) not null default 15
    check (default_additional_markup between 0 and 100);

-- Keep the existing columns as the backwards-compatible source of the other defaults:
-- default_profit_margin, default_overhead_rate, default_buffer_margin, production_commission, vat_rate.

create or replace function public.sales_project_officer_commissions()
returns table (
  organization_id uuid,
  officer_user_id uuid,
  quotation_id uuid,
  quotation_no text,
  project_name text,
  client_name text,
  quoted_amount numeric,
  paid_amount numeric,
  projected_commission numeric,
  earned_commission numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with collections as (
    select i.quotation_id, coalesce(sum(p.amount) filter (where p.reversed_at is null), 0) paid_amount
    from public.invoices i
    left join public.payments p on p.invoice_id = i.id
    where i.quotation_id is not null and i.status <> 'void'
    group by i.quotation_id
  )
  select q.organization_id, coalesce(q.prepared_by_user_id, q.created_by), q.id, q.quotation_no,
    q.project_name, q.client_name, q.total_amount,
    least(coalesce(c.paid_amount, 0), q.total_amount),
    round(least(q.total_amount, 400000) * .03 + greatest(q.total_amount - 400000, 0) * .05, 2),
    round(least(least(coalesce(c.paid_amount, 0), q.total_amount), 400000) * .03 + greatest(least(coalesce(c.paid_amount, 0), q.total_amount) - 400000, 0) * .05, 2)
  from public.quotations q
  left join collections c on c.quotation_id = q.id
  where q.document_type = 'price_quotation' and q.costing_source_id is null
    and q.status::text = 'approved'
    and coalesce(q.prepared_by_user_id, q.created_by) is not null
    and (
      private.has_text_role(q.organization_id, array['super_admin','owner','admin'])
      or (private.has_text_role(q.organization_id, array['project_manager'])
          and coalesce(q.prepared_by_user_id, q.created_by) = (select auth.uid()))
    );
$$;

revoke all on function public.sales_project_officer_commissions() from public;
grant execute on function public.sales_project_officer_commissions() to authenticated;

commit;
