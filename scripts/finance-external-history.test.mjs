import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = readFileSync(join(repoRoot, "components", "finance-workspace.tsx"), "utf8");
const workspaceShell = readFileSync(join(repoRoot, "components", "huswell-workspace.tsx"), "utf8");
const paymentRoute = readFileSync(join(repoRoot, "app", "api", "quotation-payments", "submit", "route.ts"), "utf8");
const transactionTableStart = workspace.indexOf("function TransactionTable(");
const transactionTableEnd = workspace.indexOf("function ProjectHistoryTable(", transactionTableStart);
const transactionTable = workspace.slice(transactionTableStart, transactionTableEnd);
const transactionDialogStart = workspace.indexOf("function TransactionDetailDialog(");
const transactionDialogEnd = workspace.indexOf("function ProjectFinanceDialog(", transactionDialogStart);
const transactionDialog = workspace.slice(transactionDialogStart, transactionDialogEnd);
const topHeaderStart = workspaceShell.indexOf('<header className="sticky top-0');
const topHeaderEnd = workspaceShell.indexOf("</header>", topHeaderStart);
const topHeader = workspaceShell.slice(topHeaderStart, topHeaderEnd);
const cashInSourceStart = workspace.indexOf("<legend>Cash In source</legend>");
const cashInSourceEnd = workspace.indexOf("</fieldset>", cashInSourceStart);
const cashInSource = workspace.slice(cashInSourceStart, cashInSourceEnd);
const transactionFormStart = workspace.indexOf("{transactionDirection && (");
const transactionFormEnd = workspace.indexOf("</FinanceDialog>", transactionFormStart);
const transactionForm = workspace.slice(transactionFormStart, transactionFormEnd);
const expenseTypeStart = transactionForm.indexOf("<legend>Expense type</legend>");
const expenseTypeEnd = transactionForm.indexOf("</fieldset>", expenseTypeStart);
const expenseType = transactionForm.slice(expenseTypeStart, expenseTypeEnd);

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

test("External Finance actions are labeled and placed in the top navbar", () => {
  assert.match(topHeader, /active === "Finance" && role === "external_finance"/);
  assert.match(topHeader, /<span className="hidden sm:inline">Cash In<\/span>/);
  assert.match(topHeader, /<span className="hidden sm:inline">Cash Out<\/span>/);
  assert.doesNotMatch(transactionTable, /Record Cash In|Submit Cash Out/);
});

test("top navbar actions request the existing Finance form", () => {
  assert.match(workspaceShell, /financeActionRequest/);
  assert.match(workspaceShell, /openAction=\{financeActionRequest\}/);
  assert.match(workspace, /openAction\?: Direction \| null/);
  assert.match(workspace, /setFormDirection\(openAction\)/);
});

test("the quotation payment toggle is labeled Project payment", () => {
  assert.match(cashInSource, />Project payment<\/button>/);
  assert.doesNotMatch(cashInSource, />Quotation payment<\/button>/);
});

test("Cash Out shows the available budget at the top of the modal", () => {
  const budgetIndex = transactionForm.indexOf("<span>Budget</span>");
  const expenseTypeIndex = transactionForm.indexOf("<legend>Expense type</legend>");

  assert.notEqual(budgetIndex, -1);
  assert.ok(expenseTypeIndex > budgetIndex);
});

test("the non-project Cash Out toggle uses its user-facing label", () => {
  assert.match(expenseType, />Non-Project Expense<\/button>/);
  assert.doesNotMatch(expenseType, />Regular expense<\/button>/);
});
