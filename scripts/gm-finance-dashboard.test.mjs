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

test("GM dashboard renders the hero cash flow, monthly chart, account balances, and commitments", () => {
  assert.match(workspace, /shared_kpi_finance_dashboard/);
  assert.match(workspace, /aria-label="Net cash flow"/);
  assert.match(workspace, /Monthly money flow/);
  assert.match(workspace, /MonthlyFinanceFlowChart/);
  assert.match(workspace, /Account balances/);
  assert.match(workspace, /Finance commitments/);
  assert.match(workspace, /Supplier payables/);
  assert.match(workspace, /Unpaid commissions/);
  assert.match(workspace, /Budget remaining/);
});

test("GM has a working Monthly report navigation page backed by the finance aggregate", () => {
  assert.match(workspace, /\{ view: "Finance Reports", icon: CalendarDays \}/);
  assert.match(workspace, /GeneralManagerMonthlyFinanceReport/);
  assert.match(workspace, /Monthly breakdown/);
  assert.match(workspace, /Verified and approved Finance totals by month/);
});

test("GM KPI cards keep a shared desktop width for long amounts", () => {
  assert.match(workspace, /overflow-x-auto pb-1/);
  assert.match(workspace, /xl:min-w-\[1040px\] xl:grid-cols-4/);
});
