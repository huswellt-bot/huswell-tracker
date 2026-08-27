-- Run after 026_add_super_admin_role.sql.
-- Grants the separate Super Admin role the top-level workspace permissions.

create or replace function private.is_org_admin(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.role::text in ('super_admin', 'owner', 'admin')
  );
$$;

create or replace function private.has_text_role(target_organization_id uuid, allowed text[])
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and (
        m.role::text = any(allowed)
        or (
          m.role::text = 'super_admin'
          and ('owner' = any(allowed) or 'admin' = any(allowed))
        )
      )
  );
$$;

create or replace function private.can_manage_quotation(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists(
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and role::text in ('super_admin', 'owner', 'admin', 'project_manager', 'sales')
  );
$$;

create or replace function private.can_access(target_organization_id uuid, resource text, action text)
returns boolean
language sql stable security definer
set search_path = public, private
as $$
  select exists(
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and (
        m.role::text in ('super_admin', 'owner', 'admin')
        or (m.role::text = 'project_manager' and (
          (action = 'read' and resource = any(array['leads','customers','suppliers','inventory_items','quotations','quotation_items']))
          or (action = 'create' and resource = any(array['leads','customers','suppliers','quotations','quotation_items']))
          or (action = 'update' and resource = any(array['leads','customers','suppliers','quotations']))
        ))
        or (m.role::text = 'accountant' and (
          (action = 'read' and resource = any(array['customers','suppliers','invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
          or (action = 'create' and resource = any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables']))
          or (action = 'update' and resource = any(array['invoices','invoice_items','payments','expenses','cash_flow_entries','supplier_payables','suppliers']))
          or (action = 'delete' and resource = any(array['expenses','supplier_payables']))
        ))
      )
  );
$$;

grant execute on function private.is_org_admin(uuid), private.has_text_role(uuid,text[]), private.can_manage_quotation(uuid), private.can_access(uuid,text,text) to authenticated;
