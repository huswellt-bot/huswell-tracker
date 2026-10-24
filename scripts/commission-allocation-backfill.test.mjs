import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(repoRoot, "supabase", "238_reconcile_legacy_commission_allocations.sql"),
  "utf8",
).toLowerCase();

test("legacy commission backfill preserves historical amounts and payout history", () => {
  assert.match(migration, /coalesce\(v_summary\.sales_commission_markup_amount, v_summary\.commission_amount, 0\)/);
  assert.match(migration, /commission_summary_allocations.*status = 'paid'/s);
  assert.match(migration, /finance_transactions transaction/);
  assert.match(migration, /transaction\.commission_summary_id = summary\.id/);
  assert.match(migration, /private\.upsert_commission_summary_allocation/);
  assert.match(migration, /commission_allocations_reconciled/);
  assert.match(migration, /legacy va commission data requires manual review/);
});

test("legacy commission backfill supports both self-handled and shared allocations", () => {
  assert.match(migration, /'self_handled_se'/);
  assert.match(migration, /'originating_se'/);
  assert.match(migration, /'costing_se'/);
  assert.match(migration, /v_total \* v_origin_rate \/ 100/);
  assert.match(migration, /private\.ensure_commission_summary_from_approved_quotation/);
  assert.match(migration, /huswell\.commission_assignment_rpc/);
  assert.match(migration, /commission_split_option = case/);
});
