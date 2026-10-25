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
