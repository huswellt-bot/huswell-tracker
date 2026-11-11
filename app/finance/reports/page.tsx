import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function FinanceReportsPage() {
  const access = await requireWorkspaceAccess();

  if (
    !["super_admin", "owner", "admin", "accountant"].includes(access.role) &&
    !access.internalFinanceEnabled
  ) {
    redirect("/");
  }

  return <HuswellWorkspace {...access} initialView="Finance Reports" />;
}
