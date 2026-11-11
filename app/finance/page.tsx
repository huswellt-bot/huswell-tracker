import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function FinancePage() {
  const access = await requireWorkspaceAccess();

  if (!["super_admin", "owner", "admin", "accountant"].includes(access.role)) {
    redirect("/");
  }

  return <HuswellWorkspace
    {...access}
    initialView="Finance Overview"
  />;
}
