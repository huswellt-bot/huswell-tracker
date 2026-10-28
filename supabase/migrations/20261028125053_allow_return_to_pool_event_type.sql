begin;

alter table public.finance_account_budget_allocation_events
  drop constraint if exists finance_account_budget_allocation_events_event_type_check;
alter table public.finance_account_budget_allocation_events
  add constraint finance_account_budget_allocation_events_event_type_check
  check (event_type = any (array[
    'allocation'::text,
    'reallocation_out'::text,
    'reallocation_in'::text,
    'month_end_return'::text,
    'funding_request_approval'::text,
    'return_to_pool'::text
  ]));

commit;
