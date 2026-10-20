import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types test runner resolves the .ts suffix directly.
import { exceedsProjectExpenseLimit, isActiveProjectExpenseCommitment, remainingProjectExpense } from "./finance-project-expense.ts";

const expenseRow = (overrides: Record<string, unknown> = {}) => ({
  transaction_type: "expense",
  approval_status: "pending",
  is_voided: false,
  commission_summary_id: null,
  commission_allocation_id: null,
  ...overrides,
});

test("pending, approved, and paid expenses reserve project capacity", () => {
  for (const approvalStatus of ["pending", "approved"]) {
    assert.equal(
      isActiveProjectExpenseCommitment(expenseRow({ approval_status: approvalStatus })),
      true,
    );
  }

  assert.equal(
    isActiveProjectExpenseCommitment(expenseRow({ payment_status: "paid" })),
    true,
  );
});

test("released, voided, commission, and income rows do not reserve capacity", () => {
  for (const approvalStatus of ["rejected", "revision_requested", "cancelled"]) {
    assert.equal(
      isActiveProjectExpenseCommitment(expenseRow({ approval_status: approvalStatus })),
      false,
    );
  }

  assert.equal(isActiveProjectExpenseCommitment(expenseRow({ is_voided: true })), false);
  assert.equal(
    isActiveProjectExpenseCommitment(expenseRow({ commission_summary_id: "commission" })),
    false,
  );
  assert.equal(
    isActiveProjectExpenseCommitment(expenseRow({ commission_allocation_id: "allocation" })),
    false,
  );
  assert.equal(
    isActiveProjectExpenseCommitment(expenseRow({ transaction_type: "income" })),
    false,
  );
});

test("remaining project expense is the direct cost less committed amounts with a zero floor", () => {
  assert.equal(remainingProjectExpense(100_000, 35_000), 65_000);
  assert.equal(remainingProjectExpense(100_000, 125_000), 0);
});

test("an expense can use the exact remaining amount but not exceed it", () => {
  assert.equal(exceedsProjectExpenseLimit(65_000, 65_000), false);
  assert.equal(exceedsProjectExpenseLimit(65_000.01, 65_000), true);
});
