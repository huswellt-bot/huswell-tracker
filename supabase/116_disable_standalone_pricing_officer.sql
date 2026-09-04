-- Make Sales & Pricing Officer the only pricing-capable user type.
-- Run after 115_sales_pricing_officer_project_type_routing.sql and before
-- deploying the matching application update.
--
-- The legacy pricing_officer enum value is retained because PostgreSQL does
-- not safely support dropping enum values. Memberships are converted and a
-- constraint prevents the standalone role from being assigned again.

begin;

update public.organization_members
set role = 'sales_pricing_officer'::public.member_role
where role::text = 'pricing_officer';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and conname = 'organization_members_no_standalone_pricing_officer'
  ) then
    alter table public.organization_members
      add constraint organization_members_no_standalone_pricing_officer
      check (role::text <> 'pricing_officer');
  end if;
end;
$$;

-- Keep the old pricing_officer text as an internal capability alias for the
-- policies created by earlier migrations, but never authorize a membership
-- whose actual role is the retired standalone value.
create or replace function private.has_text_role(
  target_organization_id uuid,
  allowed text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.role::text <> 'pricing_officer'
      and (
        member.role::text = any(allowed)
        or (
          member.role::text = 'super_admin'
          and ('owner' = any(allowed) or 'admin' = any(allowed))
        )
        or (
          member.role::text = 'sales_pricing_officer'
          and ('project_manager' = any(allowed) or 'pricing_officer' = any(allowed))
        )
      )
  );
$$;

drop policy if exists "pricing officer assignments: admins manage" on public.pricing_officer_project_types;
create policy "pricing officer assignments: admins manage"
on public.pricing_officer_project_types for all to authenticated
using (
  (select private.is_org_admin(organization_id))
)
with check (
  (select private.is_org_admin(organization_id))
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_members member
    where member.organization_id = pricing_officer_project_types.organization_id
      and member.user_id = pricing_officer_project_types.pricing_officer_user_id
      and member.role::text = 'sales_pricing_officer'
  )
);

create or replace function private.is_pricing_officer_assigned(
  target_organization_id uuid,
  target_user_id uuid,
  target_project_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.pricing_officer_project_types assignment
      on assignment.organization_id = member.organization_id
     and assignment.pricing_officer_user_id = member.user_id
    where member.organization_id = target_organization_id
      and member.user_id = target_user_id
      and member.role::text = 'sales_pricing_officer'
      and assignment.project_type = private.normalize_price_quotation_project_type(target_project_type)
  );
$$;

create or replace function public.set_pricing_officer_project_types(
  p_user_id uuid,
  p_project_types text[]
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_project_types text[] := coalesce(p_project_types, array[]::text[]);
  v_invalid_type text;
begin
  select member.organization_id
    into v_organization_id
  from public.organization_members member
  where member.user_id = p_user_id
    and member.role::text = 'sales_pricing_officer'
    and private.is_org_admin(member.organization_id)
  order by member.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'Only an administrator can assign Sales & Pricing Officer project types';
  end if;

  select raw.value
    into v_invalid_type
  from unnest(v_project_types) as raw(value)
  where private.normalize_price_quotation_project_type(raw.value) is null
  limit 1;

  if v_invalid_type is not null then
    raise exception 'Unsupported Price Quotation project type: %', v_invalid_type;
  end if;

  delete from public.pricing_officer_project_types
  where organization_id = v_organization_id
    and pricing_officer_user_id = p_user_id;

  insert into public.pricing_officer_project_types (
    organization_id,
    pricing_officer_user_id,
    project_type,
    created_by
  )
  select
    v_organization_id,
    p_user_id,
    private.normalize_price_quotation_project_type(raw.value),
    (select auth.uid())
  from unnest(v_project_types) as raw(value)
  group by private.normalize_price_quotation_project_type(raw.value);
end;
$$;

revoke all on function public.set_pricing_officer_project_types(uuid, text[]) from public;
grant execute on function public.set_pricing_officer_project_types(uuid, text[]) to authenticated;

commit;

-- Recovery before applying this migration: restore the organization_members
-- rows from a database backup if the old standalone role distinction must be
-- recovered. The enum value itself remains available for that recovery.
