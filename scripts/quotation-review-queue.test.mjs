import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(
  join(repoRoot, "components", "huswell-workspace.tsx"),
  "utf8",
);

test("quotation review queue keeps quotation and project in separate cells", () => {
  assert.match(workspace, /"Price Quotation", "Project", "Client's Name", "Company Name"/);
  assert.match(workspace, /<td className="px-5 py-3">\{text\(quotation\.quotation_no, "—"\)\}<\/td>\s*<td className="px-5 py-3">\{text\(quotation\.project_name, "—"\)\}<\/td>/);
});

test("client and company are separate table values", () => {
  assert.match(workspace, /"Client's Name", "Company Name"/);
  assert.doesNotMatch(workspace, /stackedCell\(party\.clientName, party\.companyName\)/);
  assert.match(workspace, /<td className="px-5 py-3">\{party\.clientName\}<\/td>\s*<td className="px-5 py-3">\{party\.companyName\}<\/td>/);
});
