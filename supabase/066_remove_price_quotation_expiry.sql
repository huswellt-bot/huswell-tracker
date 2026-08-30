-- Price Quotations no longer expire automatically. This keeps the existing
-- column for historical compatibility but clears and prevents expiry values
-- for the new direct Price Quotation workflow.
begin;

alter table public.quotations
  alter column valid_until drop not null;

create or replace function public.remove_price_quotation_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_type = 'price_quotation' and new.costing_source_id is null then
    new.valid_until := null;
    if new.terms_conditions is not null then
      new.terms_conditions := nullif(
        btrim(regexp_replace(
          new.terms_conditions,
          E'(^|\\n)Validity:[^\\n]*(\\n|$)',
          E'\\1',
          'g'
        )),
        ''
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists price_quotation_expiry_removal on public.quotations;
create trigger price_quotation_expiry_removal
before insert or update on public.quotations
for each row execute function public.remove_price_quotation_expiry();

update public.quotations
set valid_until = null,
    terms_conditions = nullif(
      btrim(regexp_replace(
        terms_conditions,
        E'(^|\\n)Validity:[^\\n]*(\\n|$)',
        E'\\1',
        'g'
      )),
      ''
    )
where document_type = 'price_quotation'
  and costing_source_id is null;

commit;
