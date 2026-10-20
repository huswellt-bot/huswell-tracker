import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const paymentRoute = readFileSync(join(repoRoot, "app", "api", "quotation-payments", "submit", "route.ts"), "utf8");
const transactionTableStart = workspace.indexOf("function TransactionTable(");
const transactionTableEnd = workspace.indexOf("function ProjectHistoryTable(", transactionTableStart);
const transactionTable = workspace.slice(transactionTableStart, transactionTableEnd);
const transactionDialogStart = workspace.indexOf("function TransactionDetailDialog(");
const transactionDialogEnd = workspace.indexOf("function ProjectFinanceDialog(", transactionDialogStart);
const transactionDialog = workspace.slice(transactionDialogStart, transactionDialogEnd);

test("External Finance history keeps only necessary columns and uses quotation as the payment reference", () => {
  assert.match(transactionTable, /\{internal && <th>Budget<\/th>\}/);
  assert.match(transactionTable, /\{internal && <th>Note<\/th>\}/);
  assert.match(transactionTable, /internal \? \(allowActions \? "min-w-\[1320px\]"/);
  assert.match(transactionTable, /transactionReference\(transaction, quotationName\)/);
  assert.match(transactionTable, /8 \+ \(internal \? 2 : 0\) \+ \(allowActions \? 2 : 0\)/);
});

test("quotation payment notes remain optional and are shown only from the real payment record", () => {
  assert.match(workspace, /Note \(optional\)/);
  assert.match(workspace, /form\.set\("notes", transactionValues\.note\.trim\(\)\)/);
  assert.match(workspace, /note: revision \? stringValue\(revision, "notes"\) : ""/);
  assert.match(transactionDialog, /stringValue\(payment, "notes"/);
});

test("quotation payment note input has a server-side length limit", () => {
  assert.match(paymentRoute, /MAX_NOTES_LENGTH = 1000/);
  assert.match(paymentRoute, /notes\.length > MAX_NOTES_LENGTH/);
});
