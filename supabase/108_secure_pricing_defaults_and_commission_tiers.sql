-- Server-enforce the GM pricing defaults and replace quotation commission markup
-- with GM-managed Sales Project Officer collection tiers.
begin;

alter table public.business_settings add column if not exists sales_commission_tiers jsonb not null default '[{"up_to":400000,"rate":3},{"up_to":null,"rate":5}]'::jsonb;

create or replace function private.enforce_pricing_default_markup()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare s public.business_settings%rowtype;
begin
  if not private.has_text_role(new.organization_id,array['pricing_officer']) then return new; end if;
  select * into s from public.business_settings where organization_id=new.organization_id;
  if new.label = 'Profit Margin' then new.rate := coalesce(s.default_profit_margin,75);
  elsif new.label = 'Overhead Expense' then new.rate := coalesce(s.default_overhead_rate,0);
  elsif new.label = 'Buffer Margin' then new.rate := coalesce(s.default_buffer_margin,20);
  elsif new.label = 'Additional Markup' then new.rate := coalesce(s.default_additional_markup,15);
  elsif new.label in ('Commission','Production Commission') then return null;
  end if;
  return new;
end; $$;
drop trigger if exists pricing_default_markup_guard on public.price_quotation_costing_markups;
create trigger pricing_default_markup_guard before insert or update on public.price_quotation_costing_markups for each row execute function private.enforce_pricing_default_markup();

create or replace function public.sales_project_officer_commissions()
returns table (organization_id uuid, officer_user_id uuid, quotation_id uuid, quotation_no text, project_name text, client_name text, quoted_amount numeric, paid_amount numeric, projected_commission numeric, earned_commission numeric)
language sql stable security definer set search_path=public,private as $$
  with collections as (
    select i.quotation_id, coalesce(sum(p.amount) filter(where p.reversed_at is null),0) paid_amount
    from public.invoices i left join public.payments p on p.invoice_id=i.id
    where i.quotation_id is not null and i.status <> 'void' group by i.quotation_id
  ), base as (
    select q.*, least(coalesce(c.paid_amount,0),q.total_amount) paid, s.sales_commission_tiers tiers
    from public.quotations q left join collections c on c.quotation_id=q.id
    join public.business_settings s on s.organization_id=q.organization_id
    where q.document_type='price_quotation' and q.costing_source_id is null and q.status::text='approved'
      and (private.has_text_role(q.organization_id,array['super_admin','owner','admin']) or (private.has_text_role(q.organization_id,array['project_manager']) and coalesce(q.prepared_by_user_id,q.created_by)=(select auth.uid())))
  )
  select b.organization_id,coalesce(b.prepared_by_user_id,b.created_by),b.id,b.quotation_no,b.project_name,b.client_name,b.total_amount,b.paid,
    round((select coalesce(sum((case when (t.value->>'up_to') is null then greatest(b.total_amount-coalesce(prev.cap,0),0) else greatest(least(b.total_amount,(t.value->>'up_to')::numeric)-coalesce(prev.cap,0),0) end)*(t.value->>'rate')::numeric/100),0) from jsonb_array_elements(b.tiers) with ordinality t(value,ord) left join lateral(select max((x.value->>'up_to')::numeric) cap from jsonb_array_elements(b.tiers) with ordinality x(value,xord) where xord<t.ord and (x.value->>'up_to') is not null) prev on true),2),
    round((select coalesce(sum((case when (t.value->>'up_to') is null then greatest(b.paid-coalesce(prev.cap,0),0) else greatest(least(b.paid,(t.value->>'up_to')::numeric)-coalesce(prev.cap,0),0) end)*(t.value->>'rate')::numeric/100),0) from jsonb_array_elements(b.tiers) with ordinality t(value,ord) left join lateral(select max((x.value->>'up_to')::numeric) cap from jsonb_array_elements(b.tiers) with ordinality x(value,xord) where xord<t.ord and (x.value->>'up_to') is not null) prev on true),2)
  from base b;
$$;
commit;
