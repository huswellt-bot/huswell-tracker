begin;

-- Retire the seeded and previously-created categories without breaking
-- historical transactions that still reference their category IDs.
--
-- The runtime trigger protects category writes by checking auth.uid(). A
-- migration has no signed-in user, so disable only that trigger for this
-- privileged, one-time archive operation. The trigger is restored before the
-- transaction commits; runtime category writes remain accountant-only.
alter table public.finance_categories
  disable trigger finance_categories_role_guard;

update public.finance_categories
set is_active = false,
    updated_at = now()
where is_active = true;

alter table public.finance_categories
  enable trigger finance_categories_role_guard;

commit;
