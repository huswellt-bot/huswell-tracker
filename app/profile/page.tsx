import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const access = await requireWorkspaceAccess();
  if (access.role === "super_admin") redirect("/super-admin");
  if (["owner", "admin"].includes(access.role))
    return <HuswellWorkspace {...access} initialView="Settings" />;
  if (access.role === "project_manager")
    return <HuswellWorkspace {...access} initialView="Profile" />;
  redirect("/");
}
