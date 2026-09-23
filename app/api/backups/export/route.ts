import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 1000;
const MAX_BACKUP_ROWS = 100_000;
const GENERAL_MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

type BackupResource = "leads" | "suppliers";
type BackupRow = Record<string, unknown>;
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const resources: Record<
  BackupResource,
  { sheetName: string; filePrefix: string; preferredColumns: string[] }
> = {
  leads: {
    sheetName: "Leads",
    filePrefix: "leads-backup",
    preferredColumns: [
      "id",
      "organization_id",
      "lead_no",
      "project_name",
      "project_description",
      "client_name",
      "contact_name",
      "address",
      "email",
      "phone",
      "date_sent",
      "date_contacted",
      "contact_method",
      "evaluation_number",
      "done_deal_status",
      "status",
      "notes",
      "outbound_caller",
      "lead_source",
      "external_lead_id",
      "assigned_to",
      "created_by",
      "endorsed_by",
      "endorsed_to",
      "endorsed_at",
      "endorsement_history_locked",
      "lead_import_batch_id",
      "lead_import_row_number",
      "created_at",
      "updated_at",
    ],
  },
  suppliers: {
    sheetName: "Suppliers",
    filePrefix: "suppliers-backup",
    preferredColumns: [
      "id",
      "organization_id",
      "company_name",
      "contact_name",
      "address",
      "email",
      "phone",
      "emails",
      "contact_numbers",
      "project_type",
      "products_services",
      "country",
      "whatsapp",
      "viber",
      "instagram_link",
      "facebook_link",
      "website_link",
      "payment_terms",
      "notes",
      "is_active",
      "created_at",
      "updated_at",
    ],
  },
};

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

const manilaDateStamp = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const safeSpreadsheetText = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const spreadsheetValue = (value: unknown): string | number | boolean => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return safeSpreadsheetText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  const serialized = JSON.stringify(value) ?? "";
  return safeSpreadsheetText(serialized);
};

const columnName = (columnIndex: number) => {
  let index = columnIndex + 1;
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
};

const columnsFor = (resource: BackupResource, rows: BackupRow[]) => {
  const discovered = new Set(rows.flatMap((row) => Object.keys(row)));
  const preferred = resources[resource].preferredColumns.filter((column) =>
    discovered.has(column),
  );
  const remaining = [...discovered]
    .filter((column) => !preferred.includes(column))
    .sort((left, right) => left.localeCompare(right));
  return [...preferred, ...remaining];
};

const fetchAllRows = async (
  client: SupabaseServerClient,
  resource: BackupResource,
  organizationId: string,
) => {
  const countResult = await client
    .from(resource)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (countResult.error) throw countResult.error;

  const expectedCount = countResult.count;
  if (expectedCount !== null && expectedCount > MAX_BACKUP_ROWS) {
    throw new Error("The backup is larger than the supported export size.");
  }

  const rows: BackupRow[] = [];
  let offset = 0;
  while (expectedCount === null || rows.length < expectedCount) {
    const result = await client
      .from(resource)
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw result.error;

    const page = (result.data ?? []) as BackupRow[];
    rows.push(...page);
    if (rows.length > MAX_BACKUP_ROWS) {
      throw new Error("The backup is larger than the supported export size.");
    }
    if (!page.length || page.length < PAGE_SIZE) break;
    offset += page.length;
  }

  if (expectedCount !== null && rows.length !== expectedCount) {
    throw new Error("The records changed while the backup was being created.");
  }
  return rows;
};

const makeWorkbook = (
  resource: BackupResource,
  organizationId: string,
  rows: BackupRow[],
) => {
  const metadata = resources[resource];
  const columns = columnsFor(resource, rows);
  const workbook = XLSX.utils.book_new();
  const generatedAt = new Date().toISOString();
  const infoSheet = XLSX.utils.aoa_to_sheet([
    ["Backup type", "Organization data backup"],
    ["Source table", resource],
    ["Organization ID", organizationId],
    ["Generated at", generatedAt],
    ["Record count", rows.length],
    ["Scope", "All organization records; page filters ignored"],
  ]);
  infoSheet["!cols"] = [{ wch: 24 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(workbook, infoSheet, "Backup Info");

  const sheetRows = rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [column, spreadsheetValue(row[column])]),
    ),
  );
  const dataSheet = XLSX.utils.json_to_sheet(sheetRows, { header: columns });
  dataSheet["!cols"] = columns.map((column) => ({
    wch: Math.min(Math.max(column.length + 2, 14), 36),
  }));
  if (columns.length) {
    dataSheet["!autofilter"] = {
      ref: `A1:${columnName(columns.length - 1)}${rows.length + 1}`,
    };
  }
  XLSX.utils.book_append_sheet(workbook, dataSheet, metadata.sheetName);
  workbook.Props = {
    Title: `${metadata.sheetName} backup`,
    Subject: "Huswell Tracker organization data backup",
    CreatedDate: new Date(),
  };
  return workbook;
};

export async function GET(request: Request) {
  const requestedResource = new URL(request.url).searchParams.get("resource");
  if (requestedResource !== "leads" && requestedResource !== "suppliers") {
    return jsonError("Choose a valid backup resource.", 400);
  }
  const resource = requestedResource as BackupResource;
  const client = await createClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) return jsonError("Authentication is required.", 401);

  const { data: membership, error: membershipError } = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) return jsonError("Unable to verify workspace access.", 500);
  const organizationId = String(membership?.organization_id ?? "");
  const role = String(membership?.role ?? "");
  if (!organizationId || !GENERAL_MANAGER_ROLES.has(role)) {
    return jsonError("General Manager access is required for backups.", 403);
  }

  try {
    const rows = await fetchAllRows(client, resource, organizationId);
    const workbook = makeWorkbook(resource, organizationId, rows);
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const metadata = resources[resource];
    return new Response(new Uint8Array(output), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${metadata.filePrefix}-${manilaDateStamp()}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Backup-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    console.error("Backup export failed", error);
    return jsonError("Unable to create the backup file.", 500);
  }
}
