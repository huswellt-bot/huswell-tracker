import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20261027124302_harden_security_advisors.sql", import.meta.url),
  "utf8",
);

test("security hardening removes anonymous inheritance without removing app roles", () => {
  assert.match(migration, /revoke execute on function %s from public/);
  assert.match(migration, /grant execute on function %s to authenticated, service_role/);
});

test("follow-up hardening removes explicit anonymous grants", async () => {
  const followUp = await readFile(
    new URL("../supabase/migrations/20261027124326_revoke_anon_security_definer_execution.sql", import.meta.url),
    "utf8",
  );
  assert.match(followUp, /revoke execute on function %s from anon/);
});

test("security hardening pins every mutable search path reported by the advisor", () => {
  for (const functionName of [
    "public.set_updated_at",
    "public.apply_inventory_movement",
    "public.recalculate_invoice_totals",
    "public.set_approval_updated_at",
    "public.queue_cash_flow_approval",
    "public.recalculate_quotation_totals",
    "private.is_valid_assigned_box_makers",
    "private.effective_assigned_box_makers",
    "private.same_assigned_box_maker_set",
    "private.canonical_pricing_markup_key",
    "private.default_print_costing_defaults",
    "private.preserve_lead_endorsement_history",
  ]) {
    assert.match(migration, new RegExp(`alter function ${functionName.replaceAll(".", "\\.")}`));
  }
});

test("budget summary keeps explicit authorization behind an invoker view", () => {
  assert.match(migration, /create or replace function private\.finance_account_budget_summary_rows/);
  assert.match(migration, /private\.finance_is_budget_viewer\(allocation\.organization_id\)/);
  assert.match(migration, /with \(security_invoker = true\)/);
});

test("mockup task policies cache auth.uid per statement", async () => {
  const rlsMigration = await readFile(
    new URL("../supabase/migrations/20261027124419_optimize_mockup_task_rls.sql", import.meta.url),
    "utf8",
  );
  assert.equal((rlsMigration.match(/\(select auth\.uid\(\)\)/g) ?? []).length, 7);
  assert.match(rlsMigration, /drop policy if exists "mockup tasks: officer insert"/);
  assert.match(rlsMigration, /drop policy if exists "mockup tasks: officer revise and resubmit"/);
  assert.match(rlsMigration, /drop policy if exists "mockup tasks: read"/);
});
