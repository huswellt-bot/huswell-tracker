-- Add optional quotation illustrations, date-based quotation numbers, and a
-- direct edit-and-resubmit workflow for approved direct Price Quotations.
-- Run after migrations 063 through 070.

begin;

-- Direct Price Quotations use a daily, human-readable sequence. Historical
-- quotation numbers are deliberately preserved.
create or replace function public.assign_direct_price_quotation_number()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_date_part text := to_char(current_date, 'MMDDYY');
  v_prefix text;
  v_next_number integer;
begin
  if new.document_type <> 'price_quotation' or new.costing_source_id is not null then
    return new;
  end if;

  v_prefix := 'QTN-' || v_date_part || '-';
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || v_date_part, 0)
  );

  select coalesce(
    max((substring(quotation_no from ('^' || v_prefix || '([0-9]+)A$')))::integer),
    0
  ) + 1
  into v_next_number
  from public.quotations
  where organization_id = new.organization_id
    and quotation_no ~ ('^' || v_prefix || '[0-9]+A$');

  new.quotation_no := v_prefix || v_next_number::text || 'A';
  return new;
end;
$$;

drop trigger if exists quotations_assign_direct_price_quotation_number on public.quotations;
create trigger quotations_assign_direct_price_quotation_number
before insert on public.quotations
for each row execute function public.assign_direct_price_quotation_number();

-- Project Officers may begin a revision themselves. The original approved
-- quotation remains in the audit trail; its edited version must be submitted
-- and reviewed by the General Manager before it is approved again.
create or replace function public.enforce_role_sensitive_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if (select private.is_org_admin(new.organization_id)) then return new; end if;

  if tg_table_name = 'quotations' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'needs_revision', 'pending'))
    or (
      tg_op = 'UPDATE'
      and new.status is distinct from old.status
      and not (
        new.document_type = 'price_quotation'
        and new.costing_source_id is null
        and (
          (old.status::text = 'pending' and new.status::text = 'draft')
          or (
            old.status::text = 'approved'
            and new.status::text = 'needs_revision'
            and new.created_by = (select auth.uid())
            and private.has_text_role(new.organization_id, array['project_manager'])
          )
        )
      )
      and (
        new.status::text not in ('draft', 'needs_revision', 'pending')
        or old.status::text not in ('draft', 'needs_revision')
      )
    )
  ) then
    raise exception 'Only an administrator can approve or finalize a quotation';
  end if;

  if tg_table_name = 'expenses' and (
    (tg_op = 'INSERT' and new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('unfulfilled', 'fulfilled', 'pending_approval') or old.status::text not in ('unfulfilled', 'fulfilled')))
  ) then raise exception 'Only an administrator can approve, reject, or cancel an expense'; end if;
  if tg_table_name = 'invoices' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'issued', 'partial'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'issued', 'partial') or old.status::text not in ('draft', 'issued', 'partial')))
  ) then raise exception 'Only an administrator can set this invoice status directly'; end if;
  if tg_table_name = 'payroll_periods' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'in_review'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'in_review') or old.status::text not in ('draft', 'in_review')))
  ) then raise exception 'Only an administrator can approve or mark payroll paid'; end if;
  if tg_table_name = 'cash_flow_entries' and (
    (tg_op = 'INSERT' and new.status::text not in ('draft', 'pending'))
    or (tg_op = 'UPDATE' and new.status is distinct from old.status and (new.status::text not in ('draft', 'pending') or old.status::text not in ('draft', 'pending')))
  ) then raise exception 'Only an administrator can approve cash flow'; end if;
  return new;
end;
$$;

create or replace function public.begin_price_quotation_revision(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote public.quotations%rowtype;
begin
  select * into v_quote
  from public.quotations
  where id = p_quotation_id
  for update;

  if not found or v_quote.document_type <> 'price_quotation'
    or v_quote.costing_source_id is not null
    or v_quote.status::text <> 'approved' then
    raise exception 'Only an approved Price Quotation can be revised';
  end if;
  if not private.has_text_role(v_quote.organization_id, array['project_manager'])
    or (v_quote.created_by is distinct from (select auth.uid())
      and v_quote.prepared_by_user_id is distinct from (select auth.uid())) then
    raise exception 'Only the Project Officer who prepared this Price Quotation can revise it';
  end if;

  update public.quotations
  set status = 'needs_revision',
      revision_note = 'Revision in progress. Update the Price Quotation and submit it for General Manager review.',
      revision_requested_by = (select auth.uid()),
      revision_requested_at = now()
  where id = v_quote.id;
end;
$$;

-- This five-argument wrapper preserves the existing three- and four-argument
-- functions. The item image URL is intentionally saved only with the item;
-- PDF rendering does not read this field.
create or replace function public.save_price_quotation_draft(
  p_quotation_id uuid,
  p_lead_id uuid,
  p_project_type text,
  p_items jsonb,
  p_has_illustrations boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote_id uuid;
  v_illustration_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Add at least one item before saving the quotation';
  end if;

  select count(*) into v_illustration_count
  from jsonb_array_elements(p_items) as item(value)
  where nullif(btrim(coalesce(item.value ->> 'image_url', '')), '') is not null;

  if v_illustration_count > 5 then
    raise exception 'A Price Quotation can have a maximum of five illustrations';
  end if;
  if p_has_illustrations and v_illustration_count = 0 then
    raise exception 'Illustration upload did not complete. Try saving again.';
  end if;

  v_quote_id := public.save_price_quotation_draft(
    p_quotation_id,
    p_lead_id,
    p_project_type,
    p_items
  );

  update public.quotation_items quotation_item
  set image_url = nullif(btrim(item.value ->> 'image_url'), '')
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  where quotation_item.quotation_id = v_quote_id
    and quotation_item.sort_order = item.ordinality - 1;

  return v_quote_id;
end;
$$;

revoke all on function public.assign_direct_price_quotation_number() from public;
revoke all on function public.begin_price_quotation_revision(uuid) from public;
grant execute on function public.begin_price_quotation_revision(uuid) to authenticated;
revoke all on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) from public;
grant execute on function public.save_price_quotation_draft(uuid, uuid, text, jsonb, boolean) to authenticated;

commit;
