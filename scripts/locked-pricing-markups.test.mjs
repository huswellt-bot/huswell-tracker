import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/huswell-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261026163105_locked_pricing_markups.sql", import.meta.url), "utf8");
const deletionMigration = await readFile(new URL("../supabase/migrations/20261026164338_allow_pricing_markup_removal.sql", import.meta.url), "utf8");

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
  assert.match(workspace, /editingPricingMarkup\.key === "vat" \? "Default VAT percentage"/);
  assert.match(workspace, /saveLabel=\"Update markup\"/);
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
