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
const confirmationDialogStart = workspace.indexOf("function FinanceConfirmDialog(");
const confirmationDialogEnd = workspace.indexOf("function FinanceLoadingState(", confirmationDialogStart);
const confirmationDialog = workspace.slice(confirmationDialogStart, confirmationDialogEnd);
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

test("External Finance history keeps only necessary columns and color-codes the amount", () => {
  assert.match(transactionTable, /\{internal && <th>Budget<\/th>\}/);
  assert.match(transactionTable, /\{internal && <th>Note<\/th>\}/);
  assert.match(transactionTable, /internal \? \(allowActions \? "min-w-\[1320px\]"/);
  assert.doesNotMatch(transactionTable, /<th>Reference<\/th>/);
  assert.doesNotMatch(transactionTable, /transactionReference\(transaction, quotationName\)/);
  assert.match(transactionTable, /finance-cash-in-amount text-\[#218b55\]/);
  assert.match(transactionTable, /finance-cash-out-amount text-\[#b42318\]/);
  assert.match(globalStyles, /\.finance-transaction-table \.app-table tbody td\.finance-cash-in-amount,[\s\S]*color: #218b55 !important/);
  assert.match(globalStyles, /\.finance-transaction-table \.app-table tbody td\.finance-cash-out-amount,[\s\S]*color: #b42318 !important/);
  assert.match(transactionTable, /7 \+ \(internal \? 2 : 0\) \+ \(allowActions \? 2 : 0\)/);
});

test("pending project payments appear in External Finance transaction history", () => {
  assert.match(workspace, /const transactionHistoryRows = useMemo<Row\[\]>\(\(\) =>/);
  assert.match(workspace, /\["pending", "revision_requested"\]\.includes\(stringValue\(payment, "status"\)\)/);
  assert.match(workspace, /id: `quotation-payment:\$\{String\(payment\.id\)\}`/);
  assert.match(workspace, /income_review_status: stringValue\(payment, "status"\)/);
  assert.match(workspace, /postedQuotationPaymentIds/);
  assert.match(workspace, /transactionPeriodTransactions = useMemo\(\s*\(\) => transactionHistoryRows\.filter/);
  assert.match(workspace, /return "pending_confirmation";/);
});

test("project expense options use the project-expense RPC result", () => {
  assert.match(workspace, /setQuotationDirectCosts\(\(requests\[14\]\.data \?\? \[\]\) as Row\[\]\)/);
  assert.match(workspace, /setProjectExpenseRows\(\(requests\[15\]\.data \?\? \[\]\) as Row\[\]\)/);
  assert.match(workspace, /setBudgetSnapshot\(\(\(requests\[16\]\.data \?\? \[\]\) as Row\[\]\)\[0\] \?\? null\)/);
});

test("Cash In project payment rows use the payment type as their category", () => {
  assert.match(workspace, /const transactionCategoryLabel = \(row: Row, categoryName/);
  assert.match(workspace, /if \(paymentKind === "downpayment"\) return "Down payment"/);
  assert.match(workspace, /if \(paymentKind === "full_payment"\) return "Full payment"/);
  assert.match(workspace, /payment_kind: stringValue\(payment, "payment_kind"\)/);
  assert.match(workspace, /transactionCategoryLabel\(transaction, categoryName\)/);
});

test("External Finance transaction history keeps only the search bar", () => {
  const historyPanelStart = workspace.indexOf('<Panel title="Transaction history"');
  const historyPanelEnd = workspace.indexOf('<Panel title="', historyPanelStart + 1);
  const historyPanel = workspace.slice(historyPanelStart, historyPanelEnd === -1 ? undefined : historyPanelEnd);
  assert.match(historyPanel, /placeholder=\{internal \? "Search project or client" : "Search history"\}/);
  assert.doesNotMatch(historyPanel, /Transaction period|Transaction source|Finance account|Transaction category/);
  assert.doesNotMatch(historyPanel, /<select/);
});

test("External Finance transaction history toggles between pending and verified rows", () => {
  assert.match(workspace, /type TransactionStatusView = "pending" \| "verified"/);
  assert.match(workspace, /transactionStatusViewOptions: Array/);
  assert.match(workspace, /label: "Pending"/);
  assert.match(workspace, /label: "Verified"/);
  assert.match(workspace, /transactionStatusViewValue\(transaction\) !== transactionStatusView/);
  assert.match(workspace, /transactionStatusViewCounts\[option\.value\]/);
  assert.match(workspace, /aria-label="Transaction status"/);
  assert.doesNotMatch(workspace, /aria-label="Transaction type"/);
});

test("External Finance replaces the transaction count row with the status toggle", () => {
  const historyPanelStart = workspace.indexOf('<Panel title="Transaction history"');
  const historyPanelEnd = workspace.indexOf('<Panel title="', historyPanelStart + 1);
  const historyPanel = workspace.slice(historyPanelStart, historyPanelEnd === -1 ? undefined : historyPanelEnd);
  const searchIndex = historyPanel.indexOf('placeholder={internal ? "Search project or client" : "Search history"}');
  const toggleIndex = historyPanel.indexOf('aria-label="Transaction status"');
  assert.ok(searchIndex >= 0);
  assert.ok(toggleIndex > searchIndex);
  assert.doesNotMatch(historyPanel, /Showing \{filteredTransactions\.length/);
});

test("Internal Finance approvals toggle Cash In, Cash Out, and budget request queues", () => {
  assert.match(workspace, /type PendingApprovalSection = "income" \| "expense" \| "budget"/);
  assert.match(workspace, /"Budget requests"/);
  assert.match(workspace, /pendingApprovalSection === "budget"/);
  assert.match(workspace, /setPendingApprovalSection\(value\)/);
  assert.match(workspace, /Cash In approvals/);
  assert.match(workspace, /Cash Out approvals/);
  assert.match(workspace, /Account funding requests/);
});

test("Budget approval queue opens a detailed review modal", () => {
  assert.match(workspace, /function BudgetRequestReviewDialog/);
  assert.match(workspace, /<th>Account<\/th><th>Requested on<\/th><th>Amount<\/th><th className="finance-action-column">Review<\/th>/);
  assert.match(workspace, /setBudgetReviewRequest\(budget\)/);
  assert.match(workspace, /Requested budget/);
  assert.match(workspace, /label="Requested by"/);
  assert.match(workspace, /label="Note"/);
  assert.match(workspace, /requestFundingReview\(request, decision\)/);
  assert.match(workspace, /Return for revision/);
  assert.match(workspace, /submitDecision\("approved"\).*className="button-success"/s);
  assert.match(workspace, /submitDecision\("revision_requested"\)[\s\S]*submitDecision\("rejected"\)[\s\S]*submitDecision\("approved"\)/);
});

test("Cash In and Cash Out approval notes are modal-only", () => {
  assert.match(workspace, /<th>Date<\/th><th>Description<\/th><th>Source<\/th><th>Account<\/th><th>Amount<\/th><th>Status<\/th><th className="finance-action-column">Review<\/th>/);
  assert.match(workspace, /<TransactionDetailField label="Note"/);
  assert.doesNotMatch(workspace, /<td>\{row\.note\}<\/td>/);
});

test("approval notes are required only for rejection, return, or reversal", () => {
  assert.match(confirmationDialog, /\{requiresNote && \(/);
  assert.doesNotMatch(confirmationDialog, /Decision note.*optional/);
  assert.match(workspace, /approveAndPay\(pendingAction\.id\);/);
  assert.match(workspace, /verifyManualIncome\(pendingAction\.id\);/);
  assert.match(workspace, /reviewFundingRequest\(String\(fundingReviewRequest\.id\), "approved", approvedAmount, null\)/);
  assert.doesNotMatch(workspace, /<label className="field-label">Decision note \(optional\)/);
});

test("eligible commission allocations have a pay action in their table row", () => {
  assert.match(workspace, /<th className="finance-action-column">Action<\/th>/);
  assert.match(workspace, /eligibleCommissionAllocations\.some\(\(eligibleAllocation\)/);
  assert.match(workspace, /onClick=\{\(\) => openCommissionPayout\(String\(allocation\.id\)\)\}/);
  assert.match(workspace, />Pay commission<\/button>/);
  assert.match(workspace, /Awaiting full payment/);
});

test("Non-project Cash Out does not show a Leads company field", () => {
  assert.match(workspace, /transactionDirection === "income" && !manualIncomeMode && !manualIncomeRevisionMode/);
  assert.match(workspace, /ariaLabel="Name \/ Company from Leads"/);
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

test("Cash Out does not show the removed account budget guidance", () => {
  assert.doesNotMatch(transactionForm, /Account budget/);
  assert.doesNotMatch(transactionForm, /Available account balances are not shown to External Finance/);
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
  assert.match(workspace, /<th>Project<\/th><th>Quotations<\/th>/);
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
  assert.match(monthlyReport, /<td className="text-center font-semibold text-\[#202938\]">\{peso\.format\(row\.netEarnings\)\}<\/td>/);
  assert.match(monthlyReport, /<td className="px-3 pb-3 pt-4 text-center font-semibold text-\[#202938\]" aria-label=\{`Total Cash In/);
  assert.match(monthlyReport, /<td className="px-3 pb-3 pt-4 text-center font-semibold text-\[#202938\]" aria-label=\{`Total Cash Out/);
  assert.match(monthlyReport, /<td className="px-3 pb-3 pt-4 text-center font-semibold text-\[#202938\]">\{peso\.format\(totals\.netEarnings\)\}<\/td>/);
  assert.doesNotMatch(monthlyReport, /Cash In ·|Cash Out ·/);
  assert.doesNotMatch(monthlyReport, /monthlyFinanceAmountRows|visibleAmountRows|totalAmountRows|amountLabel/);
  assert.doesNotMatch(monthlyReport, /quotationPayments/);
});

test("Finance overview does not repeat the Net earnings label above the amount", () => {
  assert.doesNotMatch(
    workspaceShell,
    /<p className="text-\[11px\] font-semibold uppercase tracking-\[\.06em\] text-\[#7d8797\]">Net earnings<\/p>/,
  );
});
