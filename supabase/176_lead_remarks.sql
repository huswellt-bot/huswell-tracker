-- Run after 175_automatic_commission_from_approved_costing_markups.sql and
-- before deploying the matching Leads workspace update.
-- This is additive and preserves existing leads.

begin;

alter table public.leads
  add column if not exists lead_remark text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_lead_remark_length_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_lead_remark_length_check
      check (lead_remark is null or char_length(lead_remark) <= 1000);
  end if;
end;
$$;

create or replace function public.save_lead_remark(
  p_lead_id uuid,
  p_lead_remark text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lead public.leads%rowtype;
  v_remark text := nullif(btrim(coalesce(p_lead_remark, '')), '');
begin
  if char_length(coalesce(v_remark, '')) > 1000 then
    raise exception 'Lead remark must be 1,000 characters or fewer';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;

  if not private.has_text_role(
    v_lead.organization_id,
    array['project_manager', 'sales_pricing_officer']
  )
  or coalesce(v_lead.assigned_to, v_lead.created_by) is distinct from (select auth.uid()) then
    raise exception 'Only the officer who owns this lead can save its remark';
  end if;

  update public.leads
  set lead_remark = v_remark
  where id = v_lead.id;
end;
$$;

revoke all on function public.save_lead_remark(uuid, text) from public;
grant execute on function public.save_lead_remark(uuid, text) to authenticated;

create or replace function private.guard_lead_remark_update()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.lead_remark is distinct from old.lead_remark
    and not (
      private.has_text_role(
        old.organization_id,
        array['project_manager', 'sales_pricing_officer']
      )
      and coalesce(old.assigned_to, old.created_by) is not distinct from (select auth.uid())
    ) then
    raise exception 'Only the officer who owns this lead can save its remark';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_lead_remark_update() from public;

drop trigger if exists leads_guard_lead_remark_update on public.leads;
create trigger leads_guard_lead_remark_update
before update on public.leads
for each row execute function private.guard_lead_remark_update();

commit;
