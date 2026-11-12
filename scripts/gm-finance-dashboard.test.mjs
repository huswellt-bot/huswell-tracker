import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261025130255_gm_finance_dashboard_aggregates.sql"),
  "utf8",
);
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);
const revisedMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261112004726_20261112074513_retire_legacy_finance_surface.sql"),
  "utf8",
);

test("GM Finance dashboard aggregate is role-restricted and returns the money-flow payload", () => {
  assert.match(migration, /private\.has_text_role\(/);
  assert.match(migration, /array\['super_admin', 'owner', 'admin'\]/);
  assert.match(migration, /'cash_in'/);
  assert.match(migration, /'cash_out'/);
  assert.match(migration, /'available_cash'/);
  assert.match(migration, /'supplier_payables_open'/);
  assert.match(migration, /'commission_payables_open'/);
  assert.match(migration, /'monthly_cash_flow'/);
  assert.match(migration, /grant execute on function public\.shared_kpi_finance_dashboard/);
});

test("GM Finance dashboard reads the revised project ledger", () => {
  assert.match(revisedMigration, /create or replace function public\.shared_kpi_finance_dashboard/);
  assert.match(revisedMigration, /finance_revised_ledger_entries/);
  assert.match(revisedMigration, /'project', 'daily'/);
  assert.doesNotMatch(revisedMigration, /shared_kpi_finance_dashboard_prod_gate_legacy/);
  assert.doesNotMatch(revisedMigration, /from public\.finance_accounts/);
  assert.doesNotMatch(revisedMigration, /from public\.finance_transactions/);
});

test("GM dashboard renders the cash position and supporting financial metrics", () => {
  assert.match(workspace, /shared_kpi_finance_dashboard/);
  assert.match(workspace, /aria-label="Net Cash Position"/);
  assert.match(workspace, /Cash on Hand/);
  assert.match(workspace, /Expected Collections/);
  assert.match(workspace, /Payables Due/);
});

test("GM dashboard does not expose the Monthly report navigation page", () => {
  const managementNav = workspace.match(/label: "Management",\s*items: \[(.*?)\s*\],\s*\},\s*\{\s*label: "Operations"/s)?.[1] ?? "";
  assert.doesNotMatch(managementNav, /view: "Finance Reports"/);
});

test("GM KPI cards keep a shared desktop width for long amounts", () => {
  assert.match(workspace, /dashboardMetricFontSize/);
  assert.match(workspace, /grid gap-3 sm:grid-cols-3/);
});
