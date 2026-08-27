-- Run this after 001_initial_schema.sql.
-- Creates the one fixed Huswell Trading workspace for the signed-in user.

create or replace function public.initialize_huswell_trading()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_organization_id uuid;
  new_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to initialize Huswell Trading.';
  end if;

  select organization_id into existing_organization_id
  from public.organization_members
  where user_id = current_user_id
  limit 1;

  if existing_organization_id is not null then
    return existing_organization_id;
  end if;

  insert into public.organizations (name, legal_name, created_by)
  values ('Huswell Trading', 'Huswell Trading', current_user_id)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, current_user_id, 'owner');

  insert into public.business_settings (organization_id)
  values (new_organization_id);

  return new_organization_id;
end;
$$;

grant execute on function public.initialize_huswell_trading() to authenticated;
