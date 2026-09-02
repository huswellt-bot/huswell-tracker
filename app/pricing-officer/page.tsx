import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function PricingOfficerPage() {
  const access = await requireWorkspaceAccess();

  if (access.role === "super_admin") redirect("/super-admin");
  if (["owner", "admin"].includes(access.role)) redirect("/admin");
  if (access.role === "project_manager") redirect("/project-manager");
  if (access.role !== "pricing_officer") redirect("/");

  return <HuswellWorkspace {...access} />;
}
