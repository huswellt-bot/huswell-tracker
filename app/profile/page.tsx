import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const access = await requireWorkspaceAccess();
  if (access.role === "super_admin") redirect("/super-admin");
  if (["project_manager", "owner", "admin"].includes(access.role))
    return <HuswellWorkspace {...access} initialView="Profile" />;
  redirect("/");
}
