import { SuperAdminConsole } from "@/components/super-admin-console";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function SuperAdminPage() {
  const access = await requireWorkspaceAccess();

  if (access.role !== "super_admin") redirect("/auth");

  return <SuperAdminConsole {...access} />;
}
