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

test("commission summary scope recognizes the Internal Finance capability", () => {
  assert.match(migration, /create or replace function public\.commission_summary_rows_v3/);
  assert.match(migration, /private\.has_member_capability\(p_organization_id, 'internal_finance'\)/);
  assert.match(migration, /access\.can_view_all\s+or allocation\.recipient_user_id/);
});

test("combined Sales & Pricing Officer accounts are not reduced to personal commission view", () => {
  assert.match(workspace, /readOnly=\{role === "sales_pricing_officer" && !hasInternalFinanceAccess\}/);
  assert.match(workspace, /const isCombinedSalesPricingAccount = role === "sales_pricing_officer" && hasInternalFinanceAccess/);
});
