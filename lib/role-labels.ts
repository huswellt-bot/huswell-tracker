export const workspaceRoleLabel = (
  role: string,
  internalFinanceEnabled = false,
) => {
  if (role === "sales_pricing_officer" && internalFinanceEnabled)
    return "Sales & Pricing Officer + Accounting & Finance";
  if (role === "admin" && internalFinanceEnabled)
    return "General Manager + Finance Operations";
  switch (role) {
    case "super_admin":
      return "Super Admin";
    case "owner":
      return "Owner / General Manager";
    case "admin":
      return "General Manager";
    case "project_manager":
      return "Sales Executive";
    case "sales_pricing_officer":
      return "Sales & Pricing Officer";
    case "accountant":
    case "internal_finance":
    case "external_finance":
      return "Accounting & Finance";
    case "lead_coordinator":
      return "Lead & Costing Coordinator";
    default:
      return role.replaceAll("_", " ");
  }
};

export const workspaceAccountLabel = (
  role: string,
  internalFinanceEnabled = false,
) => `${workspaceRoleLabel(role, internalFinanceEnabled)} Account`;
