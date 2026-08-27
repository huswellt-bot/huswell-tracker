import { CostingBreakdownView } from "@/components/costing-breakdown-view";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";
import { notFound, redirect } from "next/navigation";

export default async function CostingBreakdownPage(
  props: PageProps<"/costing-breakdown/[id]">,
) {
  const { id } = await props.params;
  const access = await requireWorkspaceAccess();

  if (
    !["owner", "admin", "super_admin", "project_manager"].includes(
      access.role,
    )
  ) {
    redirect("/auth");
  }

  const supabase = await createClient();
  const { data: costing, error: costingError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", access.organizationId)
    .eq("document_type", "costing_breakdown")
    .maybeSingle();

  if (costingError || !costing) notFound();

  const { data: lines } = await supabase
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", costing.id)
    .order("sort_order", { ascending: true });

  const { data: lead } = costing.lead_id
    ? await supabase
        .from("leads")
        .select("contact_name, client_name")
        .eq("id", costing.lead_id)
        .maybeSingle()
    : { data: null };

  const backHref =
    access.role === "super_admin"
      ? "/super-admin"
      : ["owner", "admin"].includes(access.role)
        ? "/admin"
        : "/project-manager";

  return (
    <CostingBreakdownView
      backHref={backHref}
      costing={costing}
      lead={lead}
      lines={lines ?? []}
    />
  );
}
