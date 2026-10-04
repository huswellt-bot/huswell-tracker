import { createClient } from "@/lib/supabase/server";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;
const MAX_SCREENSHOT_PAGES = 6;
const MIN_USEFUL_TEXT_CHARS = 80;
const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const allowedRoles = new Set(["super_admin", "owner", "admin", "sales_pricing_officer"]);
const materialCategories = ["PP White", "Vinyl Glossy", "Vinyl Matte"] as const;

type DocumentKind = "pdf" | "docx";

const documentKind = (file: File): DocumentKind | null => {
  const name = file.name.toLowerCase();
  if (file.type === PDF_MIME_TYPE || name.endsWith(".pdf")) return "pdf";
  if (file.type === DOCX_MIME_TYPE || name.endsWith(".docx")) return "docx";
  return null;
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    client_name: { type: ["string", "null"] },
    client_contact_name: { type: ["string", "null"] },
    client_phone: { type: ["string", "null"] },
    project_name: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          material_category: {
            type: "string",
            enum: [...materialCategories],
          },
          item_description: { type: "string" },
          width_mm: { type: "number" },
          height_mm: { type: "number" },
          quantity: { type: "number" },
          finish: { type: "string" },
          extraction_confidence: { type: "number" },
          source_page: { type: ["integer", "null"] },
        },
        required: [
          "material_category",
          "item_description",
          "width_mm",
          "height_mm",
          "quantity",
          "finish",
          "extraction_confidence",
          "source_page",
        ],
      },
    },
    material_assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          material_category: {
            type: "string",
            enum: [...materialCategories],
          },
          required_rolls: { type: ["number", "null"] },
          linear_meters_used: { type: ["number", "null"] },
          extraction_confidence: { type: "number" },
          source_page: { type: ["integer", "null"] },
        },
        required: [
          "material_category",
          "required_rolls",
          "linear_meters_used",
          "extraction_confidence",
          "source_page",
        ],
      },
    },
  },
  required: [
    "client_name",
    "client_contact_name",
    "client_phone",
    "project_name",
    "notes",
    "items",
    "material_assumptions",
  ],
} as const;

const extractionPrompt = `Extract the costing inputs from the supplied client document text and, when provided, its rendered page images. Return only information that is explicitly present in the document. Do not calculate totals, prices, print area, roll usage, or any missing values. Do not invent dimensions or quantities. If a value is not clear, use 0 for a numeric item field and a low confidence score so a human can correct it.

The available material categories are exactly: PP White, Vinyl Glossy, Vinyl Matte. Map a clearly named material to the closest category; if the material cannot be mapped, use PP White and explain the uncertainty in notes. Treat dimensions as millimetres only when the document states or clearly implies millimetres; otherwise preserve the value as best as possible and set a low confidence score. Extract each requested product/signage line as one item. Preserve explicit required-roll and linear-meter assumptions only when they are written in the document. Those assumptions are editable and will be checked by a human.

This is an extraction step, not a costing decision. A separate deterministic workbook-compatible calculation engine will calculate the numbers after review.

Return one JSON object with exactly these top-level keys: client_name, client_contact_name, client_phone, project_name, notes, items, material_assumptions. Each item must contain material_category, item_description, width_mm, height_mm, quantity, finish, extraction_confidence, and source_page. Each material_assumptions entry must contain material_category, required_rolls, linear_meters_used, extraction_confidence, and source_page. Use null for unknown text or source pages, and null—not zero—for an assumption that is not explicitly stated.`;

const cleanString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const cleanNumber = (value: unknown, minimum = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : 0;
};

const cleanCategory = (value: unknown) =>
  materialCategories.includes(value as (typeof materialCategories)[number])
    ? value
    : "PP White";

function normalizeExtraction(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  const sourceAssumptions = Array.isArray(source.material_assumptions)
    ? source.material_assumptions
    : [];
  return {
    client_name: cleanString(source.client_name),
    client_contact_name: cleanString(source.client_contact_name),
    client_phone: cleanString(source.client_phone),
    project_name: cleanString(source.project_name),
    notes: cleanString(source.notes),
    items: sourceItems.map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        material_category: cleanCategory(row.material_category),
        item_description: typeof row.item_description === "string" ? row.item_description.trim() : "",
        width_mm: cleanNumber(row.width_mm),
        height_mm: cleanNumber(row.height_mm),
        quantity: cleanNumber(row.quantity),
        finish: typeof row.finish === "string" ? row.finish.trim() : "",
        extraction_confidence: Math.min(1, cleanNumber(row.extraction_confidence)),
        source_page: Number.isInteger(Number(row.source_page)) && Number(row.source_page) > 0 ? Number(row.source_page) : null,
        sort_order: index,
      };
    }),
    material_assumptions: sourceAssumptions.map((assumption) => {
      const row = assumption && typeof assumption === "object" ? assumption as Record<string, unknown> : {};
      return {
        material_category: cleanCategory(row.material_category),
        required_rolls: row.required_rolls === null || row.required_rolls === undefined ? null : cleanNumber(row.required_rolls),
        linear_meters_used: row.linear_meters_used === null || row.linear_meters_used === undefined ? null : cleanNumber(row.linear_meters_used),
        extraction_confidence: Math.min(1, cleanNumber(row.extraction_confidence)),
        source_page: Number.isInteger(Number(row.source_page)) && Number(row.source_page) > 0 ? Number(row.source_page) : null,
      };
    }),
  };
}

function responseText(body: Record<string, unknown>) {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as Record<string, unknown>).message
    : null;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object"))
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

async function extractPdfContext(file: File) {
  const parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) });
  try {
    const textResult = await parser.getText({
      pageJoiner: "\n-- page page_number of total_number --\n",
    });
    const text = textResult.text.trim();
    const hasUsefulText = text.replace(/\s/g, "").length >= MIN_USEFUL_TEXT_CHARS;
    if (hasUsefulText) return { text: text.slice(0, MAX_TEXT_CHARS), pageImages: [] as string[] };

    const screenshotResult = await parser.getScreenshot({
      first: MAX_SCREENSHOT_PAGES,
      desiredWidth: 1400,
      imageDataUrl: true,
      imageBuffer: false,
    });
    const pageImages = screenshotResult.pages
      .map((page) => page.dataUrl)
      .filter((dataUrl): dataUrl is string => typeof dataUrl === "string" && dataUrl.startsWith("data:image/"));
    return { text: text.slice(0, MAX_TEXT_CHARS), pageImages };
  } finally {
    await parser.destroy();
  }
}

async function extractDocxContext(file: File) {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  return {
    text: result.value.trim().slice(0, MAX_TEXT_CHARS),
    pageImages: [] as string[],
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const organizationId = formData.get("organization_id");
  const leadId = formData.get("lead_id");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a PDF or Word (.docx) file to analyze." }, { status: 400 });
  }
  const kind = documentKind(file);
  if (!kind) {
    return Response.json({ error: "Only PDF or Word (.docx) files can be analyzed." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "The PDF or Word file must be between 1 byte and 15 MB." }, { status: 400 });
  }
  if (typeof organizationId !== "string" || !organizationId) {
    return Response.json({ error: "Organization context is required." }, { status: 400 });
  }
  if (typeof leadId !== "string" || !leadId) {
    return Response.json({ error: "Select a Lead before analyzing the costing document." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership || !allowedRoles.has(String(membership.role))) {
    return Response.json({ error: "You are not authorized to analyze costing documents." }, { status: 403 });
  }
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (leadError || !lead) {
    return Response.json({ error: "The selected Lead is not available to your account." }, { status: 403 });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      {
        error: "Document extraction is not configured. You can continue with a blank editable draft.",
        code: "AI_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  let documentContext: { text: string; pageImages: string[] };
  try {
    documentContext = kind === "docx" ? await extractDocxContext(file) : await extractPdfContext(file);
  } catch {
    return Response.json(
      {
        error: "The document could not be read locally. You can continue with a blank editable draft and enter the costing details manually.",
        code: "DOCUMENT_TEXT_UNAVAILABLE",
      },
      { status: 422 },
    );
  }
  if (!documentContext.text && documentContext.pageImages.length === 0) {
    return Response.json(
      {
        error: "No readable text or page image could be extracted from this document. You can continue with a blank editable draft and enter the costing details manually.",
        code: "DOCUMENT_TEXT_UNAVAILABLE",
      },
      { status: 422 },
    );
  }

  const userContent = [
    {
      type: "text",
      text: `${extractionPrompt}\n\nThe local document text extraction follows. Use page markers to populate source_page when they are available.\n\n${documentContext.text || "(No selectable text was found; inspect the rendered page images.)"}\n\nExpected structure:\n${JSON.stringify(extractionSchema)}`,
    },
    ...documentContext.pageImages.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "high" },
    })),
  ];
  const aiResponse = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
      messages: [
        {
          role: "system",
          content: "You extract structured costing inputs. Return valid JSON only, with no markdown fences or commentary. Never calculate or invent values.",
        },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 12000,
    }),
  });

  if (!aiResponse.ok) {
    return Response.json(
      { error: "The AI extraction service could not analyze this document." },
      { status: 502 },
    );
  }
  const body = await aiResponse.json() as Record<string, unknown>;
  const text = responseText(body).trim();
  if (!text) {
    return Response.json({ error: "The AI returned no extractable costing details." }, { status: 502 });
  }
  try {
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return Response.json({ extraction: normalizeExtraction(JSON.parse(jsonText)) });
  } catch {
    return Response.json({ error: "The AI response was not valid costing data." }, { status: 502 });
  }
}
