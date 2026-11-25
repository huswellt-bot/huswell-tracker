import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CostingBreakdownView } from "@/components/costing-breakdown-view";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";

type Row = Record<string, unknown>;

function backHrefForRole(role: string) {
  if (role === "super_admin") return "/super-admin";
  if (["owner", "admin"].includes(role)) return "/admin";
  return "/project-manager";
}

function LoadError({ id, backHref }: { id: string; backHref: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fc] px-4 py-10 text-[#202938]">
      <section
        role="alert"
        className="w-full max-w-lg rounded-[14px] border border-[#dfe5ed] bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-[18px] font-semibold">Costing Breakdown could not load</h1>
        <p className="mt-2 text-[13px] leading-5 text-[#687386]">
          The historical costing data is temporarily unavailable. Try again in a moment.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href={`/costing-breakdown/${encodeURIComponent(id)}`}
            className="rounded-md bg-[#c43b43] px-4 py-2 text-[12px] font-medium text-white transition hover:bg-[#a92f37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
          >
            Try again
          </Link>
          <Link
            href={backHref}
            className="rounded-md border border-[#d9e0e9] px-4 py-2 text-[12px] font-medium text-[#344054] transition hover:bg-[#f6f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
          >
            Back to workspace
          </Link>
        </div>
      </section>
    </main>
  );
}

export default async function CostingBreakdownPage(
  props: PageProps<"/costing-breakdown/[id]">,
) {
  const { id } = await props.params;
  const access = await requireWorkspaceAccess();

  if (
    ![
      "owner",
      "admin",
      "super_admin",
      "project_manager",
      "sales_pricing_officer",
    ].includes(access.role)
  ) {
    redirect("/auth");
  }

  const supabase = await createClient();
  const backHref = backHrefForRole(access.role);
  const { data: costing, error: costingError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", access.organizationId)
    .eq("document_type", "costing_breakdown")
    .maybeSingle();

  if (costingError) return <LoadError id={id} backHref={backHref} />;
  if (!costing) notFound();

  const { data: lines, error: linesError } = await supabase
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", costing.id)
    .order("sort_order", { ascending: true });

  if (linesError) return <LoadError id={id} backHref={backHref} />;

  let lead: Row | null = null;
  if (costing.lead_id) {
    const leadResult = await supabase
      .from("leads")
      .select("contact_name, client_name")
      .eq("id", costing.lead_id)
      .maybeSingle();
    if (leadResult.error) return <LoadError id={id} backHref={backHref} />;
    lead = leadResult.data as Row | null;
  }

  return (
    <CostingBreakdownView
      backHref={backHref}
      costing={costing as Row}
      lead={lead}
      lines={(lines ?? []) as Row[]}
    />
  );
}
