import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32_000;
const CHATBOT_SOURCE = "chatbot";

type ChatbotLeadPayload = {
  leadId?: unknown;
  capturedAt?: unknown;
  fields?: unknown;
  fieldTypes?: unknown;
};

type LeadFields = Record<string, string>;
type LeadFieldTypes = Record<string, string>;

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status });

function hasValidSecret(request: Request, secret: string) {
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();

  if (!provided) return false;

  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function toStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entries = Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" ? [[key, item.trim()] as const] : [],
  );
  return Object.fromEntries(entries);
}

function findField(
  fields: LeadFields,
  types: LeadFieldTypes,
  fieldType: string,
  labels: string[],
) {
  const typedEntry = Object.entries(types).find(
    ([label, type]) => type.toLowerCase() === fieldType && fields[label],
  );
  if (typedEntry) return fields[typedEntry[0]];

  const labelSet = new Set(labels.map((label) => label.toLowerCase()));
  const labeledEntry = Object.entries(fields).find(([label, value]) =>
    labelSet.has(label.trim().toLowerCase()) && Boolean(value),
  );
  return labeledEntry?.[1] ?? "";
}

function validCapturedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.CHATBOT_LEAD_WEBHOOK_SECRET?.trim();
  const organizationId = process.env.CHATBOT_LEAD_ORGANIZATION_ID?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!webhookSecret || !organizationId || !serviceRoleKey) {
    return json({ error: "Chatbot lead intake is not configured." }, 503);
  }
  if (!hasValidSecret(request, webhookSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "Payload is too large." }, 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return json({ error: "Payload is too large." }, 413);
  }

  const payload = (() => {
    try {
      return JSON.parse(rawBody) as ChatbotLeadPayload;
    } catch {
      return null;
    }
  })();
  const externalLeadId =
    typeof payload?.leadId === "string" ? payload.leadId.trim() : "";
  const fields = toStringRecord(payload?.fields);
  const fieldTypes = toStringRecord(payload?.fieldTypes) ?? {};

  if (!externalLeadId || externalLeadId.length > 160 || !fields) {
    return json({ error: "Invalid lead payload." }, 400);
  }

  const contactName = findField(fields, fieldTypes, "name", [
    "full name",
    "name",
    "client name",
    "contact name",
  ]).slice(0, 200);
  const email = findField(fields, fieldTypes, "email", ["email", "email address"])
    .toLowerCase()
    .slice(0, 320);
  const phone = findField(fields, fieldTypes, "phone", [
    "phone",
    "phone number",
    "contact number",
    "viber",
  ]).slice(0, 80);
  const clientName = findField(fields, fieldTypes, "text", [
    "company",
    "company name",
    "business name",
  ]).slice(0, 200);

  if (!contactName || (email && !/^\S+@\S+\.\S+$/.test(email))) {
    return json({ error: "A contact name and, if supplied, a valid email are required." }, 400);
  }

  const capturedAt = validCapturedAt(payload?.capturedAt);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: existing, error: existingError } = await admin
    .from("leads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_source", CHATBOT_SOURCE)
    .eq("external_lead_id", externalLeadId)
    .maybeSingle();
  if (existingError) return json({ error: "Could not check the lead." }, 500);
  if (existing) return json({ ok: true, duplicate: true, leadId: existing.id }, 200);

  const dateSent = (capturedAt ?? new Date()).toISOString().slice(0, 10);
  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      organization_id: organizationId,
      lead_source: CHATBOT_SOURCE,
      external_lead_id: externalLeadId,
      source_captured_at: capturedAt?.toISOString() ?? null,
      contact_name: contactName,
      client_name: clientName || null,
      email: email || null,
      phone: phone || null,
      project_name: clientName || contactName,
      contact_method: "Messenger",
      date_sent: dateSent,
      evaluation_number: 1,
    })
    .select("id, lead_no")
    .single();

  if (error?.code === "23505") {
    const { data: duplicate } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("lead_source", CHATBOT_SOURCE)
      .eq("external_lead_id", externalLeadId)
      .maybeSingle();
    if (duplicate) return json({ ok: true, duplicate: true, leadId: duplicate.id }, 200);
  }
  if (error || !lead) return json({ error: "Could not save the lead." }, 500);

  return json({ ok: true, duplicate: false, leadId: lead.id, leadNo: lead.lead_no }, 201);
}
