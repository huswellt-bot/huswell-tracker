import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const LEAD_HEADERS = [
  "Date recorded",
  "Contact Person's Fullname",
  "Company Name",
  "Company Address",
  "Email",
  "Contact Number",
  "Date contacted",
  "Outbound method",
  "Lead status",
] as const;
const LEAD_TEMPLATE_COLUMN_WIDTHS = [16, 32, 28, 36, 30, 20, 18, 18, 30];
const CONTACT_METHODS = [
  "Viber",
  "WhatsApp",
  "Messenger",
  "Phone Call",
  "Email",
] as const;
const LEAD_STATUS_LABELS: Record<number, string> = {
  1: "New client",
  2: "Paying / Repeat client",
  3: "Lost client",
  4: "Potential client / Prospect",
  5: "Loyal / Long-term client",
  6: "Inactive / Dormant client",
  8: "Referral client",
  9: "VIP / High-value client",
};

type ImportRow = {
  row_number: number;
  date_sent: string | null;
  contact_name: string;
  client_name: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  date_contacted: string | null;
  contact_method: string | null;
  evaluation_number: number;
};

type PreviewRow = ImportRow & {
  errors: string[];
  status: "ready" | "duplicate" | "invalid";
};

type RpcImportResult = {
  batch_id?: string | null;
  imported_count?: number;
  eligible_count?: number;
  duplicate_count?: number;
  duplicate_rows?: number[];
  invalid_count?: number;
};

const jsonError = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

const compact = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "");

const textCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
};

const nullableText = (value: unknown) => {
  const result = textCell(value);
  return result ? result : null;
};

const dateFromParts = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};

const normalizeDate = (value: unknown) => {
  if (value === null || value === undefined || textCell(value) === "") {
    return { value: null as string | null };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, error: "Invalid date" };
    return {
      value: dateFromParts(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      ),
      error: dateFromParts(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      )
        ? undefined
        : "Invalid date",
    };
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { value: null, error: "Invalid date" };
    const normalized = dateFromParts(parsed.y, parsed.m, parsed.d);
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const raw = textCell(value);
  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (yearFirst) {
    const normalized = dateFromParts(
      Number(yearFirst[1]),
      Number(yearFirst[2]),
      Number(yearFirst[3]),
    );
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const monthFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (monthFirst) {
    const normalized = dateFromParts(
      Number(monthFirst[3]),
      Number(monthFirst[1]),
      Number(monthFirst[2]),
    );
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { value: null, error: "Invalid date" };
  const normalized = dateFromParts(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
  );
  return normalized
    ? { value: normalized }
    : { value: null, error: "Invalid date" };
};

const normalizeContactMethod = (value: unknown) => {
  const raw = compact(value);
  if (!raw) return { value: null as string | null };
  const match = CONTACT_METHODS.find((method) => compact(method) === raw);
  return match
    ? { value: match }
    : { value: null, error: `Unknown outbound method "${textCell(value)}"` };
};

const normalizeStatus = (value: unknown) => {
  const raw = textCell(value);
  if (!raw) return { value: 4 };

  const idCandidate = raw.split("|")[0].trim();
  if (/^\d+$/.test(idCandidate)) {
    const id = Number(idCandidate);
    if (id === 7) return { value: 4, error: "Done Deal rows cannot be imported as Leads" };
    if (LEAD_STATUS_LABELS[id]) return { value: id };
  }

  const match = Object.entries(LEAD_STATUS_LABELS).find(
    ([, label]) => compact(label) === compact(raw),
  );
  if (match) return { value: Number(match[0]) };
  if (compact(raw).includes("donedeal")) {
    return { value: 4, error: "Done Deal rows cannot be imported as Leads" };
  }
  return { value: 4, error: `Unknown lead status "${raw}"` };
};

const headerAliases: Record<string, keyof ImportRow> = {
  daterecorded: "date_sent",
  datesent: "date_sent",
  date: "date_sent",
  contactpersonsfullname: "contact_name",
  contactpersonfullname: "contact_name",
  contactname: "contact_name",
  fullname: "contact_name",
  name: "contact_name",
  companyname: "client_name",
  clientname: "client_name",
  company: "client_name",
  companyaddress: "address",
  address: "address",
  email: "email",
  emailaddress: "email",
  contactnumber: "phone",
  phone: "phone",
  phonenumber: "phone",
  datecontacted: "date_contacted",
  outboundmethod: "contact_method",
  contactmethod: "contact_method",
  leadstatus: "evaluation_number",
  status: "evaluation_number",
};

const getHeaderIndexes = (headerRow: unknown[]) => {
  const indexes = new Map<keyof ImportRow, number>();
  headerRow.forEach((cell, index) => {
    const field = headerAliases[compact(cell)];
    if (field && !indexes.has(field)) indexes.set(field, index);
  });
  return indexes;
};

const parseRows = (sheet: XLSX.WorkSheet) => {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const headerRow = rows[0] ?? [];
  const indexes = getHeaderIndexes(headerRow);
  if (!indexes.has("contact_name")) {
    throw new Error(
      "The Excel file must include a Contact Person's Fullname column. Download the template for the supported columns.",
    );
  }

  const dataRows = rows.slice(1).filter((row) =>
    row.some((cell) => textCell(cell) !== ""),
  );
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`The Excel file may contain at most ${MAX_ROWS} non-empty rows.`);
  }

  const normalized: PreviewRow[] = dataRows.map((row, index) => {
    const cell = (field: keyof ImportRow) =>
      indexes.has(field) ? row[indexes.get(field) ?? -1] : "";
    const errors: string[] = [];
    const contactName = textCell(cell("contact_name"));
    const clientName = nullableText(cell("client_name"));
    const address = nullableText(cell("address"));
    const emailRaw = nullableText(cell("email"));
    const phone = nullableText(cell("phone"));
    const dateSent = normalizeDate(cell("date_sent"));
    const dateContacted = normalizeDate(cell("date_contacted"));
    const contactMethod = normalizeContactMethod(cell("contact_method"));
    const evaluationNumber = normalizeStatus(cell("evaluation_number"));

    if (!contactName) errors.push("Contact Person's Fullname is required");
    if (contactName.length > 255) errors.push("Contact name is too long");
    if (clientName && clientName.length > 1000) errors.push("Company name is too long");
    if (address && address.length > 4000) errors.push("Company address is too long");
    if (emailRaw && !/^\S+@\S+\.\S+$/.test(emailRaw)) {
      errors.push("Email address is invalid");
    }
    if (emailRaw && emailRaw.length > 254) errors.push("Email address is too long");
    if (phone && phone.length > 100) errors.push("Contact number is too long");
    if (dateSent.error) errors.push(`Date recorded: ${dateSent.error.toLowerCase()}`);
    if (dateContacted.error) errors.push(`Date contacted: ${dateContacted.error.toLowerCase()}`);
    if (contactMethod.error) errors.push(contactMethod.error);
    if (evaluationNumber.error) errors.push(evaluationNumber.error);

    return {
      row_number: index + 2,
      date_sent: dateSent.value,
      contact_name: contactName,
      client_name: clientName,
      address,
      email: emailRaw?.toLowerCase() ?? null,
      phone,
      date_contacted: dateContacted.value,
      contact_method: contactMethod.value,
      evaluation_number: evaluationNumber.value,
      errors,
      status: errors.length ? "invalid" : "ready",
    };
  });

  return normalized;
};

const importRows = (rows: PreviewRow[]): ImportRow[] =>
  rows
    .filter((row) => row.status !== "invalid")
    .map((row) => ({
      row_number: row.row_number,
      date_sent: row.date_sent,
      contact_name: row.contact_name,
      client_name: row.client_name,
      address: row.address,
      email: row.email,
      phone: row.phone,
      date_contacted: row.date_contacted,
      contact_method: row.contact_method,
      evaluation_number: row.evaluation_number,
    }));

const getOrganizationId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const runRpc = async (
  organizationId: string,
  fileName: string,
  rows: ImportRow[],
  totalRows: number,
  invalidRows: number,
  dryRun: boolean,
) => {
  const client = await createClient();
  return client.rpc("import_leads_from_excel", {
    p_organization_id: organizationId,
    p_file_name: fileName,
    p_rows: rows,
    p_total_rows: totalRows,
    p_invalid_rows: invalidRows,
    p_dry_run: dryRun,
  });
};

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("template") !== "1") {
    return jsonError("Use ?template=1 to download the lead import template.", 404);
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[...LEAD_HEADERS]]);
  sheet["!cols"] = LEAD_TEMPLATE_COLUMN_WIDTHS.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Leads");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Response(new Uint8Array(output), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="lead-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const organizationId = getOrganizationId(formData.get("organization_id"));
    const file = formData.get("file");
    if (!organizationId) return jsonError("Organization is required.");
    if (!(file instanceof File)) return jsonError("Choose an Excel file to import.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return jsonError("Only .xlsx Excel files are supported.");
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return jsonError("Excel files must be smaller than 5 MB.");
    }

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return jsonError("The Excel file has no worksheet.");
      const rows = parseRows(workbook.Sheets[sheetName]);
      const validRows = importRows(rows);
      const invalidRows = rows.filter((row) => row.status === "invalid").length;
      const { data, error } = await runRpc(
        organizationId,
        file.name,
        validRows,
        rows.length,
        invalidRows,
        true,
      );
      if (error) return jsonError(error.message, 400);

      const result = (data ?? {}) as RpcImportResult;
      const duplicateRows = new Set(result.duplicate_rows ?? []);
      const previewRows = rows.map((row) =>
        row.status === "invalid"
          ? row
          : duplicateRows.has(row.row_number)
            ? { ...row, status: "duplicate" as const }
            : row,
      );
      const readyCount = previewRows.filter((row) => row.status === "ready").length;

      return Response.json({
        file_name: file.name,
        total_rows: rows.length,
        invalid_count: invalidRows,
        duplicate_count: result.duplicate_count ?? duplicateRows.size,
        ready_count: readyCount,
        rows: previewRows,
        valid_rows: validRows,
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Unable to read the Excel file.");
    }
  }

  const body = (await request.json().catch(() => null)) as {
    organization_id?: unknown;
    file_name?: unknown;
    valid_rows?: unknown;
    total_rows?: unknown;
    invalid_count?: unknown;
  } | null;
  const organizationId = getOrganizationId(body?.organization_id);
  const fileName = getOrganizationId(body?.file_name);
  const validRows = Array.isArray(body?.valid_rows) ? body.valid_rows : null;
  const totalRows = body?.total_rows;
  const invalidRows = body?.invalid_count;
  if (!organizationId || !fileName || !validRows) return jsonError("The import confirmation payload is incomplete.");
  if (!fileName.toLowerCase().endsWith(".xlsx")) return jsonError("Only .xlsx Excel files are supported.");
  if (
    validRows.length > MAX_ROWS ||
    typeof totalRows !== "number" ||
    !Number.isInteger(totalRows) ||
    typeof invalidRows !== "number" ||
    !Number.isInteger(invalidRows) ||
    invalidRows < 0 ||
    totalRows < 0
  ) {
    return jsonError("The import confirmation payload is invalid.");
  }

  const { data, error } = await runRpc(
    organizationId,
    fileName,
    validRows as ImportRow[],
    totalRows,
    invalidRows,
    false,
  );
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true, ...(data as RpcImportResult) });
}
