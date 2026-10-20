import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "231_finance_project_expense_limits.sql",
);

test("project expense migration contains its cap and authorization contract", () => {
  const migration = readFileSync(migrationPath, "utf8").toLowerCase();

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
