-- Project schedules follow the current visible workflow: an approved direct
-- Price Quotation is eligible. The retired mockup_tasks approval gate is not
-- produced by the active Mockups workspace and otherwise blocks every officer.
-- Run after 113_preserve_price_quotation_resubmission_state.sql.

begin;

create or replace function public.populate_project_schedule_from_quotation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_quotation public.quotations%rowtype;
begin
  select * into v_quotation from public.quotations where id = new.quotation_id;
  if not found
    or v_quotation.organization_id is distinct from new.organization_id
    or v_quotation.document_type is distinct from 'price_quotation'
    or v_quotation.status::text is distinct from 'approved' then
    raise exception 'Projects can only be scheduled from an approved Price Quotation';
  end if;
  new.quotation_no := coalesce(v_quotation.quotation_no, '');
  new.project_name := coalesce(nullif(btrim(new.project_name), ''), nullif(v_quotation.project_name, ''), v_quotation.quotation_no, 'Untitled project');
  new.client_name := coalesce(nullif(btrim(new.client_name), ''), nullif(v_quotation.client_name, ''));
  new.product_name := coalesce(nullif(btrim(new.product_name), ''), nullif(v_quotation.project_types, ''));
  new.quantity := coalesce(new.quantity, v_quotation.project_quantity);
  return new;
end;
$$;

commit;
