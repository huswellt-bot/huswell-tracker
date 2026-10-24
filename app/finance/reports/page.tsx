import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function FinanceReportsPage() {
  const access = await requireWorkspaceAccess();

  if (!["internal_finance", "external_finance"].includes(access.role)) {
    redirect("/");
  }

  return <HuswellWorkspace {...access} initialView="Finance Reports" />;
}
