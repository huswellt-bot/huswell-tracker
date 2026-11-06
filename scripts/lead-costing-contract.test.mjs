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
const latestIndexMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261105125811_lead_costing_latest_index_updates.sql"),
  "utf8",
);
const directWorkflowMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261105135427_lead_costing_direct_cost_pricing_workflow.sql"),
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
const printingSecurityValidationMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261105145557_lead_costing_printing_security_validation.sql"),
  "utf8",
);
const sheetInventoryMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261105152102_lead_costing_sheet_inventory_fields.sql"),
  "utf8",
);
const inventoryAndRevisionGuardsMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261105162713_lead_costing_inventory_and_revision_guards.sql"),
  "utf8",
);
const printingQuotationGuardMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261106011653_allow_lead_costing_printing_quotation_guards.sql"),
  "utf8",
);
const printingCostingItemGuardMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261106012313_allow_lead_costing_printing_costing_item_guard.sql"),
  "utf8",
);
const printingCommissionGuardMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20261106013353_skip_printing_quotation_commission_summary.sql"),
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

test("calculator is direct-cost only and quotation pricing stays in the GM workflow", () => {
  assert.match(costingWorkspace, /Direct Cost Calculator/);
  assert.match(costingWorkspace, /Saved Costings/);
  assert.match(costingWorkspace, /Save direct costing/);
  assert.match(costingWorkspace, /create_lead_costing_order_from_index_direct/);
  assert.match(costingWorkspace, /This page calculates direct production cost only/);
  assert.doesNotMatch(costingWorkspace, /Sales Dashboard/);
  assert.doesNotMatch(costingWorkspace, /Target gross profit margin/);
  assert.doesNotMatch(costingWorkspace, /Print Customer Copy/);
  assert.match(calculator, /totalOrderCost/);
  assert.match(calculator, /calculateProductionReadiness/);
  assert.match(calculator, /isPrintableLeadCostingMaterial/);
  assert.match(calculator, /printCostRateForUnit/);
  assert.doesNotMatch(calculator, /sellingPricePerItem/);
  assert.doesNotMatch(calculator, /estimatedProfit/);
  assert.match(costingWorkspace, /lead-costing-data-/);
  assert.match(indexMigration, /"materials":\[/);
  assert.match(indexMigration, /"services":\[/);
  assert.match(indexMigration, /"printerCosts":\[/);
  assert.match(indexMigration, /Saturn Digital/);
  assert.match(indexMigration, /Brand Maximizers Inc\. \(BMI\)/);
  assert.match(printingQuotation, /Printing Quotations/);
  assert.match(printingQuotation, /Collateral type/);
  assert.match(printingQuotation, /production_cost: productionCost/);
  assert.match(printingQuotation, /submit_lead_costing_printing_quotation/);
  assert.match(printingQuotation, /Stock readiness/);
  assert.match(printingQuotation, /manual_stock_confirmed/);
  assert.match(costingWorkspace, /createPrintingQuotationFromCalculator/);
  assert.match(printingQuotation, /LeadCostingPrintingQuotationPrefill/);
  assert.match(printingQuotationMigration, /quotation_source/);
  assert.match(printingQuotationMigration, /pending_gm_approval/);
  assert.match(printingQuotationMigration, /costing_metadata/);
  assert.match(costingWorkspace, /__custom__/);
  assert.match(costingWorkspace, /Pixels \(px\)/);
  assert.match(calculator, /0\.0254 \/ Math\.max\(1, numberValue\(input\.dpi\)/);
  assert.match(latestIndexMigration, /resolution_dpi/);
  assert.match(latestIndexMigration, /create_lead_costing_order_from_index_direct/);
  assert.match(latestIndexMigration, /measurement_unit in \('ft', 'in', 'm', 'px'\)/);
  assert.match(directWorkflowMigration, /seed_lead_costing_printing_product_costings/);
  assert.match(directWorkflowMigration, /Direct printing production cost/);
  assert.match(directWorkflowMigration, /create or replace function public\.submit_lead_costing_printing_quotation/);
  assert.match(directWorkflowMigration, /create or replace function public\.list_lead_costing_print_computations/);
  assert.match(workspace, /Add saved print computation/);
  assert.match(workspace, /list_lead_costing_print_computations/);
  assert.match(workspace, /Source ID/);
  assert.match(workspace, /direct_cost_per_item/);
  assert.match(printingSecurityValidationMigration, /lead_costing_can_access_lead/);
  assert.match(printingSecurityValidationMigration, /validate_lead_costing_printing_item/);
  assert.match(printingSecurityValidationMigration, /costing_mode = 'direct_printing'/);
  assert.match(printingSecurityValidationMigration, /manual_stock_confirmed/);
  assert.match(printingSecurityValidationMigration, /revoke all on function private\.seed_lead_costing_printing_product_costings/);
  assert.match(printingSecurityValidationMigration, /security definer[\s\S]*create_lead_costing_order_from_index_direct/);
  assert.match(printingSecurityValidationMigration, /revoke all on function public\.create_lead_costing_order_from_index\(/);
  assert.match(costingWorkspace, /available_sheets/);
  assert.match(costingWorkspace, /Available sheets/);
  assert.match(costingWorkspace, /name="materialType"/);
  assert.match(costingWorkspace, /is_sheet: String\(data\.get\("materialType"\)/);
  assert.match(costingWorkspace, /upsert/);
  assert.match(calculator, /availableSheets/);
  assert.match(calculator, /layoutValid/);
  assert.match(calculator, /requiredSheets/);
  assert.match(sheetInventoryMigration, /add column if not exists available_sheets/);
  assert.match(printingQuotation, /inventoryByMaterial/);
  assert.match(printingQuotation, /calculateProductionReadiness\(input, material, inventoryByMaterial/);
  assert.match(inventoryAndRevisionGuardsMigration, /lead_coordinator/);
  assert.match(inventoryAndRevisionGuardsMigration, /validate_lead_costing_printing_inventory/);
  assert.match(inventoryAndRevisionGuardsMigration, /validate_lead_costing_direct_layout/);
  assert.match(inventoryAndRevisionGuardsMigration, /lead_costing_printing_inventory_guard/);
});

test("printing quotations bypass only the legacy project-officer quotation guards", () => {
  assert.match(printingQuotationGuardMigration, /enforce_project_officer_price_quotation_content/);
  assert.match(printingQuotationGuardMigration, /enforce_project_officer_price_quotation_items/);
  assert.match(printingQuotationGuardMigration, /enforce_price_quotation_preparation/);
  assert.match(printingQuotationGuardMigration, /coalesce\(new\.quotation_source, 'standard'\) <> 'lead_costing_printing'/);
  assert.match(printingQuotationGuardMigration, /coalesce\(v_quotation\.quotation_source, 'standard'\) <> 'lead_costing_printing'/);
  assert.match(printingQuotationGuardMigration, /Only a Sales Project Officer can change Price Quotation items/);
  assert.match(printingQuotationGuardMigration, /Only the General Manager can set quotation prices or totals/);
});

test("printing submission can seed its direct-cost quotation item snapshot", () => {
  assert.match(printingCostingItemGuardMigration, /enforce_price_quotation_item_preparation/);
  assert.match(printingCostingItemGuardMigration, /coalesce\(v_quote\.quotation_source, 'standard'\) <> 'lead_costing_printing'/);
  assert.match(printingCostingItemGuardMigration, /Only the assigned Sales & Pricing Officer can set Selling Price \/ Unit/);
});

test("approved printing quotations do not enter the standard commission summary workflow", () => {
  assert.match(printingCommissionGuardMigration, /create_commission_summary_on_quotation_approval/);
  assert.match(printingCommissionGuardMigration, /coalesce\(new\.quotation_source, 'standard'\) <> 'lead_costing_printing'/);
  assert.match(printingCommissionGuardMigration, /ensure_commission_summary_from_approved_quotation/);
});
