import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const workspaceShell = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const tablePagination = readFileSync(join(repoRoot, "components", "ui", "table-pagination.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");
const paymentRoute = readFileSync(join(repoRoot, "app", "api", "quotation-payments", "submit", "route.ts"), "utf8");
const financeMigration = readFileSync(join(repoRoot, "supabase", "192_finance_module_and_lead_coordinator.sql"), "utf8");
const financeRoleMigrationPath = join(repoRoot, "supabase", "233_finance_gm_budget_only_and_legacy_compatibility.sql");
const financeRoleMigration = existsSync(financeRoleMigrationPath)
  ? readFileSync(financeRoleMigrationPath, "utf8")
  : "";
const transactionTableStart = workspace.indexOf("function TransactionTable(");
const transactionTableEnd = workspace.indexOf("function ProjectHistoryTable(", transactionTableStart);
const transactionTable = workspace.slice(transactionTableStart, transactionTableEnd);
const monthlyReportStart = workspace.indexOf("function MonthlyFinanceReport(");
const monthlyReportEnd = workspace.indexOf("function FinanceSummaryLayout(", monthlyReportStart);
const monthlyReport = workspace.slice(monthlyReportStart, monthlyReportEnd);
const transactionDialogStart = workspace.indexOf("function TransactionDetailDialog(");
const transactionDialogEnd = workspace.indexOf("function ProjectFinanceDialog(", transactionDialogStart);
const transactionDialog = workspace.slice(transactionDialogStart, transactionDialogEnd);
const topHeaderStart = workspaceShell.indexOf('<header className="sticky top-0');
const topHeaderEnd = workspaceShell.indexOf("</header>", topHeaderStart);
const topHeader = workspaceShell.slice(topHeaderStart, topHeaderEnd);
const cashInSourceStart = workspace.indexOf("<legend>Cash In source</legend>");
const cashInSourceEnd = workspace.indexOf("</fieldset>", cashInSourceStart);
const cashInSource = workspace.slice(cashInSourceStart, cashInSourceEnd);
const transactionFormStart = workspace.indexOf("{transactionDirection && (");
const transactionFormEnd = workspace.indexOf("</FinanceDialog>", transactionFormStart);
const transactionForm = workspace.slice(transactionFormStart, transactionFormEnd);
const expenseTypeStart = transactionForm.indexOf("<legend>Expense type</legend>");
const expenseTypeEnd = transactionForm.indexOf("</fieldset>", expenseTypeStart);
const expenseType = transactionForm.slice(expenseTypeStart, expenseTypeEnd);
const categoryManagementStart = workspace.indexOf("const saveCategory = async () =>");
const categoryManagementEnd = workspace.indexOf("const openAccountEditor", categoryManagementStart);
const categoryManagement = workspace.slice(categoryManagementStart, categoryManagementEnd);
const categorySaveEnd = workspace.indexOf("const archiveCategory", categoryManagementStart);
const categorySave = workspace.slice(categoryManagementStart, categorySaveEnd);
const categoryRpcStart = financeMigration.indexOf("create or replace function public.create_finance_category(");
const categoryRpcEnd = financeMigration.indexOf("create or replace function public.archive_finance_category", categoryRpcStart);
const categoryRpc = financeMigration.slice(categoryRpcStart, categoryRpcEnd);

test("External Finance history keeps only necessary columns and uses quotation as the payment reference", () => {
  assert.match(transactionTable, /\{internal && <th>Budget<\/th>\}/);
  assert.match(transactionTable, /\{internal && <th>Note<\/th>\}/);
  assert.match(transactionTable, /internal \? \(allowActions \? "min-w-\[1320px\]"/);
  assert.match(transactionTable, /transactionReference\(transaction, quotationName\)/);
  assert.match(transactionTable, /8 \+ \(internal \? 2 : 0\) \+ \(allowActions \? 2 : 0\)/);
});

test("quotation payment notes remain optional and are shown only from the real payment record", () => {
  assert.match(workspace, /Note \(optional\)/);
  assert.match(workspace, /form\.set\("notes", transactionValues\.note\.trim\(\)\)/);
  assert.match(workspace, /note: revision \? stringValue\(revision, "notes"\) : ""/);
  assert.match(transactionDialog, /stringValue\(payment, "notes"/);
});

test("quotation payment note input has a server-side length limit", () => {
  assert.match(paymentRoute, /MAX_NOTES_LENGTH = 1000/);
  assert.match(paymentRoute, /notes\.length > MAX_NOTES_LENGTH/);
});

test("External Finance actions are labeled and placed in the top navbar", () => {
  assert.match(topHeader, /active === "Finance Transactions" && role === "external_finance"/);
  assert.match(topHeader, /<span className="hidden sm:inline">Cash In<\/span>/);
  assert.match(topHeader, /<span className="hidden sm:inline">Cash Out<\/span>/);
  assert.doesNotMatch(transactionTable, /Record Cash In|Submit Cash Out/);
});

test("top navbar actions request the existing Finance form", () => {
  assert.match(workspaceShell, /financeActionRequest/);
  assert.match(workspaceShell, /openAction=\{financeActionRequest\}/);
  assert.match(workspace, /openAction\?: Direction \| null/);
  assert.match(workspace, /setFormDirection\(openAction\)/);
});

test("the quotation payment toggle is labeled Project payment", () => {
  assert.match(cashInSource, />Project payment<\/button>/);
  assert.doesNotMatch(cashInSource, />Quotation payment<\/button>/);
});

test("Cash Out shows the account budget guidance at the top of the modal", () => {
  const budgetIndex = transactionForm.indexOf("<span>Account budget</span>");
  const expenseTypeIndex = transactionForm.indexOf("<legend>Expense type</legend>");

  assert.notEqual(budgetIndex, -1);
  assert.ok(expenseTypeIndex > budgetIndex);
});

test("the non-project Cash Out toggle uses its user-facing label", () => {
  assert.match(expenseType, />Non-Project Expense<\/button>/);
  assert.doesNotMatch(expenseType, />Regular expense<\/button>/);
});

test("Finance can open category creation from the dropdown without inline category controls", () => {
  assert.match(workspace, /const canCreateCategory = internal \|\| role === "external_finance";/);
  assert.match(categoryManagement, /if \(!canCreateCategory\) return setErrorMessage\("Only Internal or External Finance can manage finance categories\."\);/);
  assert.match(workspace, /const addCategoryOptionValue = "__add_finance_category__";/);
  assert.match(workspace, /label: "Add new"/);
  assert.match(workspace, /if \(value === addCategoryOptionValue\)/);
  assert.match(workspace, /setCategoryCreateOpen\(true\)/);
  assert.doesNotMatch(transactionForm, /Add a custom \{transactionDirection\} category/);
});

test("adding a category keeps the dialogs open and selects the new category", () => {
  assert.match(categorySave, /const \{ data, error \} = await client\.rpc\("create_finance_category"/);
  assert.match(categorySave, /setCategoryDraft\(\(current\) => \(\{ \.\.\.current, name: "" \}\)\)/);
  assert.match(categorySave, /setCategoryCreateMessage\("Category added\. You can add another\."\)/);
  assert.match(categorySave, /setTransactionValues\(\(current\) => \(\{ \.\.\.current, category_id: String\(data\) \}\)\)/);
  assert.doesNotMatch(categorySave, /setCategoryCreateOpen\(false\)/);
  assert.match(workspace, /title=\{transactionDirection === "income" \? "Add income category" : "Add expense category"\}/);
  assert.match(workspace, /layer="top"/);
  assert.match(workspace, />Done<\/button>/);
});

test("category creation remains server-authorized for Finance roles", () => {
  assert.match(categoryRpc, /private\.finance_is_external_or_internal\(v_organization_id\)/);
  assert.match(categoryRpc, /p_expense_class not in \('operating', 'non_operating'\)/);
  assert.match(financeRoleMigration, /create or replace function private\.finance_category_role_guard/);
  assert.match(financeRoleMigration, /finance_is_external_or_internal\(new\.organization_id\)/);
  assert.match(financeRoleMigration, /Only Internal or External Finance can create finance categories/);
  assert.match(financeRoleMigration, /Only Internal Finance can update finance categories/);
});

test("Internal and External Finance expose their sections in the main sidebar", () => {
  assert.match(workspaceShell, /"Finance Approvals"/);
  assert.match(workspaceShell, /"Finance Transactions"/);
  assert.match(workspaceShell, /"Finance Accounts"/);
  assert.match(workspaceShell, /"Finance Budget"/);
  assert.match(workspaceShell, /"Finance Supplier Costing"/);
  assert.match(workspaceShell, /"Finance Payables"/);
  assert.match(workspaceShell, /view: "Finance Reports", icon: CalendarDays/);
  assert.match(workspaceShell, /view === "Finance Reports"[\s\S]{0,120}"Monthly report"/);
  assert.match(workspaceShell, /view === "Finance Transactions" && role === "external_finance"[\s\S]{0,100}"Transaction"/);
  assert.match(workspaceShell, /view === "Finance Transactions" && hasInternalFinanceAccess[\s\S]{0,120}"Transaction history"/);
  assert.match(workspaceShell, /active === "Finance Transactions"/);
  assert.match(workspaceShell, /initialTab="transactions"/);
});

test("sidebar Finance sections do not render the old top-level tab bar", () => {
  assert.match(workspace, /initialTab\?: Tab/);
  assert.match(workspace, /initialTab \?\? \(budgetOnly \? "budget" : reportOnly/);
  assert.match(workspace, /!overviewOnly && !reportOnly && !initialTab/);
  assert.doesNotMatch(workspace, /href="\/finance\/reports"[\s\S]{0,160}>[\s\S]*Monthly report/);
});

test("Finance uses Project terminology without changing technical quotation identifiers", () => {
  assert.match(workspace, /label: "Project payments"/);
  assert.match(workspace, /<TransactionDetailField label="Project">/);
  assert.match(workspace, /<TransactionDetailField label="Project total">/);
  assert.match(workspace, /<th>Project<\/th><th>Project<\/th>/);
  assert.match(workspace, /quotation_id/);
  assert.match(workspaceShell, /Approved projects/);
  assert.match(workspaceShell, /Project Payment History/);
  assert.doesNotMatch(workspaceShell, /title: isInternalFinanceRole\(role\) \? "Approved quotations"/);
});

test("External Finance Cash In uses the semantic green action", () => {
  assert.match(topHeader, /active === "Finance Transactions" && role === "external_finance"/);
  assert.match(topHeader, /<Button compact tone="green"/);
  assert.match(topHeader, /<span className="hidden sm:inline">Cash Out<\/span>/);
});

test("all shared tables use 50-row pages and centered body values", () => {
  assert.match(tablePagination, /TABLE_PAGE_SIZE = 50/);
  assert.match(workspaceShell, /Math\.ceil\(rows\.length \/ TABLE_PAGE_SIZE\)/);
  assert.match(workspaceShell, /rows\.slice\(activePage \* TABLE_PAGE_SIZE, activePage \* TABLE_PAGE_SIZE \+ TABLE_PAGE_SIZE\)/);
  assert.match(globalStyles, /table tbody td\s*\{\s*text-align:\s*center(?:\s*!important)?;/);
});

test("monthly Finance report keeps separate colored Cash In and Cash Out columns", () => {
  assert.doesNotMatch(monthlyReport, /Verified Transactions|Pending \/ Returned/);
  assert.doesNotMatch(monthlyReport, /pendingOrReturned|verifiedTransactions/);
  assert.match(monthlyReport, /<th className="text-center">Month<\/th>/);
  assert.match(monthlyReport, /<th className="text-center">Cash In<\/th>/);
  assert.match(monthlyReport, /<th className="text-center">Cash Out<\/th>/);
  assert.match(monthlyReport, /<th className="text-center">Net Earnings<\/th>/);
  assert.doesNotMatch(monthlyReport, /<th className="text-right">Amount<\/th>/);
  assert.match(monthlyReport, /<td className="text-center font-semibold text-\[var\(--color-success-text\)\][\s\S]{0,120}peso\.format\(row\.cashIn\)/);
  assert.match(monthlyReport, /<td className="text-center font-semibold text-\[var\(--color-danger-text\)\][\s\S]{0,120}peso\.format\(row\.cashOut\)/);
  assert.doesNotMatch(monthlyReport, /Cash In ·|Cash Out ·/);
  assert.doesNotMatch(monthlyReport, /monthlyFinanceAmountRows|visibleAmountRows|totalAmountRows|amountLabel/);
  assert.doesNotMatch(monthlyReport, /quotationPayments/);
});
