-- An approved Lead deletion sets lead_id to NULL on every linked quotation.
-- Migration 075 correctly protects historical Costing Breakdowns from edits,
-- but its blanket update guard also blocked that automatic FK update.
--
-- Run after 079_allow_gm_approved_lead_deletion.sql. Safe to re-run.

begin;

create or replace function public.prevent_costing_breakdown_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' and new.document_type = 'costing_breakdown' then
    raise exception 'Costing Breakdowns are no longer available. Create a direct Price Quotation instead.';
  end if;

  if tg_op = 'UPDATE' and old.document_type = 'costing_breakdown'
    and not (
      new.lead_id is null
      and old.lead_id is not null
      and coalesce(
        current_setting('huswell.allow_price_quotation_lead_unlink', true),
        'off'
      ) = 'on'
    ) then
    raise exception 'Historical Costing Breakdowns are read-only.';
  end if;

  if tg_op = 'DELETE' and old.document_type = 'costing_breakdown' then
    raise exception 'Historical Costing Breakdowns cannot be deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_costing_breakdown_workflow() from public;

commit;
