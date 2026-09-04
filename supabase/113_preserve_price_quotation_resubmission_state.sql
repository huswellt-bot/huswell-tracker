-- Preserve the fact that a direct Price Quotation was returned while Sales edits
-- it as a draft, then count it exactly once when it is resubmitted.
-- Run after 112_track_price_quotation_resubmissions.sql.

begin;

alter table public.quotations
  add column if not exists resubmission_pending boolean not null default false;

create or replace function public.track_price_quotation_resubmission()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.document_type <> 'price_quotation' or new.costing_source_id is not null then
    return new;
  end if;

  -- Saving a returned quotation creates a draft. Keep that history while it is
  -- being edited; do not increment until the officer actually submits it.
  if old.status::text = 'needs_revision' and new.status::text = 'draft' then
    new.resubmission_pending := true;
  elsif old.status::text = 'draft' and new.status::text = 'pending'
    and old.resubmission_pending then
    new.resubmission_count := old.resubmission_count + 1;
    new.resubmission_pending := false;
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_resubmission_tracker on public.quotations;
create trigger price_quotation_resubmission_tracker
before update on public.quotations
for each row execute function public.track_price_quotation_resubmission();

commit;
