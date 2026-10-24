import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const costingRoute = readFileSync(join(repoRoot, "app", "api", "costing-requests", "extract", "route.ts"), "utf8");
const workspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const financeFollowUpMigration = readFileSync(
  join(repoRoot, "supabase", "233_finance_gm_budget_only_and_legacy_compatibility.sql"),
  "utf8",
);
const financeCapabilityMigration = readFileSync(
  join(repoRoot, "supabase", "237_internal_finance_member_capability.sql"),
  "utf8",
);

test("malformed costing uploads return a controlled client error", () => {
  assert.match(costingRoute, /request\.formData\(\)\.catch\(\(\) => null\)/);
  assert.match(costingRoute, /The costing document form could not be read/);
  assert.match(costingRoute, /status: 400/);
});

test("quotation payment copy matches the Internal Finance reversal boundary", () => {
  assert.match(workspace, /Internal Finance handles reversals and exceptions/);
  assert.doesNotMatch(workspace, /management can handle reversals and exceptions/);
});

test("pending payment receiving-account correction is Internal Finance only", () => {
  const start = financeFollowUpMigration.indexOf(
    "create or replace function public.update_pending_quotation_payment_account",
  );
  const end = financeFollowUpMigration.indexOf("-- GM can read the allocation summary", start);
  assert.ok(start >= 0 && end > start);
  const replacement = financeFollowUpMigration.slice(start, end);
  assert.match(replacement, /private\.finance_is_internal\(v_payment\.organization_id\)/);
  assert.doesNotMatch(replacement, /array\[[\s\S]*accountant/i);
});

test("Finance realtime subscriptions match the current role boundaries", () => {
  const start = workspace.indexOf("const isFinance = hasInternalFinanceAccess");
  const end = workspace.indexOf("const queueTables = new Set<string>();", start);
  assert.ok(start >= 0 && end > start);
  const roleScope = workspace.slice(start, end);
  assert.match(roleScope, /const isFinance = hasInternalFinanceAccess \|\| role === "external_finance";/);
  assert.match(roleScope, /const isInternalFinance = hasInternalFinanceAccess;/);
  assert.doesNotMatch(roleScope, /super_admin|owner|admin|accountant/);
});

test("quotation payment reads stay inside the Finance role boundary", () => {
  const start = financeFollowUpMigration.indexOf(
    "create or replace function private.can_view_quotation_payment",
  );
  const end = financeFollowUpMigration.indexOf(
    "-- Remove the old management/accountant Finance read path",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const replacement = financeFollowUpMigration.slice(start, end);
  assert.match(replacement, /private\.finance_is_external_or_internal\(quote\.organization_id\)/);
  assert.doesNotMatch(replacement, /super_admin|owner|admin|accountant|production|warehouse/);
  assert.match(replacement, /reviewer_user_id = \(select auth\.uid\(\)\)/);
});

test("External Finance does not receive the broad transaction receipt delete path", () => {
  const start = financeFollowUpMigration.indexOf(
    'create policy "finance receipts: finance delete"',
  );
  const end = financeFollowUpMigration.indexOf("commit;", start);
  assert.ok(start >= 0 && end > start);
  const deletePolicy = financeFollowUpMigration.slice(start, end);
  assert.doesNotMatch(deletePolicy, /array\['external_finance'\]/);
  assert.match(deletePolicy, /private\.finance_is_internal\(transaction\.organization_id\)/);
});

test("Payment Monitoring cannot be opened by non-Finance roles", () => {
  assert.match(
    workspace,
    /const financePaymentViewAllowed =\s+hasInternalFinanceAccess \|\| role === "external_finance";/,
  );
  assert.match(
    workspace,
    /if \(view === "Payment Monitoring" && !financePaymentViewAllowed\)/,
  );
  assert.match(workspace, /const safeInitialView = requestedInitialView === "Payment Monitoring"/);
});

test("Dianne's existing Sales and Pricing account receives Finance as a capability", () => {
  assert.match(financeCapabilityMigration, /organization_member_capabilities/);
  assert.match(financeCapabilityMigration, /dianne@huswelloffice\.com/);
  assert.match(financeCapabilityMigration, /member\.role::text = 'sales_pricing_officer'/);
  assert.match(financeCapabilityMigration, /private\.finance_is_internal/);
  assert.match(workspace, /internalFinanceEnabled = false/);
  assert.match(workspace, /role === "internal_finance"/);
});

test("combined Sales and Pricing accounts use separate sidebar workspaces", () => {
  assert.match(workspace, /type SidebarWorkspace = "sales_pricing" \| "finance"/);
  assert.match(workspace, /const isCombinedSalesPricingAccount = role === "sales_pricing_officer" && hasInternalFinanceAccess/);
  assert.match(workspace, /id="sidebar-workspace"/);
  assert.match(workspace, /<option value="sales_pricing">Sales &amp; Pricing<\/option>/);
  assert.match(workspace, /<option value="finance">Finance<\/option>/);
  assert.match(workspace, /label: "Company"/);
  assert.match(workspace, /label: "Finance"/);
});
