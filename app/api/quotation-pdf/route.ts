import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PdfRequest = {
  html?: unknown;
  documentId?: unknown;
  documentType?: unknown;
};

const PDF_RENDER_TIMEOUT_MS = 45_000;
const PDF_BROWSER_PROFILE_ROOT = join(
  process.env.PDF_BROWSER_PROFILE_DIR ?? "D:\\Temp\\agent-scratch",
  "huswell-pdf-renderer",
);
async function createPdf(html: string) {
  await mkdir(PDF_BROWSER_PROFILE_ROOT, { recursive: true });
  const profileDir = await mkdtemp(join(PDF_BROWSER_PROFILE_ROOT, "edge-"));
  const htmlPath = join(profileDir, "quotation.html");
  const pdfPath = join(profileDir, "quotation.pdf");
  try {
    await writeFile(htmlPath, html);
    const edge = process.env.PDF_RENDERER_EXECUTABLE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const child = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", `--user-data-dir=${join(profileDir, "profile")}`, `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`], { windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("PDF rendering timed out. Please try again.")); }, PDF_RENDER_TIMEOUT_MS);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("PDF renderer exited before creating the document.")); });
    });
    return await readFile(pdfPath);
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const { html, documentId, documentType } = (await request.json()) as PdfRequest;
  if (typeof html !== "string" || html.length === 0 || html.length > 2_000_000) {
    return Response.json({ error: "A valid quotation document is required." }, { status: 400 });
  }
  if (
    typeof documentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId) ||
    (documentType !== "costing_breakdown" && documentType !== "price_quotation")
  ) {
    return Response.json({ error: "A valid document reference is required." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to generate this PDF." }, { status: 401 });
  const { data: document, error: documentError } = await supabase
    .from("quotations")
    .select("id, organization_id, document_type, status")
    .eq("id", documentId)
    .eq("document_type", documentType)
    .maybeSingle();
  if (documentError || !document) {
    return Response.json({ error: "You do not have access to this document." }, { status: 403 });
  }
  if (documentType === "costing_breakdown") {
    if (document.status !== "approved") {
      return Response.json(
        { error: "Costing Breakdown PDFs are available after General Manager approval." },
        { status: 403 },
      );
    }
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", document.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(String(membership.role))) {
      return Response.json({ error: "Only the General Manager can generate Costing Breakdown PDFs." }, { status: 403 });
    }
  }

  try {
    const pdf = await createPdf(html);
    const body = new Uint8Array(pdf);
    return new Response(body.buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${documentType === "costing_breakdown" ? "Costing Breakdown" : "Price Quotation"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to generate the quotation PDF." },
      { status: 500 },
    );
  }
}
