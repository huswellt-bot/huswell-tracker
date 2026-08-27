-- Automatically assign Lead / Project numbers when they are created.

create sequence if not exists public.lead_no_sequence;

create or replace function public.assign_lead_number()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.lead_no is null or btrim(new.lead_no) = '' then
    new.lead_no := format(
      'LD-%s-%s',
      to_char(current_date, 'YYYY'),
      lpad(nextval('public.lead_no_sequence')::text, 4, '0')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_number on public.leads;
create trigger leads_assign_number
before insert on public.leads
for each row execute function public.assign_lead_number();
