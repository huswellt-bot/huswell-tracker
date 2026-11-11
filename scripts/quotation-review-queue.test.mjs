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

test("quotation review queue keeps quotation and project separate from the combined party cell", () => {
  assert.match(workspace, /"Price Quotation", "Project", "Client \/ Company"/);
  assert.match(workspace, /<td className="px-5 py-3">\{text\(quotation\.quotation_no, [^}]+\)\}<\/td>\s*<td className="px-5 py-3">\{text\(quotation\.project_name, [^}]+\)\}<\/td>/);
});

test("GM quotations show only the approved section", () => {
  assert.match(workspace, /const quotationSectionTabs = isGeneralManager\s*\? \(\["approved"\] as const\)/);
});

test("client and company use the shared conditional stacked renderer", () => {
  assert.match(workspace, /import \{ ClientCompanyNames \} from "@\/components\/ui\/client-company-names"/);
  assert.doesNotMatch(workspace, /"Client's Name", "Company Name"/);
  assert.match(workspace, /<ClientCompanyNames clientName=\{party\.clientName\} companyName=\{party\.companyName\} \/>/);
});
