import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function Home() {
  const access = await requireWorkspaceAccess();
  const { role } = access;

  if (role === "super_admin") redirect("/super-admin");
  if (["owner", "admin"].includes(role)) redirect("/admin");
  if (role === "project_manager") redirect("/project-manager");
  if (role === "sales_pricing_officer") redirect("/project-manager");
  if (role === "accountant") redirect("/accountant");

  return <HuswellWorkspace {...access} />;
}
