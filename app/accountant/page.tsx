import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function AccountantPage() {
  const access = await requireWorkspaceAccess();

  if (access.role !== "accountant" && !access.internalFinanceEnabled) redirect("/");

  return <HuswellWorkspace {...access} initialView="Finance Overview" />;
}
