import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/huswell-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261026163105_locked_pricing_markups.sql", import.meta.url), "utf8");
const deletionMigration = await readFile(new URL("../supabase/migrations/20261026164338_allow_pricing_markup_removal.sql", import.meta.url), "utf8");
const roleMigration = await readFile(new URL("../supabase/migrations/20261028040711_pricing_markup_role_assignments.sql", import.meta.url), "utf8");
const snapshotLabelMigration = await readFile(new URL("../supabase/migrations/20261028041726_preserve_pricing_markup_snapshot_labels.sql", import.meta.url), "utf8");

test("pricing defaults and costing payloads carry markup lock state", () => {
  assert.match(workspace, /locked: definition\.locked === true/);
  assert.match(workspace, /locked: markup\.locked === true/);
  assert.match(workspace, /locked: markup\.locked === true,/);
  assert.match(workspace, /target price behavior/);
});

test("Target Selling Price / Piece skips locked markups", () => {
  assert.match(workspace, /!isProtectedCommission\(markup\) && markup\.locked !== true/);
  assert.match(workspace, /isProtectedCommission\(markup\) \|\| markup\.locked === true/);
  assert.match(workspace, /Unlock at least one percentage markup before applying a Target Budget/);
});

test("individual Pricing Defaults deletion remains available", () => {
  assert.match(workspace, /Remove \$\{definition\.label\}/);
  assert.match(workspace, /removePricingMarkupDefault\(definition\.key\)/);
  assert.match(deletionMigration, /only required row/i);
  assert.match(deletionMigration, /if not \(p_defaults \? 'vat'\)/);
  assert.doesNotMatch(deletionMigration, /Missing pricing default: target_profit_margin/);
});

test("each Pricing Defaults row can be edited and updated", () => {
  assert.match(workspace, /Edit \$\{definition\.label\}/);
  assert.match(workspace, /openPricingMarkupEdit\(definition\)/);
  assert.match(workspace, /savePricingMarkupEdit/);
  assert.match(workspace, /key: "label", label: "Markup name", required: true/);
  assert.match(workspace, /label: text\(pricingMarkupEditValues\.label, editingPricingMarkup\.label\)\.trim\(\)/);
  assert.match(workspace, /ActionIcon label=\{`Edit \$\{definition\.label\}`\} confirm=\{false\}/);
  assert.match(workspace, /key: "purpose", label: "Purpose"/);
  assert.match(workspace, /saveLabel=\"Update markup\"/);
});

test("VAT can be assigned or deleted", () => {
  assert.match(workspace, /purpose === "vat"/);
  assert.match(workspace, /Delete the row to use 0% for new quotations/);
  assert.doesNotMatch(roleMigration, /Missing pricing default: vat/);
});

test("empty defaults stay empty and GM approval preserves snapshot labels", () => {
  assert.match(workspace, /const hasStoredConfiguration = stored !== null && stored !== undefined/);
  assert.match(snapshotLabelMigration, /create or replace function private\.refresh_gm_pricing_defaults_before_va_scope/);
  assert.match(snapshotLabelMigration, /nullif\(btrim\(v_markup ->> 'label'\), ''\)/);
  assert.doesNotMatch(snapshotLabelMigration, /when 'target_profit_margin' then 'Target Profit Margin'/);
});

test("deleting Sales Executive Commission preserves existing records", () => {
  assert.match(workspace, /Existing quotations and commission assignments keep their saved values/);
  assert.match(workspace, /removePricingMarkupDefault\(definition\.key\)/);
  assert.match(migration, /'sales_commission'/);
});

test("markup purpose assignment is stored and limited to one special role", () => {
  assert.match(workspace, /key: "purpose", label: "Purpose"/);
  assert.match(workspace, /system_role: definition\.purpose/);
  assert.match(workspace, /definition\.purpose === purpose/);
  assert.match(roleMigration, /create or replace function private\.pricing_markup_purpose/);
  assert.match(roleMigration, /Only one pricing default can be assigned as VAT/);
  assert.match(roleMigration, /Only one pricing default can be assigned as Sales Executive Commission/);
  assert.match(roleMigration, /when v_purpose = 'vat' then 'vat'/);
  assert.match(roleMigration, /when v_purpose = 'sales_commission' then 'sales_commission'/);
});

test("lock status uses compact accessible icons", () => {
  assert.match(workspace, /shortLabels: \{ unlocked: <Unlock size=\{15\} \/>, locked: <Lock size=\{15\} \/> \}/);
  assert.match(workspace, /definition\.locked \? <Lock size=\{14\} \/> : <Unlock size=\{14\} \/>/);
});

test("migration persists and validates lock state", () => {
  assert.match(migration, /add column if not exists locked boolean not null default false/);
  assert.match(migration, /lock state must be true or false/);
  assert.match(migration, /'locked', v_locked/);
  assert.match(migration, /'locked', cm\.locked/);
});
