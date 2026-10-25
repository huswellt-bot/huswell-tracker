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

test("quotation review queue does not repeat the company as the project detail", () => {
  assert.match(
    workspace,
    /const distinctQuotationProject = \(quotation: Row, companyName: unknown\)/,
  );
  assert.match(
    workspace,
    /stackedCell\(quotation\.quotation_no, distinctQuotationProject\(quotation, party\.companyName\)\)/,
  );
  assert.match(
    workspace,
    /stackedCell\(text\(quotation\?\.quotation_no, "Price Quotation"\), quotation \? distinctQuotationProject\(quotation, party\.companyName\) : ""\)/,
  );
});
