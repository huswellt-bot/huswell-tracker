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
  readFileSync(join(root, "supabase", "migrations", "20261111083118_revised_finance_costing_monitoring.sql"), "utf8"),
].join("\n");
const integrityMigration = readFileSync(join(root, "supabase", "migrations", "20261111083110_revised_finance_integrity_fixes.sql"), "utf8");
const fundModalMigration = readFileSync(join(root, "supabase", "migrations", "20261111091638_revised_finance_gm_fund_modal_simplification.sql"), "utf8");
const workingToCapitalMigration = readFileSync(join(root, "supabase", "migrations", "20261112100000_revised_finance_working_to_capital.sql"), "utf8");
const actorVisibilityMigration = readFileSync(join(root, "supabase", "migrations", "20261111122521_revised_finance_actor_visibility.sql"), "utf8");
const revisionMigration = readFileSync(join(root, "supabase", "migrations", "20261111135536_revised_finance_revision_flow.sql"), "utf8");
const accessMigration = readFileSync(join(root, "supabase", "migrations", "20261111233138_revised_finance_access_and_current_balances.sql"), "utf8");
const legacyBoundaryMigration = readFileSync(join(root, "supabase", "migrations", "20261112004726_20261112074513_retire_legacy_finance_surface.sql"), "utf8");
const accountantWriteMigration = readFileSync(join(root, "supabase", "migrations", "20261112004737_20261112091500_revised_finance_accountant_write_boundary.sql"), "utf8");
const sharedPoolMigration = readFileSync(join(root, "supabase", "migrations", "20261112113000_revised_finance_shared_daily_pool_and_receipts.sql"), "utf8");
const reviewFixMigration = readFileSync(join(root, "supabase", "migrations", "20261112130000_revised_finance_review_fixes.sql"), "utf8");
const retiredReceiptPolicyMigration = readFileSync(join(root, "supabase", "migrations", "20261112143000_remove_retired_finance_receipt_policies.sql"), "utf8");
const roleMigration = readFileSync(join(root, "supabase", "migrations", "20261111054901_unify_accounting_finance_role.sql"), "utf8");
const workspace = readFileSync(join(root, "components", "finance-revised-workspace.tsx"), "utf8");
const host = readFileSync(join(root, "components", "huswell-workspace.tsx"), "utf8");
const globalStyles = readFileSync(join(root, "app", "globals.css"), "utf8");
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

test("revised Finance approval badges include all pending ledger requests", () => {
  assert.match(integrityMigration, /create or replace function public\.finance_sidebar_queue_counts/);
  assert.match(integrityMigration, /private\.finance_revised_can_operate\(p_organization_id\)/);
  assert.match(integrityMigration, /from public\.finance_revised_transactions[\s\S]*status = 'pending'/);
  assert.match(integrityMigration, /from public\.finance_working_fund_requests[\s\S]*status = 'pending'/);
  assert.match(integrityMigration, /from public\.finance_daily_fund_requests[\s\S]*status = 'pending'/);
});

test("system Finance categories cannot be deleted", () => {
  assert.match(integrityMigration, /if v_category\.is_system then/);
  assert.match(integrityMigration, /System Finance categories cannot be deleted/);
  assert.match(workspace, /!Boolean\(category\.is_system\)/);
});

test("Finance category deletion uses a modal confirmation", () => {
  assert.match(workspace, /deleteCategoryTarget \? <Modal/);
  assert.match(workspace, /Are you sure you want to delete this category/);
  assert.match(workspace, /onClick=\{\(\) => void confirmDeleteCategory\(\)\}/);
});

test("repayment reversal restores the Working Fund request state", () => {
  assert.match(integrityMigration, /finance_revised_sync_working_fund_request_status/);
  assert.match(integrityMigration, /transaction\.status = 'approved'/);
  assert.match(integrityMigration, /finance_revised_request_status_after_reversal/);
  assert.match(integrityMigration, /new\.status = 'voided'/);
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

test("shared Daily Fund pool and receipt evidence are enforced by the revised flow", () => {
  assert.match(sharedPoolMigration, /add column if not exists receipt_storage_path/);
  assert.match(sharedPoolMigration, /add constraint finance_revised_transactions_daily_fund_link_check/);
  assert.match(sharedPoolMigration, /transaction_kind in \('daily_fund_return', 'operating_cash_out', 'adjustment'\)/);
  assert.match(sharedPoolMigration, /create or replace function public\.create_finance_revised_cash_out_with_receipt/);
  assert.match(sharedPoolMigration, /if p_project_fund_id is null/);
  assert.match(sharedPoolMigration, /private\.finance_revised_balance\(p_organization_id, 'daily'\)/);
  assert.match(sharedPoolMigration, /create or replace function private\.post_finance_revised_transaction_pool_v2/);
  assert.match(sharedPoolMigration, /create or replace function public\.create_finance_revised_daily_fund_pool_return/);
  assert.match(sharedPoolMigration, /'available_for_return'/);
  assert.match(sharedPoolMigration, /finance_revised_validate_receipt/);
  assert.match(sharedPoolMigration, /insert into storage\.buckets \(id, name, public\)/);
  assert.match(sharedPoolMigration, /values \('finance-receipts', 'finance-receipts', false\)/);
  assert.match(sharedPoolMigration, /finance receipts: revised transaction upload/);
  assert.match(sharedPoolMigration, /revoke all on function public\.create_finance_revised_cash_out_with_category/);
  assert.match(sharedPoolMigration, /grant execute on function public\.create_finance_revised_cash_out_with_receipt/);
  assert.match(workspace, /Balance after Cash In/);
  assert.match(workspace, /Current Daily Fund balance/);
  assert.match(workspace, /View receipt/);
  assert.doesNotMatch(workspace, /dailyFundRequestId: ""/);
});

test("shared Daily Fund returns can be reversed and pool reporting is explicit", () => {
  assert.match(reviewFixMigration, /transaction_kind = 'daily_fund_return'[\s\S]*daily_fund_request_id is not null/);
  assert.match(reviewFixMigration, /Shared-pool returns have no request ID[\s\S]*generic ledger reversal/);
  assert.match(reviewFixMigration, /null::numeric as unused_amount/);
  assert.match(reviewFixMigration, /shared_pool_balance/);
  assert.match(reviewFixMigration, /shared_pool_spent_amount/);
  assert.match(reviewFixMigration, /shared_pool_returned_amount/);
});

test("Finance receipt validation checks stored object metadata and retires old upload policies", () => {
  assert.match(reviewFixMigration, /p_receipt_content_type is null/);
  assert.match(reviewFixMigration, /storage_object\.metadata ->> 'mimetype'/);
  assert.match(reviewFixMigration, /storage_object\.metadata ->> 'size'/);
  assert.match(reviewFixMigration, /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(reviewFixMigration, /case[\s\S]*split_part\(name, '\/', 1\)::uuid[\s\S]*else null/);
  assert.match(reviewFixMigration, /drop policy if exists "finance receipts: pending transaction upload"/);
  assert.match(reviewFixMigration, /drop policy if exists "finance receipts: pending transaction read"/);
  assert.match(reviewFixMigration, /drop policy if exists "finance receipts: pending transaction delete"/);
});

test("retired generic Finance receipt policies cannot affect quotation image uploads", () => {
  assert.match(retiredReceiptPolicyMigration, /drop policy if exists "finance receipts: authorized read"/);
  assert.match(retiredReceiptPolicyMigration, /drop policy if exists "finance receipts: finance delete"/);
  assert.match(retiredReceiptPolicyMigration, /drop policy if exists "finance receipts: finance upload"/);
  assert.doesNotMatch(retiredReceiptPolicyMigration, /create policy/);
});

test("legacy Finance Foundation links fall back to an authorized workspace", () => {
  assert.match(host, /requestedInitialView === "Finance Foundation"[\s\S]*defaultWorkspaceView/);
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
    "list_finance_revised_costing_breakdown",
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

test("legacy Finance roles, capabilities, and RPCs are blocked", () => {
  assert.match(legacyBoundaryMigration, /organization_members_no_legacy_finance_roles/);
  assert.match(legacyBoundaryMigration, /role::text in \('internal_finance', 'external_finance'\)/);
  assert.match(legacyBoundaryMigration, /delete from public\.organization_member_capabilities/);
  assert.match(legacyBoundaryMigration, /select false/);
  assert.match(legacyBoundaryMigration, /p\.proname = any/);
  assert.match(legacyBoundaryMigration, /'create_finance_account'/);
  assert.match(legacyBoundaryMigration, /'create_finance_category'/);
  assert.match(legacyBoundaryMigration, /'create_finance_transaction'/);
  assert.match(legacyBoundaryMigration, /'approve_and_pay_finance_transaction'/);
  assert.match(legacyBoundaryMigration, /'register_quotation_payment_with_account'/);
  assert.match(legacyBoundaryMigration, /'resubmit_quotation_payment_with_account'/);
  assert.match(legacyBoundaryMigration, /'update_pending_quotation_payment_account'/);
  assert.match(legacyBoundaryMigration, /finance_accounts/);
  assert.match(legacyBoundaryMigration, /finance_account_balances/);
  assert.match(legacyBoundaryMigration, /finance_account_budget_summary/);
  assert.match(legacyBoundaryMigration, /finance_transactions/);
});

test("the visible Finance flow is project-ledger based", () => {
  assert.match(workspace, /Project Finance Monitoring/);
  assert.match(workspace, /Open breakdown/);
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
  assert.match(workspace, /Daily Fund/);
  assert.match(workspace, /Reverse posted transaction/);
  assert.match(workspace, /Remove Capital Funds/);
  assert.match(workspace, /Return to Capital Funds/);
  assert.match(workspace, /create_finance_revised_daily_fund_request/);
  assert.match(workspace, /create_finance_revised_daily_fund_pool_return/);
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

test("Cash In and Cash Out forms remain modal-only", () => {
  assert.match(workspace, /title="Revised Finance activity"/);
  assert.match(workspace, /dialog === "cash_in"/);
  assert.match(workspace, /dialog === "cash_out"/);
  const transactionsStart = workspace.indexOf("const renderTransactions");
  const requestsStart = workspace.indexOf("const renderRequests", transactionsStart);
  assert.ok(transactionsStart >= 0 && requestsStart > transactionsStart);
  assert.doesNotMatch(workspace.slice(transactionsStart, requestsStart), /Record Cash In|Record Cash Out/);
  assert.doesNotMatch(workspace, /detail \? <p className=/);
  assert.doesNotMatch(workspace, /How the revised flow works/);
  assert.doesNotMatch(workspace, /What happens after approval/);
  assert.doesNotMatch(workspace, /Commission rule/);
  assert.doesNotMatch(workspace, /Enter any collection amount manually\. No downpayment percentage or automatic payment restriction is applied/);
  assert.doesNotMatch(workspace, /The project, amount, collection date, reference, and note are entered in a modal/);
  assert.doesNotMatch(workspace, /Choose a project for project expenses or Working Funds for an operating expense/);
  assert.doesNotMatch(workspace, /Project Cash Out is limited to that project&apos;s balance/);
});

test("Finance Overview renders each metric in its own card", () => {
  assert.match(workspace, /function MetricCard\(/);
  assert.match(workspace, /<MetricCard><Metric label="Total Cash on Hand"/);
  assert.match(workspace, /<MetricCard><Metric label="Open commission payables"/);
});

test("Finance pages do not repeat the sidebar page heading", () => {
  assert.doesNotMatch(workspace, /<h1/);
});

test("costing errors block misleading project PDF exports", () => {
  assert.match(workspace, /costingError/);
  assert.match(workspace, /PDF export is disabled/);
  assert.match(workspace, /Retry costing/);
  assert.match(workspace, /disabled=\{saving \|\| detailLoading \|\| Boolean\(costingError\)\}/);
});

test("Finance notifications use dismissible modal dialogs", () => {
  assert.match(workspace, /NotificationDialog/);
  assert.match(workspace, /title="Finance update"/);
  assert.match(workspace, /title="Finance error"/);
  assert.doesNotMatch(workspace, /notice \? <div/);
  assert.doesNotMatch(workspace, /error \? <div/);
  assert.match(host, /NotificationDialog message=\{message\}/);
  assert.doesNotMatch(host, /NotificationToast/);
});

test("Cash Out uses an explicit Project or Non-project source toggle", () => {
  assert.match(workspace, /type CashOutSource = "project" \| "non_project"/);
  assert.match(workspace, /Cash Out source/);
  assert.match(workspace, /aria-label="Cash Out source"/);
  assert.match(workspace, /aria-pressed=\{cashOut\.source === source\}/);
  assert.match(workspace, /cashOut\.source === "project"/);
  assert.doesNotMatch(workspace, /Project Cash Out uses the selected project balance/);
  assert.doesNotMatch(workspace, /Non-project Cash Out uses the Daily Fund balance/);
  assert.match(workspace, /p_project_fund_id: isProjectCashOut \? cashOut\.projectId : null/);
  assert.doesNotMatch(workspace, /p_daily_fund_request_id/);
  assert.match(workspace, /create_finance_revised_cash_out_with_receipt/);
  assert.match(workspace, /Balance after Cash Out/);
  assert.match(workspace, /receiptFile/);
});

test("GM fund modals use automatic dates and only the required amount fields", () => {
  const capitalStart = workspace.indexOf('{dialog === "capital"');
  const transferStart = workspace.indexOf('{dialog === "transfer"');
  const dailyStart = workspace.indexOf('{dialog === "daily_request"', transferStart);
  assert.ok(capitalStart >= 0 && transferStart > capitalStart && dailyStart > transferStart);
  const capitalModal = workspace.slice(capitalStart, transferStart);
  const transferModal = workspace.slice(transferStart, dailyStart);
  assert.match(capitalModal, /<Field label="Amount"/);
  assert.doesNotMatch(capitalModal, /Quarter \/ period|Investment date|label="Reference"|label="Note"/);
  assert.match(transferModal, /Available Capital Funds/);
  assert.match(transferModal, /<Field label="Transfer amount"/);
  assert.doesNotMatch(transferModal, /Transfer date|label="Reference"|label="Note"/);
  assert.match(fundModalMigration, /create or replace function public\.create_finance_revised_capital_contribution/);
  assert.match(fundModalMigration, /create or replace function public\.create_finance_revised_capital_to_working/);
  assert.match(fundModalMigration, /transaction_date,[\s\S]*current_date/);
  assert.match(fundModalMigration, /period_label,[\s\S]*null/);
  assert.match(fundModalMigration, /reference_number,[\s\S]*null/);
  assert.match(fundModalMigration, /note,[\s\S]*null/);
});

test("Capital Funds details stay concise and removal is balance-gated", () => {
  const modalStart = workspace.indexOf("function CapitalFundDetailsModal");
  const modalEnd = workspace.indexOf("function EmptyState", modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  const capitalModal = workspace.slice(modalStart, modalEnd);
  assert.match(capitalModal, /<Metric label="Amount" value=\{amount\(transaction\.amount\)\}/);
  assert.match(capitalModal, /<Metric label="Date" value=\{dateLabel\(transaction\.transaction_date\)\}/);
  assert.match(capitalModal, /canRemove/);
  assert.match(capitalModal, /Remove Capital Funds/);
  assert.doesNotMatch(capitalModal, /<Metric label="(?:Movement|From|To|Recorded by|Posted by|Current fund balances|Transaction ID)"/);
  assert.match(workspace, /canRemoveSelectedCapital/);
  assert.match(workspace, /numberValue\(currentFundBalances, "capital_funds"\) \+ 0\.001 >= selectedTransactionAmount/);
  assert.match(accessMigration, /funds have already been used/);
});

test("GM can return a chosen Working Funds amount to Capital Funds", () => {
  assert.match(workspace, /dialog === "return_capital"/);
  assert.match(workspace, /Return Working Funds to Capital Funds/);
  assert.match(workspace, /<Field label="Return amount"/);
  assert.match(workspace, /create_finance_revised_working_to_capital/);
  assert.match(workspace, /numberValue\(currentFundBalances, "working_funds"\)/);
  assert.match(workingToCapitalMigration, /working_to_capital/);
  assert.match(workingToCapitalMigration, /create or replace function public\.create_finance_revised_working_to_capital/);
  assert.match(workingToCapitalMigration, /Working Funds balance is not enough for this return/);
  assert.match(workingToCapitalMigration, /revoke all on function public\.create_finance_revised_working_to_capital\(uuid, numeric\) from public, anon/);
  assert.match(workingToCapitalMigration, /grant execute on function public\.create_finance_revised_working_to_capital\(uuid, numeric\) to authenticated/);
});

test("Fund activities use one tabbed table", () => {
  assert.match(workspace, /aria-label="Fund activity types"/);
  assert.match(workspace, /const \[fundActivityTab, setFundActivityTab\]/);
  assert.match(workspace, /const activityTransactions = showingCapitalActivity \? capitalTransactions : workingTransactions/);
  assert.match(workspace, /<ActivityTable transactions=\{activityTransactions\}/);
});

test("GM approvals are organized into counted request tabs", () => {
  assert.match(workspace, /aria-label="Finance approval request types"/);
  assert.match(workspace, /className="app-tabs overflow-x-auto border-b/);
  assert.match(workspace, /className="app-tab whitespace-nowrap"/);
  assert.match(workspace, /app-tab-count/);
  assert.match(workspace, /label: "All"/);
  assert.match(workspace, /label: "Cash In"/);
  assert.match(workspace, /label: "Cash Out"/);
  assert.match(workspace, /label: "Working Funds"/);
  assert.match(workspace, /label: "Daily Fund"/);
  assert.match(workspace, /approvalCounts/);
  assert.match(workspace, /function ApprovalTable/);
  assert.match(workspace, /items=\{visibleItems\}/);
  assert.match(workspace, /All approval types use one queue/);
});

test("Cash In and Cash Out use approve or request-revision decisions", () => {
  assert.match(revisionMigration, /status in \('pending', 'approved', 'rejected', 'revision_requested', 'voided'\)/);
  assert.match(revisionMigration, /v_decision not in \('approved', 'revision_requested'\)/);
  assert.match(revisionMigration, /'project_cash_in', 'project_cash_out', 'operating_cash_out', 'commission_payout'/);
  assert.match(revisionMigration, /A revision note is required/);
  assert.match(revisionMigration, /reviewed_by = v_actor/);
  assert.match(revisionMigration, /create or replace function public\.resubmit_finance_revised_transaction/);
  assert.match(revisionMigration, /revision_of_transaction_id/);
  assert.match(revisionMigration, /finance_revised_transactions_one_active_revision_child_idx/);
  assert.match(revisionMigration, /replacement\.status not in \('rejected', 'voided'\)/);
  assert.match(revisionMigration, /commission_allocation_id/);
  assert.match(workspace, /Request revision/);
  assert.match(workspace, /Correct &amp; resubmit/);
  assert.match(workspace, /Correct and resubmit commission payout/);
  assert.match(workspace, /GM revision note/);
  assert.doesNotMatch(workspace, /reviewTransactionDecision\("rejected"\)/);
});

test("revised approval counts and realtime refresh include fund requests", () => {
  assert.match(revisionMigration, /finance_revised_transactions transaction[\s\S]*status = 'pending'/);
  assert.match(revisionMigration, /finance_working_fund_requests request[\s\S]*status = 'pending'/);
  assert.match(revisionMigration, /finance_daily_fund_requests request[\s\S]*status = 'pending'/);
  assert.match(revisionMigration, /finance_revised_transactions',\s*'finance_working_fund_requests',\s*'finance_daily_fund_requests'/);
  assert.match(host, /finance_revised_transactions/);
  assert.match(host, /finance_working_fund_requests/);
  assert.match(host, /finance_daily_fund_requests/);
});

test("repayment UI uses collected project balance instead of support-inclusive balance", () => {
  assert.match(workspace, /client_cash_in.*cash_out.*working_fund_repaid/);
  assert.doesNotMatch(workspace, /numberValue\(project, "available_balance"\),\s*\n\s*\)\);/);
});

test("Finance audit actors are visible for transactions and fund requests", () => {
  assert.match(workspace, />Actors<\/th>/);
  assert.match(workspace, />Requested by<\/th>/);
  assert.match(workspace, /submitted_by_name/);
  assert.match(workspace, /requested_by_name/);
  assert.match(workspace, /approved_by_name/);
  assert.match(workspace, /Requested at/);
  assert.match(workspace, /Reviewed by/);
  assert.match(actorVisibilityMigration, /create or replace view public\.finance_revised_working_fund_request_feed/);
  assert.match(actorVisibilityMigration, /create or replace view public\.finance_revised_daily_fund_request_feed/);
  assert.match(actorVisibilityMigration, /requested_by_name/);
  assert.match(actorVisibilityMigration, /approved_by_name/);
  assert.match(actorVisibilityMigration, /left join public\.profiles requested_profile/);
  assert.match(actorVisibilityMigration, /left join public\.profiles approved_profile/);
  assert.match(actorVisibilityMigration, /with \(security_invoker = true\)/);
});

test("revised Finance uses the Accountant role and current fund balances", () => {
  assert.match(accessMigration, /array\['super_admin', 'owner', 'admin', 'accountant'\]/);
  assert.doesNotMatch(accessMigration, /has_member_capability\([^)]*internal_finance/);
  assert.match(accessMigration, /get_finance_revised_current_balances/);
  assert.match(accessMigration, /finance_revised_business_date/);
  assert.match(workspace, /get_finance_revised_current_balances/);
  assert.match(workspace, /currentFundBalances/);
});

test("GM approval is separate from Accountant operational Finance writes", () => {
  assert.match(workspace, /const canOperate = role === "accountant"/);
  assert.match(accountantWriteMigration, /finance_revised_is_accountant/);
  assert.match(accountantWriteMigration, /create_finance_revised_cash_in_with_category_accountant_legacy/);
  assert.match(accountantWriteMigration, /create_finance_revised_cash_out_with_category_accountant_legacy/);
  assert.match(accountantWriteMigration, /create_finance_working_fund_request_accountant_legacy/);
  assert.match(accountantWriteMigration, /create_finance_revised_daily_fund_request_accountant_legacy/);
  assert.match(accountantWriteMigration, /grant execute on function public\.create_finance_revised_cash_in_with_category\(uuid, uuid, numeric, uuid, date, text, text\) to authenticated/);
  assert.match(accountantWriteMigration, /grant execute on function public\.create_finance_revised_cash_out_with_category\(uuid, uuid, numeric, uuid, date, text, text, uuid\) to authenticated/);
});

test("GM and Accounting & Finance receive separate revised Finance navigation", () => {
  const gmStart = host.indexOf("const gmFinanceSidebarViews");
  const accountingStart = host.indexOf("const accountingFinanceSidebarViews");
  const financeViewsStart = host.indexOf("const financeSidebarViews");
  assert.ok(gmStart >= 0 && accountingStart > gmStart && financeViewsStart > accountingStart);
  const gmViews = host.slice(gmStart, accountingStart);
  const accountingViews = host.slice(accountingStart, financeViewsStart);
  assert.match(gmViews, /Finance Funds/);
  assert.match(gmViews, /Finance Approvals/);
  assert.match(host, /isManagementRole\r?\n                  \? "Overview"/);
  assert.doesNotMatch(gmViews, /"Finance Transactions"|"Finance Requests"|"Finance Commissions"/);
  assert.match(accountingViews, /Finance Transactions/);
  assert.match(accountingViews, /Finance Requests/);
  assert.match(accountingViews, /Finance Commissions/);
  assert.doesNotMatch(accountingViews, /"Finance Funds"|"Finance Approvals"/);
  assert.match(host, /const targetView: View = view === "Finance Daily Fund" \? "Finance Requests" : view/);
  assert.match(host, /active === "Finance Transactions" && hasInternalFinanceAccess/);
});

test("Finance Monitoring uses a project table and the shared blue table treatment", () => {
  const projectsStart = workspace.indexOf("const renderProjects");
  const historyStart = workspace.indexOf("const renderHistory", projectsStart);
  assert.ok(projectsStart >= 0 && historyStart > projectsStart);
  const projectsRenderer = workspace.slice(projectsStart, historyStart);
  assert.match(projectsRenderer, /<table className="app-table w-full min-w-\[1240px\] text-left text-\[11px\]">/);
  assert.match(projectsRenderer, /<th>Project<\/th>/);
  assert.match(projectsRenderer, /<th>Total Direct Cost<\/th>/);
  assert.match(projectsRenderer, /<th>Project balance<\/th>/);
  assert.match(projectsRenderer, /Open breakdown/);
  assert.doesNotMatch(projectsRenderer, /<article /);
  assert.doesNotMatch(projectsRenderer, /grid gap-4 sm:grid-cols-2/);
  assert.match(globalStyles, /\.finance-revised-workspace table thead/);
  assert.match(globalStyles, /background: #1F4E79/);
  assert.match(globalStyles, /color: #ffffff/);
});

test("Finance Monitoring reads the submitted direct-cost payload by quotation product", () => {
  assert.match(migration, /create or replace function public\.list_finance_revised_costing_breakdown/);
  assert.match(migration, /quotation_item_id uuid/);
  assert.match(migration, /product_description text/);
  assert.match(migration, /product_total_direct_cost numeric/);
  assert.match(migration, /total_direct_cost numeric/);
  assert.match(migration, /price_quotation_product_costings product_costing/);
  assert.match(migration, /price_quotation_costing_lines line/);
  assert.match(migration, /calculation_type = 'fixed_amount'/);
  assert.match(migration, /grant execute on function public\.list_finance_revised_costing_breakdown\(uuid, uuid\) to authenticated/);
  assert.match(workspace, /list_finance_revised_costing_breakdown/);
  assert.match(workspace, /Total Direct Cost/);
  assert.match(workspace, /Pricing Officer submitted direct-cost lines/);
  assert.match(workspace, /GM markups, selling price, VAT, commission, and profit are excluded/);
});
