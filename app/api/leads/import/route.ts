import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import {
  LEAD_HEADERS,
  LEAD_TEMPLATE_COLUMN_WIDTHS,
  MAX_FILE_SIZE,
  MAX_ROWS,
  importRows,
  parseWorkbook,
} from "@/lib/lead-import";
import type { ImportRow } from "@/lib/lead-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Unable to read the Excel file.");
    }

    let parsed: ReturnType<typeof parseWorkbook>;
    try {
      parsed = parseWorkbook(workbook);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Unable to interpret the Excel file.",
        400,
      );
    }

    try {
      const rows = parsed.rows;
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
        sheet_name: parsed.sheetName,
        header_row_number: parsed.headerRowIndex + 1,
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
