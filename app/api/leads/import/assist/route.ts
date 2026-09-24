import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_FILE_SIZE,
  analyzeWorkbookWithAi,
  importRows,
  parseWorkbookWithAiMapping,
} from "@/lib/lead-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RpcImportResult = {
  duplicate_count?: number;
  duplicate_rows?: number[];
};

const jsonError = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

const getOrganizationId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const allowedImportRoles = new Set([
  "super_admin",
  "owner",
  "admin",
  "project_manager",
  "sales_pricing_officer",
]);

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonError("Choose an Excel file to analyze.");
  }

  const client = await createClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) return jsonError("You must be signed in to analyze Leads.", 401);

  const formData = await request.formData();
  const organizationId = getOrganizationId(formData.get("organization_id"));
  const file = formData.get("file");
  if (!organizationId) return jsonError("Organization is required.");
  if (!(file instanceof File)) return jsonError("Choose an Excel file to analyze.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return jsonError("Only .xlsx Excel files are supported.");
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return jsonError("Excel files must be smaller than 5 MB.");
  }

  const { data: membership, error: membershipError } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) return jsonError("Unable to verify import access.", 500);
  if (!membership || !allowedImportRoles.has(String(membership.role))) {
    return jsonError("You do not have permission to analyze Leads for this organization.", 403);
  }

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
    });
    const mapping = await analyzeWorkbookWithAi(workbook);
    const parsed = parseWorkbookWithAiMapping(workbook, mapping);
    const rows = parsed.rows;
    const validRows = importRows(rows);
    const invalidRows = rows.filter((row) => row.status === "invalid").length;
    const { data, error } = await client.rpc("import_leads_from_excel", {
      p_organization_id: organizationId,
      p_file_name: file.name,
      p_rows: validRows,
      p_total_rows: rows.length,
      p_invalid_rows: invalidRows,
      p_dry_run: true,
    });
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
      sheet_name: parsed.sheetName,
      header_row_number: parsed.headerRowIndex + 1,
      ai_available: true,
      ai_assisted: true,
      ai_mapped_fields: mapping.mappedFields,
      total_rows: rows.length,
      invalid_count: invalidRows,
      duplicate_count: result.duplicate_count ?? duplicateRows.size,
      ready_count: readyCount,
      rows: previewRows,
      valid_rows: validRows,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "AI-assisted detection was not completed.",
    );
  }
}
