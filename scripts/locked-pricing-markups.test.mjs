import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/huswell-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261026163105_locked_pricing_markups.sql", import.meta.url), "utf8");
const vatMigration = await readFile(new URL("../supabase/migrations/20261028051802_vat_lock_target_price_behavior.sql", import.meta.url), "utf8");
const vatFlowMigration = await readFile(new URL("../supabase/migrations/20261028065024_quotation_vat_treatment_flow.sql", import.meta.url), "utf8");
const vatServerGuardMigration = await readFile(new URL("../supabase/migrations/20261028065342_quotation_vat_server_rate_guard.sql", import.meta.url), "utf8");
const vatSnapshotMigration = await readFile(new URL("../supabase/migrations/20261028065606_quotation_vat_snapshot_preservation.sql", import.meta.url), "utf8");
const singleVatSourceMigration = await readFile(new URL("../supabase/migrations/20261028071758_single_vat_settings_source.sql", import.meta.url), "utf8");
const legacyVatMigration = await readFile(new URL("../supabase/migrations/20261028071817_normalize_legacy_vat_markup.sql", import.meta.url), "utf8");
const gmMarkupRefreshMigration = await readFile(new URL("../supabase/migrations/20261028073156_refresh_gm_quotation_markups_from_settings.sql", import.meta.url), "utf8");
const deletionMigration = await readFile(new URL("../supabase/migrations/20261026164338_allow_pricing_markup_removal.sql", import.meta.url), "utf8");
const roleMigration = await readFile(new URL("../supabase/migrations/20261028040711_pricing_markup_role_assignments.sql", import.meta.url), "utf8");
const snapshotLabelMigration = await readFile(new URL("../supabase/migrations/20261028041726_preserve_pricing_markup_snapshot_labels.sql", import.meta.url), "utf8");

test("pricing defaults and costing payloads carry markup lock state", () => {
  assert.match(workspace, /locked: definition\.locked === true/);
  assert.match(workspace, /locked: markup\.locked === true/);
  assert.match(workspace, /locked: markup\.locked === true,/);
  assert.match(workspace, /vat_locked: costing\.vatLocked === true/);
  assert.match(workspace, /vatLocked: costing\.vat_locked === undefined \? true : costing\.vat_locked === true/);
  assert.match(workspace, /target price behavior/);
});

test("Target Selling Price / Piece skips locked markups", () => {
  assert.match(workspace, /!isProtectedCommission\(markup\) && markup\.locked !== true/);
  assert.match(workspace, /isProtectedCommission\(markup\) \|\| markup\.locked === true/);
  assert.match(workspace, /const hasAdjustableVat = vatInclusive && !vatLocked/);
  assert.match(workspace, /Unlock at least one percentage markup or VAT before applying a Target Budget/);
});

test("VAT lock state is persisted and participates in target-price recomputation", () => {
  assert.match(workspace, /vatLocked: boolean/);
  assert.match(workspace, /const vatLockState/);
  assert.match(workspace, /toggleVatLock/);
  assert.match(workspace, /vatLocked: nextLocked/);
  assert.match(workspace, /vatInclusive\s*\?\s*vatLocked/);
  assert.match(vatMigration, /add column if not exists vat_locked boolean not null default true/);
  assert.match(vatMigration, /coalesce\(\(v_costing ->> 'vat_locked'\)::boolean, true\)/);
  assert.match(vatMigration, /'vat_locked', pc\.vat_locked/);
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
  assert.match(workspace, /aria-label=\{`\$\{vatLockState === true \? "Unlock" : "Lock"\} VAT/);
});

test("migration persists and validates lock state", () => {
  assert.match(migration, /add column if not exists locked boolean not null default false/);
  assert.match(migration, /lock state must be true or false/);
  assert.match(migration, /'locked', v_locked/);
  assert.match(migration, /'locked', cm\.locked/);
});

test("VAT treatment uses one GM default, quotation mode, and guarded override", () => {
  assert.match(workspace, /const \[vatInclusive, setVatInclusive\]/);
  assert.match(workspace, /Quotation VAT treatment/);
  assert.match(workspace, /p_vat_inclusive: vatInclusive/);
  assert.match(workspace, /p_vat_rate: appliedVatRate/);
  assert.match(workspace, /set_price_quotation_vat_preferences/);
  assert.match(vatFlowMigration, /add column if not exists vat_inclusive boolean not null default false/);
  assert.match(vatFlowMigration, /add column if not exists vat_rate_snapshot numeric\(5,2\) not null default 0/);
  assert.match(vatFlowMigration, /create or replace function public\.set_price_quotation_vat_preferences/);
  assert.match(vatFlowMigration, /Only the assigned Sales & Pricing Officer can choose VAT treatment/);
  assert.match(vatFlowMigration, /grant execute on function public\.set_price_quotation_vat_preferences/);
});

test("Pricing Officer submission cannot overwrite the server VAT snapshot", () => {
  assert.match(vatServerGuardMigration, /create or replace function private\.persist_product_quotation_totals/);
  assert.match(vatServerGuardMigration, /if p_status = 'pending_gm_approval'/);
  assert.match(vatServerGuardMigration, /case when v_vat_inclusive then v_vat_rate else 0 end/);
  assert.match(vatServerGuardMigration, /vat_rate_snapshot = v_vat_rate/);
  assert.match(vatServerGuardMigration, /vat_rate = v_vat_rate/);
});

test("VAT Exclusive preserves the editable snapshot without applying VAT", () => {
  assert.match(vatSnapshotMigration, /v_vat_rate := case when v_vat_inclusive/);
  assert.match(vatSnapshotMigration, /else 0/);
  assert.match(vatSnapshotMigration, /v_vat_snapshot_rate := case when v_vat_inclusive/);
  assert.match(vatSnapshotMigration, /else v_vat_snapshot_rate/);
  assert.match(vatSnapshotMigration, /vat_rate_snapshot = v_vat_snapshot_rate/);
});

test("Approval Center uses the single GM Settings VAT source", () => {
  assert.match(workspace, /VAT percentage from GM Settings/);
  assert.match(workspace, /single VAT purpose in GM Settings/);
  assert.doesNotMatch(workspace, /GM can edit the rate before final approval/);
  assert.match(singleVatSourceMigration, /v_rate := v_default_rate/);
  assert.match(singleVatSourceMigration, /pricing_markup_purpose\(entry.key, entry.value\) = 'vat'/);
  assert.match(legacyVatMigration, /'vat'/);
  assert.match(legacyVatMigration, /'third_party_markup'/);
  assert.match(legacyVatMigration, /system_role', 'vat'/);
});

test("GM Approval Center refreshes pending markup rows from current Settings", () => {
  assert.match(workspace, /applyCurrentPricingDefaultsToCosting/);
  assert.match(workspace, /shouldRefreshGmMarkups\s*=\s*finalApproval\s*&&\s*text\(quotation\.status, ""\) === "pending_gm_approval"/);
  assert.match(workspace, /shouldRefreshGmMarkups\s*\?\s*savedCostings\.map/);
  assert.match(workspace, /shouldRefreshGmMarkups\s*\?\s*loadedCostings\.map/);
  assert.match(workspace, /defaults\s*\.filter\(\(definition\) => definition\.purpose !== "vat"\)/);
  assert.match(workspace, /refresh_gm_price_quotation_markups/);
  assert.match(gmMarkupRefreshMigration, /create or replace function public\.refresh_gm_price_quotation_markups/);
  assert.match(gmMarkupRefreshMigration, /Only the General Manager can refresh quotation markups/);
  assert.match(gmMarkupRefreshMigration, /pricing_markup_purpose\(entry.key, entry.value\) <> 'vat'/);
});
