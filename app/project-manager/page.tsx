import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function ProjectManagerPage() {
  const access = await requireWorkspaceAccess();

  if (access.role === "super_admin") redirect("/super-admin");
  if (["owner", "admin"].includes(access.role)) redirect("/admin");
  if (!["project_manager", "sales_pricing_officer"].includes(access.role)) redirect("/auth");

  return <HuswellWorkspace {...access} />;
}
