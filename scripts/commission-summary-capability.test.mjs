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
  assert.match(migration, /commission allocations: authorized read/);
  assert.match(migration, /private\.finance_is_internal\(organization_id\)/);
});

test("combined accounts keep personal Pricing Officer summaries", () => {
  assert.match(workspace, /readOnly=\{role === "sales_pricing_officer"\}/);
  assert.match(workspace, /const \[commissionMonth, setCommissionMonth\] = useState\(currentMonth\)/);
  assert.match(financeWorkspace, /const quotationForId = useCallback\(\(quotationId: unknown\) => quotations\.find\(\(quotation\) => String\(quotation\.id\) === String\(quotationId\)\)/);
  assert.match(financeWorkspace, /stringValue\(quotation, "quotation_no", String\(quotationId \?\? ""\)\.trim\(\) \|\| "—"\)/);
});
