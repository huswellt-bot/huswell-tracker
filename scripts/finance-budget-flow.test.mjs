import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const mainWorkspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const financePage = readFileSync(join(repoRoot, "app", "finance", "page.tsx"), "utf8");
const financeReportsPage = readFileSync(join(repoRoot, "app", "finance", "reports", "page.tsx"), "utf8");
const accountantPage = readFileSync(join(repoRoot, "app", "accountant", "page.tsx"), "utf8");
const homePage = readFileSync(join(repoRoot, "app", "page.tsx"), "utf8");
const migrationPath = join(repoRoot, "supabase", "232_finance_monthly_budget_account_allocations.sql");
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const followUpMigrationPath = join(repoRoot, "supabase", "233_finance_gm_budget_only_and_legacy_compatibility.sql");
const followUpMigration = existsSync(followUpMigrationPath)
  ? readFileSync(followUpMigrationPath, "utf8")
  : "";

test("the new budget workflow has a server-authoritative monthly allocation migration", () => {
  assert.notEqual(migration, "", "expected the monthly allocation migration to exist");
  assert.match(migration, /create table if not exists public\.finance_budget_periods/);
  assert.match(migration, /create table if not exists public\.finance_budget_grants/);
  assert.match(migration, /create table if not exists public\.finance_account_budget_allocations/);
  assert.match(migration, /create table if not exists public\.finance_account_funding_requests/);
  assert.match(migration, /create or replace function public\.create_finance_budget_grant/);
  assert.match(migration, /create or replace function public\.allocate_finance_account_budget/);
  assert.match(migration, /create or replace function public\.create_finance_account_funding_request/);
  assert.match(migration, /create or replace function public\.review_finance_account_funding_request/);
  assert.match(migration, /p_organization_id uuid default null/);
  assert.match(migration, /create or replace function private\.finance_budget_allocation_guard/);
  assert.match(migration, /create or replace function private\.finance_transaction_submission_guard/);
  assert.match(migration, /v_manual_income_insert_context/);
  assert.match(migration, /Only the controlled Money In submission workflow can create this record/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("create or replace function private.finance_transaction_submission_guard"),
      migration.indexOf("create or replace function private.finance_budget_allocation_guard"),
    ),
    /External Finance cannot choose the payment account/,
  );
  assert.match(migration, /v_budgeted := v_external or new\.budget_period_id is not null/);
  assert.match(migration, /old\.account_budget_allocation_id is not null/);
  assert.match(migration, /old\.budget_period_id is not null/);
  assert.match(migration, /Only the General Manager can add an approved budget/);
  assert.match(migration, /v_amount > v_request\.requested_amount/);
  assert.match(migration, /This account has no available budget/);
  assert.match(migration, /return to the undistributed pool/i);
});

test("Cash Out uses an active account allocation instead of the legacy personal budget pool", () => {
  assert.match(workspace, /list_finance_expense_accounts/);
  assert.match(workspace, /list_finance_funding_request_accounts/);
  assert.match(workspace, /account_budget_allocation_id/);
  assert.match(workspace, /This account has no available budget/);
  assert.doesNotMatch(workspace, /Request a new budget before submitting it/);
});

test("External Finance requests funding for a selected account", () => {
  assert.match(workspace, /Account funding request/);
  assert.match(workspace, /Choose account/);
  assert.match(workspace, /create_finance_account_funding_request/);
  assert.match(workspace, /review_finance_account_funding_request/);
  assert.doesNotMatch(workspace, /create_finance_budget_request/);
});

test("Internal Finance can review an approved amount and allocate it to the requested account", () => {
  assert.match(workspace, /approved_amount/);
  assert.match(workspace, /Approved amount/);
  assert.match(workspace, /review_finance_account_funding_request/);
  assert.match(workspace, /allocate_finance_account_budget/);
  assert.match(workspace, /reallocate_finance_account_budget/);
});

test("budget realtime refresh includes the new monthly allocation tables", () => {
  assert.match(workspace, /finance_budget_periods/);
  assert.match(workspace, /finance_budget_grants/);
  assert.match(workspace, /finance_account_budget_allocations/);
  assert.match(workspace, /finance_account_funding_requests/);
});

test("GM can grant budget but cannot operate Internal Finance allocation decisions", () => {
  assert.match(workspace, /const canManageBudget = role === "internal_finance";/);
  assert.match(workspace, /const canViewBudget = internal \|\| canGrantBudget;/);
  assert.match(workspace, /canGrantBudget &&/);
  assert.match(workspace, /canManageBudget && <button type="button" onClick=\{\(\) => openBudgetAllocation\(\)\}/);
  assert.match(workspace, /canManageBudget && \["pending", "revision_requested"\]\.includes\(status\)/);
  assert.match(migration, /create or replace function private\.finance_is_budget_operator/);
  assert.match(migration, /not private\.finance_is_budget_operator\(v_organization_id\)/);
  assert.match(migration, /not private\.finance_is_budget_operator\(v_request\.organization_id\)/);
  assert.match(followUpMigration, /create or replace function private\.finance_is_internal/);
  assert.match(followUpMigration, /create or replace function private\.finance_is_budget_operator/);
  assert.match(followUpMigration, /create or replace function private\.finance_is_budget_viewer/);
  assert.match(followUpMigration, /internal_finance/);
  assert.doesNotMatch(followUpMigration, /array\['accountant'[^\]]*\]/i);
});

test("finance queue badges use new account funding requests instead of legacy budget requests", () => {
  assert.match(mainWorkspace, /finance_sidebar_queue_counts/);
  assert.match(mainWorkspace, /finance_account_funding_requests/);
  assert.doesNotMatch(mainWorkspace, /finance_budget_requests/);
  assert.match(migration, /create or replace function public\.finance_sidebar_queue_counts/);
  assert.match(migration, /if private\.finance_is_budget_operator\(p_organization_id\) then/);
});

test("GM navigation exposes only the Finance budget view and Accountant has no Finance views", () => {
  assert.match(mainWorkspace, /\{ view: "Finance Budget", icon: FileText \}/);
  const accountantStart = mainWorkspace.indexOf('accountant: [');
  const accountantEnd = mainWorkspace.indexOf('internal_finance:', accountantStart);
  assert.ok(accountantStart >= 0 && accountantEnd > accountantStart);
  assert.doesNotMatch(mainWorkspace.slice(accountantStart, accountantEnd), /Finance/);
  const managementStart = mainWorkspace.indexOf('const navBase');
  const managementEnd = mainWorkspace.indexOf('] : role === "internal_finance" ?', managementStart);
  assert.ok(managementStart >= 0 && managementEnd > managementStart);
  const managementNav = mainWorkspace.slice(managementStart, managementEnd);
  assert.match(managementNav, /\{ view: "Finance Budget", icon: FileText \}/);
  assert.doesNotMatch(managementNav, /Finance Overview|Finance Reports|\{ view: "Finance", icon: Wallet \}|Payment Monitoring/);
});

test("direct Finance routes preserve the same role boundary", () => {
  assert.match(financePage, /super_admin.*owner.*admin.*internal_finance.*external_finance/);
  assert.match(financePage, /\? "Finance Budget"/);
  assert.match(financeReportsPage, /\["internal_finance", "external_finance"\]/);
  assert.doesNotMatch(financeReportsPage, /super_admin|owner|admin|accountant/);
  assert.match(accountantPage, /access\.role !== "accountant"/);
  assert.match(accountantPage, /initialView="Announcements"/);
  assert.doesNotMatch(homePage, /\["accountant", "internal_finance", "external_finance"\]\.includes\(role\)\) redirect\("\/finance"\)/);
});

test("GM does not load operational Finance data", () => {
  assert.match(workspace, /const budgetOnly = isGeneralManagerRole\(role\);/);
  assert.match(workspace, /budgetOnly\s*\?\s*emptyFinanceRequest\(\)\s*:\s*client\.from\("finance_transactions"\)/);
  assert.match(workspace, /const canViewBudget = internal \|\| canGrantBudget;/);
  assert.match(workspace, /budgetOnly\s*\|\|\s*internal\s*\?\s*emptyFinanceRequest\(\)\s*:\s*client\.rpc\("list_finance_expense_accounts"/);
});

test("follow-up Finance migration preserves legacy rows and serializes reallocations", () => {
  assert.notEqual(followUpMigration, "", "expected the follow-up Finance migration to exist");
  assert.match(followUpMigration, /old\.budget_request_id is not null/);
  assert.match(followUpMigration, /return new;/);
  const reallocationStart = followUpMigration.indexOf("create or replace function public.reallocate_finance_account_budget");
  assert.ok(reallocationStart >= 0);
  const reallocation = followUpMigration.slice(reallocationStart);
  const periodLock = reallocation.search(/finance_budget_periods[\s\S]{0,80}for update/);
  const sourceLock = reallocation.search(/finance_account_budget_allocations[\s\S]{0,100}for update/);
  assert.ok(periodLock >= 0 && sourceLock > periodLock);
});

test("follow-up Finance migration closes older management role leaks", () => {
  const directCostStart = followUpMigration.indexOf("create or replace function public.finance_quotation_direct_cost_rows");
  const projectExpenseStart = followUpMigration.indexOf("create or replace function public.finance_project_expense_rows");
  const paymentReviewStart = followUpMigration.indexOf("create or replace function public.review_quotation_payment");
  const paymentReverseStart = followUpMigration.indexOf("create or replace function public.reverse_quotation_payment");
  assert.ok(directCostStart >= 0 && projectExpenseStart > directCostStart && paymentReviewStart > projectExpenseStart && paymentReverseStart > paymentReviewStart);

  const directCost = followUpMigration.slice(directCostStart, projectExpenseStart);
  const projectExpense = followUpMigration.slice(projectExpenseStart, paymentReviewStart);
  const paymentReview = followUpMigration.slice(paymentReviewStart, paymentReverseStart);
  const paymentReverse = followUpMigration.slice(paymentReverseStart, followUpMigration.indexOf("-- External categories", paymentReverseStart));

  assert.match(directCost, /private\.finance_is_internal\(p_organization_id\)/);
  assert.match(projectExpense, /private\.finance_is_external_or_internal\(p_organization_id\)/);
  assert.match(paymentReview, /private\.finance_is_internal\(v_payment\.organization_id\)/);
  assert.match(paymentReverse, /private\.finance_is_internal\(v_payment\.organization_id\)/);
  assert.doesNotMatch(paymentReview, /super_admin|owner|admin|accountant/);
  assert.doesNotMatch(paymentReverse, /super_admin|owner|admin|accountant/);
  assert.doesNotMatch(mainWorkspace, /canReviewAsManager/);
});
