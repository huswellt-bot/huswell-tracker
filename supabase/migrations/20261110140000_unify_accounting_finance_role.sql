-- The revised Finance flow has one operational Finance role.
-- Existing Internal/External Finance memberships are normalized so they use
-- the same Accounting & Finance permissions and approval workflow.

begin;

update public.organization_members
set role = 'accountant'
where role in ('internal_finance', 'external_finance');

commit;
