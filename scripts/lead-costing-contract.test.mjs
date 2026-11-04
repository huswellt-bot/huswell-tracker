import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspace = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const costingWorkspace = readFileSync(join(repoRoot, "components", "lead-costing-index-workspace.tsx"), "utf8");
const calculator = readFileSync(join(repoRoot, "lib", "lead-costing-calculator.ts"), "utf8");
const securityMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261027025253_lead_costing_module.sql"),
  "utf8",
);
const indexMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261104115933_lead_costing_index_reference_data.sql"),
  "utf8",
);
const printingQuotation = readFileSync(
  join(repoRoot, "components", "lead-costing-printing-quotation.tsx"),
  "utf8",
);
const printingQuotationMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261104132346_lead_costing_printing_quotations.sql"),
  "utf8",
);

test("Lead & Costing is exposed only in the Lead Coordinator workspace", () => {
  assert.match(workspace, /lead_coordinator: \["Leads", "Lead Costing", "Announcements", "Policy"\]/);
  assert.match(workspace, /role === "lead_coordinator" \? \[/);
  assert.match(workspace, /\{ view: "Lead Costing", icon: ReceiptText \}/);
  assert.match(workspace, /active === "Lead Costing" \? \(/);
  assert.match(workspace, /<DynamicLeadCostingWorkspace organizationId=\{organizationId\} \/>/);
  assert.match(workspace, /lead-costing-index-workspace/);
});

test("retired HP Latex 700W page is not mounted or shown in workspace navigation", () => {
  assert.doesNotMatch(workspace, /PDF Costing/);
  assert.doesNotMatch(workspace, /CostingRequestWorkspace/);
  assert.doesNotMatch(workspace, /HP Latex 700W/);
});

test("Lead costing persistence is organization-scoped and server-authorized", () => {
  assert.match(securityMigration, /create table if not exists public\.lead_costing_orders/);
  assert.match(securityMigration, /create or replace function private\.lead_costing_is_operator/);
  assert.match(securityMigration, /array\['lead_coordinator'\]/);
  assert.match(securityMigration, /enable row level security/);
  assert.match(securityMigration, /create policy %I on public\.%I for select/);
  assert.match(securityMigration, /create or replace function public\.create_lead_costing_order/);
  assert.match(securityMigration, /security invoker/);
  assert.match(indexMigration, /create or replace function public\.create_lead_costing_order_from_index/);
  assert.match(indexMigration, /waste_allowance_per_project/);
  assert.match(indexMigration, /Only a Lead & Costing Coordinator can create costing orders/);
});

test("calculator preserves the target costing areas and print workflows", () => {
  assert.match(costingWorkspace, /laminationPerItem/);
  assert.match(calculator, /costAllowancePercent/);
  assert.match(costingWorkspace, /calculateLeadCosting/);
  assert.match(costingWorkspace, /create_lead_costing_order_from_index/);
  assert.match(costingWorkspace, /Export sales CSV/);
  assert.match(costingWorkspace, /Export customers CSV/);
  assert.match(costingWorkspace, /Search media, code, supplier/);
  assert.match(costingWorkspace, /Search material, code, supplier/);
  assert.match(costingWorkspace, /Search customer, order, service/);
  assert.match(costingWorkspace, /Search customer, contact, inquiry/);
  assert.match(costingWorkspace, /Copy quotation summary/);
  assert.match(costingWorkspace, /Print Customer \+ Admin Copies/);
  assert.match(costingWorkspace, /printOrder\(order, "customer"\)/);
  assert.match(costingWorkspace, /printOrder\(order, "admin"\)/);
  assert.match(costingWorkspace, /lead-costing-data:/);
  assert.match(indexMigration, /"materials":\[/);
  assert.match(indexMigration, /"services":\[/);
  assert.match(indexMigration, /"printerCosts":\[/);
  assert.match(indexMigration, /Saturn Digital/);
  assert.match(indexMigration, /Brand Maximizers Inc\. \(BMI\)/);
  assert.match(printingQuotation, /Printing Quotations/);
  assert.match(printingQuotation, /Collateral type/);
  assert.match(printingQuotation, /submit_lead_costing_printing_quotation/);
  assert.match(printingQuotationMigration, /quotation_source/);
  assert.match(printingQuotationMigration, /pending_gm_approval/);
  assert.match(printingQuotationMigration, /costing_metadata/);
});
