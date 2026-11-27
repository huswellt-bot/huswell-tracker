import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 1000;
const MAX_BACKUP_ROWS = 100_000;
const GENERAL_MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

type BackupResource = "leads" | "suppliers";
type BackupRow = Record<string, unknown>;
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type BackupResourceMetadata = {
  sheetName: string;
  filePrefix: string;
  preferredColumns: string[];
  excludedColumns?: string[];
  orderColumn: string;
  includeInfoSheet: boolean;
};

const resources: Record<
  BackupResource,
  BackupResourceMetadata
> = {
  leads: {
    sheetName: "Leads",
    filePrefix: "leads-backup",
    excludedColumns: ["id", "organization_id"],
    orderColumn: "date_sent",
    includeInfoSheet: false,
    preferredColumns: [
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
    orderColumn: "created_at",
    includeInfoSheet: true,
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
  const metadata = resources[resource];
  const excludedColumns = new Set(metadata.excludedColumns ?? []);
  const discovered = new Set(rows.flatMap((row) => Object.keys(row)));
  const preferred = metadata.preferredColumns.filter(
    (column) => discovered.has(column) && !excludedColumns.has(column),
  );
  const remaining = [...discovered]
    .filter(
      (column) =>
        !excludedColumns.has(column) && !preferred.includes(column),
    )
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
      .order(resources[resource].orderColumn, {
        ascending: true,
        nullsFirst: false,
      })
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

const LEAD_COLUMN_WIDTHS: Record<string, number> = {
  lead_no: 16,
  project_name: 30,
  project_description: 42,
  client_name: 28,
  contact_name: 28,
  address: 38,
  email: 32,
  phone: 20,
  date_sent: 16,
  date_contacted: 18,
  contact_method: 20,
  evaluation_number: 28,
  done_deal_status: 28,
  status: 18,
  notes: 40,
  lead_remark: 40,
  outbound_caller: 24,
  lead_source: 22,
  external_lead_id: 26,
  assigned_to: 38,
  created_by: 38,
  endorsed_by: 38,
  endorsed_to: 38,
  endorsed_at: 22,
  endorsement_history_locked: 24,
  lead_import_batch_id: 38,
  lead_import_row_number: 24,
  created_at: 24,
  updated_at: 24,
};

const styleLeadWorksheet = (
  worksheet: ExcelJS.Worksheet,
  columns: string[],
  rows: BackupRow[],
) => {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.properties.defaultRowHeight = 24;

  columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width =
      LEAD_COLUMN_WIDTHS[column] ?? Math.min(Math.max(column.length + 4, 18), 40);
  });

  const header = worksheet.getRow(1);
  header.height = 30;
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });

  for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.height = 36;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = {
        vertical: "top",
        wrapText: true,
      };
    });
  }
};

const makeWorkbook = (
  resource: BackupResource,
  organizationId: string,
  rows: BackupRow[],
) => {
  const metadata = resources[resource];
  const columns = columnsFor(resource, rows);
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date().toISOString();
  if (metadata.includeInfoSheet) {
    const infoSheet = workbook.addWorksheet("Backup Info");
    infoSheet.addRows([
      ["Backup type", "Organization data backup"],
      ["Source table", resource],
      ["Organization ID", organizationId],
      ["Generated at", generatedAt],
      ["Record count", rows.length],
      ["Scope", "All organization records; page filters ignored"],
    ]);
    infoSheet.getColumn(1).width = 24;
    infoSheet.getColumn(2).width = 72;
  }

  const dataSheet = workbook.addWorksheet(metadata.sheetName);
  dataSheet.addRow(columns);
  rows.forEach((row) => dataSheet.addRow(columns.map((column) => spreadsheetValue(row[column]))));
  columns.forEach((column, index) => {
    dataSheet.getColumn(index + 1).width = Math.min(Math.max(column.length + 2, 14), 36);
  });
  if (columns.length) {
    dataSheet.autoFilter = {
      from: "A1",
      to: `${columnName(columns.length - 1)}${rows.length + 1}`,
    };
  }
  if (resource === "leads") styleLeadWorksheet(dataSheet, columns, rows);
  workbook.creator = "Huswell Tracker";
  workbook.title = `${metadata.sheetName} backup`;
  workbook.subject = "Huswell Tracker organization data backup";
  workbook.created = new Date();
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
    const output = await workbook.xlsx.writeBuffer();
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
