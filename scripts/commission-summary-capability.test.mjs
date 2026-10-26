import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "238_commission_summary_internal_finance_scope.sql"),
  "utf8",
).toLowerCase();
const paymentGateMigration = readFileSync(
  join(repoRoot, "supabase", "239_commission_visibility_after_verified_payment.sql"),
  "utf8",
).toLowerCase();
const personalScopeMigration = readFileSync(
  join(repoRoot, "supabase", "245_restore_personal_pricing_commission_scope.sql"),
  "utf8",
).toLowerCase();
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);
const financeWorkspace = readFileSync(
  join(repoRoot, "components", "finance-workspace.tsx"),
  "utf8",
);

test("Finance Payables scope recognizes the Internal Finance capability", () => {
  assert.match(migration, /create or replace function public\.commission_summary_rows_v3/);
  assert.doesNotMatch(migration, /private\.has_member_capability\(p_organization_id/);
  assert.doesNotMatch(migration, /private\.finance_is_internal\(p_organization_id\)/);
  assert.match(migration, /commission summaries: finance read/);
  assert.match(migration, /commission allocations: authorized read/);
  assert.match(migration, /private\.finance_is_internal\(organization_id\)/);
});

test("combined accounts keep personal Pricing Officer summaries", () => {
  assert.match(workspace, /readOnly=\{role === "sales_pricing_officer"\}/);
  assert.match(
    personalScopeMigration,
    /array\['super_admin', 'owner', 'admin', 'accountant', 'internal_finance'\]\s*\) as can_view_all/,
  );
  assert.doesNotMatch(personalScopeMigration, /private\.finance_is_internal\(p_organization_id\)/);
  assert.match(workspace, /const \[commissionMonth, setCommissionMonth\] = useState\(""\)/);
  assert.match(workspace, /aria-pressed=\{!commissionMonth\}/);
  assert.match(workspace, /Show all/);
  assert.match(workspace, /setCommissionMonth\(""\)/);
  assert.match(financeWorkspace, /const quotationForId = useCallback/);
  assert.match(financeWorkspace, /const commissionSummaryForQuotation = useCallback/);
  assert.match(financeWorkspace, /stringValue\(summary, "quotation_no"\) \|\| "—"/);
  assert.match(financeWorkspace, /commissionSummariesRequest/);
});

test("Pricing Officer commission summaries require a verified quotation payment", () => {
  assert.match(paymentGateMigration, /from public\.quotation_payment_records payment/);
  assert.match(paymentGateMigration, /payment\.quotation_id = summary\.quotation_id/);
  assert.match(paymentGateMigration, /payment\.status = 'verified'/);
  assert.match(
    paymentGateMigration,
    /access\.can_view_all\s+or exists\s*\(\s*select 1\s+from public\.quotation_payment_records payment/s,
  );
});

test("all commission pages default to Show all month filters", () => {
  assert.match(financeWorkspace, /commissionPayablesMonth/);
  assert.match(financeWorkspace, /paidCommissionMonth/);
  assert.match(financeWorkspace, /aria-label="Commission payout month"/);
  assert.match(financeWorkspace, /aria-label="Paid commission month"/);
  assert.match(financeWorkspace, /aria-pressed=\{!commissionPayablesMonth\}/);
  assert.match(financeWorkspace, /aria-pressed=\{!paidCommissionMonth\}/);
  assert.match(financeWorkspace, /Show all/);
});

test("Pricing Officer commission rows do not duplicate allocation rates and amounts", () => {
  assert.match(workspace, /const originDetail = ""/);
  assert.match(workspace, /const coworkerDetail = selfHandled \? "No co-worker" : ""/);
  assert.doesNotMatch(workspace, /share_rate\)\}% - \$\{peso\.format/);
});
