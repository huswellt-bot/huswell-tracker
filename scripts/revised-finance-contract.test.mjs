import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = [
  readFileSync(join(root, "supabase", "migrations", "20261111054845_revised_finance_ledger.sql"), "utf8"),
  readFileSync(join(root, "supabase", "migrations", "20261111054855_revised_finance_categories.sql"), "utf8"),
  readFileSync(join(root, "supabase", "migrations", "20261111054858_revised_finance_daily_fund.sql"), "utf8"),
].join("\n");
const roleMigration = readFileSync(join(root, "supabase", "migrations", "20261111054901_unify_accounting_finance_role.sql"), "utf8");
const workspace = readFileSync(join(root, "components", "finance-revised-workspace.tsx"), "utf8");
const host = readFileSync(join(root, "components", "huswell-workspace.tsx"), "utf8");
const userAdmin = readFileSync(join(root, "components", "super-admin-console.tsx"), "utf8");

test("revised Finance uses a separate project-ledger data path", () => {
  assert.match(migration, /create table if not exists public\.finance_revised_transactions/);
  assert.match(migration, /create table if not exists public\.finance_revised_ledger_entries/);
  assert.match(migration, /create table if not exists public\.finance_working_fund_requests/);
  assert.match(migration, /create table if not exists public\.finance_working_fund_request_lines/);
  assert.doesNotMatch(migration, /finance_accounts|account_id/);
  assert.doesNotMatch(migration, /working_fund_opening/);
});

test("revised Finance has database-level isolation and approval guards", () => {
  assert.match(migration, /alter table public\.finance_revised_transactions enable row level security/);
  assert.match(migration, /alter table public\.finance_revised_ledger_entries enable row level security/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /Project balance is not enough/);
  assert.match(migration, /Working Funds balance is not enough/);
  assert.match(migration, /Only completed projects can return Working Funds/);
  assert.match(migration, /finance_revised_client_available_balance/);
  assert.match(migration, /Collected project balance is not enough to make this repayment/);
  assert.match(migration, /Only the GM can approve Finance transactions/);
  assert.match(migration, /Only the GM can review Working Fund requests/);
  assert.match(migration, /Only the GM can reverse a posted Finance transaction/);
  assert.match(migration, /Reversal \/ adjustment/);
  assert.doesNotMatch(migration, /revision_requested/);
});

test("commission payouts use the project ledger and require full client collection", () => {
  assert.match(migration, /commission_payout/);
  assert.match(migration, /commission_allocation_id uuid references public\.commission_summary_allocations/);
  assert.match(migration, /create or replace function public\.list_finance_revised_commission_payables/);
  assert.match(migration, /create or replace function public\.create_finance_revised_commission_payout/);
  assert.match(migration, /finance_revised_client_cash_in/);
  assert.match(migration, /Commission becomes payable after the project is fully collected/);
  assert.match(migration, /Project balance is not enough for this commission payout/);
  assert.match(migration, /Request Working Funds for this project first/);
  assert.match(migration, /Commission payout/);
});

test("revised Finance categories support both directions and safe management", () => {
  assert.match(migration, /finance_revised_transactions[\s\S]*category_id uuid/);
  assert.match(migration, /create or replace function public\.list_finance_revised_categories/);
  assert.match(migration, /create or replace function public\.create_finance_revised_category/);
  assert.match(migration, /create or replace function public\.update_finance_revised_category/);
  assert.match(migration, /create or replace function public\.delete_finance_revised_category/);
  assert.match(migration, /category\.direction = 'income'/);
  assert.match(migration, /category\.direction = 'expense'/);
  assert.match(migration, /return 'archived'/);
});

test("Daily Fund isolates non-project Cash Out from Working Funds", () => {
  assert.match(migration, /create table if not exists public\.finance_daily_fund_requests/);
  assert.match(migration, /create or replace function public\.create_finance_revised_daily_fund_request/);
  assert.match(migration, /create or replace function public\.review_finance_revised_daily_fund_request/);
  assert.match(migration, /create or replace function public\.create_finance_revised_daily_fund_return/);
  assert.match(migration, /create or replace function public\.get_finance_revised_daily_fund_snapshot/);
  assert.match(migration, /'daily_fund_allocation'/);
  assert.match(migration, /'daily_fund_return'/);
  assert.match(migration, /'daily'/);
  assert.match(migration, /Daily Fund balance is not enough for this non-project Cash Out/);
  assert.match(migration, /Unused Daily Fund can be returned to Working Funds/);
  assert.match(migration, /finance_revised_daily_fund_spent/);
  assert.match(migration, /spent_amount/);
  assert.match(migration, /daily_fund_request_id/);
});

test("revised Finance exposes only authenticated RPC entry points", () => {
  for (const functionName of [
    "list_finance_revised_categories",
    "create_finance_revised_category",
    "update_finance_revised_category",
    "delete_finance_revised_category",
    "create_finance_revised_cash_in_with_category",
    "create_finance_revised_cash_out_with_category",
    "create_finance_revised_daily_fund_request",
    "review_finance_revised_daily_fund_request",
    "create_finance_revised_daily_fund_return",
    "get_finance_revised_daily_fund_snapshot",
    "list_finance_revised_commission_payables",
    "create_finance_revised_commission_payout",
    "create_finance_revised_capital_contribution",
    "create_finance_revised_capital_to_working",
    "create_finance_working_fund_request",
    "review_finance_revised_working_fund_request",
    "create_finance_revised_repayment",
    "review_finance_revised_transaction",
    "void_finance_revised_transaction",
    "get_finance_revised_snapshot",
    "list_finance_revised_projects",
    "list_finance_revised_costing_lines",
  ]) {
    assert.match(migration, new RegExp("create or replace function public\\." + functionName));
    assert.match(migration, new RegExp("grant execute on function public\\." + functionName));
  }
  assert.match(migration, /revoke all on function public\.create_finance_revised_cash_in\([^;]+\) from authenticated/);
  assert.match(migration, /revoke all on function public\.create_finance_revised_cash_out\([^;]+\) from authenticated/);
  assert.match(migration, /grant execute on function public\.create_finance_revised_cash_in_with_category\([^;]+\) to authenticated/);
  assert.match(migration, /grant execute on function public\.create_finance_revised_cash_out_with_category\([^;]+\) to authenticated/);
});

test("Finance uses one Accounting & Finance membership role", () => {
  assert.match(roleMigration, /set role = 'accountant'/);
  assert.match(roleMigration, /role in \('internal_finance', 'external_finance'\)/);
  assert.match(userAdmin, /value="accountant">Accounting &amp; Finance/);
  assert.doesNotMatch(userAdmin, /value="internal_finance">Internal Finance/);
  assert.doesNotMatch(userAdmin, /value="external_finance">External Finance/);
});

test("the visible Finance flow is project-ledger based", () => {
  assert.match(workspace, /Accounting &(?:amp;| )Finance/);
  assert.match(workspace, /Capital & Working Funds/);
  assert.match(workspace, /Cash In & Cash Out/);
  assert.match(workspace, /Working Fund Requests/);
  assert.match(workspace, /Project Finance Monitoring/);
  assert.match(workspace, /Open project breakdown/);
  assert.match(workspace, /Project Cash In breakdown/);
  assert.match(workspace, /Project Cash Out breakdown/);
  assert.match(workspace, /Commission Payables/);
  assert.match(workspace, /create_finance_revised_commission_payout/);
  assert.match(workspace, /Request Working Funds/);
  assert.match(workspace, /Generate PDF/);
  assert.match(workspace, /create_finance_revised_cash_in/);
  assert.match(workspace, /create_finance_revised_cash_out/);
  assert.match(workspace, /Manage Finance categories/);
  assert.match(workspace, /create_finance_revised_category/);
  assert.match(workspace, /update_finance_revised_category/);
  assert.match(workspace, /delete_finance_revised_category/);
  assert.match(workspace, /Hover a category to show actions/);
  assert.match(workspace, /Daily Fund/);
  assert.match(workspace, /GM approvals/);
  assert.match(workspace, /Reverse posted transaction/);
  assert.match(workspace, /create_finance_revised_daily_fund_request/);
  assert.match(workspace, /create_finance_revised_daily_fund_return/);
  assert.match(workspace, /Cash on Hand breakdown/);
  assert.match(workspace, /Total Cash on Hand/);
  assert.match(workspace, /submitted_by_name/);
  assert.match(workspace, /Unallocated Working Funds are excluded/);
  assert.doesNotMatch(workspace, /Collected \/ allocated/);
  assert.doesNotMatch(workspace, /Cash Out \/ used/);
  assert.match(host, /Finance Daily Fund/);
  assert.match(host, /Finance Cash on Hand/);
  assert.match(workspace, /create_finance_working_fund_request/);
  assert.match(host, /Finance Funds/);
  assert.match(host, /Finance Commissions/);
  assert.match(host, /FinanceRevisedWorkspace/);
  assert.doesNotMatch(workspace, /finance_account_id|finance_accounts/);
});
