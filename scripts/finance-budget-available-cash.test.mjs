import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "248_fix_available_cash_view_permissions.sql"),
  "utf8",
);
const workspace = readFileSync(
  join(repoRoot, "components", "finance-workspace.tsx"),
  "utf8",
);

test("account allocations are included in available cash", () => {
  assert.match(migration, /create or replace view public\.finance_account_balances/);
  assert.match(migration, /sum\(allocation\.allocated_amount\)/);
  assert.match(migration, /allocation\.organization_id = account\.organization_id/);
  assert.match(migration, /allocation\.account_id = account\.id/);
  assert.match(migration, /account\.is_active/);
  assert.match(migration, /period\.period_start = date_trunc\('month', timezone\('Asia\/Manila', now\(\)\)\)::date/);
  assert.doesNotMatch(migration, /private\.finance_budget_period_start\(\)/);
  assert.match(migration, /security_invoker = true/);
  assert.match(workspace, /each allocation is added to that account's available cash/);
});
