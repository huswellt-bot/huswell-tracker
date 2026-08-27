-- New leads always belong to the authenticated user who creates them.
-- Their displayed outbound caller comes from that user's profile. Existing
-- records are preserved and this migration can be safely re-run.

create or replace function public.assign_lead_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  if tg_op = 'UPDATE' then
    -- A lead's creator, assigned officer, and outbound caller stay aligned.
    new.created_by := old.created_by;
    new.assigned_to := old.assigned_to;
    new.outbound_caller := old.outbound_caller;
    return new;
  end if;

  if actor_id is not null then
    new.created_by := actor_id;
    new.assigned_to := actor_id;
    select nullif(btrim(full_name), '')
      into actor_name
      from public.profiles
      where id = actor_id;
    new.outbound_caller := actor_name;
  end if;

  return new;
end;
$$;

revoke all on function public.assign_lead_creator() from public;

drop trigger if exists leads_assign_creator on public.leads;
create trigger leads_assign_creator
before insert or update on public.leads
for each row execute function public.assign_lead_creator();
