export const workspaceRoleLabel = (role: string) => {
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
    default:
      return role.replaceAll("_", " ");
  }
};

export const workspaceAccountLabel = (role: string) =>
  `${workspaceRoleLabel(role)} Account`;
