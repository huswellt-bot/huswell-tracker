import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Finance realtime and query hardening migration is present", async () => {
  const migration = await read("supabase/migrations/20261028043509_finance_realtime_and_query_indexes.sql");
  for (const table of [
    "finance_transactions",
    "finance_accounts",
    "finance_budget_periods",
    "finance_account_funding_requests",
    "commission_summary_allocations",
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /create index if not exists finance_transactions_org_date_idx/);
  assert.match(migration, /create index if not exists quotations_org_created_idx/);
});

test("runtime hardening avoids unauthenticated sidebar retries and portable PDF defaults", async () => {
  const workspace = await read("components/huswell-workspace.tsx");
  const pdfRoute = await read("app/api/quotation-pdf/route.ts");
  assert.match(workspace, /if \(!currentUserLoaded \|\| !currentUserId\)/);
  assert.match(workspace, /error as typeof error & \{ status\?: number \}/);
  assert.match(pdfRoute, /process\.platform === "win32"/);
  assert.match(pdfRoute, /turbopackIgnore: true/);
});

test("Excel import and backup paths no longer use the vulnerable xlsx package", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const leadRoute = await read("app/api/leads/import/route.ts");
  const backupRoute = await read("app/api/backups/export/route.ts");
  assert.equal(packageJson.dependencies.xlsx, undefined);
  assert.match(leadRoute, /from "exceljs"/);
  assert.match(backupRoute, /from "exceljs"/);
});
