import { HuswellWorkspace } from "@/components/huswell-workspace";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { redirect } from "next/navigation";

export default async function FinancePage() {
  const access = await requireWorkspaceAccess();

  if (!["super_admin", "owner", "admin", "internal_finance", "external_finance"].includes(access.role)) {
    redirect("/");
  }

  return <HuswellWorkspace
    {...access}
    initialView={
      ["super_admin", "owner", "admin"].includes(access.role)
        ? "Finance Budget"
        : "Finance Overview"
    }
  />;
}
