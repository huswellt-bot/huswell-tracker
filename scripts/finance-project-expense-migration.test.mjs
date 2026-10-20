import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workspacePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "components",
  "finance-workspace.tsx",
);
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "231_finance_project_expense_limits.sql",
);
const workspace = readFileSync(workspacePath, "utf8");
const migration = readFileSync(migrationPath, "utf8").toLowerCase();

test("project expense migration contains its cap and authorization contract", () => {
  for (const clause of [
    "finance_project_expense_rows",
    "finance_project_expense_guard",
    "for update",
    "external_finance",
    "revision_requested",
    "commission_summary_id",
    "remaining_direct_cost",
  ]) {
    assert.match(migration, new RegExp(clause.replaceAll("_", "[_]")), clause);
  }
});

test("returned quotation-linked rows cannot be resubmitted without a quotation", () => {
  assert.match(
    migration,
    /old\.quotation_id\s+is\s+not\s+null[\s\S]*new\.quotation_id\s+is\s+null/,
  );
});

test("supplier payments are checked against their payable quotation", () => {
  assert.match(migration, /v_payable_quotation_id/);
  assert.match(migration, /supplier_payable_id/);
  assert.match(migration, /supplier payable.*quotation/i);
});

test("legacy lead-only revisions use an explicit regular-expense resubmission path", () => {
  assert.match(migration, /resubmit_finance_transaction_as_regular/);
  assert.match(workspace, /legacyLeadOnlyRevision/);
  assert.match(workspace, /resubmit_finance_transaction_as_regular/);
});
