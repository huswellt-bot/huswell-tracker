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
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);
const financeWorkspace = readFileSync(
  join(repoRoot, "components", "finance-workspace.tsx"),
  "utf8",
);

test("commission summaries expose client payment status and remaining balance", () => {
  assert.match(migration, /client_payment_status text/);
  assert.match(migration, /client_paid_amount numeric/);
  assert.match(migration, /client_pending_payment_amount numeric/);
  assert.match(migration, /client_remaining_balance numeric/);
  assert.match(migration, /payment\.status = 'verified'/);
  assert.match(migration, /payment\.status = 'pending'/);
  assert.match(workspace, /"Client payment", "Remaining client balance", "Commission payout"/);
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

test("project transaction notes open from a note icon modal", () => {
  assert.match(financeWorkspace, /selectedNoteTransaction/);
  assert.match(financeWorkspace, /title="View note" aria-label="View note"/);
  assert.match(financeWorkspace, /MessageSquareText size=\{15\}/);
  assert.match(financeWorkspace, /title="Transaction note"/);
  assert.match(financeWorkspace, /transactionNote\(selectedNoteTransaction\)/);
  assert.match(financeWorkspace, /layer="top"/);
});

test("paid commissions have a dedicated Internal Finance history page", () => {
  assert.match(workspace, /"Paid commissions"/);
  assert.match(workspace, /initialTab="commission_history"/);
  assert.match(financeWorkspace, /tab === "commission_history" && internal/);
  assert.match(financeWorkspace, /title="Paid commissions"/);
  assert.match(financeWorkspace, /placeholder="Search commission payouts"/);
  assert.match(financeWorkspace, /placeholder="Search paid commissions"/);
  assert.match(financeWorkspace, /filteredPayablesRows/);
  assert.match(financeWorkspace, /filteredPaidCommissionRows/);
  assert.match(financeWorkspace, /Boolean\(transaction\.commission_allocation_id\)/);
  assert.match(financeWorkspace, /stringValue\(transaction, "payment_status"\) === "paid"/);
  assert.match(financeWorkspace, /profileName\(allocation\.recipient_user_id\)/);
  assert.match(financeWorkspace, /if \(transaction\.supplier_payable_id \|\| transaction\.commission_summary_id \|\| transaction\.commission_allocation_id\) return total;/);
  assert.match(financeWorkspace, /if \(transaction\.commission_summary_id \|\| transaction\.commission_allocation_id\) return;/);
});
