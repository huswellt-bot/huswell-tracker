import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationPdfViewer } from "@/components/quotation-pdf-viewer";
import type {
  QuotationPdfRow,
  QuotationPdfStore,
} from "@/components/huswell-workspace";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/supabase/workspace-access";

export const metadata: Metadata = {
  title: "Quotation PDF",
};

type PageProps = {
  searchParams: Promise<{ quotationId?: string | string[] }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function Page({ searchParams }: PageProps) {
  await requireWorkspaceAccess();
  const params = await searchParams;
  const quotationId =
    typeof params.quotationId === "string" ? params.quotationId : "";
  if (!uuidPattern.test(quotationId)) notFound();

  const supabase = await createClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", quotationId)
    .eq("status", "approved")
    .in("document_type", ["price_quotation", "mockup_quotation"])
    .maybeSingle();
  if (quoteError || !quote) notFound();

  const leadId = typeof quote.lead_id === "string" ? quote.lead_id : null;
  const customerId =
    typeof quote.customer_id === "string" ? quote.customer_id : null;
  const sourceId =
    typeof quote.source_price_quotation_id === "string"
      ? quote.source_price_quotation_id
      : null;
  const [itemsResult, leadResult, customerResult, sourceResult] =
    await Promise.all([
      supabase.from("quotation_items").select("*").eq("quotation_id", quote.id),
      leadId
        ? supabase.from("leads").select("*").eq("id", leadId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      customerId
        ? supabase
            .from("customers")
            .select("*")
            .eq("id", customerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sourceId
        ? supabase
            .from("quotations")
            .select("*")
            .eq("id", sourceId)
            .eq("status", "approved")
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const quoteRows = [
    quote,
    ...(sourceResult.data ? [sourceResult.data] : []),
  ] as unknown as QuotationPdfRow[];
  const store = {
    quotations: quoteRows,
    quotation_items: (itemsResult.data ?? []) as unknown as QuotationPdfRow[],
    price_quotation_product_costings: [],
    price_quotation_costing_lines: [],
    price_quotation_costing_markups: [],
    customers: customerResult.data
      ? [customerResult.data as unknown as QuotationPdfRow]
      : [],
    leads: leadResult.data
      ? [leadResult.data as unknown as QuotationPdfRow]
      : [],
  } satisfies QuotationPdfStore;

  return <QuotationPdfViewer quote={quoteRows[0]} store={store} />;
}
