import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const mainWorkspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const revisedWorkspace = readFileSync(join(repoRoot, "components", "finance-revised-workspace.tsx"), "utf8");
const migration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261028125014_finance_activity_history_and_returns.sql"),
  "utf8",
).toLowerCase();
const cutoffMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261028131007_finance_activity_history_cutoff.sql"),
  "utf8",
).toLowerCase();

test("Transactions History is a separate final Finance navigation item for GM and Accounting & Finance", () => {
  assert.match(mainWorkspace, /\| "Finance Transactions History"/);
  assert.match(mainWorkspace, /\{ view: "Finance Transactions History", icon: ClipboardList \}/);
  assert.match(mainWorkspace, /active === "Finance Transactions History"/);
  const accountingStart = mainWorkspace.indexOf('const accountingFinanceItems');
  const navStart = mainWorkspace.indexOf('const navBase', accountingStart);
  assert.ok(accountingStart >= 0 && navStart > accountingStart);
  assert.match(mainWorkspace.slice(accountingStart, navStart), /Finance Transactions History/);
});

test("Transactions History uses one unified revised Finance table", () => {
  assert.match(revisedWorkspace, /const historyRows = useMemo<FinanceHistoryRow\[\]>/);
  assert.match(revisedWorkspace, /finance_revised_transaction_feed/);
  assert.match(revisedWorkspace, /finance_revised_working_fund_request_feed/);
  assert.match(revisedWorkspace, /finance_revised_daily_fund_request_feed/);
  assert.match(revisedWorkspace, /function TransactionsHistoryTable/);
  assert.match(revisedWorkspace, /<div className="table-shell overflow-x-auto">/);
  assert.match(revisedWorkspace, /finance activit\{rows\.length === 1 \? "y" : "ies"\} shown/);
  assert.match(revisedWorkspace, /<table className="app-table w-full min-w-\[1240px\] text-left text-\[11px\]" aria-label="Finance money movement history">/);
  assert.match(revisedWorkspace, /Date &amp; time.*Description.*From.*To.*Amount/);
  assert.doesNotMatch(revisedWorkspace, /Project \/ Client \/ Company.*Amount.*Status.*Actors/);
  assert.match(revisedWorkspace, /historyTransactionMovement/);
});

test("Capital Funds activity stays in the concise funds table", () => {
  assert.match(revisedWorkspace, /<Panel title=\{activityTitle\}/);
  assert.match(revisedWorkspace, /Capital Funds activity/);
  assert.doesNotMatch(revisedWorkspace, /function CapitalFundDetailsModal/);
  assert.match(revisedWorkspace, /Remove Capital Funds/);
});

test("legacy activity history migration keeps server-side role authorization", () => {
  assert.match(migration, /create or replace function public\.get_finance_activity_history/);
  assert.match(migration, /activity_at timestamptz/);
  assert.match(migration, /source_account text/);
  assert.match(migration, /destination_account text/);
  assert.match(migration, /not private\.finance_is_budget_viewer\(p_organization_id\)/);
  assert.match(migration, /grant execute on function public\.get_finance_activity_history\(uuid\) to authenticated/);
  assert.match(cutoffMigration, /finance_activity_history_started_at/);
  assert.match(cutoffMigration, /grant_row\.granted_at >= v_started_at/);
  assert.match(cutoffMigration, /event\.created_at >= v_started_at/);
  assert.match(cutoffMigration, /log\.created_at >= v_started_at/);
});

test("return-to-pool preserves allocation history and prevents returning used budget", () => {
  assert.match(migration, /create or replace function public\.return_finance_account_budget/);
  assert.match(migration, /return_to_pool/);
  assert.match(migration, /returned_amount = coalesce\(returned_amount, 0\) \+ v_amount/);
  assert.match(migration, /v_allocation\.allocated_amount\s*-\s*coalesce\(v_allocation\.returned_amount, 0\)\s*-\s*v_consumed/);
  assert.match(migration, /only % of unused and uncommitted budget can be returned/);
  assert.match(workspace, /return_finance_account_budget/);
  assert.match(workspace, /Return to pool/);
  assert.match(workspace, /<th>Status<\/th>/);
  assert.match(workspace, /Returned to pool/);
  assert.match(workspace, /Partially returned/);
  assert.doesNotMatch(workspace, /Explain why.*return|Return reason/i);
});

test("budget summaries, allocation, reallocation, and expense guards use net allocation after returns", () => {
  assert.match(migration, /sum\(allocated_amount - coalesce\(returned_amount, 0\)\)/);
  assert.match(migration, /allocation\.allocated_amount\s*-\s*coalesce\(allocation\.returned_amount, 0\)/);
  assert.match(migration, /v_source\.allocated_amount\s*-\s*coalesce\(v_source\.returned_amount, 0\)/);
  assert.match(migration, /v_available := round\(/);
  assert.match(migration, /shared_kpi_finance_dashboard_legacy/);
  assert.match(migration, /budget_allocated/);
  assert.match(migration, /available_cash/);
});
