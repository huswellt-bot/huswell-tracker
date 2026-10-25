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
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
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
