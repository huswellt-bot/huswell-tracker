import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const access = await requireWorkspaceAccess();

  if (access.role === "super_admin") redirect("/super-admin");
  if (access.role === "project_manager") redirect("/project-manager");
  if (!["owner", "admin"].includes(access.role)) redirect("/auth");

  return <HuswellWorkspace {...access} />;
}
