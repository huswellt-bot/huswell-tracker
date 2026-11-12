import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accessMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261111233138_revised_finance_access_and_current_balances.sql"),
  "utf8",
).toLowerCase();
const roleMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261111054901_unify_accounting_finance_role.sql"),
  "utf8",
).toLowerCase();
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);

test("revised Finance recognizes only the Accountant membership role", () => {
  assert.match(accessMigration, /array\['super_admin', 'owner', 'admin', 'accountant'\]/);
  assert.doesNotMatch(accessMigration, /has_member_capability/);
  assert.match(workspace, /const hasInternalFinanceAccess = role === "accountant";/);
  assert.match(workspace, /role === "accountant" \? \[/);
});

test("legacy Finance memberships are normalized to Accounting & Finance", () => {
  assert.match(roleMigration, /update public\.organization_members/);
  assert.match(roleMigration, /set role = 'accountant'/);
  assert.match(roleMigration, /where role in \('internal_finance', 'external_finance'\)/);
});

test("Finance approval counts use only revised pending rows", () => {
  assert.match(accessMigration, /create or replace function public\.finance_sidebar_queue_counts/);
  assert.match(accessMigration, /finance_revised_transactions transaction[\s\S]*status = 'pending'/);
  assert.match(accessMigration, /finance_working_fund_requests request[\s\S]*status = 'pending'/);
  assert.match(accessMigration, /finance_daily_fund_requests request[\s\S]*status = 'pending'/);
  assert.doesNotMatch(accessMigration, /finance_account_funding_requests/);
  assert.doesNotMatch(accessMigration, /finance_budget_requests/);
});

test("revised Finance removes the legacy capability toggle from the user-management path", () => {
  assert.match(workspace, /const isCombinedSalesPricingAccount = false;/);
  assert.doesNotMatch(workspace, /role === "internal_finance"/);
  assert.doesNotMatch(workspace, /role === "external_finance"/);
});
