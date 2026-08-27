-- Repair databases created with an outdated quotation status default.
-- `unfulfilled` belongs to expense statuses; quotations must begin as `draft`.

alter table public.quotations
  alter column status set default 'draft'::public.quotation_status;
