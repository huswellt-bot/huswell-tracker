import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/huswell-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261026153105_approved_selling_prices_per_item.sql", import.meta.url), "utf8");

test("Pricing Officer UI exposes one approved price input per quotation item", () => {
  assert.match(workspace, /Approved Selling Price \/ Unit/);
  assert.match(workspace, /approvedSellingPrices\[text\(line\.id\)\]/);
  assert.match(workspace, /Enter an Approved Selling Price \/ Unit for every quotation product/);
});

test("review submission uses the structured approved-price RPCs", () => {
  assert.match(workspace, /pricing_review_price_quotation_with_approved_prices/);
  assert.match(workspace, /pricing_review_price_quotation_with_commission_and_approved_prices/);
  assert.match(workspace, /p_approved_selling_prices: approvedSellingPricesPayload/);
});

test("migration stores approved prices separately from the GM target price", () => {
  assert.match(migration, /add column if not exists approved_selling_price numeric\(14,2\)/);
  assert.match(migration, /quotation_items_approved_selling_price_check/);
  assert.match(workspace, /Target Selling Price \/ Piece/); // preserves the distinction in the UI contract
});

test("migration validates item ownership and Pricing Officer authorization", () => {
  assert.match(migration, /Only the assigned Sales & Pricing Officer can review this Price Quotation/);
  assert.match(migration, /Only the selected Pricing Officer can review this quotation/);
  assert.match(migration, /Approved selling price item does not belong to this quotation/);
});
