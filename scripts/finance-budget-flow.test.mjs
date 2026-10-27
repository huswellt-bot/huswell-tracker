import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const mainWorkspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const superAdminConsole = readFileSync(join(repoRoot, "components", "super-admin-console.tsx"), "utf8");
const superAdminUsersRoute = readFileSync(join(repoRoot, "app", "api", "super-admin", "users", "route.ts"), "utf8");
const roleLabels = readFileSync(join(repoRoot, "lib", "role-labels.ts"), "utf8");
const workspaceAccess = readFileSync(join(repoRoot, "lib", "supabase", "workspace-access.ts"), "utf8");
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
const gmBudgetOperatorMigrationPath = join(repoRoot, "supabase", "migrations", "20261027072401_gm_budget_operator_admin.sql");
const gmBudgetOperatorMigration = existsSync(gmBudgetOperatorMigrationPath)
  ? readFileSync(gmBudgetOperatorMigrationPath, "utf8")
  : "";
const metadataMigrationPath = join(repoRoot, "supabase", "234_finance_accounts_metadata_only.sql");
const metadataMigration = existsSync(metadataMigrationPath)
  ? readFileSync(metadataMigrationPath, "utf8")
  : "";
const customTypesMigrationPath = join(repoRoot, "supabase", "235_finance_account_custom_types.sql");
const customTypesMigration = existsSync(customTypesMigrationPath)
  ? readFileSync(customTypesMigrationPath, "utf8")
  : "";
const removalMigrationPath = join(repoRoot, "supabase", "236_finance_category_and_account_type_removal.sql");
const removalMigration = existsSync(removalMigrationPath)
  ? readFileSync(removalMigrationPath, "utf8")
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

test("budget view separates account allocations and funding requests into tabs", () => {
  assert.match(workspace, /aria-label="Budget sections"/);
  assert.match(workspace, /budgetSection === "allocations"/);
  assert.match(workspace, /id="finance-budget-allocations"/);
  assert.match(workspace, /id="finance-budget-requests"/);
});

test("Accounts page uses GM budget allocation instead of direct account funding", () => {
  assert.doesNotMatch(workspace, /Add funds to account/);
  assert.doesNotMatch(workspace, /> Add funds</);
  assert.doesNotMatch(workspace, /client\.rpc\("create_finance_account_funding",/);
  assert.match(workspace, /New spending capacity comes from GM-approved budget allocation/);
});

test("new accounts are metadata-only and start without opening cash", () => {
  const accountFormStart = workspace.indexOf('title={accountEditing ? "Edit Finance account"');
  const accountFormEnd = workspace.indexOf("{budgetOpen &&", accountFormStart);
  assert.ok(accountFormStart >= 0 && accountFormEnd > accountFormStart);
  const accountForm = workspace.slice(accountFormStart, accountFormEnd);
  assert.doesNotMatch(accountForm, /Account number \/ identifier/);
  assert.doesNotMatch(accountForm, /Opening amount/);
  assert.doesNotMatch(accountForm, /Receipt image/);
  assert.doesNotMatch(accountForm, /View account receipt/);
  assert.match(workspace, /p_account_number: null/);
  assert.match(workspace, /p_opening_balance: 0/);
  assert.match(workspace, /p_receipt_storage_path: null/);
});

test("the account card does not present legacy opening fields as current setup", () => {
  const accountsCardStart = workspace.indexOf('title="Bank and e-wallet accounts"');
  const accountsCardEnd = workspace.indexOf('{tab === "budget"', accountsCardStart);
  const accountsCard = workspace.slice(accountsCardStart, accountsCardEnd);
  assert.doesNotMatch(accountsCard, /Opening balance:/);
  assert.doesNotMatch(accountsCard, />View receipt</);
  assert.doesNotMatch(accountsCard, /Historical account funding/);
  assert.doesNotMatch(accountsCard, /Payments:/);
  assert.match(accountsCard, /Available cash/);
});

test("the account creation RPC enforces metadata-only accounts server-side", () => {
  assert.notEqual(metadataMigration, "", "expected the metadata-only account migration to exist");
  assert.match(metadataMigration, /create or replace function public\.create_finance_account_with_mapping/);
  assert.match(metadataMigration, /insert into public\.finance_accounts/);
  assert.match(metadataMigration, /null, 0, v_payment_method/);
  assert.match(metadataMigration, /use GM budget allocation for spending capacity/);
  assert.doesNotMatch(metadataMigration, /Upload the account receipt image/);
});

test("Other opens a reusable custom account type modal", () => {
  assert.match(workspace, /accountTypeCreateOpen/);
  assert.match(workspace, /create_finance_account_type/);
  assert.match(workspace, /label: "Add new"/);
  assert.match(workspace, /custom:\$\{String\(type\.id\)\}/);
  assert.match(workspace, /p_custom_account_type_id/);
});

test("custom account types are organization-scoped and server-validated", () => {
  assert.notEqual(customTypesMigration, "", "expected the custom account type migration to exist");
  assert.match(customTypesMigration, /create table if not exists public\.finance_account_types/);
  assert.match(customTypesMigration, /finance_account_types_active_name_idx/);
  assert.match(customTypesMigration, /create or replace function public\.create_finance_account_type/);
  assert.match(customTypesMigration, /Only Internal Finance can create account types/);
  assert.match(customTypesMigration, /custom_account_type_id/);
  assert.match(customTypesMigration, /organization_id = v_organization_id/);
  assert.match(customTypesMigration, /is_active/);
});

test("custom categories and account types use icon removal actions", () => {
  assert.match(workspace, /Delete or archive .* category/);
  assert.match(workspace, /Delete or archive .* account type/);
  assert.match(workspace, /remove_finance_category/);
  assert.match(workspace, /remove_finance_account_type/);
  assert.match(workspace, /Items already used by transactions or accounts are archived/);
});

test("removal RPCs delete unused items and archive referenced items", () => {
  assert.notEqual(removalMigration, "", "expected the safe removal migration to exist");
  assert.match(removalMigration, /create or replace function public\.remove_finance_category/);
  assert.match(removalMigration, /create or replace function public\.remove_finance_account_type/);
  assert.match(removalMigration, /from public\.finance_transactions where category_id = v_category\.id/);
  assert.match(removalMigration, /from public\.finance_accounts where custom_account_type_id = v_type\.id/);
  assert.match(removalMigration, /return 'archived'/);
  assert.match(removalMigration, /return 'deleted'/);
});

test("budget realtime refresh includes the new monthly allocation tables", () => {
  assert.match(workspace, /finance_budget_periods/);
  assert.match(workspace, /finance_budget_grants/);
  assert.match(workspace, /finance_account_budget_allocations/);
  assert.match(workspace, /finance_account_funding_requests/);
});

test("the GM role automatically receives operational Finance access", () => {
  assert.match(workspace, /const canManageBudget = role === "internal_finance";/);
  assert.match(workspace, /const canViewBudget = internal \|\| canGrantBudget;/);
  assert.match(workspace, /const canGrantBudget = budgetOnly \|\| gmBudgetAccess;/);
  assert.match(mainWorkspace, /const financeRole = hasInternalFinanceAccess\s*\? "internal_finance"\s*:\s*role;/);
  assert.match(workspaceAccess, /membership\.role === "admin"\s*\|\|/);
  assert.match(superAdminUsersRoute, /member\.role === "admin"\s*\|\|/);
  assert.match(superAdminConsole, /Enable Finance operations/);
  assert.match(superAdminConsole, /role === "sales_pricing_officer"/);
  assert.match(superAdminUsersRoute, /role === "sales_pricing_officer"/);
  assert.match(roleLabels, /role === "admin" && internalFinanceEnabled/);
  const automaticMigrationPath = join(repoRoot, "supabase", "254_gm_finance_operations_automatic.sql");
  const automaticMigration = readFileSync(automaticMigrationPath, "utf8");
  assert.match(automaticMigration, /array\['admin', 'internal_finance'\]/);
  assert.match(automaticMigration, /private\.has_member_capability\(p_organization_id, 'internal_finance'\)/);
  assert.match(workspace, /const openBudgetAllocation =/);
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

test("GM budget actions use the navbar and the budget label", () => {
  assert.match(mainWorkspace, /active === "Finance Budget" && isManagementRole/);
  assert.match(mainWorkspace, /setFinanceBudgetActionRequest\("grant"\)/);
  assert.match(mainWorkspace, /setFinanceBudgetActionRequest\("allocate"\)/);
  assert.match(mainWorkspace, /className="button-danger min-h-7 px-3 text-\[12px\]"/);
  assert.match(workspace, /budgetAction\?: "grant" \| "allocate" \| null/);
  assert.doesNotMatch(workspace, /Add top-up|GM budget top-up|GM budget approval or top-up/);
});

test("full Finance GM access preserves GM budget top-ups", () => {
  assert.match(workspace, /gmBudgetAccess\?: boolean/);
  assert.match(workspace, /const canGrantBudget = budgetOnly \|\| gmBudgetAccess/);
  assert.match(mainWorkspace, /gmBudgetAccess=\{isManagementRole && hasInternalFinanceAccess\}/);
  assert.match(gmBudgetOperatorMigration, /array\['admin', 'internal_finance'\]/);
});

test("GM navigation keeps Budget-only by default and exposes full Finance with the capability", () => {
  assert.match(mainWorkspace, /\{ view: "Finance Budget", icon: FileText \}/);
  const accountantStart = mainWorkspace.indexOf('accountant: [');
  const accountantEnd = mainWorkspace.indexOf('internal_finance:', accountantStart);
  assert.ok(accountantStart >= 0 && accountantEnd > accountantStart);
  assert.doesNotMatch(mainWorkspace.slice(accountantStart, accountantEnd), /Finance/);
  const managementStart = mainWorkspace.indexOf('const navBase');
  const managementEnd = mainWorkspace.indexOf('] : role === "internal_finance" ?', managementStart);
  assert.ok(managementStart >= 0 && managementEnd > managementStart);
  const managementNav = mainWorkspace.slice(managementStart, managementEnd);
  assert.match(managementNav, /label: "Finance"/);
  assert.match(managementNav, /label: "Business"/);
  assert.doesNotMatch(managementNav, /label: "Business"[\s\S]*\.\.\.managementFinanceItems/);
  const managementFinanceStart = mainWorkspace.indexOf('const managementFinanceItems');
  const managementFinanceEnd = mainWorkspace.indexOf('const navBase', managementFinanceStart);
  assert.ok(managementFinanceStart >= 0 && managementFinanceEnd > managementFinanceStart);
  assert.doesNotMatch(mainWorkspace.slice(managementFinanceStart, managementFinanceEnd), /Finance Overview|Finance Reports/);
  assert.match(mainWorkspace, /hasInternalFinanceAccess/);
  assert.match(mainWorkspace, /Finance Overview/);
  assert.match(mainWorkspace, /Finance Approvals/);
  assert.match(mainWorkspace, /Finance Accounts/);
  assert.match(mainWorkspace, /Finance Transactions/);
  assert.match(mainWorkspace, /financeMenuOpen/);
  assert.match(mainWorkspace, /management-finance-sidebar-items/);
  assert.match(mainWorkspace, /aria-expanded=\{financeMenuOpen\}/);
});

test("direct Finance routes preserve the same role boundary", () => {
  assert.match(financePage, /super_admin[\s\S]*owner[\s\S]*admin[\s\S]*internal_finance[\s\S]*external_finance/);
  assert.match(financePage, /\? "Finance Budget"/);
  assert.match(financeReportsPage, /\["internal_finance", "external_finance"\]/);
  assert.doesNotMatch(financeReportsPage, /super_admin|owner|admin|accountant/);
  assert.match(accountantPage, /access\.role !== "accountant"/);
  assert.match(accountantPage, /initialView="Announcements"/);
  assert.doesNotMatch(homePage, /\["accountant", "internal_finance", "external_finance"\]\.includes\(role\)\) redirect\("\/finance"\)/);
});

test("a GM without the Finance capability does not load operational Finance data", () => {
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
