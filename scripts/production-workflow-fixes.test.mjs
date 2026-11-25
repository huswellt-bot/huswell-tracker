import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const accessMigration = readFileSync(
  join(root, "supabase", "migrations", "20261126120000_production_access_payment_status_fixes.sql"),
  "utf8",
);
const costingMigration = readFileSync(
  join(root, "supabase", "migrations", "20261126120001_optimize_quotation_costing_read_policies.sql"),
  "utf8",
);
const workspace = readFileSync(join(root, "components", "huswell-workspace.tsx"), "utf8");

test("Production visibility remains limited to approved users", () => {
  assert.match(accessMigration, /create or replace function private\.can_view_production/);
  assert.match(accessMigration, /member\.role::text = any \(array\['super_admin', 'owner', 'admin', 'accountant'\]\)/);
  assert.match(accessMigration, /organization_member_capabilities/);
  assert.match(accessMigration, /production_operations_permissions/);
  assert.match(accessMigration, /revoke all on function private\.can_view_production\(uuid\) from public, anon/);
  assert.match(workspace, /const canViewProduction =\s*\n\s*isManagementRole \|\| hasInternalFinanceAccess \|\| productionOperationsEnabled/);
});

test("Production tiers and statuses enforce the reviewed lifecycle rules", () => {
  assert.match(accessMigration, /where percentage <> trunc\(percentage\)/);
  assert.match(accessMigration, /Tier percentage must be a whole number greater than 0/);
  assert.match(accessMigration, /Built-in Production statuses cannot be edited/);
  assert.match(accessMigration, /Completed and Delivered projects are final and cannot be removed/);
});

test("Production payment workflows lock active projects and cancel pending requests on archive", () => {
  assert.match(accessMigration, /status = 'cancelled'/);
  assert.match(accessMigration, /Request cancelled because the Production project was removed/);
  assert.match(accessMigration, /The Production project is no longer active/);
  assert.match(accessMigration, /select \* into v_job[\s\S]*for update;/);
});

test("quotation costing reads use one guarded helper per costing table", () => {
  assert.match(costingMigration, /create or replace function private\.can_read_price_quotation_costing/);
  assert.match(costingMigration, /security definer/);
  assert.equal((costingMigration.match(/create policy .*authorized read/g) ?? []).length, 3);
  assert.match(costingMigration, /private\.can_read_price_quotation_costing\(/);
  assert.match(costingMigration, /grant execute on function private\.can_read_price_quotation_costing\(uuid, uuid\)\s+to authenticated/);
});
