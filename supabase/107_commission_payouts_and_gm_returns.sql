-- Final GM return path and immutable, GM-paid Sales Project Officer commission payouts.
begin;

create table if not exists public.sales_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete restrict,
  officer_user_id uuid not null references auth.users(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(), reference_no text, notes text,
  paid_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists sales_commission_payouts_quote_idx on public.sales_commission_payouts(quotation_id);
alter table public.sales_commission_payouts enable row level security;
create policy "commission payouts: officer or GM read" on public.sales_commission_payouts for select to authenticated using (
  officer_user_id = (select auth.uid()) or private.has_text_role(organization_id, array['super_admin','owner','admin'])
);

create or replace function public.return_price_quotation_from_gm(p_quotation_id uuid, p_note text)
returns void language plpgsql security definer set search_path=public,private as $$
declare q public.quotations%rowtype; v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if v_note is null then raise exception 'Enter revision notes before returning this quotation'; end if;
  select * into q from public.quotations where id=p_quotation_id for update;
  if not found or q.status::text <> 'pending_gm_approval' then raise exception 'Quotation is not awaiting General Manager approval'; end if;
  if not private.has_text_role(q.organization_id,array['super_admin','owner','admin']) then raise exception 'Only the General Manager can return this quotation'; end if;
  update public.quotations set status='needs_revision', revision_note=v_note, revision_requested_by=(select auth.uid()), revision_requested_at=now() where id=q.id;
end; $$;

create or replace function public.mark_sales_commission_paid(p_quotation_id uuid, p_amount numeric, p_reference_no text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,private as $$
declare q public.quotations%rowtype; earned numeric; already_paid numeric; v_id uuid;
begin
  select * into q from public.quotations where id=p_quotation_id for update;
  if not found or q.status::text <> 'approved' then raise exception 'Only a final approved quotation can have commission paid'; end if;
  if not private.has_text_role(q.organization_id,array['super_admin','owner','admin']) then raise exception 'Only the General Manager can mark commission paid'; end if;
  select least(q.total_amount, coalesce(sum(p.amount),0)) into earned from public.invoices i left join public.payments p on p.invoice_id=i.id and p.reversed_at is null where i.quotation_id=q.id and i.status <> 'void';
  earned := round(least(earned,400000)*.03 + greatest(earned-400000,0)*.05,2);
  select coalesce(sum(amount),0) into already_paid from public.sales_commission_payouts where quotation_id=q.id;
  if coalesce(p_amount,0) <= 0 or p_amount > earned-already_paid then raise exception 'Payout cannot exceed earned unpaid commission'; end if;
  insert into public.sales_commission_payouts(organization_id,quotation_id,officer_user_id,amount,reference_no,notes,paid_by) values(q.organization_id,q.id,coalesce(q.prepared_by_user_id,q.created_by),p_amount,nullif(btrim(coalesce(p_reference_no,'')),''),nullif(btrim(coalesce(p_notes,'')),''),(select auth.uid())) returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.return_price_quotation_from_gm(uuid,text), public.mark_sales_commission_paid(uuid,numeric,text,text) to authenticated;
commit;
