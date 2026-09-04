-- Two-stage Price Quotation approval: Pricing Officer -> General Manager.
-- Run after 105_pricing_defaults_and_sales_commissions.sql.

alter type public.quotation_status add value if not exists 'pending_gm_approval';

begin;

alter table public.quotations
  add column if not exists pricing_reviewed_by uuid references auth.users(id),
  add column if not exists pricing_reviewed_at timestamptz;

-- The Pricing Officer may complete pricing, but its "approved" review action is
-- deliberately translated to the intermediate state. GM/Admin keep final approval.
create or replace function public.submit_price_quotation_to_gm(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['pricing_officer']) then
    raise exception 'Only a Pricing Officer can submit a Price Quotation to the General Manager';
  end if;
  if v_quote.status::text <> 'pending' then
    raise exception 'Only a submitted Price Quotation can be sent to the General Manager';
  end if;
  update public.quotations
  set status = 'pending_gm_approval', pricing_reviewed_by = (select auth.uid()), pricing_reviewed_at = now()
  where id = v_quote.id;
end;
$$;

create or replace function public.final_approve_price_quotation(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_quote public.quotations%rowtype;
begin
  select * into v_quote from public.quotations where id = p_quotation_id for update;
  if not found or v_quote.document_type <> 'price_quotation' or v_quote.costing_source_id is not null then
    raise exception 'Price Quotation not found';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['super_admin','owner','admin']) then
    raise exception 'Only the General Manager can finally approve a Price Quotation';
  end if;
  if v_quote.status::text <> 'pending_gm_approval' then
    raise exception 'This Price Quotation is not awaiting General Manager approval';
  end if;
  update public.quotations
  set status = 'approved', approved_by = (select auth.uid()), approved_at = now(), issue_date = current_date
  where id = v_quote.id;
  update public.approval_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now()
  where resource_type = 'quotation' and resource_id = v_quote.id;
end;
$$;

create or replace function public.enforce_role_sensitive_transitions()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;
  if tg_table_name = 'quotations' and new.status is distinct from old.status then
    -- Existing pricing RPCs save their completed costing through an "approved"
    -- decision. Convert that write before it reaches the table; this keeps the
    -- pricing calculation intact while removing final authority from the role.
    if new.document_type = 'price_quotation' and new.costing_source_id is null
      and old.status::text = 'pending' and new.status::text = 'approved'
      and private.has_text_role(new.organization_id, array['pricing_officer']) then
      new.status := 'pending_gm_approval';
      new.approved_by := null;
      new.approved_at := null;
      new.pricing_reviewed_by := (select auth.uid());
      new.pricing_reviewed_at := now();
      return new;
    end if;
    if new.document_type = 'price_quotation' and new.costing_source_id is null
      and old.status::text = 'pending' and new.status::text = 'pending_gm_approval'
      and private.has_text_role(new.organization_id, array['pricing_officer']) then return new; end if;
    if new.document_type = 'price_quotation' and new.costing_source_id is null
      and old.status::text = 'pending_gm_approval' and new.status::text = 'needs_revision'
      and private.has_text_role(new.organization_id, array['pricing_officer']) then return new; end if;
    raise exception 'Only a General Manager can approve or finalize a quotation';
  end if;
  return new;
end;
$$;

revoke all on function public.submit_price_quotation_to_gm(uuid), public.final_approve_price_quotation(uuid) from public;
grant execute on function public.submit_price_quotation_to_gm(uuid), public.final_approve_price_quotation(uuid) to authenticated;

commit;
