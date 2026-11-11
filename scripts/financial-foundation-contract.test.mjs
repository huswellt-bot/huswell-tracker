import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261107100000_financial_foundation.sql", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/finance-foundation-workspace.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/huswell-workspace.tsx", import.meta.url), "utf8");

test("financial foundation schema covers the audited control modules", () => {
  for (const table of [
    "finance_foundation_settings",
    "project_funds",
    "project_fund_entries",
    "company_working_fund_entries",
    "project_company_advances",
    "project_box_maker_rates",
    "labor_accomplishments",
    "labor_payment_runs",
    "labor_payment_items",
    "operating_cost_templates",
    "operating_cost_entries",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
});

test("financial foundation keeps project money and company advances separate", () => {
  assert.match(migration, /source_payment_id uuid unique/);
  assert.match(migration, /source_transaction_id uuid unique/);
  assert.match(migration, /Company Working Fund advance released/);
  assert.match(migration, /advance repayment/);
  assert.match(migration, /Project Fund does not have enough available money/);
  assert.match(migration, /The Project Fund still has an outstanding Company Working Fund advance/);
  assert.match(migration, /with \(security_invoker = true\)/);
});

test("labor workflow is rate-based, accomplishment-verified, and Tuesday/Friday constrained", () => {
  assert.match(migration, /agreed_total_rate numeric/);
  assert.match(migration, /payable_amount numeric.*generated always as/);
  assert.match(migration, /status in \('submitted', 'verified', 'rejected'\)/);
  assert.match(migration, /v_day not in \(2, 5\)/);
  assert.match(migration, /Only an approved labor payment run can be paid/);
  assert.match(workspace, /Individual Box Maker Labor Rates/);
  assert.match(workspace, /Tuesday & Friday payment runs/);
});

test("the revised project-ledger Finance workspace replaces the old foundation shell", () => {
  assert.match(migration, /expected_monthly_amount numeric/);
  assert.match(migration, /v_break_even_sales/);
  assert.match(migration, /v_required_sales/);
  assert.match(workspace, /OperatingCostsPanel/);
  assert.match(workspace, /BreakEvenPanel/);
  assert.match(shell, /Finance Foundation/);
  assert.match(shell, /DynamicFinanceRevisedWorkspace/);
  assert.match(shell, /active === "Finance Foundation"/);
  assert.match(shell, /active === "Finance Foundation"[\s\S]*initialTab="dashboard"/);
});

test("foundation RPCs are not executable by anon or public", () => {
  for (const functionName of [
    "upsert_finance_foundation_settings",
    "get_finance_foundation_snapshot",
    "record_company_working_fund_entry",
    "create_project_fund",
    "request_project_company_advance",
    "record_labor_accomplishment",
    "create_labor_payment_run",
    "record_operating_cost_entry",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}`));
  }
});
