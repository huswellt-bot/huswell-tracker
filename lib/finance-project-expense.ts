export type ProjectExpenseTransactionLike = {
  transaction_type?: unknown;
  approval_status?: unknown;
  is_voided?: unknown;
  commission_summary_id?: unknown;
  commission_allocation_id?: unknown;
};

const releasedApprovalStatuses = new Set([
  "rejected",
  "revision_requested",
  "cancelled",
]);

const roundAmount = (value: number) =>
  Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;

export const isActiveProjectExpenseCommitment = (
  row: ProjectExpenseTransactionLike,
) =>
  row.transaction_type === "expense" &&
  row.is_voided !== true &&
  row.commission_summary_id == null &&
  row.commission_allocation_id == null &&
  !releasedApprovalStatuses.has(String(row.approval_status ?? ""));

export const remainingProjectExpense = (
  totalDirectCost: number,
  committedAmount: number,
) => roundAmount(Math.max(0, roundAmount(totalDirectCost) - roundAmount(committedAmount)));

export const exceedsProjectExpenseLimit = (amount: number, remainingAmount: number) =>
  roundAmount(amount) > roundAmount(remainingAmount);
