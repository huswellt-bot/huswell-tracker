-- Grant the Pricing Officer read access to organization business settings.
--
-- The business_settings (and other shared tables) use role-aware RLS policies built
-- around private.can_access(...), NOT has_text_role. Migration 097 added the
-- 'pricing_officer' role to the quotation-related policies and RPCs, but never gave
-- the role any resource access inside private.can_access. As a result the Pricing
-- Officer could review quotations but could NOT read business_settings, so when
-- reviewing a Price Quotation the default bank details (default_bank_details) fell
-- back to the hardcoded DEFAULT_QUOTATION_BANK_DETAILS instead of the organization's
-- configured default.
--
-- This reproduces the current private.can_access body (from 027_enable_super_admin_access.sql)
-- verbatim and adds a 'pricing_officer' branch granting READ access to the resources the
-- role legitimately needs to review quotations and manage mockups. The role stays read-only
-- for business_settings (it must not update them).

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
        or (m.role::text = 'pricing_officer' and (
          (action = 'read' and resource = any(array['business_settings','leads','customers','quotations','quotation_items','price_quotation_illustrations','price_quotation_product_costings','price_quotation_costing_lines','price_quotation_costing_markups','price_quotation_mockups']))
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
