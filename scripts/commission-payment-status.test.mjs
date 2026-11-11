import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "246_commission_summary_client_payment_status.sql"),
  "utf8",
);
const holdRemovalMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261025093255_remove_commission_three_day_hold.sql"),
  "utf8",
);
const commissionReceiptMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261025095549_commission_payout_receipt_optional.sql"),
  "utf8",
);
const commissionReceiptColumnsMigrationPath = join(
  repoRoot,
  "supabase",
  "migrations",
  "20261025100025_commission_payout_receipt_columns_nullable.sql",
);
const commissionReceiptColumnsMigration = readFileSync(commissionReceiptColumnsMigrationPath, "utf8");
const productionConfirmedPayablesMigration = readFileSync(
  join(repoRoot, "supabase", "251_production_confirmed_commission_payables.sql"),
  "utf8",
);
const productionConfirmedSummariesMigration = readFileSync(
  join(repoRoot, "supabase", "252_commission_summary_production_visibility.sql"),
  "utf8",
);
const financeProductionRemovalMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261111054555_remove_finance_production_requirement.sql"),
  "utf8",
);
const commissionSummaryAccessMigration = readFileSync(
  join(repoRoot, "supabase", "253_revoke_anon_commission_summary_access.sql"),
  "utf8",
);
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);
const financeWorkspace = readFileSync(
  join(repoRoot, "components", "finance-workspace.tsx"),
  "utf8",
);
const revisedFinanceWorkspace = readFileSync(
  join(repoRoot, "components", "finance-revised-workspace.tsx"),
  "utf8",
);

test("commission summaries expose client payment status and remaining balance", () => {
  assert.match(migration, /client_payment_status text/);
  assert.match(migration, /client_paid_amount numeric/);
  assert.match(migration, /client_pending_payment_amount numeric/);
  assert.match(migration, /client_remaining_balance numeric/);
  assert.match(migration, /payment\.status = 'verified'/);
  assert.match(migration, /payment\.status = 'pending'/);
  assert.match(workspace, /"Client payment", "Pending payment", "Remaining client balance", "Commission amount", "Payout status"/);
  assert.match(workspace, /summary\.client_remaining_balance/);
  assert.match(workspace, /summary\.client_pending_payment_amount/);
});

test("Internal Finance commission payout no longer waits three days", () => {
  assert.match(holdRemovalMigration, /private\.quotation_is_fully_paid/);
  assert.match(holdRemovalMigration, /payment\.status = 'verified'/);
  assert.match(holdRemovalMigration, /finance_sidebar_queue_counts/);
  assert.doesNotMatch(holdRemovalMigration, /v_latest_verified\s*\+\s*interval '3 days'/);
  assert.doesNotMatch(workspace, /currentTime >= new Date\(verifiedAt\)\.getTime\(\) \+ 3 \* 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(workspace, /three-day hold/);
});

test("commission payout uses the allocation amount and does not require a receipt", () => {
  assert.match(financeWorkspace, /amount: commissionAmount\.toFixed\(2\)/);
  assert.match(financeWorkspace, /category_id: String\(commissionExpenseCategory\.id\)/);
  assert.match(financeWorkspace, /!commissionPayoutMode && <div className="field-label"><span>\{revisionTransaction/);
  assert.match(financeWorkspace, /p_receipt_file_name: submittedFile\?\.name \?\? null/);
  assert.match(commissionReceiptMigration, /v_commission_receipt_optional boolean/);
  assert.match(commissionReceiptMigration, /allow_commission_allocation_insert/);
  assert.match(commissionReceiptMigration, /if not v_commission_receipt_optional and \(/);
  assert.match(commissionReceiptMigration, /nullif\(btrim\(p_receipt_file_name\), ''\)/);
  assert.match(commissionReceiptColumnsMigration, /alter column receipt_storage_path drop not null/);
  assert.match(commissionReceiptColumnsMigration, /alter column receipt_file_name drop not null/);
  assert.match(commissionReceiptColumnsMigration, /alter column receipt_content_type drop not null/);
  assert.match(commissionReceiptColumnsMigration, /alter column receipt_file_size drop not null/);
});

test("commission payables separate waiting projects from fully paid payout rows", () => {
  assert.match(financeWorkspace, /type CommissionPayablesView = "awaiting_payment" \| "ready_to_pay"/);
  assert.match(financeWorkspace, /label: "Awaiting verified payment"/);
  assert.match(financeWorkspace, /label: "Fully paid"/);
  assert.match(financeWorkspace, /commissionPayablesRowsByView/);
  assert.match(financeWorkspace, /stringValue\(allocation, "status"\) === "not_yet_paid"/);
  assert.match(financeWorkspace, /No fully paid projects are ready for commission payout/);
  assert.match(financeWorkspace, /No commission projects are awaiting verified payment/);
  assert.doesNotMatch(financeWorkspace, /<th>Payment readiness<\/th>/);
  assert.match(financeWorkspace, /commissionPayablesView === "ready_to_pay" && <th className="finance-action-column">Action<\/th>/);
  assert.match(financeWorkspace, /commissionPayablesView === "ready_to_pay" \? <StatusPill value=\{stringValue\(allocation, "status"\)\}/);
  assert.match(financeWorkspace, /bg-\[#218b55\][^>]*>Pay commission<\/button>/);
});

test("Finance commission transactions no longer require Production", () => {
  assert.match(financeProductionRemovalMigration, /finance_commission_payable_quotation_ids/);
  assert.match(financeProductionRemovalMigration, /commission_summary_allocations allocation/);
  assert.match(financeProductionRemovalMigration, /drop trigger if exists finance_transactions_commission_production_guard/);
  assert.match(financeProductionRemovalMigration, /drop function if exists private\.enforce_commission_production_confirmation/);
  assert.doesNotMatch(financeProductionRemovalMigration, /Commission payouts require an approved Production schedule/);
  assert.doesNotMatch(financeWorkspace, /productionConfirmedQuotationIdSet/);
  assert.doesNotMatch(financeWorkspace, /finance_commission_payable_quotation_ids/);
  assert.doesNotMatch(financeWorkspace, /Commission payouts.*approved Production schedule/s);
  assert.doesNotMatch(financeWorkspace, /"project_schedules"/);
});

test("Commission Summary rows require an approved Production-page schedule", () => {
  assert.match(productionConfirmedSummariesMigration, /commission_quotation_is_production_confirmed/);
  assert.match(productionConfirmedSummariesMigration, /summary\.quotation_id/);
  assert.match(productionConfirmedPayablesMigration, /schedule\.status = 'approved'::public\.approval_status/);
  assert.match(productionConfirmedPayablesMigration, /schedule\.due_date is not null/);
  assert.match(workspace, /Only commission allocations from quotations already confirmed in Production are shown/);
});

test("Commission Summary RPC is not executable by anon", () => {
  assert.match(commissionSummaryAccessMigration, /revoke all on function public\.commission_summary_rows_v3\(uuid\) from public, anon/);
  assert.match(commissionSummaryAccessMigration, /grant execute on function public\.commission_summary_rows_v3\(uuid\) to authenticated/);
});

test("project transaction notes open from a note icon modal", () => {
  assert.match(financeWorkspace, /selectedNoteTransaction/);
  assert.match(financeWorkspace, /title="View note" aria-label="View note"/);
  assert.match(financeWorkspace, /MessageSquareText size=\{15\}/);
  assert.match(financeWorkspace, /title="Transaction note"/);
  assert.match(financeWorkspace, /transactionNote\(selectedNoteTransaction\)/);
  assert.match(financeWorkspace, /layer="top"/);
});

test("commission payouts use the revised project ledger and activity history", () => {
  assert.match(workspace, /initialTab="commissions"/);
  assert.match(workspace, /initialTab="history"/);
  assert.match(revisedFinanceWorkspace, /title="Commission Payables"/);
  assert.match(revisedFinanceWorkspace, /list_finance_revised_commission_payables/);
  assert.match(revisedFinanceWorkspace, /create_finance_revised_commission_payout/);
  assert.match(revisedFinanceWorkspace, /Request payout/);
  assert.match(revisedFinanceWorkspace, /Project Cash Out/);
  assert.match(workspace, /Finance Activity History/);
  assert.match(revisedFinanceWorkspace, /commission_allocation_id/);
  assert.doesNotMatch(revisedFinanceWorkspace, /commission_history/);
});
