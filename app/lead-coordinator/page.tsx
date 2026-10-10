import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function LeadCoordinatorPage() {
  const access = await requireWorkspaceAccess();

  if (access.role !== "lead_coordinator") redirect("/");

  return <HuswellWorkspace {...access} initialView="Leads" />;
}
