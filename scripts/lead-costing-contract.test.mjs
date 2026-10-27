import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const costingWorkspace = readFileSync(join(repoRoot, "components", "lead-costing-workspace.tsx"), "utf8");
const migration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261027025253_lead_costing_module.sql"),
  "utf8",
);

test("Lead & Costing is exposed only in the Lead Coordinator workspace", () => {
  assert.match(workspace, /lead_coordinator: \["Leads", "Lead Costing", "Announcements", "Policy"\]/);
  assert.match(workspace, /role === "lead_coordinator" \? \[/);
  assert.match(workspace, /\{ view: "Lead Costing", icon: ReceiptText \}/);
  assert.match(workspace, /active === "Lead Costing" \? \(/);
  assert.match(workspace, /<DynamicLeadCostingWorkspace organizationId=\{organizationId\} \/>/);
});

test("Lead costing persistence is organization-scoped and server-authorized", () => {
  assert.match(migration, /create table if not exists public\.lead_costing_orders/);
  assert.match(migration, /create or replace function private\.lead_costing_is_operator/);
  assert.match(migration, /array\['lead_coordinator'\]/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /create policy %I on public\.%I for select/);
  assert.match(migration, /create or replace function public\.create_lead_costing_order/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /Only a Lead & Costing Coordinator can create costing orders/);
});

test("calculator preserves the target costing areas and print workflows", () => {
  assert.match(costingWorkspace, /laminationPerItem/);
  assert.match(costingWorkspace, /costAllowancePercent/);
  assert.match(costingWorkspace, /sellingPerItem/);
  assert.match(costingWorkspace, /Export sales CSV/);
  assert.match(costingWorkspace, /Export customers CSV/);
  assert.match(costingWorkspace, /Search media list/);
  assert.match(costingWorkspace, /Search inventory/);
  assert.match(costingWorkspace, /Search sales/);
  assert.match(costingWorkspace, /Search customers/);
  assert.match(costingWorkspace, /Copy quote/);
  assert.match(costingWorkspace, /Print quote/);
  assert.match(costingWorkspace, /printOrder\(row, "customer"\)/);
  assert.match(costingWorkspace, /printOrder\(row, "admin"\)/);
  assert.match(costingWorkspace, /lead-costing-data:/);
});
