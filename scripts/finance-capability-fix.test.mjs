import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "243_fix_internal_finance_capability_commission_workflows.sql"),
  "utf8",
).toLowerCase();

test("Commission Payables recognizes capability-enabled Internal Finance", () => {
  assert.match(migration, /create or replace function public\.commission_summary_rows_v3/);
  assert.match(migration, /private\.finance_is_internal\(p_organization_id\)/);
  assert.match(migration, /'super_admin', 'owner', 'admin', 'accountant'/);
});

test("capability-enabled Internal Finance commission payouts are approved", () => {
  assert.match(
    migration,
    /v_approval_status\s*:=\s*case[\s\S]*when private\.finance_is_internal\(v_organization_id\) then 'approved'/,
  );
});

test("legacy commission payment RPC recognizes the Internal Finance capability", () => {
  assert.match(migration, /create or replace function public\.mark_commission_summary_paid/);
  assert.match(migration, /private\.finance_is_internal\(v_summary\.organization_id\)/);
});
