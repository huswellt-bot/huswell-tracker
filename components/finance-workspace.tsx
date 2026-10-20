"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  LoaderCircle,
  Plus,
  ReceiptText,
  Search,
  Undo2,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  Document as PdfDocument,
  Page as PdfPage,
  StyleSheet as PdfStyleSheet,
  Text as PdfText,
  View as PdfView,
  pdf,
} from "@react-pdf/renderer";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  exceedsProjectExpenseLimit,
  isActiveProjectExpenseCommitment,
  remainingProjectExpense,
} from "@/lib/finance-project-expense";
import { FileUploadControl } from "@/components/ui/file-upload-control";
import { LoadingState } from "@/components/ui/loading-state";
import { NumberInput } from "@/components/ui/number-input";
import { SearchableLeadSelect } from "@/components/ui/searchable-lead-select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { TABLE_PAGE_SIZE, TablePagination } from "@/components/ui/table-pagination";
import { NotificationDialog } from "@/components/ui/notification-dialog";

type Row = { id?: string; [key: string]: unknown };
type Direction = "income" | "expense";
type CashInSource = "other_income" | "quotation_payment";
type ExpenseMode = "regular" | "project" | "supplier";
type Tab = "overview" | "reports" | "approvals" | "transactions" | "accounts" | "budget" | "supplier_costing" | "payables";
type PayablesSection = "commission" | "supplier";
type Period = "all" | "weekly" | "monthly" | "yearly";
type BudgetDecision = "approved" | "rejected" | "revision_requested";
type QuotationPaymentDecision = "verified" | "revision_requested" | "rejected";
type TransactionView = "all" | "income" | "expense";
type TransactionSourceFilter = "all" | "quotation_payment" | "other_income" | "regular_expense" | "project_expense" | "supplier_payment" | "commission_payout";
type TransactionStatusFilter = "all" | "needs_review" | "completed" | "returned" | "reversed";
type PendingApprovalFilter = "all" | "income" | "expense";

type ProjectHistoryRow = {
  key: string;
  projectName: string;
  clientName: string;
  quotationNumbers: string[];
  latestDate: string;
  transactions: Row[];
};

type MonthlyFinanceReportRow = {
  key: string;
  label: string;
  cashIn: number;
  cashOut: number;
  netEarnings: number;
  verifiedTransactions: number;
  pendingOrReturned: number;
};

type PendingApprovalRow = {
  id: string;
  kind: "quotation_payment" | "finance_transaction";
  direction: Direction;
  date: unknown;
  description: string;
  note: string;
  source: string;
  amount: number;
  accountId: string;
  status: string;
  receiptPath: string;
  receiptBucket: string;
  payment?: Row;
  quotation?: Row;
  lead?: Row;
  transaction?: Row;
};

const transactionViewOptions: Array<{ value: TransactionView; label: string }> = [
  { value: "all", label: "All" },
  { value: "income", label: "Cash In" },
  { value: "expense", label: "Cash Out" },
];

const transactionSourceFilterOptions: Array<{ value: TransactionSourceFilter; label: string; direction: TransactionView }> = [
  { value: "quotation_payment", label: "Quotation payments", direction: "income" },
  { value: "other_income", label: "Other income", direction: "income" },
  { value: "regular_expense", label: "Regular expenses", direction: "expense" },
  { value: "project_expense", label: "Project expenses", direction: "expense" },
  { value: "supplier_payment", label: "Supplier payments", direction: "expense" },
  { value: "commission_payout", label: "Commission payouts", direction: "expense" },
];

const transactionStatusFilterOptions: Array<{ value: TransactionStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "needs_review", label: "Needs review" },
  { value: "completed", label: "Completed" },
  { value: "returned", label: "Returned" },
  { value: "reversed", label: "Reversed" },
];

const payablesSectionOptions: { value: PayablesSection; label: string }[] = [
  { value: "commission", label: "Commission payouts" },
  { value: "supplier", label: "Supplier payables" },
];

const commissionRoleLabel = (value: unknown) => {
  const role = String(value ?? "");
  if (role === "originating_se") return "S.E. Origin";
  if (role === "costing_se") return "Co-Worker";
  if (role === "self_handled_se") return "Self-handled";
  return role.replaceAll("_", " ") || "—";
};

const commissionDivisionLabel = (value: unknown) => {
  if (value === "self_handled_100_0") return "100% S.E. Origin";
  if (value === "50_50") return "50% / 50%";
  if (value === "60_40") return "60% / 40%";
  if (value === "70_30") return "70% / 30%";
  if (value === "80_20") return "80% / 20%";
  return "—";
};

const financePaymentMethods = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
  ["gcash", "GCash"],
  ["card", "Card"],
  ["check", "Check"],
  ["other", "Other"],
] as const;

const financePaymentMethodLabel = (value: unknown) =>
  financePaymentMethods.find(([key]) => key === String(value ?? ""))?.[1] ?? "Other";

const defaultPaymentMethodForAccountType = (accountType: string) => {
  if (accountType === "e_wallet") return "gcash";
  if (accountType === "cash") return "cash";
  if (accountType === "other") return "other";
  return "bank_transfer";
};

const accountFundingSources = [
  ["owner_funding", "Owner funding"],
  ["loan_received", "Loan received"],
  ["external_deposit", "External deposit"],
  ["other", "Other"],
] as const;

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

const stringValue = (row: Row | null | undefined, key: string, fallback = "") => {
  const value = row?.[key];
  return value === null || value === undefined ? fallback : String(value);
};

const uniqueTextParts = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value) => value.trim());
};

const financeProjectLabel = (
  quotation: Row | null | undefined,
  lead: Row | null | undefined,
  fallback = "Project",
) => {
  const companyName = stringValue(quotation, "client_name") || stringValue(lead, "client_name");
  const clientName = stringValue(quotation, "client_contact_name") || stringValue(lead, "contact_name");
  const quotationId = stringValue(quotation, "quotation_no") || fallback;
  return uniqueTextParts([companyName, clientName, quotationId]).join(" - ") || fallback;
};

const numericValue = (row: Row | null | undefined, key: string) => {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : 0;
};

const localDate = () => {
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
  }).format(new Date());
  return value;
};

const displayDate = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  return Number.isNaN(parsed.getTime())
    ? raw.slice(0, 10)
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
};

const extensionFor = (file: File) =>
  file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";

const isInternalRole = (role: string) =>
  ["super_admin", "owner", "admin", "accountant", "internal_finance"].includes(role);

const canUseFinance = (role: string) =>
  isInternalRole(role) || role === "external_finance";

const defaultTransaction = (direction: Direction, categoryId = "") => ({
  amount: "",
  category_id: categoryId,
  account_id: "",
  budget_request_id: "",
  note: "",
  reference_number: "",
  transaction_date: localDate(),
  transaction_time: new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()),
  payment_status: "unpaid",
  lead_id: "",
  quotation_id: "",
  payment_kind: "downpayment",
  supplier_payable_id: "",
  commission_allocation_id: "",
});

const quotationPaymentKindOptions = [
  ["downpayment", "Downpayment"],
  ["full_payment", "Full payment"],
] as const;

type FinanceQuotationPaymentSummary = {
  total: number;
  pending: number;
  verified: number;
  available: number;
  downpaymentTarget: number;
  downpaymentRemaining: number;
};

const roundFinancePayment = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const financeQuotationPaymentSummary = (quotation: Row, records: Row[]): FinanceQuotationPaymentSummary => {
  const total = roundFinancePayment(Math.max(0, numericValue(quotation, "total_amount")));
  const related = records.filter((record) => String(record.quotation_id ?? "") === String(quotation.id ?? ""));
  const pending = roundFinancePayment(related.filter((record) => stringValue(record, "status") === "pending").reduce((sum, record) => sum + numericValue(record, "amount"), 0));
  const verified = roundFinancePayment(related.filter((record) => stringValue(record, "status") === "verified").reduce((sum, record) => sum + numericValue(record, "amount"), 0));
  const downpaymentTarget = roundFinancePayment(total * 0.5);
  return {
    total,
    pending,
    verified,
    available: roundFinancePayment(Math.max(total - verified - pending, 0)),
    downpaymentTarget,
    downpaymentRemaining: roundFinancePayment(Math.max(downpaymentTarget - verified - pending, 0)),
  };
};

const financeQuotationPaymentDefaultKind = (summary: FinanceQuotationPaymentSummary) =>
  summary.downpaymentRemaining > 0 ? "downpayment" : "full_payment";

const financeQuotationPaymentSuggestedAmount = (kind: string, summary: FinanceQuotationPaymentSummary) => {
  const amount = kind === "downpayment" ? summary.downpaymentRemaining : kind === "full_payment" ? summary.available : 0;
  return amount > 0 ? roundFinancePayment(amount).toFixed(2) : "";
};

const statusClass = (value: string) => {
  if (["rejected", "cancelled", "voided", "reversed"].includes(value)) return "bg-[#fef3f2] text-[#b42318]";
  if (["revision_requested", "returned"].includes(value)) return "bg-[#f5f3ff] text-[#6941c6]";
  if (["pending", "pending_confirmation", "pending_approval", "awaiting_payment", "needs_review", "unpaid"].includes(value)) return "bg-[#fff8e9] text-[#a76605]";
  if (["approved", "paid", "verified", "completed"].includes(value)) return "bg-[#edf9f2] text-[#218b55]";
  return "bg-[#f1f4f8] text-[#626b7a]";
};

const isManualIncomeTransaction = (row: Row | null | undefined) =>
  stringValue(row, "transaction_type") === "income"
  && stringValue(row, "income_source") === "manual";

const transactionSourceValue = (row: Row): TransactionSourceFilter => {
  if (stringValue(row, "transaction_type") === "income") {
    return row.source_payment_id || stringValue(row, "income_source") === "quotation_payment"
      ? "quotation_payment"
      : "other_income";
  }
  if (row.supplier_payable_id) return "supplier_payment";
  if (row.commission_summary_id || row.commission_allocation_id) return "commission_payout";
  if (row.quotation_id || row.lead_id) return "project_expense";
  return "regular_expense";
};

const transactionSourceLabel = (row: Row) =>
  transactionSourceFilterOptions.find((option) => option.value === transactionSourceValue(row))?.label ?? "Other transaction";

const transactionStatusFilterValue = (row: Row): Exclude<TransactionStatusFilter, "all"> => {
  if (Boolean(row.is_voided)) return "reversed";
  if (stringValue(row, "transaction_type") === "income") {
    if (isManualIncomeTransaction(row) && stringValue(row, "income_review_status") === "revision_requested") return "returned";
    return stringValue(row, "payment_status") === "paid" ? "completed" : "needs_review";
  }
  if (stringValue(row, "approval_status") === "revision_requested") return "returned";
  if (stringValue(row, "payment_status") === "paid") return "completed";
  return "needs_review";
};

const transactionStatusLabel = (row: Row) => {
  if (Boolean(row.is_voided)) return "reversed";
  if (stringValue(row, "transaction_type") === "income") {
    if (isManualIncomeTransaction(row)) {
      if (stringValue(row, "income_review_status") === "revision_requested") return "returned";
      if (stringValue(row, "payment_status") === "paid") return "completed";
      return "pending_confirmation";
    }
    return stringValue(row, "payment_status") === "paid" ? "completed" : "needs_review";
  }
  if (stringValue(row, "approval_status") === "revision_requested") return "returned";
  if (stringValue(row, "payment_status") === "paid") return "completed";
  if (stringValue(row, "approval_status") === "approved") return "awaiting_payment";
  return "pending_approval";
};

const transactionNote = (row: Row) => {
  if (Boolean(row.is_voided)) return `Voided: ${stringValue(row, "void_reason", "Reversed transaction")}`;
  if (transactionStatusFilterValue(row) === "returned") {
    return `Correction requested: ${stringValue(row, "decision_note", "See reviewer note")}`;
  }
  return stringValue(row, "note", "-");
};

const transactionReference = (row: Row, quotationName: (id: unknown) => string) => {
  const reference = stringValue(row, "reference_number");
  if (reference) return reference;
  if (!row.source_payment_id) return "-";
  const quotation = quotationName(row.quotation_id);
  return quotation === "—" ? "-" : quotation;
};

const transactionStatusValue = (row: Row) => {
  if (Boolean(row.is_voided)) return "voided";
  if (isManualIncomeTransaction(row)) {
    const reviewStatus = stringValue(row, "income_review_status");
    if (reviewStatus === "revision_requested") return "revision_requested";
    if (reviewStatus === "pending" && stringValue(row, "payment_status") === "unpaid") return "pending_confirmation";
  }
  return stringValue(row, "payment_status");
};

const isVerifiedFinanceTransaction = (row: Row) => {
  if (Boolean(row.is_voided)) return false;
  const type = stringValue(row, "transaction_type");
  if (type === "income") {
    return stringValue(row, "payment_status") === "paid"
      && (
        Boolean(row.source_payment_id)
        || (stringValue(row, "income_source") === "manual" && stringValue(row, "income_review_status") === "verified")
      );
  }
  return type === "expense"
    && stringValue(row, "approval_status") === "approved"
    && stringValue(row, "payment_status") === "paid";
};

const primaryButton =
  "button-primary";
const secondaryButton =
  "button-secondary";

type FinanceAction =
  | { kind: "approve_and_pay"; id: string; label: string }
  | { kind: "revision"; id: string; label: string }
  | { kind: "quotation_payment"; id: string; decision: QuotationPaymentDecision; label: string }
  | { kind: "verify_income"; id: string; label: string }
  | { kind: "income_revision"; id: string; label: string }
  | { kind: "income_void"; id: string; label: string }
  | { kind: "budget"; id: string; decision: BudgetDecision; label: string }
  | { kind: "paid"; id: string; label: string }
  | { kind: "funding"; id: string; label: string }
  | { kind: "account"; id: string; active: boolean; label: string };

const StatusPill = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusClass(value)}`}>
    {value.replaceAll("_", " ") || "—"}
  </span>
);

function FinanceReportDocument({
  rows,
  income,
  expense,
  balance,
  period,
}: {
  rows: Row[];
  income: number;
  expense: number;
  balance: number;
  period: string;
}) {
  return (
    <PdfDocument title="Huswell Finance Report">
      <PdfPage size="A4" style={pdfStyles.page}>
        <PdfText style={pdfStyles.title}>Huswell Finance Report</PdfText>
        <PdfText style={pdfStyles.detail}>Period: {period}</PdfText>
        <PdfView style={pdfStyles.summary}>
          <PdfText>Cash In: {peso.format(income)}</PdfText>
          <PdfText>Cash Out: {peso.format(expense)}</PdfText>
          <PdfText>Net earnings: {peso.format(balance)}</PdfText>
        </PdfView>
        <PdfView style={pdfStyles.table}>
          <PdfView style={pdfStyles.headerRow}>
            <PdfText style={pdfStyles.date}>Date</PdfText>
            <PdfText style={pdfStyles.description}>Description</PdfText>
            <PdfText style={pdfStyles.amount}>Source</PdfText>
            <PdfText style={pdfStyles.amount}>Amount</PdfText>
            <PdfText style={pdfStyles.status}>Status</PdfText>
          </PdfView>
          {rows.map((row, index) => (
            <PdfView key={String(row.id ?? index)} style={pdfStyles.row}>
              <PdfText style={pdfStyles.date}>{stringValue(row, "transaction_date")}</PdfText>
                <PdfText style={pdfStyles.description}>{[stringValue(row, "note", "Finance transaction"), stringValue(row, "reference_number") ? `Ref: ${stringValue(row, "reference_number")}` : ""].filter(Boolean).join(" · ")}</PdfText>
              <PdfText style={pdfStyles.amount}>{transactionSourceLabel(row)}</PdfText>
              <PdfText style={pdfStyles.amount}>{stringValue(row, "transaction_type") === "income" ? "+" : "−"}{peso.format(numericValue(row, "amount"))}</PdfText>
              <PdfText style={pdfStyles.status}>{transactionStatusLabel(row)}</PdfText>
            </PdfView>
          ))}
        </PdfView>
      </PdfPage>
    </PdfDocument>
  );
}

// Kept as a compatibility reference for the previous mixed-column table.
// The organized table below is the rendered component.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyTransactionTableV2({
  rows,
  categoryName,
  accountName,
  leadName,
  budgetLabel,
  accounts,
  internal,
  approveAndPay,
  requestRevision,
  verifyIncome,
  requestIncomeRevision,
  voidIncome,
  editRevision,
  markPaid,
  assignAccount,
  openReceipt,
  saving,
}: {
  rows: Row[];
  categoryName: (id: unknown) => string;
  accountName: (id: unknown) => string;
  leadName: (id: unknown) => string;
  budgetLabel: (id: unknown) => string;
  accounts: Row[];
  internal: boolean;
  approveAndPay: (id: string) => void;
  requestRevision: (id: string) => void;
  verifyIncome: (id: string) => void;
  requestIncomeRevision: (id: string) => void;
  voidIncome: (id: string) => void;
  editRevision: (transaction: Row) => void;
  markPaid: (id: string, label?: string) => void;
  assignAccount: (id: string, accountId: string) => Promise<void>;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="finance-transaction-table">
      <div className="space-y-2 md:hidden">
        {rows.map((transaction) => {
          const type = stringValue(transaction, "transaction_type");
          const approval = stringValue(transaction, "approval_status");
          const paid = stringValue(transaction, "payment_status");
          const manualIncome = isManualIncomeTransaction(transaction);
          const incomeReviewStatus = stringValue(transaction, "income_review_status");
          const isVoided = Boolean(transaction.is_voided);
          const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canApproveAndPay = internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval);
          const canMarkPaid = internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved";
          const canRequestRevision = internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canEditRevision = !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested";
          const canVerifyIncome = internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending" && Boolean(transaction.account_id);
          const canRequestIncomeRevision = internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending";
          const canEditIncomeRevision = !internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "revision_requested";
          const canVoidIncome = internal && manualIncome && !isVoided && paid === "paid" && incomeReviewStatus === "verified";
          const accountId = stringValue(transaction, "account_id");
          const canChangeAccount = internal && !isVoided && (
            (type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval))
            || (!accountId && Boolean(transaction.source_payment_id))
            || (manualIncome && paid === "unpaid" && ["pending", "revision_requested"].includes(incomeReviewStatus))
          );
          const paymentDisplay = manualIncome && paid === "unpaid" ? "unpaid" : transactionStatusValue(transaction);
          const reviewDisplay = manualIncome
            ? incomeReviewStatus === "pending" ? "pending_confirmation" : incomeReviewStatus
            : approval;
          const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
          const name = manualIncome ? "Manual Cash In" : leadName(transaction.lead_id);
          const note = isVoided
            ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}`
            : reviewDisplay === "revision_requested"
              ? `Correction requested: ${stringValue(transaction, "decision_note", "See reviewer note")}`
              : stringValue(transaction, "note", "-");
          return (
            <article key={String(transaction.id)} className={`rounded-lg border border-[#d9e0e9] bg-white p-3 ${isVoided ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#202938]">{name}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">{displayDate(transaction.transaction_date)}</p>
                  {manualIncome && <p className="mt-1 text-[10px] text-[#7d8797]">Standalone income{stringValue(transaction, "reference_number") ? ` · Ref: ${stringValue(transaction, "reference_number")}` : ""}</p>}
                </div>
                <StatusPill value={paymentDisplay} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div><span className="block text-[10px] text-[#8b92a1]">Category</span><span className="font-medium text-[#344054]">{categoryName(transaction.category_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">{type === "income" ? "Receiving account" : "Account"}</span><span className="font-medium text-[#344054]">{accountName(transaction.account_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Cash In</span><span className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Cash Out</span><span className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Review</span><StatusPill value={reviewDisplay} /></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 text-[#344054]">{note}</span></div>
              </div>
              {budgetLabel(transaction.budget_request_id) && <p className="mt-2 text-[10px] text-[#687386]">Budget: {budgetLabel(transaction.budget_request_id)}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
                {canChangeAccount && <select aria-label={type === "income" ? "Receiving account" : "Payment account"} defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] flex-1 text-[10px]"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select>}
                {!canChangeAccount && !accountId && internal && !isVoided && <span className="text-[10px] text-[#a76605]">Needs finance account</span>}
                {stringValue(transaction, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="button-secondary" title="View receipt"><ReceiptText size={14} /> Receipt</button>}
                {canVerifyIncome && <button type="button" disabled={saving} onClick={() => verifyIncome(String(transaction.id))} className="button-secondary text-[#218b55]">Verify Cash In</button>}
                {canRequestIncomeRevision && <button type="button" disabled={saving} onClick={() => requestIncomeRevision(String(transaction.id))} className="button-secondary text-[#6941c6]">Return for correction</button>}
                {canEditIncomeRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[#6941c6]">Edit &amp; resubmit</button>}
                {canVoidIncome && <button type="button" disabled={saving} onClick={() => voidIncome(String(transaction.id))} className="button-danger">Reverse Cash In</button>}
                {canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[#218b55]">{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}
                {canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[#6941c6]">Return for revision</button>}
                {canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[#6941c6]">Edit &amp; resubmit</button>}
                {canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary">Mark paid</button>}
              </div>
            </article>
          );
        })}
        {!rows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-6 text-center text-[11px] text-[#7d8797]">No transactions match the current filter.</p>}
      </div>
      <div className="table-shell overflow-x-auto">
        <table className="app-table w-full min-w-[1080px]">
          <thead><tr><th>Date</th><th>Name / Company</th><th>Category</th><th>Account</th><th>Cash In</th><th>Cash Out</th><th>Payment</th><th>Review</th><th>Receipt</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((transaction) => {
              const type = stringValue(transaction, "transaction_type");
              const approval = stringValue(transaction, "approval_status");
              const paid = stringValue(transaction, "payment_status");
              const manualIncome = isManualIncomeTransaction(transaction);
              const incomeReviewStatus = stringValue(transaction, "income_review_status");
              const isVoided = Boolean(transaction.is_voided);
              const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
              const canApproveAndPay = internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval);
              const canMarkPaid = internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved";
              const canRequestRevision = internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
              const canEditRevision = !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested";
              const canVerifyIncome = internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending" && Boolean(transaction.account_id);
              const canRequestIncomeRevision = internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending";
              const canEditIncomeRevision = !internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "revision_requested";
              const canVoidIncome = internal && manualIncome && !isVoided && paid === "paid" && incomeReviewStatus === "verified";
              const accountId = stringValue(transaction, "account_id");
              const canChangeAccount = internal && !isVoided && ((type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval)) || (!accountId && Boolean(transaction.source_payment_id)) || (manualIncome && paid === "unpaid" && ["pending", "revision_requested"].includes(incomeReviewStatus)));
              const paymentDisplay = manualIncome && paid === "unpaid" ? "unpaid" : transactionStatusValue(transaction);
              const reviewDisplay = manualIncome ? incomeReviewStatus === "pending" ? "pending_confirmation" : incomeReviewStatus : approval;
              const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
              const note = isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : reviewDisplay === "revision_requested" ? `Correction requested: ${stringValue(transaction, "decision_note", "See reviewer note")}` : stringValue(transaction, "note", "-");
              return <tr key={String(transaction.id)} className={isVoided ? "opacity-60" : undefined}><td>{displayDate(transaction.transaction_date)}<small>{stringValue(transaction, "transaction_time")}</small></td><td>{manualIncome ? "Manual Cash In" : leadName(transaction.lead_id)}{manualIncome && <small>Standalone income{stringValue(transaction, "reference_number") ? ` · Ref: ${stringValue(transaction, "reference_number")}` : ""}</small>}{Boolean(transaction.source_payment_id) && <small>Automatic quotation payment</small>}</td><td>{categoryName(transaction.category_id)}<small>{note}</small></td><td>{canChangeAccount ? <select aria-label={type === "income" ? "Receiving account" : "Payment account"} defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] text-[10px]"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select> : accountName(transaction.account_id)}</td><td className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td><StatusPill value={paymentDisplay} /></td><td><StatusPill value={reviewDisplay} /></td><td>{stringValue(transaction, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="text-[#c43b43]" title="View receipt"><ReceiptText size={15} /></button> : "-"}</td><td><span className="flex flex-wrap gap-1">{canVerifyIncome && <button type="button" disabled={saving} onClick={() => verifyIncome(String(transaction.id))} className="button-secondary text-[10px] text-[#218b55]">Verify</button>}{canRequestIncomeRevision && <button type="button" disabled={saving} onClick={() => requestIncomeRevision(String(transaction.id))} className="button-secondary text-[10px] text-[#6941c6]">Return</button>}{canEditIncomeRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px] text-[#6941c6]">Edit &amp; resubmit</button>}{canVoidIncome && <button type="button" disabled={saving} onClick={() => voidIncome(String(transaction.id))} className="button-danger text-[10px]">Reverse</button>}{canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[10px]" title={approval === "pending" ? "Approve and pay Cash Out" : "Pay approved Cash Out"}>{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}{canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[10px]" title="Return Cash Out for revision">Return</button>}{canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px] text-[#6941c6]">Edit &amp; resubmit</button>}{canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary text-[10px]">Mark paid</button>}{!canVerifyIncome && !canRequestIncomeRevision && !canEditIncomeRevision && !canVoidIncome && !canApproveAndPay && !canRequestRevision && !canEditRevision && !canMarkPaid && "-"}</span></td></tr>;
            })}
            {!rows.length && <tr><td colSpan={10} className="text-center text-[#7d8797]">No transactions match the current filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionTable({
  rows,
  categoryName,
  accountName,
  leadName,
  quotationName,
  budgetLabel,
  accounts,
  internal,
  approveAndPay,
  requestRevision,
  verifyIncome,
  requestIncomeRevision,
  voidIncome,
  editRevision,
  markPaid,
  assignAccount,
  openReceipt,
  onSelectTransaction,
  saving,
  allowActions = true,
}: {
  rows: Row[];
  categoryName: (id: unknown) => string;
  accountName: (id: unknown) => string;
  leadName: (id: unknown) => string;
  quotationName: (id: unknown) => string;
  budgetLabel: (id: unknown) => string;
  accounts: Row[];
  internal: boolean;
  approveAndPay: (id: string) => void;
  requestRevision: (id: string) => void;
  verifyIncome: (id: string) => void;
  requestIncomeRevision: (id: string) => void;
  voidIncome: (id: string) => void;
  editRevision: (transaction: Row) => void;
  markPaid: (id: string, label?: string) => void;
  assignAccount: (id: string, accountId: string) => Promise<void>;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  onSelectTransaction: (transaction: Row) => void;
  saving: boolean;
  allowActions?: boolean;
}) {
  return (
    <div className="finance-transaction-table">
      <div className="space-y-2 md:hidden">
        {rows.map((transaction) => {
          const type = stringValue(transaction, "transaction_type");
          const approval = stringValue(transaction, "approval_status");
          const paid = stringValue(transaction, "payment_status");
          const manualIncome = isManualIncomeTransaction(transaction);
          const incomeReviewStatus = stringValue(transaction, "income_review_status");
          const isVoided = Boolean(transaction.is_voided);
          const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canApproveAndPay = allowActions && internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval);
          const canMarkPaid = allowActions && internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved";
          const canRequestRevision = allowActions && internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canEditRevision = allowActions && !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested";
          const canVerifyIncome = allowActions && internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending" && Boolean(transaction.account_id);
          const canRequestIncomeRevision = allowActions && internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending";
          const canEditIncomeRevision = allowActions && !internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "revision_requested";
          const canVoidIncome = allowActions && internal && manualIncome && !isVoided && paid === "paid" && incomeReviewStatus === "verified";
          const accountId = stringValue(transaction, "account_id");
          const canChangeAccount = allowActions && internal && !isVoided && (
            (type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval))
            || (!accountId && Boolean(transaction.source_payment_id))
            || (manualIncome && paid === "unpaid" && ["pending", "revision_requested"].includes(incomeReviewStatus))
          );
          const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
          const description = manualIncome ? "Manual Cash In" : leadName(transaction.lead_id) !== "—" ? leadName(transaction.lead_id) : type === "income" ? "Quotation payment" : "Cash Out";
          const reference = transactionReference(transaction, quotationName);
          const amount = numericValue(transaction, "amount");
          return (
            <article key={String(transaction.id)} className={`rounded-lg border border-[#d9e0e9] bg-white p-3 ${isVoided ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-[#202938]">{description}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">{displayDate(transaction.transaction_date)}{stringValue(transaction, "transaction_time") ? ` · ${stringValue(transaction, "transaction_time")}` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[13px] font-semibold ${type === "income" ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(amount)}</p>
                  <div className="mt-1"><StatusPill value={transactionStatusLabel(transaction)} /></div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div><span className="block text-[10px] text-[#8b92a1]">Source</span><span className="font-medium text-[#344054]">{transactionSourceLabel(transaction)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Category</span><span className="font-medium text-[#344054]">{categoryName(transaction.category_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Account</span><span className="font-medium text-[#344054]">{accountName(transaction.account_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Reference</span><span className="font-medium text-[#344054]">{reference}</span></div>
                {internal && <div><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 text-[#344054]">{transactionNote(transaction)}</span></div>}
              </div>
              {internal && budgetLabel(transaction.budget_request_id) && <p className="mt-2 text-[10px] text-[#687386]">Budget: {budgetLabel(transaction.budget_request_id)}</p>}
              {allowActions && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
                <button type="button" onClick={() => onSelectTransaction(transaction)} className="button-secondary text-[10px]">Details</button>
                {canChangeAccount && <select aria-label={type === "income" ? "Receiving account" : "Payment account"} defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] flex-1 text-[10px]"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select>}
                {!canChangeAccount && !accountId && internal && !isVoided && <span className="text-[10px] text-[#a76605]">Needs finance account</span>}
                {stringValue(transaction, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="button-secondary text-[10px]" title="View receipt"><ReceiptText size={14} /> Receipt</button>}
                 {canVerifyIncome && <button type="button" disabled={saving} onClick={() => verifyIncome(String(transaction.id))} className="button-secondary text-[10px] text-[#218b55]">Verify Cash In</button>}
                {canRequestIncomeRevision && <button type="button" disabled={saving} onClick={() => requestIncomeRevision(String(transaction.id))} className="button-secondary text-[10px]">Return for correction</button>}
                {canEditIncomeRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px]">Edit &amp; resubmit</button>}
                 {canVoidIncome && <button type="button" disabled={saving} onClick={() => voidIncome(String(transaction.id))} className="button-danger text-[10px]">Reverse Cash In</button>}
                {canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[10px] text-[#218b55]">{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}
                {canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[10px]">Return for revision</button>}
                {canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px]">Edit &amp; resubmit</button>}
                 {canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary text-[10px]">Mark paid</button>}
              </div>}
            </article>
          );
        })}
        {!rows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-6 text-center text-[11px] text-[#7d8797]">No transactions match the current filters.</p>}
      </div>
      <div className="table-shell hidden overflow-x-auto md:block">
        <table className={`app-table w-full ${internal ? (allowActions ? "min-w-[1320px]" : "min-w-[1000px]") : (allowActions ? "min-w-[1080px]" : "min-w-[820px]")}`}>
          <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Source</th><th>Category</th>{internal && <th>Budget</th>}<th>Account</th><th>Amount</th>{internal && <th>Note</th>}<th>Status</th>{allowActions && <><th>Receipt</th><th className="finance-action-column">Action</th></>}</tr></thead>
          <tbody>
            {rows.map((transaction) => {
              const type = stringValue(transaction, "transaction_type");
              const approval = stringValue(transaction, "approval_status");
              const paid = stringValue(transaction, "payment_status");
              const manualIncome = isManualIncomeTransaction(transaction);
              const incomeReviewStatus = stringValue(transaction, "income_review_status");
              const isVoided = Boolean(transaction.is_voided);
              const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
              const canApproveAndPay = allowActions && internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval);
              const canMarkPaid = allowActions && internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved";
              const canRequestRevision = allowActions && internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
              const canEditRevision = allowActions && !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested";
              const canVerifyIncome = allowActions && internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending" && Boolean(transaction.account_id);
              const canRequestIncomeRevision = allowActions && internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "pending";
              const canEditIncomeRevision = allowActions && !internal && manualIncome && !isVoided && paid === "unpaid" && incomeReviewStatus === "revision_requested";
              const canVoidIncome = allowActions && internal && manualIncome && !isVoided && paid === "paid" && incomeReviewStatus === "verified";
              const accountId = stringValue(transaction, "account_id");
              const canChangeAccount = allowActions && internal && !isVoided && ((type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval)) || (!accountId && Boolean(transaction.source_payment_id)) || (manualIncome && paid === "unpaid" && ["pending", "revision_requested"].includes(incomeReviewStatus)));
              const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
              const description = manualIncome ? "Manual Cash In" : leadName(transaction.lead_id) !== "—" ? leadName(transaction.lead_id) : type === "income" ? "Quotation payment" : "Cash Out";
              const reference = transactionReference(transaction, quotationName);
              const amount = numericValue(transaction, "amount");
              return <tr key={String(transaction.id)} className={isVoided ? "opacity-60" : undefined}>
                <td>{displayDate(transaction.transaction_date)}</td>
                <td>{description}</td>
                <td>{reference}</td>
                <td>{transactionSourceLabel(transaction)}</td>
                <td>{categoryName(transaction.category_id)}</td>
                {internal && <td>{budgetLabel(transaction.budget_request_id) || "-"}</td>}
                <td>{canChangeAccount ? <select aria-label={type === "income" ? "Receiving account" : "Payment account"} defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[145px] text-[10px]"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select> : accountName(transaction.account_id)}</td>
                <td className={`whitespace-nowrap font-semibold ${type === "income" ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(amount)}</td>
                {internal && <td>{transactionNote(transaction)}</td>}
                <td><StatusPill value={transactionStatusLabel(transaction)} /></td>
                 {allowActions && <><td>{stringValue(transaction, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="text-[#c43b43]" title="View receipt"><ReceiptText size={15} /></button> : "-"}</td><td className="finance-action-cell"><span className="finance-action-group"><button type="button" onClick={() => onSelectTransaction(transaction)} className="button-secondary text-[10px]">Details</button>{canVerifyIncome && <button type="button" disabled={saving} onClick={() => verifyIncome(String(transaction.id))} className="button-secondary text-[10px] text-[#218b55]">Verify</button>}{canRequestIncomeRevision && <button type="button" disabled={saving} onClick={() => requestIncomeRevision(String(transaction.id))} className="button-secondary text-[10px]">Return</button>}{canEditIncomeRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px]">Edit</button>}{canVoidIncome && <button type="button" disabled={saving} onClick={() => voidIncome(String(transaction.id))} className="button-danger text-[10px]">Reverse</button>}{canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[10px]">{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}{canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[10px]">Return</button>}{canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px]">Edit</button>}{canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary text-[10px]">Mark paid</button>}</span></td></>}
              </tr>;
            })}
             {!rows.length && <tr><td colSpan={8 + (internal ? 2 : 0) + (allowActions ? 2 : 0)} className="text-center text-[#7d8797]">No transactions match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectHistoryTable({
  rows,
  onSelectProject,
}: {
  rows: ProjectHistoryRow[];
  onSelectProject: (project: ProjectHistoryRow) => void;
}) {
  return (
    <div className="finance-project-history-table">
      <div className="space-y-2 md:hidden">
        {rows.map((project) => (
          <article key={project.key} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-[#202938]">{project.projectName}</p>
              </div>
              <button type="button" onClick={() => onSelectProject(project)} className="table-action shrink-0" title={`Review ${project.projectName}`} aria-label={`Review ${project.projectName}`}>
                <ClipboardCheck size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
              <div><span className="block text-[10px] text-[#8b92a1]">Quotation</span><span className="text-[#344054]">{project.quotationNumbers.length ? project.quotationNumbers.join(", ") : "—"}</span></div>
              <div><span className="block text-[10px] text-[#8b92a1]">Transactions</span><span className="text-[#344054]">{project.transactions.length}</span></div>
              <div className="col-span-2"><span className="block text-[10px] text-[#8b92a1]">Last verified activity</span><span className="text-[#344054]">{displayDate(project.latestDate)}</span></div>
            </div>
          </article>
        ))}
        {!rows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-8 text-center text-[11px] text-[#7d8797]">No verified project transactions match your search.</p>}
      </div>
      <div className="table-shell hidden overflow-x-auto md:block">
        <table className="app-table w-full min-w-[760px] text-left">
          <thead><tr><th>Project</th><th>Quotation</th><th>Last verified activity</th><th>Transactions</th><th className="finance-action-column">Review</th></tr></thead>
          <tbody>
            {rows.map((project) => (
              <tr key={project.key}>
                <td><span className="font-medium text-[#202938]">{project.projectName}</span></td>
                <td>{project.quotationNumbers.length ? project.quotationNumbers.join(", ") : "—"}</td>
                <td>{displayDate(project.latestDate)}</td>
                <td>{project.transactions.length}</td>
                <td className="finance-action-cell"><button type="button" onClick={() => onSelectProject(project)} className="table-action" title={`Review ${project.projectName}`} aria-label={`Review ${project.projectName}`}><ClipboardCheck size={15} aria-hidden="true" /></button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="text-center text-[#7d8797]">No verified project transactions match your search.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionDetailField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="block text-[10px] text-[#8b92a1]">{label}</span>
      <span className="mt-1 block text-[12px] text-[#344054]">{children}</span>
    </div>
  );
}

function TransactionDetailDialog({
  transaction,
  categoryName,
  accountName,
  quotationName,
  quotationPaymentRecords,
  budgetLabel,
  profileName,
  openReceipt,
  close,
}: {
  transaction: Row;
  categoryName: (id: unknown) => string;
  accountName: (id: unknown) => string;
  quotationName: (id: unknown) => string;
  quotationPaymentRecords: Row[];
  budgetLabel: (id: unknown) => string;
  profileName: (id: unknown) => string;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  close: () => void;
}) {
  const type = stringValue(transaction, "transaction_type");
  const amount = numericValue(transaction, "amount");
  const quotationId = stringValue(transaction, "quotation_id");
  const receiptPath = stringValue(transaction, "receipt_storage_path");
  const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
  const sourcePaymentId = stringValue(transaction, "source_payment_id");
  const payment = sourcePaymentId
    ? quotationPaymentRecords.find((record) => String(record.id ?? "") === sourcePaymentId)
    : null;
  const note = Boolean(transaction.is_voided) || transactionStatusFilterValue(transaction) === "returned"
    ? transactionNote(transaction)
    : sourcePaymentId
      ? stringValue(payment, "notes", "-")
      : transactionNote(transaction);
  const isIncome = type === "income";
  return (
    <FinanceDialog
      title={`${transactionSourceLabel(transaction)} details`}
      detail={`${isIncome ? "Cash In" : "Cash Out"} · ${displayDate(transaction.transaction_date)}`}
      close={close}
      status={<StatusPill value={transactionStatusLabel(transaction)} />}
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">{isIncome ? "Cash In amount" : "Cash Out amount"}</p>
          <p className={`mt-1 text-3xl font-semibold ${isIncome ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(amount)}</p>
        </div>
        <TransactionDetailField label="Date">{displayDate(transaction.transaction_date)}{stringValue(transaction, "transaction_time") ? ` · ${stringValue(transaction, "transaction_time")}` : ""}</TransactionDetailField>
        <TransactionDetailField label="Source">{transactionSourceLabel(transaction)}</TransactionDetailField>
        <TransactionDetailField label="Category">{categoryName(transaction.category_id)}</TransactionDetailField>
        <TransactionDetailField label="Account">{accountName(transaction.account_id)}</TransactionDetailField>
        {quotationId && <TransactionDetailField label="Quotation">{quotationName(quotationId)}</TransactionDetailField>}
        {stringValue(transaction, "budget_request_id") && <TransactionDetailField label="Budget">{budgetLabel(stringValue(transaction, "budget_request_id"))}</TransactionDetailField>}
        {stringValue(transaction, "reference_number") && <TransactionDetailField label="Reference number">{stringValue(transaction, "reference_number")}</TransactionDetailField>}
        {stringValue(transaction, "submitted_by") && <TransactionDetailField label="Submitted by">{profileName(stringValue(transaction, "submitted_by"))}</TransactionDetailField>}
        {stringValue(transaction, "approved_by") && <TransactionDetailField label="Approved by">{profileName(stringValue(transaction, "approved_by"))}</TransactionDetailField>}
        {stringValue(transaction, "paid_by") && <TransactionDetailField label="Verified / paid by">{profileName(stringValue(transaction, "paid_by"))}</TransactionDetailField>}
        {note !== "-" && <TransactionDetailField label="Note" className="sm:col-span-2"><span className="whitespace-pre-wrap">{note}</span></TransactionDetailField>}
        {stringValue(transaction, "decision_note") && <TransactionDetailField label="Reviewer note" className="sm:col-span-2"><span className="whitespace-pre-wrap">{stringValue(transaction, "decision_note")}</span></TransactionDetailField>}
        {stringValue(transaction, "void_reason") && <TransactionDetailField label="Reversal reason" className="sm:col-span-2"><span className="whitespace-pre-wrap">{stringValue(transaction, "void_reason")}</span></TransactionDetailField>}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-4">
        {receiptPath && <button type="button" onClick={() => void openReceipt(receiptPath, receiptBucket)} className="button-secondary"><ReceiptText size={14} /> View receipt</button>}
        <button type="button" onClick={close} className="button-primary">Close</button>
      </div>
    </FinanceDialog>
  );
}

function ProjectFinanceDialog({
  project,
  accountName,
  categoryName,
  quotations,
  directCostTotalsByQuotation,
  projectExpenseRows,
  openReceipt,
  close,
}: {
  project: ProjectHistoryRow;
  accountName: (id: unknown) => string;
  categoryName: (id: unknown) => string;
  quotations: Row[];
  directCostTotalsByQuotation: Map<string, number>;
  projectExpenseRows: Row[];
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  close: () => void;
}) {
  const quotationLabel = project.quotationNumbers.length ? project.quotationNumbers.join(", ") : "—";
  const projectQuotationIds = new Set(
    project.transactions.map((transaction) => stringValue(transaction, "quotation_id")).filter(Boolean),
  );
  const projectQuotations = quotations.filter((quotation) => (
    projectQuotationIds.has(String(quotation.id ?? ""))
    && stringValue(quotation, "document_type") === "price_quotation"
    && !quotation.costing_source_id
    && stringValue(quotation, "status") === "approved"
  ));
  const quotationTotal = projectQuotations.length
    ? projectQuotations.reduce((total, quotation) => total + numericValue(quotation, "total_amount"), 0)
    : null;
  const projectExpenseCapacityRows = projectExpenseRows.filter((row) => projectQuotationIds.has(String(row.quotation_id ?? "")));
  const hasDirectCostTotals = projectQuotations.length > 0
    && projectQuotations.every((quotation) => directCostTotalsByQuotation.has(String(quotation.id ?? "")));
  const directCostTotal = projectExpenseCapacityRows.length
    ? projectExpenseCapacityRows.reduce((total, row) => total + numericValue(row, "total_direct_cost"), 0)
    : hasDirectCostTotals
    ? projectQuotations.reduce(
        (total, quotation) => total + (directCostTotalsByQuotation.get(String(quotation.id ?? "")) ?? 0),
        0,
      )
    : null;
  const committedProjectExpense = projectExpenseCapacityRows.length
    ? projectExpenseCapacityRows.reduce((total, row) => total + numericValue(row, "committed_project_expense"), 0)
    : null;
  const remainingDirectCost = projectExpenseCapacityRows.length
    ? projectExpenseCapacityRows.reduce((total, row) => total + numericValue(row, "remaining_direct_cost"), 0)
    : null;
  const transactions = [...project.transactions].sort((left, right) => {
    const dateCompare = stringValue(right, "transaction_date").localeCompare(stringValue(left, "transaction_date"));
    return dateCompare || stringValue(right, "created_at").localeCompare(stringValue(left, "created_at"));
  });
  const [transactionQuery, setTransactionQuery] = useState("");
  const [transactionDirection, setTransactionDirection] = useState<Direction>(() => (
    project.transactions.some((transaction) => stringValue(transaction, "transaction_type") === "income")
      ? "income"
      : "expense"
  ));

  const transactionDescription = (transaction: Row) => {
    if (Boolean(transaction.source_payment_id)) return "Quotation payment";
    return transactionSourceLabel(transaction);
  };
  const normalizedTransactionQuery = transactionQuery.trim().toLowerCase();
  const directionTransactions = transactions.filter((transaction) => stringValue(transaction, "transaction_type") === transactionDirection);
  const directionTotal = directionTransactions.reduce((total, transaction) => total + numericValue(transaction, "amount"), 0);
  const directionLabel = transactionDirection === "income" ? "Cash In" : "Cash Out";
  const visibleTransactions = directionTransactions.filter((transaction) => {
    if (!normalizedTransactionQuery) return true;
    return [
      displayDate(transaction.transaction_date),
      stringValue(transaction, "transaction_date"),
      transactionDescription(transaction),
      transactionNote(transaction),
      transactionSourceLabel(transaction),
      accountName(transaction.account_id),
      categoryName(transaction.category_id),
      stringValue(transaction, "reference_number"),
      peso.format(numericValue(transaction, "amount")),
    ].join(" ").toLowerCase().includes(normalizedTransactionQuery);
  });

  return (
    <FinanceDialog
      title={`${project.projectName} review`}
      wide
      detail={`${project.clientName} · ${project.transactions.length} verified transaction${project.transactions.length === 1 ? "" : "s"}`}
      close={close}
    >
      <div className="mt-5 grid gap-3 border-b border-[#edf0f5] pb-4 sm:grid-cols-2">
        <TransactionDetailField label="Project">{project.projectName}</TransactionDetailField>
        <TransactionDetailField label="Client">{project.clientName}</TransactionDetailField>
        <TransactionDetailField label="Quotation">{quotationLabel}</TransactionDetailField>
        <TransactionDetailField label="Quotation total">
          {quotationTotal === null ? "-" : <span className="font-semibold text-[#202938]">{peso.format(quotationTotal)}</span>}
        </TransactionDetailField>
        <TransactionDetailField label="Total direct cost">
          {directCostTotal === null ? "-" : <span className="font-semibold text-[#202938]">{peso.format(directCostTotal)}</span>}
        </TransactionDetailField>
        <TransactionDetailField label="Committed project expenses">
          {committedProjectExpense === null ? "-" : <span className="font-semibold text-[#a76605]">{peso.format(committedProjectExpense)}</span>}
        </TransactionDetailField>
        <TransactionDetailField label="Remaining Direct Cost">
          {remainingDirectCost === null
            ? "-"
            : <span className={remainingDirectCost > 0 ? "font-semibold text-[#218b55]" : "font-semibold text-[#b42318]"}>{peso.format(remainingDirectCost)}</span>}
        </TransactionDetailField>
      </div>
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-[#202938]">Verified transaction history</h3>
          <span className="text-[11px] text-[#7d8797]">{normalizedTransactionQuery ? `${visibleTransactions.length} of ${directionTransactions.length} records` : `${directionTransactions.length} ${directionLabel} record${directionTransactions.length === 1 ? "" : "s"}`}</span>
        </div>
        <div role="tablist" aria-label="Project transaction direction" className="mt-4 flex max-w-md rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1">
          <button
            id="project-cash-in-tab"
            type="button"
            role="tab"
            aria-selected={transactionDirection === "income"}
            aria-controls="project-transaction-panel"
            onClick={() => setTransactionDirection("income")}
            className={transactionDirection === "income" ? "flex-1 rounded-md bg-[#edf9f2] px-3 py-2 text-[11px] font-semibold text-[#218b55]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}
          >
            Cash In ({transactions.filter((transaction) => stringValue(transaction, "transaction_type") === "income").length})
          </button>
          <button
            id="project-cash-out-tab"
            type="button"
            role="tab"
            aria-selected={transactionDirection === "expense"}
            aria-controls="project-transaction-panel"
            onClick={() => setTransactionDirection("expense")}
            className={transactionDirection === "expense" ? "flex-1 rounded-md bg-[#fef3f2] px-3 py-2 text-[11px] font-semibold text-[#b42318]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}
          >
            Cash Out ({transactions.filter((transaction) => stringValue(transaction, "transaction_type") === "expense").length})
          </button>
        </div>
        <label className="relative mt-3 block max-w-md">
          <Search size={15} className="search-icon pointer-events-none absolute left-3 text-[#8b92a1]" />
          <input type="search" value={transactionQuery} onChange={(event) => setTransactionQuery(event.target.value)} className="input mt-0 w-full search-input text-[12px]" placeholder={`Search verified ${directionLabel.toLowerCase()} transactions`} aria-label={`Search verified ${directionLabel} transactions`} />
        </label>
        <div id="project-transaction-panel" role="tabpanel" aria-labelledby={transactionDirection === "income" ? "project-cash-in-tab" : "project-cash-out-tab"}>
          <div className="mt-3 space-y-2 md:hidden">
          {visibleTransactions.map((transaction) => {
            const isIncome = stringValue(transaction, "transaction_type") === "income";
            const receiptPath = stringValue(transaction, "receipt_storage_path");
            return (
              <article key={String(transaction.id)} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#202938]">{transactionDescription(transaction)}</p>
                    <p className="mt-1 text-[10px] text-[#7d8797]">{displayDate(transaction.transaction_date)} · {transactionSourceLabel(transaction)}</p>
                  </div>
                  <p aria-label={`${isIncome ? "Cash In" : "Cash Out"} amount ${peso.format(numericValue(transaction, "amount"))}`} className={`shrink-0 text-[13px] font-semibold ${isIncome ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(numericValue(transaction, "amount"))}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                  <div><span className="block text-[10px] text-[#8b92a1]">Account</span><span className="text-[#344054]">{accountName(transaction.account_id)}</span></div>
                  <div><span className="block text-[10px] text-[#8b92a1]">Category</span><span className="text-[#344054]">{categoryName(transaction.category_id)}</span></div>
                  <div className="col-span-2"><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 whitespace-pre-wrap text-[#344054]">{transactionNote(transaction)}</span></div>
                </div>
                {receiptPath && <div className="mt-3 border-t border-[#edf0f5] pt-3"><button type="button" onClick={() => void openReceipt(receiptPath, stringValue(transaction, "receipt_bucket", "finance-receipts"))} className="table-action" title="View receipt" aria-label="View receipt"><ReceiptText size={15} aria-hidden="true" /></button></div>}
              </article>
            );
          })}
          {!visibleTransactions.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-4 text-center text-[11px] text-[#7d8797]">{normalizedTransactionQuery ? `No verified ${directionLabel.toLowerCase()} transactions match your search.` : `No verified ${directionLabel.toLowerCase()} transactions are linked to this project.`}</p>}
        </div>
          <div className="table-shell mt-3 hidden overflow-x-auto md:block">
          <table className="app-table finance-project-transaction-table w-full min-w-[820px]">
            <thead><tr><th>Date</th><th>Description</th><th>Note</th><th>Source</th><th>Account</th><th>Amount</th><th>Receipt</th></tr></thead>
            <tbody>
              {visibleTransactions.map((transaction) => {
                const isIncome = stringValue(transaction, "transaction_type") === "income";
                const receiptPath = stringValue(transaction, "receipt_storage_path");
                return (
                  <tr key={String(transaction.id)}>
                    <td>{displayDate(transaction.transaction_date)}</td>
                    <td>{transactionDescription(transaction)}</td>
                    <td>{transactionNote(transaction)}</td>
                    <td>{transactionSourceLabel(transaction)}</td>
                    <td>{accountName(transaction.account_id)}</td>
                    <td className={`whitespace-nowrap font-semibold ${isIncome ? "finance-cash-in-amount text-[#218b55]" : "finance-cash-out-amount text-[#b42318]"}`} aria-label={`${isIncome ? "Cash In" : "Cash Out"} amount ${peso.format(numericValue(transaction, "amount"))}`}>{peso.format(numericValue(transaction, "amount"))}</td>
                    <td>{receiptPath ? <button type="button" onClick={() => void openReceipt(receiptPath, stringValue(transaction, "receipt_bucket", "finance-receipts"))} className="button-secondary text-[10px]"><ReceiptText size={13} /> Receipt</button> : "—"}</td>
                  </tr>
                );
              })}
              {!visibleTransactions.length && <tr><td colSpan={7} className="text-center text-[#7d8797]">{normalizedTransactionQuery ? `No verified ${directionLabel.toLowerCase()} transactions match your search.` : `No verified ${directionLabel.toLowerCase()} transactions are linked to this project.`}</td></tr>}
            </tbody>
          </table>
        </div>
          <div className="mt-3 flex justify-end border-t border-[#edf0f5] pt-3">
          <div className="text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">{directionLabel} total</span>
            <strong className={`block text-[15px] ${transactionDirection === "income" ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(directionTotal)}</strong>
          </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end border-t border-[#edf0f5] pt-4"><button type="button" onClick={close} className="button-primary">Close</button></div>
    </FinanceDialog>
  );
}

const pendingTransactionReviewState = (transaction: Row) => {
  const type = stringValue(transaction, "transaction_type");
  const approval = stringValue(transaction, "approval_status");
  const paid = stringValue(transaction, "payment_status");
  const manualIncome = isManualIncomeTransaction(transaction);
  const incomeReviewStatus = stringValue(transaction, "income_review_status");
  const isVoided = Boolean(transaction.is_voided);
  const isRegularExpense = type === "expense"
    && !transaction.source_payment_id
    && !transaction.supplier_payable_id
    && !transaction.commission_summary_id
    && !transaction.commission_allocation_id;

  return {
    manualIncome,
    canVerifyIncome: !isVoided && manualIncome && paid === "unpaid" && incomeReviewStatus === "pending" && Boolean(transaction.account_id),
    canRequestIncomeRevision: !isVoided && manualIncome && paid === "unpaid" && incomeReviewStatus === "pending",
    canApproveAndPay: !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval),
    canRequestRevision: !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && isRegularExpense,
  };
};

function FinanceApprovalReviewDialog({
  row,
  accounts,
  accountName,
  categoryName,
  quotationName,
  budgetLabel,
  profileName,
  openReceipt,
  assignAccount,
  assignQuotationPaymentAccount,
  requestQuotationPaymentReview,
  requestApproveAndPay,
  requestRevision,
  requestVerifyIncome,
  requestIncomeRevision,
  close,
  saving,
}: {
  row: PendingApprovalRow;
  accounts: Row[];
  accountName: (id: unknown) => string;
  categoryName: (id: unknown) => string;
  quotationName: (id: unknown) => string;
  budgetLabel: (id: unknown) => string;
  profileName: (id: unknown) => string;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  assignAccount: (transactionId: string, accountId: string) => Promise<void>;
  assignQuotationPaymentAccount: (paymentId: string, accountId: string) => Promise<void>;
  requestQuotationPaymentReview: (paymentId: string, decision: QuotationPaymentDecision) => void;
  requestApproveAndPay: (transactionId: string) => void;
  requestRevision: (transactionId: string) => void;
  requestVerifyIncome: (transactionId: string) => void;
  requestIncomeRevision: (transactionId: string) => void;
  close: () => void;
  saving: boolean;
}) {
  const transaction = row.transaction;
  const payment = row.payment;
  const quotation = row.quotation;
  const lead = row.lead;
  const isIncome = row.direction === "income";
  const state = transaction ? pendingTransactionReviewState(transaction) : null;
  const accountOptions = row.kind === "quotation_payment"
    ? accounts.filter((account) => stringValue(account, "payment_method") === stringValue(payment, "method"))
    : accounts;
  const accountIsEligible = accountOptions.some((account) => String(account.id) === row.accountId);
  const showVerify = row.kind === "quotation_payment" || Boolean(state?.canVerifyIncome) || Boolean(state?.manualIncome && !row.accountId);
  const verifyNeedsAccount = row.kind === "finance_transaction" && Boolean(state?.manualIncome) && !row.accountId;
  const showIncomeRevision = row.kind === "quotation_payment" || Boolean(state?.canRequestIncomeRevision);
  const showCashOutApproval = Boolean(state?.canApproveAndPay);
  const showCashOutRevision = Boolean(state?.canRequestRevision);
  const quotationNo = stringValue(quotation, "quotation_no");
  const clientName = stringValue(lead, "client_name", stringValue(quotation, "client_name"));
  const projectName = stringValue(quotation, "project_name", stringValue(lead, "project_name"));
  const paymentKind = stringValue(payment, "payment_kind").replaceAll("_", " ");
  const paymentMethod = financePaymentMethodLabel(payment?.method);
  const paymentNote = stringValue(payment, "notes") || stringValue(payment, "correction_note");
  const receiptFileName = stringValue(payment, "receipt_file_name") || stringValue(transaction, "receipt_file_name");
  const sourceLabel = row.kind === "quotation_payment" ? "Quotation payment" : row.source;

  return (
    <FinanceDialog
      title={`${sourceLabel} review`}
      detail={`${isIncome ? "Cash In" : "Cash Out"} · ${displayDate(row.date)}`}
      close={close}
      status={<StatusPill value={row.status} />}
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">{isIncome ? "Cash In amount" : "Cash Out amount"}</p>
          <p className={`mt-1 text-3xl font-semibold ${isIncome ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(row.amount)}</p>
        </div>
        <TransactionDetailField label="Source">{sourceLabel}</TransactionDetailField>
        <TransactionDetailField label={isIncome ? "Receiving account" : "Payment account"} className="sm:col-span-2">
          <select
            aria-label={isIncome ? "Receiving account" : "Payment account"}
            value={accountIsEligible ? row.accountId : ""}
            onChange={(event) => {
              if (!event.target.value) return;
              if (row.kind === "quotation_payment") void assignQuotationPaymentAccount(row.id, event.target.value);
              else void assignAccount(row.id, event.target.value);
            }}
            disabled={saving}
            className="input mt-1 w-full max-w-[280px] text-[12px]"
          >
            <option value="">{row.accountId && !accountIsEligible ? `${accountName(row.accountId)} (not eligible)` : "Choose account"}</option>
            {accountOptions.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}
          </select>
        </TransactionDetailField>
        {row.kind === "quotation_payment" ? (
          <>
            {quotationNo && <TransactionDetailField label="Quotation">{quotationNo}</TransactionDetailField>}
            {clientName && <TransactionDetailField label="Client">{clientName}</TransactionDetailField>}
            {projectName && <TransactionDetailField label="Project">{projectName}</TransactionDetailField>}
            {paymentKind && <TransactionDetailField label="Payment type">{paymentKind}</TransactionDetailField>}
            <TransactionDetailField label="Payment method">{paymentMethod}</TransactionDetailField>
            {stringValue(payment, "reference_no") && <TransactionDetailField label="Reference number">{stringValue(payment, "reference_no")}</TransactionDetailField>}
            {stringValue(payment, "submitted_by") && <TransactionDetailField label="Submitted by">{profileName(stringValue(payment, "submitted_by"))}</TransactionDetailField>}
            {receiptFileName && <TransactionDetailField label="Receipt file">{receiptFileName}</TransactionDetailField>}
            {paymentNote && <TransactionDetailField label="Notes" className="sm:col-span-2"><span className="whitespace-pre-wrap">{paymentNote}</span></TransactionDetailField>}
          </>
        ) : (
          <>
            {transaction && !state?.manualIncome && row.description && <TransactionDetailField label="Payee / company">{row.description}</TransactionDetailField>}
            {transaction && transaction.category_id && <TransactionDetailField label="Category">{categoryName(transaction.category_id)}</TransactionDetailField>}
            {transaction && transaction.quotation_id && <TransactionDetailField label="Quotation">{quotationName(transaction.quotation_id)}</TransactionDetailField>}
            {transaction && transaction.budget_request_id && <TransactionDetailField label="Budget">{budgetLabel(transaction.budget_request_id)}</TransactionDetailField>}
            {transaction && stringValue(transaction, "reference_number") && <TransactionDetailField label="Reference number">{stringValue(transaction, "reference_number")}</TransactionDetailField>}
            {transaction && stringValue(transaction, "payment_status") && <TransactionDetailField label="Payment status"><StatusPill value={stringValue(transaction, "payment_status")} /></TransactionDetailField>}
            {transaction && stringValue(transaction, "submitted_by") && <TransactionDetailField label="Submitted by">{profileName(stringValue(transaction, "submitted_by"))}</TransactionDetailField>}
            {transaction && stringValue(transaction, "approved_by") && <TransactionDetailField label="Approved by">{profileName(stringValue(transaction, "approved_by"))}</TransactionDetailField>}
            {transaction && stringValue(transaction, "paid_by") && <TransactionDetailField label="Paid by">{profileName(stringValue(transaction, "paid_by"))}</TransactionDetailField>}
            {transaction && transactionNote(transaction) !== "-" && <TransactionDetailField label="Note" className="sm:col-span-2"><span className="whitespace-pre-wrap">{transactionNote(transaction)}</span></TransactionDetailField>}
            {transaction && stringValue(transaction, "decision_note") && <TransactionDetailField label="Reviewer note" className="sm:col-span-2"><span className="whitespace-pre-wrap">{stringValue(transaction, "decision_note")}</span></TransactionDetailField>}
          </>
        )}
      </div>
      {verifyNeedsAccount && <p className="mt-4 rounded-md border border-[#f0d49b] bg-[#fff8e9] px-3 py-2 text-[11px] text-[#8a5a00]">Choose a receiving account before verifying this Cash In.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f5] pt-4">
        <div>
          {row.receiptPath && <button type="button" disabled={saving} onClick={() => void openReceipt(row.receiptPath, row.receiptBucket)} className="button-secondary"><ReceiptText size={14} /> View receipt</button>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={close} className="button-secondary">Close</button>
          {showIncomeRevision && <button type="button" disabled={saving} onClick={() => { close(); if (row.kind === "quotation_payment") requestQuotationPaymentReview(row.id, "revision_requested"); else requestIncomeRevision(row.id); }} className="button-secondary"><Undo2 size={14} aria-hidden="true" /> Return for correction</button>}
          {showCashOutRevision && <button type="button" disabled={saving} onClick={() => { close(); requestRevision(row.id); }} className="button-secondary"><Undo2 size={14} aria-hidden="true" /> Return for revision</button>}
          {showCashOutApproval && <button type="button" disabled={saving || !row.accountId} onClick={() => { close(); requestApproveAndPay(row.id); }} className="button-success"><Check size={14} aria-hidden="true" /> Approve and pay</button>}
          {showVerify && <button type="button" disabled={saving || verifyNeedsAccount} onClick={() => { close(); if (row.kind === "quotation_payment") requestQuotationPaymentReview(row.id, "verified"); else requestVerifyIncome(row.id); }} className="button-success"><Check size={14} aria-hidden="true" /> Verify</button>}
        </div>
      </div>
    </FinanceDialog>
  );
}

// Kept as a compatibility helper for any older local callers while the
// approval center uses the normalized table below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PendingQuotationPaymentTable({
  rows,
  quotations,
  leads,
  accounts,
  accountName,
  openReceipt,
  assignAccount,
  review,
  saving,
}: {
  rows: Row[];
  quotations: Row[];
  leads: Row[];
  accounts: Row[];
  accountName: (id: unknown) => string;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  assignAccount: (paymentId: string, accountId: string) => Promise<void>;
  review: (paymentId: string, decision: QuotationPaymentDecision) => void;
  saving: boolean;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visibleRows = rows.slice(
    (activePage - 1) * TABLE_PAGE_SIZE,
    activePage * TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const quoteFor = (payment: Row) =>
    quotations.find((quotation) => quotation.id === payment.quotation_id);
  const leadFor = (quote: Row | undefined) =>
    leads.find((lead) => lead.id === quote?.lead_id);
  const accountOptionsFor = (payment: Row) =>
    accounts.filter(
      (account) =>
        Boolean(account.is_active) &&
        stringValue(account, "payment_method") === stringValue(payment, "method"),
    );

  const paymentDetails = (payment: Row) => {
    const quote = quoteFor(payment);
    const lead = leadFor(quote);
    return {
      quote,
      quoteNo: stringValue(quote, "quotation_no", "Price Quotation"),
      project: stringValue(quote, "project_name", "—"),
      client: stringValue(lead, "client_name", stringValue(quote, "client_name", "—")),
      accountId: stringValue(payment, "finance_account_id"),
      accountOptions: accountOptionsFor(payment),
      date: displayDate(payment.paid_at ?? payment.submitted_at ?? payment.created_at),
      method: financePaymentMethodLabel(payment.method),
      kind: stringValue(payment, "payment_kind", "payment").replaceAll("_", " "),
      amount: peso.format(numericValue(payment, "amount")),
      receiptPath: stringValue(payment, "receipt_storage_path"),
    };
  };

  return (
    <div className="finance-transaction-table">
      <div className="space-y-2 md:hidden">
        {visibleRows.map((payment) => {
          const details = paymentDetails(payment);
          return (
            <article key={String(payment.id)} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-[#202938]">{details.quoteNo}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">Client: {details.client}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">Project: {details.project || "-"}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">{details.date}</p>
                  <p className="mt-1 text-[10px] capitalize text-[#7d8797]">{details.kind}</p>
                </div>
                <StatusPill value="pending_confirmation" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                <div><span className="block text-[10px] text-[#8b92a1]">Amount</span><span className="font-semibold text-[#218b55]">{details.amount}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Received into</span><span>{details.accountId ? accountName(details.accountId) : "No account selected"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Payment method</span><span>{details.method}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
                {details.receiptPath && <button type="button" disabled={saving} onClick={() => void openReceipt(details.receiptPath, "quotation-payment-receipts")} className="button-secondary text-[10px]"><ReceiptText size={13} /> Receipt</button>}
                <button type="button" disabled={saving} onClick={() => review(String(payment.id), "revision_requested")} className="button-secondary text-[10px]"><Undo2 size={13} aria-hidden="true" /> Return for correction</button>
                <button type="button" disabled={saving} onClick={() => review(String(payment.id), "verified")} className="button-secondary text-[10px]"><Check size={13} aria-hidden="true" /> Verify</button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="table-shell hidden overflow-x-auto md:block">
        <table className="app-table w-full min-w-[1220px]">
          <thead><tr><th>Paid date</th><th>Quotation</th><th>Client</th><th>Project</th><th>Type</th><th>Received into</th><th>Payment method</th><th>Amount</th><th>Receipt</th><th>Review</th></tr></thead>
          <tbody>
            {visibleRows.map((payment) => {
              const details = paymentDetails(payment);
              return (
                <tr key={String(payment.id)}>
                  <td>{details.date}</td>
                  <td>{details.quoteNo}</td>
                  <td>{details.client}</td>
                  <td>{details.project || "-"}</td>
                  <td className="capitalize">{details.kind}</td>
                  <td>
                    {details.accountOptions.length ? (
                      <select
                        aria-label={`Receiving account for ${details.quoteNo}`}
                        value={details.accountOptions.some((account) => String(account.id) === details.accountId) ? details.accountId : ""}
                        onChange={(event) => {
                          if (event.target.value) void assignAccount(String(payment.id), event.target.value);
                        }}
                        disabled={saving}
                        className="input min-w-[170px] text-[10px]"
                      >
                        <option value="">{details.accountId ? `${accountName(details.accountId)} (not eligible)` : "Choose account"}</option>
                        {details.accountOptions.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}
                      </select>
                    ) : <span>{details.accountId ? accountName(details.accountId) : "No account selected"}</span>}
                  </td>
                  <td>{details.method}</td>
                  <td className="font-semibold text-[#218b55]">{details.amount}</td>
                  <td>{details.receiptPath ? <button type="button" disabled={saving} onClick={() => void openReceipt(details.receiptPath, "quotation-payment-receipts")} className="button-secondary text-[10px]"><ReceiptText size={13} /> Receipt</button> : "—"}</td>
                  <td><span className="flex flex-wrap gap-1"><button type="button" disabled={saving} onClick={() => review(String(payment.id), "revision_requested")} className="button-secondary text-[10px]"><Undo2 size={13} aria-hidden="true" /> Return for correction</button><button type="button" disabled={saving} onClick={() => review(String(payment.id), "verified")} className="button-secondary text-[10px]"><Check size={13} aria-hidden="true" /> Verify</button></span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={10} className="text-center text-[#7d8797]">No quotation payment receipts are awaiting verification.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_PAGE_SIZE && <TablePagination page={activePage} pageCount={pageCount} total={rows.length} onPageChange={setPage} label="Pending quotation payment pagination" />}
    </div>
  );
}

function PendingApprovalTable({
  rows,
  accountName,
  onSelectReview,
  saving,
}: {
  rows: PendingApprovalRow[];
  accountName: (id: unknown) => string;
  onSelectReview: (row: PendingApprovalRow) => void;
  saving: boolean;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visibleRows = rows.slice(
    (activePage - 1) * TABLE_PAGE_SIZE,
    activePage * TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  return (
    <div className="finance-transaction-table finance-approval-table">
      <div className="space-y-2 px-4 py-4 md:hidden sm:px-5">
        {visibleRows.map((row) => (
          <article key={`${row.kind}-${row.id}`} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-[#202938]">{row.description}</p>
                <p className="mt-1 text-[10px] text-[#7d8797]">{displayDate(row.date)} · {row.source}</p>
              </div>
              <StatusPill value={row.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
              <div><span className="block text-[10px] text-[#8b92a1]">Amount</span><span aria-label={`${row.direction === "income" ? "Cash In" : "Cash Out"} amount ${peso.format(row.amount)}`} className={`font-semibold ${row.direction === "income" ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(row.amount)}</span></div>
              <div><span className="block text-[10px] text-[#8b92a1]">Account</span><span>{row.accountId ? accountName(row.accountId) : "Needs finance account"}</span></div>
              <div className="col-span-2"><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 whitespace-pre-wrap text-[#344054]">{row.note}</span></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
              <button type="button" disabled={saving} title={`Review ${row.description}`} aria-label={`Review ${row.description}`} onClick={() => onSelectReview(row)} className="table-action"><ClipboardCheck size={15} aria-hidden="true" /></button>
            </div>
          </article>
        ))}
        {!visibleRows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-6 text-center text-[11px] text-[#7d8797]">No Cash In or Cash Out approvals match this filter.</p>}
      </div>
      <div className="table-shell hidden overflow-x-auto md:block">
        <table className="app-table w-full min-w-[980px]">
          <thead><tr><th>Date</th><th>Description</th><th>Note</th><th>Source</th><th>Account</th><th>Amount</th><th>Status</th><th className="finance-action-column">Review</th></tr></thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={`${row.kind}-${row.id}`}>
                <td>{displayDate(row.date)}</td>
                <td>{row.description}</td>
                <td>{row.note}</td>
                <td>{row.source}</td>
                <td>{row.accountId ? accountName(row.accountId) : <span className="text-[#a76605]">Needs finance account</span>}</td>
                <td className="whitespace-nowrap"><span aria-label={`${row.direction === "income" ? "Cash In" : "Cash Out"} amount ${peso.format(row.amount)}`} className={`font-semibold ${row.direction === "income" ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(row.amount)}</span></td>
                <td><StatusPill value={row.status} /></td>
                <td className="finance-action-cell"><button type="button" disabled={saving} title={`Review ${row.description}`} aria-label={`Review ${row.description}`} onClick={() => onSelectReview(row)} className="table-action"><ClipboardCheck size={15} aria-hidden="true" /></button></td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan={8} className="text-center text-[#7d8797]">No Cash In or Cash Out approvals match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_PAGE_SIZE && <TablePagination page={activePage} pageCount={pageCount} total={rows.length} onPageChange={setPage} label="Pending Finance approvals pagination" />}
    </div>
  );
}

const pdfStyles = PdfStyleSheet.create({
  page: { padding: 28, fontSize: 9, color: "#202938" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 5 },
  detail: { color: "#687386", marginBottom: 16 },
  summary: { gap: 6, marginBottom: 18, fontSize: 10, fontWeight: 700 },
  table: { borderWidth: 1, borderColor: "#d9e0e9" },
  headerRow: { flexDirection: "row", backgroundColor: "#f1f4f8", padding: 6, fontWeight: 700 },
  row: { flexDirection: "row", borderTopWidth: 1, borderColor: "#edf0f5", padding: 6 },
  date: { width: "17%" },
  description: { width: "38%" },
  amount: { width: "17%" },
  status: { width: "17%" },
});

function Panel({
  title,
  detail,
  action,
  children,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[#d9e0e9] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#edf0f5] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-[14px] font-semibold text-[#202938]">{title}</h2>
          {detail && <p className="mt-1 text-[11px] leading-5 text-[#7d8797]">{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FinanceSummaryMetric({
  label,
  value,
  color = "text-[#202938]",
  detail,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-[#4f5663]">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold ${color}`}>{value}</p>
      {detail && <p className="mt-1 text-[10px] leading-4 text-[#7d8797]">{detail}</p>}
    </div>
  );
}

function FinanceOverviewMetricCard({
  label,
  value,
  color = "text-[#202938]",
  detail,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  detail?: string;
}) {
  return (
    <article className="flex min-h-[112px] min-w-0 flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--card-shadow)]">
      <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-tertiary)]">{label}</p>
      <p className={`mt-2 truncate text-[22px] font-semibold tracking-tight ${color}`}>{value}</p>
      {detail && <p className="mt-auto pt-2 text-[10px] leading-4 text-[var(--color-text-tertiary)]">{detail}</p>}
    </article>
  );
}

const financeMonthKey = (value: unknown) => {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
};

const financeMonthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
};

function MonthlyFinanceReport({
  transactions,
  quotationPayments,
}: {
  transactions: Row[];
  quotationPayments: Row[];
}) {
  const [reportYear, setReportYear] = useState("all");
  const reportRows = useMemo<MonthlyFinanceReportRow[]>(() => {
    const grouped = new Map<string, MonthlyFinanceReportRow>();
    const getRow = (key: string) => {
      const existing = grouped.get(key);
      if (existing) return existing;
      const row: MonthlyFinanceReportRow = {
        key,
        label: financeMonthLabel(key),
        cashIn: 0,
        cashOut: 0,
        netEarnings: 0,
        verifiedTransactions: 0,
        pendingOrReturned: 0,
      };
      grouped.set(key, row);
      return row;
    };

    transactions.forEach((transaction) => {
      const key = financeMonthKey(transaction.transaction_date ?? transaction.created_at);
      if (!key || Boolean(transaction.is_voided)) return;
      const type = stringValue(transaction, "transaction_type");
      if (isVerifiedFinanceTransaction(transaction)) {
        const row = getRow(key);
        if (type === "income") row.cashIn += numericValue(transaction, "amount");
        if (type === "expense") row.cashOut += numericValue(transaction, "amount");
        row.verifiedTransactions += 1;
        return;
      }
      const pending = type === "expense"
        ? ["pending", "revision_requested"].includes(stringValue(transaction, "approval_status"))
        : isManualIncomeTransaction(transaction)
          && ["pending", "revision_requested"].includes(stringValue(transaction, "income_review_status"));
      if (pending) getRow(key).pendingOrReturned += 1;
    });

    quotationPayments.forEach((payment) => {
      if (!["pending", "revision_requested"].includes(stringValue(payment, "status"))) return;
      const key = financeMonthKey(payment.paid_at ?? payment.submitted_at ?? payment.created_at);
      if (!key) return;
      getRow(key).pendingOrReturned += 1;
    });

    return [...grouped.values()]
      .map((row) => ({ ...row, netEarnings: row.cashIn - row.cashOut }))
      .sort((left, right) => right.key.localeCompare(left.key));
  }, [quotationPayments, transactions]);
  const reportYears = useMemo(
    () => [...new Set(reportRows.map((row) => row.key.slice(0, 4)))].sort((left, right) => right.localeCompare(left)),
    [reportRows],
  );
  const visibleRows = reportYear === "all"
    ? reportRows
    : reportRows.filter((row) => row.key.startsWith(`${reportYear}-`));
  const totals = useMemo(
    () => visibleRows.reduce(
      (result, row) => ({
        cashIn: result.cashIn + row.cashIn,
        cashOut: result.cashOut + row.cashOut,
        netEarnings: result.netEarnings + row.netEarnings,
        verifiedTransactions: result.verifiedTransactions + row.verifiedTransactions,
        pendingOrReturned: result.pendingOrReturned + row.pendingOrReturned,
      }),
      { cashIn: 0, cashOut: 0, netEarnings: 0, verifiedTransactions: 0, pendingOrReturned: 0 },
    ),
    [visibleRows],
  );

  return (
    <Panel
      title="Monthly finance report"
      detail="Verified Cash In and Cash Out grouped by transaction date. Pending and returned records are excluded from Net Earnings."
      action={
        <label className="flex items-center gap-2 text-[11px] text-[#687386]">
          <span>Year</span>
          <select value={reportYear} onChange={(event) => setReportYear(event.target.value)} className="input mt-0 min-w-[120px] text-[12px]" aria-label="Report year">
            <option value="all">All years</option>
            {reportYears.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      }
    >
      {visibleRows.length ? (
        <div className="table-shell mt-4 overflow-x-auto">
          <table className="app-table w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="text-left">Month</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Net Earnings</th>
                <th className="text-right">Verified Transactions</th>
                <th className="text-right">Pending / Returned</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td className="text-left font-medium">{row.label}</td>
                  <td className="text-right">
                    <span className="block text-[var(--color-success-text)]" aria-label={`Cash In ${peso.format(row.cashIn)}`}>Cash In · {peso.format(row.cashIn)}</span>
                    <span className="mt-1 block text-[var(--color-danger-text)]" aria-label={`Cash Out ${peso.format(row.cashOut)}`}>Cash Out · {peso.format(row.cashOut)}</span>
                  </td>
                  <td className={`text-right font-semibold ${row.netEarnings >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)]"}`}>{peso.format(row.netEarnings)}</td>
                  <td className="text-right">{row.verifiedTransactions}</td>
                  <td className={`text-right ${row.pendingOrReturned ? "font-semibold text-[var(--color-warning-text)]" : "text-[#687386]"}`}>{row.pendingOrReturned}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[#d9e0e9]">
              <tr>
                <td className="px-3 pb-3 pt-4 text-left font-semibold">Total</td>
                <td className="px-3 pb-3 pt-4 text-right">
                  <span className="block text-[var(--color-success-text)]" aria-label={`Total Cash In ${peso.format(totals.cashIn)}`}>Cash In · {peso.format(totals.cashIn)}</span>
                  <span className="mt-1 block text-[var(--color-danger-text)]" aria-label={`Total Cash Out ${peso.format(totals.cashOut)}`}>Cash Out · {peso.format(totals.cashOut)}</span>
                </td>
                <td className={`px-3 pb-3 pt-4 text-right font-semibold ${totals.netEarnings >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)]"}`}>{peso.format(totals.netEarnings)}</td>
                <td className="px-3 pb-3 pt-4 text-right font-semibold">{totals.verifiedTransactions}</td>
                <td className={`px-3 pb-3 pt-4 text-right font-semibold ${totals.pendingOrReturned ? "text-[var(--color-warning-text)]" : "text-[#687386]"}`}>{totals.pendingOrReturned}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="px-5 py-12 text-center text-[12px] text-[#7d8797]">
          No finance activity is available for the selected period.
        </div>
      )}
    </Panel>
  );
}

function FinanceSummaryLayout({
  primaryLabel,
  primaryValue,
  primaryDetail,
  children,
  className = "",
}: {
  primaryLabel: string;
  primaryValue: ReactNode;
  primaryDetail?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] ${className}`}>
      <div className="min-w-0">
        <p className="text-[15px] text-[#4f5663]">{primaryLabel}</p>
        <p className="mt-2 text-4xl font-bold tracking-tight text-[#202938]">{primaryValue}</p>
        {primaryDetail && <p className="mt-2 text-[11px] text-[#7d8797]">{primaryDetail}</p>}
      </div>
      <div className="border-t border-[#edf0f5] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        {children}
      </div>
    </div>
  );
}

function FinanceDialog({
  title,
  detail,
  close,
  children,
  compact = false,
  wide = false,
  layer = "base",
  status,
}: {
  title: string;
  detail?: string;
  close: () => void;
  children: ReactNode;
  compact?: boolean;
  wide?: boolean;
  layer?: "base" | "top";
  status?: ReactNode;
}) {
  const titleId = useId();
  const detailId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), textarea, select, button[aria-haspopup='listbox'], [role=combobox]",
      );
      (firstField ?? dialogRef.current?.querySelector<HTMLElement>("button"))?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <div className={`fixed inset-0 ${layer === "top" ? "z-[60]" : "z-50"} grid place-items-center bg-[#151922]/40 p-4`}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detail ? detailId : undefined}
        className={`max-h-[calc(100dvh-2rem)] w-full ${compact ? "max-w-sm" : wide ? "max-w-5xl" : "max-w-3xl"} overflow-y-auto rounded-lg border border-[#d9e0e9] bg-white p-5`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold text-[#202938]">{title}</h2>
            {detail && <p id={detailId} className="mt-1 text-[12px] text-[#7d8797]">{detail}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status}
            <button type="button" onClick={close} aria-label="Close" className="text-[#687386] hover:text-[#202938]"><X size={18} /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function FinanceConfirmDialog({
  action,
  note,
  setNote,
  saving,
  close,
  confirm,
}: {
  action: FinanceAction;
  note: string;
  setNote: (value: string) => void;
  saving: boolean;
  close: () => void;
  confirm: () => void | Promise<void>;
}) {
  const isDecision = action.kind === "approve_and_pay" || action.kind === "quotation_payment" || action.kind === "budget" || action.kind === "revision" || action.kind === "verify_income" || action.kind === "income_revision";
  const isRejection = (action.kind === "budget" && action.decision === "rejected") || (action.kind === "quotation_payment" && action.decision === "rejected");
  const isQuotationRevision = action.kind === "quotation_payment" && action.decision === "revision_requested";
  const isRevision = action.kind === "revision" || action.kind === "income_revision" || isQuotationRevision || (action.kind === "budget" && action.decision === "revision_requested");
  const isBudgetRevision = action.kind === "budget" && action.decision === "revision_requested";
  const requiresNote = isRejection || isRevision || action.kind === "funding" || action.kind === "income_void";
  const actionLabel = action.kind === "paid"
    ? "Mark paid"
    : action.kind === "funding"
      ? "Void"
      : action.kind === "account"
        ? action.active ? "Reactivate" : "Deactivate"
      : action.kind === "approve_and_pay"
        ? "Approve and pay"
      : action.kind === "quotation_payment"
        ? action.decision === "verified" ? "Verify receipt" : action.decision === "revision_requested" ? "Return for correction" : "Reject receipt"
      : action.kind === "verify_income"
        ? "Verify Cash In"
      : action.kind === "income_void"
        ? "Reverse Cash In"
      : isRevision
        ? action.kind === "income_revision" ? "Return for correction" : "Return for revision"
      : action.decision === "approved" ? "Approve" : "Reject";

  return (
    <FinanceDialog
      title={`${actionLabel} ${action.label}`}
      detail={action.kind === "funding" ? "This removes the funding amount from the account balance but preserves the audit record." : action.kind === "account" ? "Deactivation hides the account from new payment selections but preserves its balances, payments, and receipts." : action.kind === "approve_and_pay" ? "This approves the regular Cash Out, records it as paid, and deducts the selected payment account." : action.kind === "quotation_payment" ? action.decision === "verified" ? "This confirms the client receipt and posts it as Cash In." : action.decision === "revision_requested" ? "This returns the receipt to External Finance for correction. It stays out of Cash In until resubmitted and verified." : "This rejects the receipt and keeps it out of Cash In." : action.kind === "verify_income" ? "This confirms the receipt, updates the selected receiving account balance, and includes the amount in Cash In totals." : action.kind === "income_void" ? "This reverses the verified Cash In and removes it from the account balance while preserving the audit record." : isRevision ? isBudgetRevision ? "This sends the budget request back to External Finance for correction and resubmission." : action.kind === "income_revision" ? "This sends the standalone Cash In back to External Finance for correction and resubmission." : "This sends the unpaid Cash Out back to External Finance for correction and resubmission." : isDecision ? "Add a note so the financial decision is clear to the next reviewer." : "This changes the settlement status in the finance ledger."}
      close={close}
    >
      {(isDecision || action.kind === "funding" || action.kind === "income_void") && (
        <label className="field-label mt-5 block">
          {action.kind === "funding" ? "Void reason (required)" : action.kind === "income_void" ? "Reversal reason (required)" : isRevision ? action.kind === "income_revision" || isQuotationRevision ? "Correction reason (required)" : "Revision reason (required)" : `Decision note${isRejection ? " (required)" : " (optional)"}`}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input mt-1 min-h-24" placeholder={action.kind === "funding" ? "Explain why this funding entry is being voided" : action.kind === "income_void" ? "Explain why this Cash In is being reversed" : action.kind === "quotation_payment" && action.decision === "revision_requested" ? "Explain what External Finance must correct" : isRevision ? isBudgetRevision ? "Explain what External Finance must correct in this budget request" : action.kind === "income_revision" ? "Explain what External Finance must correct in this Cash In" : "Explain what External Finance must correct" : isRejection ? action.kind === "quotation_payment" ? "Explain why this receipt is being rejected" : "Explain why this request is being rejected" : "Add context for this approval"} />
        </label>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={close} className={secondaryButton}>Cancel</button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving || (requiresNote && !note.trim())}
          className={requiresNote ? "button-danger" : primaryButton}
        >
          {saving && <LoaderCircle size={14} className="animate-spin" />}
          {saving ? "Saving…" : actionLabel}
        </button>
      </div>
    </FinanceDialog>
  );
}

function FinanceLoadingState({ cardCount = 4 }: { cardCount?: number }) {
  return (
    <div className="space-y-4">
      <LoadingState variant="bar" label="Loading Finance workspace..." />
      <div className={`grid gap-4 sm:grid-cols-2 ${cardCount === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
        {Array.from({ length: cardCount }, (_, index) => index + 1).map((item) => <div key={item} className="h-24 animate-pulse rounded-lg border border-[#edf0f5] bg-[#f6f8fb]" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-[#edf0f5] bg-[#f6f8fb]" />
    </div>
  );
}

export function FinanceWorkspace({
  organizationId,
  role,
  overviewOnly = false,
  reportOnly = false,
  openAction = null,
  onOpenActionHandled,
}: {
  organizationId: string;
  role: string;
  overviewOnly?: boolean;
  reportOnly?: boolean;
  openAction?: Direction | null;
  onOpenActionHandled?: () => void;
}) {
  const client = useMemo(() => createClient(), []);
  const internal = isInternalRole(role);
  const canRequestBudget = role === "external_finance";
  const canSubmitExpense = role === "external_finance";
  const canRecordIncome = role === "external_finance";
  const canRecordSupplierCosting = role === "external_finance";
  const financeTabs = useMemo<[Tab, string][]>(
    () => [
      ...(internal ? [["approvals", "Pending approvals"] as [Tab, string]] : []),
      ["transactions", "Transaction history"],
      ...(internal ? [["accounts", "Accounts"] as [Tab, string]] : []),
      ["budget", "Budget requests"],
      ...(internal || canRecordSupplierCosting ? [["supplier_costing", "Supplier costing"] as [Tab, string]] : []),
      ...(internal ? [["payables", "Payables"] as [Tab, string]] : []),
    ],
    [canRecordSupplierCosting, internal],
  );
  const [tab, setTab] = useState<Tab>(reportOnly ? "reports" : overviewOnly ? "overview" : internal ? "approvals" : "transactions");
  const [payablesSection, setPayablesSection] = useState<PayablesSection>("commission");
  const [payablesPage, setPayablesPage] = useState(1);
  const [budgetPage, setBudgetPage] = useState(1);
  const [supplierCostingPage, setSupplierCostingPage] = useState(1);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [transactionPeriod, setTransactionPeriod] = useState<Period>("monthly");
  const [transactionQuery, setTransactionQuery] = useState("");
  const [transactionView, setTransactionView] = useState<TransactionView>("all");
  const [transactionSourceFilter, setTransactionSourceFilter] = useState<TransactionSourceFilter>("all");
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<TransactionStatusFilter>("all");
  const [transactionAccountFilter, setTransactionAccountFilter] = useState("all");
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("all");
  const [pendingApprovalFilter, setPendingApprovalFilter] = useState<PendingApprovalFilter>("all");
  const [selectedTransaction, setSelectedTransaction] = useState<Row | null>(null);
  const [selectedProjectHistory, setSelectedProjectHistory] = useState<ProjectHistoryRow | null>(null);
  const [selectedApprovalKey, setSelectedApprovalKey] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [balances, setBalances] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<Row[]>([]);
  const [leads, setLeads] = useState<Row[]>([]);
  const [quotations, setQuotations] = useState<Row[]>([]);
  const [quotationDirectCosts, setQuotationDirectCosts] = useState<Row[]>([]);
  const [projectExpenseRows, setProjectExpenseRows] = useState<Row[]>([]);
  const [payables, setPayables] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [commissionAllocations, setCommissionAllocations] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Row[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<Row[]>([]);
  const [quotationPaymentRecords, setQuotationPaymentRecords] = useState<Row[]>([]);
  const [pendingQuotationPayments, setPendingQuotationPayments] = useState<Row[]>([]);
  const [accountFundingEntries, setAccountFundingEntries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<FinanceAction | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [transactionDirection, setTransactionDirection] = useState<Direction | null>(null);
  const [cashInSource, setCashInSource] = useState<CashInSource>("other_income");
  const [revisionTransaction, setRevisionTransaction] = useState<Row | null>(null);
  const [expenseMode, setExpenseMode] = useState<ExpenseMode>("regular");
  const [transactionFile, setTransactionFile] = useState<File | null>(null);
  const [transactionValues, setTransactionValues] = useState(defaultTransaction("income"));
  const [categoryDraft, setCategoryDraft] = useState({ name: "", expense_class: "operating" });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEditing, setAccountEditing] = useState<Row | null>(null);
  const [accountFile, setAccountFile] = useState<File | null>(null);
  const [accountValues, setAccountValues] = useState({ name: "", type: "bank", number: "", opening_balance: "", payment_method: "bank_transfer" });
  const [accountFundingOpen, setAccountFundingOpen] = useState(false);
  const [accountFundingFile, setAccountFundingFile] = useState<File | null>(null);
  const [accountFundingValues, setAccountFundingValues] = useState({ account_id: "", amount: "", funding_source: "owner_funding", funding_date: localDate(), note: "" });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetRevision, setBudgetRevision] = useState<Row | null>(null);
  const [budgetValues, setBudgetValues] = useState({ amount: "", note: "" });
  const [supplierCostOpen, setSupplierCostOpen] = useState(false);
  const [supplierCostValues, setSupplierCostValues] = useState({ supplier_id: "", quotation_id: "", lead_id: "", description: "", amount: "", due_date: "", notes: "" });
  const financeRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void client.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (overviewOnly || reportOnly || tab === "overview" || tab === "reports" || financeTabs.some(([value]) => value === tab)) return;
    setTab(financeTabs[0]?.[0] ?? "transactions");
  }, [financeTabs, overviewOnly, reportOnly, tab]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const accountsRequest = internal
        ? client.from("finance_accounts").select("*").eq("organization_id", organizationId).order("account_name")
        : client.rpc("list_finance_payment_accounts", {
            p_organization_id: organizationId,
          });
      const balancesRequest = internal
        ? client.from("finance_account_balances").select("*").eq("organization_id", organizationId).order("account_name")
        : Promise.resolve({ data: [], error: null });
      const accountFundingRequest = internal
        ? client.from("finance_account_funding_entries").select("*").eq("organization_id", organizationId).order("funding_date", { ascending: false }).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const commissionAllocationsRequest = internal
        ? client.from("commission_summary_allocations").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const quotationsRequest = internal
        ? client
            .from("quotations")
            .select("*")
            .eq("organization_id", organizationId)
            .in("document_type", ["price_quotation", "mockup_quotation"])
            .order("created_at", { ascending: false })
        : client.rpc("external_finance_quotation_rows", {
            p_organization_id: organizationId,
          });
      const quotationDirectCostsRequest = internal
        ? client.rpc("finance_quotation_direct_cost_rows", {
            p_organization_id: organizationId,
          })
        : Promise.resolve({ data: [], error: null });
      const projectExpenseRowsRequest = client.rpc("finance_project_expense_rows", {
        p_organization_id: organizationId,
      });
      const pendingQuotationPaymentsRequest = internal
        ? client
            .from("quotation_payment_records")
            .select("*")
            .eq("organization_id", organizationId)
            .in("status", ["pending", "revision_requested"])
            .order("paid_at", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const quotationPaymentRecordsRequest = internal
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("quotation_payment_records")
            .select("id,quotation_id,status,payment_kind,amount,paid_at,finance_account_id,reference_no,notes,receipt_storage_path,receipt_file_name,receipt_content_type,receipt_file_size,submitted_by,correction_note,submitted_at,created_at")
            .eq("organization_id", organizationId)
            .order("paid_at", { ascending: false })
            .order("created_at", { ascending: false });
      const requests = await Promise.all([
        client.from("finance_transactions").select("*").eq("organization_id", organizationId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
        client.from("finance_categories").select("*").eq("organization_id", organizationId).eq("is_active", true).order("direction").order("name"),
        accountsRequest,
        balancesRequest,
        client.from("finance_budget_requests").select("*").eq("organization_id", organizationId).order("requested_at", { ascending: false }),
        client.from("leads").select("id,lead_no,client_name,contact_name,phone,email,project_name").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        quotationsRequest,
        client.from("supplier_payables").select("*").eq("organization_id", organizationId).order("due_date", { ascending: true }),
        client.from("suppliers").select("id,company_name").eq("organization_id", organizationId).order("company_name"),
        commissionAllocationsRequest,
        client.from("profiles").select("id,full_name"),
        client.from("quotation_payment_records").select("quotation_id,status,amount,verified_at").eq("organization_id", organizationId).eq("status", "verified"),
        accountFundingRequest,
        pendingQuotationPaymentsRequest,
        quotationPaymentRecordsRequest,
        quotationDirectCostsRequest,
        projectExpenseRowsRequest,
      ]);
      const failed = requests.find((request) => request.error);
      if (failed?.error) {
        setLoadError(`Finance data could not load: ${failed.error.message}`);
      }
      setTransactions((requests[0].data ?? []) as Row[]);
      setCategories((requests[1].data ?? []) as Row[]);
      setAccounts((requests[2].data ?? []) as Row[]);
      setBalances((requests[3].data ?? []) as Row[]);
      setBudgets((requests[4].data ?? []) as Row[]);
      setLeads((requests[5].data ?? []) as Row[]);
      setQuotations((requests[6].data ?? []) as Row[]);
      setQuotationDirectCosts((requests[15].data ?? []) as Row[]);
      setProjectExpenseRows((requests[16].data ?? []) as Row[]);
      setPayables((requests[7].data ?? []) as Row[]);
      setSuppliers((requests[8].data ?? []) as Row[]);
      const loadedAllocations = (requests[9].data ?? []) as Row[];
      setCommissionAllocations(loadedAllocations);
      setProfiles((requests[10].data ?? []) as Row[]);
      setPaymentRecords((requests[11].data ?? []) as Row[]);
      setAccountFundingEntries((requests[12].data ?? []) as Row[]);
      setPendingQuotationPayments((requests[13].data ?? []) as Row[]);
      setQuotationPaymentRecords((requests[14].data ?? []) as Row[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Finance data could not load.");
    } finally {
      setHasLoadedOnce(true);
      setLoading(false);
    }
  }, [client, internal, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const realtimeTables = [
      "finance_transactions",
      "finance_categories",
      "finance_accounts",
      "finance_account_funding_entries",
      "finance_budget_requests",
      "supplier_payables",
      "commission_summary_allocations",
      "quotation_payment_records",
      "leads",
      "quotations",
      "suppliers",
      "profiles",
    ];
    const scheduleRefresh = () => {
      if (financeRefreshTimer.current) {
        window.clearTimeout(financeRefreshTimer.current);
      }
      financeRefreshTimer.current = window.setTimeout(() => {
        financeRefreshTimer.current = null;
        void load();
      }, 400);
    };
    const channel = client.channel(`finance-data:${organizationId}`);
    realtimeTables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    });
    channel.subscribe();
    return () => {
      if (financeRefreshTimer.current) {
        window.clearTimeout(financeRefreshTimer.current);
        financeRefreshTimer.current = null;
      }
      void client.removeChannel(channel);
    };
  }, [client, load, organizationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCategories = useMemo(
    () => categories.filter((category) => stringValue(category, "direction") === (transactionDirection ?? "income")),
    [categories, transactionDirection],
  );
  const isStandaloneExternalIncome = role === "external_finance" && transactionDirection === "income" && !revisionTransaction && cashInSource === "other_income";
  const activeAccounts = useMemo(
    () => accounts.filter((account) => Boolean(account.is_active)),
    [accounts],
  );

  const categoryOptions = useMemo<SearchableOption[]>(
    () => {
      const visibleCategories = isStandaloneExternalIncome
        ? activeCategories.filter((category) => !stringValue(category, "name").trim().toLowerCase().startsWith("customer payment"))
        : activeCategories;
      const options = visibleCategories.map((category) => {
        const expenseClass = stringValue(category, "expense_class");
        const groupLabel = expenseClass === "non_operating"
          ? "Non-operating expenses"
          : expenseClass === "operating"
            ? "Operating expenses"
            : undefined;

        return {
          value: String(category.id),
          label: stringValue(category, "name"),
          searchText: [stringValue(category, "name"), expenseClass, groupLabel].filter(Boolean).join(" "),
          groupLabel: transactionDirection === "expense" ? groupLabel : undefined,
        };
      });

      if (transactionDirection !== "expense") return options;

      const groupOrder: Record<string, number> = {
        "Operating expenses": 0,
        "Non-operating expenses": 1,
      };

      return options.sort((left, right) => (groupOrder[left.groupLabel ?? ""] ?? 2) - (groupOrder[right.groupLabel ?? ""] ?? 2));
    },
    [activeCategories, isStandaloneExternalIncome, transactionDirection],
  );

  const leadOptions = useMemo(
    () => leads.map((lead) => ({
      value: String(lead.id),
      label: `${stringValue(lead, "client_name")} · ${stringValue(lead, "contact_name", "Lead")}`,
      searchText: [
        stringValue(lead, "lead_no"),
        stringValue(lead, "client_name"),
        stringValue(lead, "contact_name"),
        stringValue(lead, "project_name"),
        stringValue(lead, "phone"),
        stringValue(lead, "email"),
      ].join(" "),
    })),
    [leads],
  );

  const categoryName = useCallback((categoryId: unknown) => stringValue(categories.find((category) => category.id === categoryId), "name", "Uncategorized"), [categories]);
  const accountName = useCallback((accountId: unknown) => stringValue(accounts.find((account) => account.id === accountId), "account_name", "—"), [accounts]);
  const leadName = useCallback((leadId: unknown) => stringValue(leads.find((lead) => lead.id === leadId), "client_name", "—"), [leads]);
  const supplierName = useCallback((supplierId: unknown) => stringValue(suppliers.find((supplier) => supplier.id === supplierId), "company_name", "—"), [suppliers]);
  const quotationName = useCallback((quotationId: unknown) => stringValue(quotations.find((quotation) => quotation.id === quotationId), "quotation_no", "—"), [quotations]);
  const profileName = useCallback((profileId: unknown) => stringValue(profiles.find((profile) => profile.id === profileId), "full_name", "Sales & Pricing Officer"), [profiles]);
  const financeUserName = useCallback((profileId: unknown) => stringValue(profiles.find((profile) => profile.id === profileId), "full_name", "—"), [profiles]);

  const verifiedPaymentByQuotation = useMemo(() => {
    const map = new Map<string, string>();
    const totals = new Map<string, number>();
    paymentRecords.forEach((record) => {
      const quotationId = stringValue(record, "quotation_id");
      const verifiedAt = stringValue(record, "verified_at");
      if (!quotationId || !verifiedAt) return;
      totals.set(quotationId, (totals.get(quotationId) ?? 0) + numericValue(record, "amount"));
      if (!map.has(quotationId) || verifiedAt > String(map.get(quotationId))) map.set(quotationId, verifiedAt);
    });
    quotations.forEach((quotation) => {
      const quotationId = String(quotation.id);
      if (numericValue(quotation, "total_amount") > 0 && (totals.get(quotationId) ?? 0) + 0.001 >= numericValue(quotation, "total_amount")) return;
      map.delete(quotationId);
    });
    return map;
  }, [paymentRecords, quotations]);

  const verifiedPaymentTotalsByQuotation = useMemo(() => {
    const map = new Map<string, number>();
    paymentRecords.forEach((record) => {
      const quotationId = stringValue(record, "quotation_id");
      if (quotationId) map.set(quotationId, (map.get(quotationId) ?? 0) + numericValue(record, "amount"));
    });
    return map;
  }, [paymentRecords]);

  const eligibleCommissionAllocationsForOptions = useMemo(() => commissionAllocations.filter((allocation) => {
    if (stringValue(allocation, "status") !== "not_yet_paid") return false;
    const quotation = quotations.find((item) => item.id === allocation.quotation_id);
    const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id"));
    const verifiedAmount = verifiedPaymentTotalsByQuotation.get(stringValue(allocation, "quotation_id")) ?? 0;
    const total = numericValue(quotation, "total_amount");
    return Boolean(
      verifiedAt
      && total > 0
      && verifiedAmount + 0.001 >= total
      && currentTime >= new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000,
    );
  }), [commissionAllocations, currentTime, quotations, verifiedPaymentByQuotation, verifiedPaymentTotalsByQuotation]);

  const accountOptions = useMemo<SearchableOption[]>(
    () => activeAccounts.map((account) => ({
      value: String(account.id),
      label: stringValue(account, "account_name"),
      searchText: [stringValue(account, "account_name"), stringValue(account, "account_number"), stringValue(account, "account_type"), financePaymentMethodLabel(account.payment_method)].join(" "),
    })),
    [activeAccounts],
  );

  const supplierOptions = useMemo<SearchableOption[]>(
    () => suppliers.map((supplier) => ({
      value: String(supplier.id),
      label: stringValue(supplier, "company_name"),
      searchText: stringValue(supplier, "company_name"),
    })),
    [suppliers],
  );

  const quotationOptions = useMemo<SearchableOption[]>(
    () => quotations.map((quotation) => ({
      value: String(quotation.id),
      label: `${stringValue(quotation, "quotation_no")} · ${stringValue(quotation, "client_name", "Name / Company not set")}`,
      searchText: [stringValue(quotation, "quotation_no"), stringValue(quotation, "client_name"), stringValue(quotation, "project_name")].join(" "),
    })),
    [quotations],
  );

  const normalizedQuotationOptions = useMemo<SearchableOption[]>(
    () => quotationOptions.map((option) => {
      const quotation = quotations.find((item) => String(item.id) === option.value);
      const lead = leads.find((item) => String(item.id) === String(quotation?.lead_id));
      const label = financeProjectLabel(quotation, lead, "Quotation");
      return { ...option, label, searchText: [label, option.searchText].join(" ") };
    }),
    [leads, quotationOptions, quotations],
  );

  const projectExpenseOptions = useMemo<SearchableOption[]>(
    () => projectExpenseRows.map((project) => {
      const projectName = stringValue(project, "project_name") || stringValue(project, "client_name", "Unnamed project");
      const clientName = stringValue(project, "client_name", "Client not set");
      const clientContactName = stringValue(project, "client_contact_name");
      const quotationNo = stringValue(project, "quotation_no", "Quotation");
      return {
        value: `quotation:${String(project.quotation_id)}`,
        label: `${projectName} · ${quotationNo}`,
        searchText: [projectName, clientName, clientContactName, quotationNo, stringValue(project, "lead_id")].join(" "),
      };
    }),
    [projectExpenseRows],
  );

  const quotationPaymentOptions = useMemo<SearchableOption[]>(
    () => quotations
      .filter((quotation) => stringValue(quotation, "document_type") === "price_quotation" && stringValue(quotation, "status") === "approved")
      .map((quotation) => {
        const lead = leads.find((item) => String(item.id) === String(quotation.lead_id));
        const companyName = stringValue(quotation, "client_name", stringValue(lead, "client_name", "Company not set"));
        const clientName = stringValue(quotation, "client_contact_name", stringValue(lead, "contact_name", "Client not set"));
        return {
          value: String(quotation.id),
          label: `${companyName} — ${clientName}`,
          searchText: [companyName, clientName, stringValue(quotation, "quotation_no"), stringValue(quotation, "project_name")].filter(Boolean).join(" "),
        };
      }),
    [leads, quotations],
  );

  const normalizedQuotationPaymentOptions = useMemo<SearchableOption[]>(
    () => quotationPaymentOptions.map((option) => {
      const quotation = quotations.find((item) => String(item.id) === option.value);
      const lead = leads.find((item) => String(item.id) === String(quotation?.lead_id));
      const label = financeProjectLabel(quotation, lead, "Quotation");
      return { ...option, label, searchText: [label, option.searchText].join(" ") };
    }),
    [leads, quotationPaymentOptions, quotations],
  );

  const eligibleCommissionOptions = useMemo<SearchableOption[]>(
    () => eligibleCommissionAllocationsForOptions.map((allocation) => ({
      value: String(allocation.id),
      label: `${quotationName(allocation.quotation_id)} · ${profileName(allocation.recipient_user_id)} · ${commissionRoleLabel(allocation.allocation_role)} · ${peso.format(numericValue(allocation, "amount"))}`,
      searchText: [quotationName(allocation.quotation_id), profileName(allocation.recipient_user_id), commissionRoleLabel(allocation.allocation_role)].join(" "),
    })),
    [eligibleCommissionAllocationsForOptions, profileName, quotationName],
  );

  const supplierPayableOptions = useMemo<SearchableOption[]>(
    () => payables
      .filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status")))
      .map((payable) => ({
        value: String(payable.id),
        label: `${stringValue(payable, "payable_no")} · ${supplierName(payable.supplier_id)}`,
        searchText: [stringValue(payable, "payable_no"), supplierName(payable.supplier_id), stringValue(payable, "description")].join(" "),
      })),
    [payables, supplierName],
  );

  const selectedSupplierPayable = useMemo(
    () => payables.find((payable) => String(payable.id) === transactionValues.supplier_payable_id) ?? null,
    [payables, transactionValues.supplier_payable_id],
  );
  const selectedSupplierPayableRemaining = selectedSupplierPayable
    ? Math.max(numericValue(selectedSupplierPayable, "amount") - numericValue(selectedSupplierPayable, "amount_paid"), 0)
    : 0;

  const currentMonthRange = useMemo(() => {
    const today = localDate();
    const [year, month] = today.split("-").map(Number);
    return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
  }, []);
  const transactionPeriodRange = useMemo(() => {
    if (transactionPeriod === "all") return { start: "", end: "" };
    const today = localDate();
    const [year, month, date] = today.split("-").map(Number);
    if (transactionPeriod === "yearly") return { start: `${year}-01-01`, end: today };
    if (transactionPeriod === "monthly") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
    const current = new Date(Date.UTC(year, month - 1, date));
    const day = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() - day + 1);
    return { start: current.toISOString().slice(0, 10), end: today };
  }, [transactionPeriod]);
  const transactionPeriodStart = transactionPeriodRange.start;
  const transactionPeriodEnd = transactionPeriodRange.end;

  const overviewPeriodTransactions = useMemo(
    () => transactions.filter((transaction) => {
      const transactionDate = stringValue(transaction, "transaction_date");
      if (currentMonthRange.start && transactionDate < currentMonthRange.start) return false;
      if (currentMonthRange.end && transactionDate > currentMonthRange.end) return false;
      return true;
    }),
    [currentMonthRange.end, currentMonthRange.start, transactions],
  );

  const transactionPeriodTransactions = useMemo(
    () => transactions.filter((transaction) => {
      const transactionDate = stringValue(transaction, "transaction_date");
      if (transactionPeriodStart && transactionDate < transactionPeriodStart) return false;
      if (transactionPeriodEnd && transactionDate > transactionPeriodEnd) return false;
      return true;
    }),
    [transactionPeriodEnd, transactionPeriodStart, transactions],
  );

  const filteredTransactions = useMemo(() => {
    const normalized = transactionQuery.trim().toLowerCase();
    return transactionPeriodTransactions.filter((transaction) => {
      const type = stringValue(transaction, "transaction_type") as TransactionView;
      if (transactionView !== "all" && type !== transactionView) return false;
      if (transactionSourceFilter !== "all" && transactionSourceValue(transaction) !== transactionSourceFilter) return false;
      if (transactionStatusFilter !== "all" && transactionStatusFilterValue(transaction) !== transactionStatusFilter) return false;
      if (transactionAccountFilter !== "all" && String(transaction.account_id ?? "") !== transactionAccountFilter) return false;
      if (transactionCategoryFilter !== "all" && String(transaction.category_id ?? "") !== transactionCategoryFilter) return false;
      if (!normalized) return true;
      const category = categories.find((item) => item.id === transaction.category_id);
      const account = accounts.find((item) => item.id === transaction.account_id);
      const lead = leads.find((item) => item.id === transaction.lead_id);
      const quotation = quotations.find((item) => item.id === transaction.quotation_id);
      const payable = payables.find((item) => item.id === transaction.supplier_payable_id);
      return [
        stringValue(transaction, "note"),
        stringValue(transaction, "transaction_type"),
        stringValue(category, "name"),
        stringValue(account, "account_name"),
        stringValue(account, "account_number"),
        stringValue(lead, "client_name"),
        stringValue(lead, "contact_name"),
        stringValue(lead, "lead_no"),
        stringValue(lead, "project_name"),
        stringValue(quotation, "quotation_no"),
        stringValue(quotation, "project_name"),
        stringValue(payable, "payable_no"),
        stringValue(payable, "description"),
        stringValue(transaction, "reference_number"),
        stringValue(transaction, "income_source"),
        stringValue(transaction, "income_review_status"),
        stringValue(transaction, "payment_status"),
        stringValue(transaction, "approval_status"),
        stringValue(transaction, "decision_note"),
        transactionSourceLabel(transaction),
        transactionStatusLabel(transaction),
        stringValue(suppliers.find((item) => item.id === payable?.supplier_id), "company_name"),
      ].join(" ").toLowerCase().includes(normalized);
    });
  }, [accounts, categories, leads, payables, quotations, suppliers, transactionAccountFilter, transactionCategoryFilter, transactionPeriodTransactions, transactionQuery, transactionSourceFilter, transactionStatusFilter, transactionView]);

  const projectHistoryRows = useMemo<ProjectHistoryRow[]>(() => {
    const grouped = new Map<string, ProjectHistoryRow>();
    transactions.forEach((transaction) => {
      if (!isVerifiedFinanceTransaction(transaction)) return;
      const quotation = quotations.find((item) => String(item.id) === String(transaction.quotation_id ?? ""));
      const lead = leads.find((item) => String(item.id) === String(transaction.lead_id ?? quotation?.lead_id ?? ""));
      const leadId = String(transaction.lead_id ?? quotation?.lead_id ?? "");
      const quotationId = String(transaction.quotation_id ?? "");
      if (!leadId && !quotationId) return;
      const key = leadId ? `lead:${leadId}` : `quotation:${quotationId}`;
      const projectName = stringValue(quotation, "project_name") || stringValue(lead, "project_name") || stringValue(quotation, "client_name") || stringValue(lead, "client_name") || "Unnamed project";
      const clientName = stringValue(quotation, "client_name") || stringValue(lead, "client_name") || "Client not set";
      const transactionDate = stringValue(transaction, "transaction_date");
      const existing = grouped.get(key);
      if (existing) {
        existing.transactions.push(transaction);
        if (quotationId) existing.quotationNumbers = uniqueTextParts([...existing.quotationNumbers, stringValue(quotation, "quotation_no")]);
        if (transactionDate > existing.latestDate) existing.latestDate = transactionDate;
        return;
      }
      grouped.set(key, {
        key,
        projectName,
        clientName,
        quotationNumbers: quotationId ? uniqueTextParts([stringValue(quotation, "quotation_no")]) : [],
        latestDate: transactionDate,
        transactions: [transaction],
      });
    });
    const normalized = transactionQuery.trim().toLowerCase();
    return [...grouped.values()]
      .filter((project) => {
        if (!normalized) return true;
        const transactionText = project.transactions.flatMap((transaction) => {
          const quotation = quotations.find((item) => String(item.id) === String(transaction.quotation_id ?? ""));
          const lead = leads.find((item) => String(item.id) === String(transaction.lead_id ?? quotation?.lead_id ?? ""));
          const category = categories.find((item) => String(item.id) === String(transaction.category_id ?? ""));
          const account = accounts.find((item) => String(item.id) === String(transaction.account_id ?? ""));
          return [
            stringValue(transaction, "note"),
            stringValue(transaction, "reference_number"),
            transactionSourceLabel(transaction),
            stringValue(category, "name"),
            stringValue(account, "account_name"),
            stringValue(lead, "project_name"),
            stringValue(lead, "client_name"),
            stringValue(quotation, "quotation_no"),
            stringValue(quotation, "project_name"),
          ];
        });
        return [project.projectName, project.clientName, ...project.quotationNumbers, ...transactionText].join(" ").toLowerCase().includes(normalized);
      })
      .sort((left, right) => right.latestDate.localeCompare(left.latestDate));
  }, [accounts, categories, leads, quotations, transactionQuery, transactions]);

  const transactionViewCounts = useMemo<Record<TransactionView, number>>(
    () => transactionPeriodTransactions.reduce<Record<TransactionView, number>>((counts, transaction) => {
      const type = stringValue(transaction, "transaction_type") as Exclude<TransactionView, "all">;
      counts.all += 1;
      if (type === "income") counts.income += 1;
      if (type === "expense") counts.expense += 1;
      return counts;
    }, { all: 0, income: 0, expense: 0 }),
    [transactionPeriodTransactions],
  );

  const transactionSourceOptions = useMemo(
    () => transactionSourceFilterOptions.filter((option) => transactionView === "all" || option.direction === transactionView),
    [transactionView],
  );

  const budgetPageCount = Math.max(1, Math.ceil(budgets.length / TABLE_PAGE_SIZE));
  const activeBudgetPage = Math.min(budgetPage, budgetPageCount);
  const visibleBudgets = budgets.slice(
    (activeBudgetPage - 1) * TABLE_PAGE_SIZE,
    activeBudgetPage * TABLE_PAGE_SIZE,
  );
  const transactionPageCount = Math.max(1, Math.ceil(filteredTransactions.length / TABLE_PAGE_SIZE));
  const activeTransactionsPage = Math.min(transactionsPage, transactionPageCount);
  const visibleTransactions = filteredTransactions.slice(
    (activeTransactionsPage - 1) * TABLE_PAGE_SIZE,
    activeTransactionsPage * TABLE_PAGE_SIZE,
  );
  const projectHistoryPageCount = Math.max(1, Math.ceil(projectHistoryRows.length / TABLE_PAGE_SIZE));
  const activeProjectHistoryPage = Math.min(transactionsPage, projectHistoryPageCount);
  const visibleProjectHistoryRows = projectHistoryRows.slice(
    (activeProjectHistoryPage - 1) * TABLE_PAGE_SIZE,
    activeProjectHistoryPage * TABLE_PAGE_SIZE,
  );
  const recentTransactions = transactions.slice(0, 8);
  const pendingApprovalTransactions = useMemo(
    () => transactions.filter((transaction) => {
      if (Boolean(transaction.is_voided)) return false;
      const type = stringValue(transaction, "transaction_type");
      if (type === "expense") return stringValue(transaction, "approval_status") === "pending";
      return isManualIncomeTransaction(transaction)
        && stringValue(transaction, "income_review_status") === "pending"
        && stringValue(transaction, "payment_status") === "unpaid";
    }),
    [transactions],
  );
  const pendingQuotationPaymentRows = useMemo(
    () => pendingQuotationPayments.filter((payment) => {
      if (stringValue(payment, "status") !== "pending") return false;
      const quotation = quotations.find((item) => item.id === payment.quotation_id);
      return Boolean(
        quotation
        && stringValue(quotation, "document_type") === "price_quotation"
        && !quotation.costing_source_id
        && stringValue(quotation, "status") === "approved",
      );
    }),
    [pendingQuotationPayments, quotations],
  );
  const overviewQuotationPaymentRows = useMemo(
    () => (internal ? pendingQuotationPayments : quotationPaymentRecords).filter((payment) => {
      const status = stringValue(payment, "status");
      if (!["pending", "revision_requested"].includes(status)) return false;
      const quotation = quotations.find((item) => item.id === payment.quotation_id);
      return Boolean(
        quotation
        && stringValue(quotation, "document_type") === "price_quotation"
        && !quotation.costing_source_id
        && stringValue(quotation, "status") === "approved",
      );
    }),
    [internal, pendingQuotationPayments, quotationPaymentRecords, quotations],
  );
  const pendingQuotationPaymentTotalsByQuotation = useMemo(() => {
    const map = new Map<string, number>();
    overviewQuotationPaymentRows.forEach((payment) => {
      if (stringValue(payment, "status") !== "pending") return;
      const quotationId = stringValue(payment, "quotation_id");
      if (quotationId) map.set(quotationId, (map.get(quotationId) ?? 0) + numericValue(payment, "amount"));
    });
    return map;
  }, [overviewQuotationPaymentRows]);
  const quotationDirectCostTotalsByQuotation = useMemo(() => {
    const map = new Map<string, number>();
    quotationDirectCosts.forEach((row) => {
      const quotationId = stringValue(row, "quotation_id");
      if (quotationId) map.set(quotationId, numericValue(row, "total_direct_cost"));
    });
    return map;
  }, [quotationDirectCosts]);
  const awaitingConfirmationCount = pendingApprovalTransactions.length
    + overviewQuotationPaymentRows.filter((payment) => stringValue(payment, "status") === "pending").length;
  const awaitingConfirmationAmount = pendingApprovalTransactions.reduce((total, transaction) => total + numericValue(transaction, "amount"), 0)
    + overviewQuotationPaymentRows.reduce((total, payment) => stringValue(payment, "status") === "pending" ? total + numericValue(payment, "amount") : total, 0);
  const pendingBudgetRows = useMemo(
    () => budgets.filter((budget) => stringValue(budget, "status") === "pending"),
    [budgets],
  );
  const pendingApprovalRows = useMemo<PendingApprovalRow[]>(() => {
    const quotationRows: PendingApprovalRow[] = pendingQuotationPaymentRows.map((payment) => {
      const quotation = quotations.find((item) => item.id === payment.quotation_id);
      const lead = leads.find((item) => item.id === quotation?.lead_id);
      const quotationNo = stringValue(quotation, "quotation_no", "Price Quotation");
      const client = stringValue(lead, "client_name", stringValue(quotation, "client_name", "Client"));
      const project = stringValue(quotation, "project_name", "");
      return {
        id: String(payment.id),
        kind: "quotation_payment",
        direction: "income",
        date: payment.paid_at ?? payment.submitted_at ?? payment.created_at,
        description: uniqueTextParts([quotationNo, client, project]).join(" · "),
        note: stringValue(payment, "notes") || stringValue(payment, "correction_note") || "-",
        source: "Quotation payment",
        amount: numericValue(payment, "amount"),
        accountId: stringValue(payment, "finance_account_id"),
        status: "pending_confirmation",
        receiptPath: stringValue(payment, "receipt_storage_path"),
        receiptBucket: "quotation-payment-receipts",
        payment,
        quotation,
        lead,
      };
    });
    const transactionRows: PendingApprovalRow[] = pendingApprovalTransactions.map((transaction) => {
      const type = stringValue(transaction, "transaction_type");
      const manualIncome = isManualIncomeTransaction(transaction);
      const lead = leads.find((item) => item.id === transaction.lead_id);
      const description = manualIncome
        ? "Manual Cash In"
        : stringValue(lead, "client_name", "") || (type === "expense" ? "Cash Out" : "Cash In");
      return {
        id: String(transaction.id),
        kind: "finance_transaction",
        direction: type === "income" ? "income" : "expense",
        date: transaction.transaction_date ?? transaction.created_at,
        description,
        note: transactionNote(transaction),
        source: transactionSourceLabel(transaction),
        amount: numericValue(transaction, "amount"),
        accountId: stringValue(transaction, "account_id"),
        status: transactionStatusValue(transaction),
        receiptPath: stringValue(transaction, "receipt_storage_path"),
        receiptBucket: stringValue(transaction, "receipt_bucket", "finance-receipts"),
        transaction,
      };
    });
    return [...quotationRows, ...transactionRows].sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  }, [leads, pendingApprovalTransactions, pendingQuotationPaymentRows, quotations]);
  const visiblePendingApprovalRows = useMemo(
    () => pendingApprovalRows.filter((row) => pendingApprovalFilter === "all" || row.direction === pendingApprovalFilter),
    [pendingApprovalFilter, pendingApprovalRows],
  );
  const selectedApprovalRow = useMemo(
    () => selectedApprovalKey
      ? pendingApprovalRows.find((row) => `${row.kind}:${row.id}` === selectedApprovalKey) ?? null
      : null,
    [pendingApprovalRows, selectedApprovalKey],
  );
  const pendingApprovalCount = pendingApprovalRows.length + pendingBudgetRows.length;
  const pendingApprovalIncomeCount = pendingApprovalRows.filter((row) => row.direction === "income").length;
  const pendingApprovalExpenseCount = pendingApprovalRows.filter((row) => row.direction === "expense").length;

  const totals = useMemo<{ income: number; expense: number; pending: number }>(
    () =>
      filteredTransactions.reduce<{ income: number; expense: number; pending: number }>(
        (result, transaction) => {
          if (Boolean(transaction.is_voided)) return result;
          const type = stringValue(transaction, "transaction_type");
          const paid = stringValue(transaction, "payment_status") === "paid";
          const approved = stringValue(transaction, "approval_status") === "approved" || type === "income";
          if (type === "income" && paid && approved) result.income += numericValue(transaction, "amount");
          if (type === "expense" && paid && approved) result.expense += numericValue(transaction, "amount");
          if (type === "expense" && stringValue(transaction, "approval_status") === "pending") result.pending += 1;
          return result;
        },
        { income: 0, expense: 0, pending: 0 },
      ),
    [filteredTransactions],
  );
  const periodTotals = useMemo<{ income: number; expense: number }>(
    () => overviewPeriodTransactions.reduce<{ income: number; expense: number }>(
      (result, transaction) => {
        if (Boolean(transaction.is_voided)) return result;
        const type = stringValue(transaction, "transaction_type");
        const paid = stringValue(transaction, "payment_status") === "paid";
        const approved = stringValue(transaction, "approval_status") === "approved" || type === "income";
        if (type === "income" && paid && approved) result.income += numericValue(transaction, "amount");
        if (type === "expense" && paid && approved) result.expense += numericValue(transaction, "amount");
        return result;
      },
      { income: 0, expense: 0 },
    ),
    [overviewPeriodTransactions],
  );
  const transactionRevisionRows = useMemo(
    () => transactions.filter((transaction) => {
      if (Boolean(transaction.is_voided)) return false;
      if (stringValue(transaction, "transaction_type") === "expense") {
        return stringValue(transaction, "approval_status") === "revision_requested";
      }
      return isManualIncomeTransaction(transaction)
        && stringValue(transaction, "income_review_status") === "revision_requested";
    }),
    [transactions],
  );
  const quotationPaymentRevisionRows = useMemo(
    () => overviewQuotationPaymentRows.filter((payment) => stringValue(payment, "status") === "revision_requested"),
    [overviewQuotationPaymentRows],
  );
  const revisionRequests = transactionRevisionRows.length + quotationPaymentRevisionRows.length;
  const revisionRequestAmount = useMemo(
    () => transactionRevisionRows.reduce((total, transaction) => total + numericValue(transaction, "amount"), 0)
      + quotationPaymentRevisionRows.reduce((total, payment) => total + numericValue(payment, "amount"), 0),
    [quotationPaymentRevisionRows, transactionRevisionRows],
  );
  const eligibleCommissionAllocations = useMemo(() => commissionAllocations.filter((allocation) => {
    if (stringValue(allocation, "status") !== "not_yet_paid") return false;
    const quotation = quotations.find((item) => item.id === allocation.quotation_id);
    const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id"));
    const verifiedAmount = verifiedPaymentTotalsByQuotation.get(stringValue(allocation, "quotation_id")) ?? 0;
    const total = numericValue(quotation, "total_amount");
    return Boolean(
      verifiedAt
      && total > 0
      && verifiedAmount + 0.001 >= total
      && currentTime >= new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000,
    );
  }), [commissionAllocations, currentTime, quotations, verifiedPaymentByQuotation, verifiedPaymentTotalsByQuotation]);
  const transactionPayables = useMemo(
    () => transactions.filter((transaction) => !Boolean(transaction.is_voided) && stringValue(transaction, "transaction_type") === "expense" && stringValue(transaction, "approval_status") === "approved" && stringValue(transaction, "payment_status") === "unpaid"),
    [transactions],
  );
  const payablesRowsBySection = useMemo<Record<PayablesSection, Row[]>>(
    () => ({
      commission: commissionAllocations.filter((allocation) => stringValue(allocation, "status") !== "not_applicable"),
      supplier: payables.filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status"))),
    }),
    [commissionAllocations, payables],
  );
  const supplierCostingRows = useMemo(
    () => payables.filter((payable) => stringValue(payable, "status") !== "cancelled"),
    [payables],
  );
  const supplierCostingPageCount = Math.max(1, Math.ceil(supplierCostingRows.length / TABLE_PAGE_SIZE));
  const activeSupplierCostingPage = Math.min(supplierCostingPage, supplierCostingPageCount);
  const visibleSupplierCostingRows = supplierCostingRows.slice(
    (activeSupplierCostingPage - 1) * TABLE_PAGE_SIZE,
    activeSupplierCostingPage * TABLE_PAGE_SIZE,
  );
  const activePayablesRows = payablesRowsBySection[payablesSection];
  const payablesPageCount = Math.max(1, Math.ceil(activePayablesRows.length / TABLE_PAGE_SIZE));
  const activePayablesPage = Math.min(payablesPage, payablesPageCount);
  const visiblePayablesRows = activePayablesRows.slice(
    (activePayablesPage - 1) * TABLE_PAGE_SIZE,
    activePayablesPage * TABLE_PAGE_SIZE,
  );
  const currentCashBalance = useMemo(
    () => balances.reduce((total, balance) => total + numericValue(balance, "current_balance"), 0),
    [balances],
  );
  const openQuotationReceivableBalance = useMemo(
    () => quotations.reduce((total, quotation) => {
      if (
        stringValue(quotation, "document_type") !== "price_quotation"
        || quotation.costing_source_id
        || stringValue(quotation, "status") !== "approved"
      ) return total;
      const quotationId = String(quotation.id ?? "");
      const remaining = numericValue(quotation, "total_amount")
        - (verifiedPaymentTotalsByQuotation.get(quotationId) ?? 0)
        - (pendingQuotationPaymentTotalsByQuotation.get(quotationId) ?? 0);
      return total + Math.max(remaining, 0);
    }, 0),
    [pendingQuotationPaymentTotalsByQuotation, quotations, verifiedPaymentTotalsByQuotation],
  );
  const openSupplierBalance = useMemo(
    () => payables.reduce((total, payable) => {
      if (["paid", "cancelled"].includes(stringValue(payable, "status"))) return total;
      return total + Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0);
    }, 0),
    [payables],
  );
  const openCommissionBalance = useMemo(
    () => commissionAllocations.reduce((total, allocation) => (
      stringValue(allocation, "status") === "not_yet_paid"
        ? total + numericValue(allocation, "amount")
        : total
    ), 0),
    [commissionAllocations],
  );
  const openLedgerPayableBalance = useMemo(
    () => transactionPayables.reduce((total, transaction) => {
      if (transaction.supplier_payable_id || transaction.commission_summary_id || transaction.commission_allocation_id) return total;
      return total + numericValue(transaction, "amount");
    }, 0),
    [transactionPayables],
  );
  const approvedBudgetTotal = useMemo(
    () => budgets.reduce((total, budget) => stringValue(budget, "status") === "approved" ? total + numericValue(budget, "amount") : total, 0),
    [budgets],
  );
  const budgetMetrics = useMemo(() => {
    const map = new Map<string, { used: number; committed: number; remaining: number }>();
    budgets.forEach((budget) => {
      let used = 0;
      let committed = 0;
      transactions.forEach((transaction) => {
        if (
          transaction.budget_request_id !== budget.id
          || Boolean(transaction.is_voided)
          || stringValue(transaction, "transaction_type") !== "expense"
          || ["rejected", "revision_requested", "cancelled"].includes(stringValue(transaction, "approval_status"))
        ) return;
        if (stringValue(transaction, "payment_status") === "paid" && stringValue(transaction, "approval_status") === "approved") {
          used += numericValue(transaction, "amount");
        } else {
          committed += numericValue(transaction, "amount");
        }
      });
      const remaining = Math.max(numericValue(budget, "amount") - used - committed, 0);
      map.set(String(budget.id), { used, committed, remaining });
    });
    return map;
  }, [budgets, transactions]);
  const approvedBudgetRemainingTotal = useMemo(
    () => budgets.reduce((total, budget) => stringValue(budget, "status") === "approved" ? total + (budgetMetrics.get(String(budget.id))?.remaining ?? numericValue(budget, "amount")) : total, 0),
    [budgetMetrics, budgets],
  );
  const approvedBudgetUsedTotal = useMemo(
    () => [...budgetMetrics.values()].reduce((total, metric) => total + metric.used, 0),
    [budgetMetrics],
  );
  const approvedBudgetCommittedTotal = useMemo(
    () => [...budgetMetrics.values()].reduce((total, metric) => total + metric.committed, 0),
    [budgetMetrics],
  );
  const approvedBudgetConsumedTotal = approvedBudgetUsedTotal + approvedBudgetCommittedTotal;
  const approvedBudgetUsagePercent = approvedBudgetTotal > 0
    ? Math.min(100, Math.round((approvedBudgetConsumedTotal / approvedBudgetTotal) * 100))
    : 0;
  const budgetLabel = useCallback((budgetId: unknown) => {
    if (!budgetId) return "";
    return stringValue(budgets.find((budget) => budget.id === budgetId), "note", "Budget request");
  }, [budgets]);
  const periodLabel = "This month";

  const accountBalance = (accountId: string) => numericValue(balances.find((balance) => balance.id === accountId), "current_balance");
  const commissionPayoutMode = internal && Boolean(transactionValues.commission_allocation_id);
  const projectExpenseMode = !internal && transactionDirection === "expense" && expenseMode === "project";
  const supplierPaymentMode = !internal && transactionDirection === "expense" && expenseMode === "supplier";
  const quotationPaymentMode = !internal && transactionDirection === "income" && !revisionTransaction && cashInSource === "quotation_payment";
  const manualIncomeMode = !internal && transactionDirection === "income" && !revisionTransaction && cashInSource === "other_income";
  const manualIncomeRevisionMode = Boolean(revisionTransaction && transactionDirection === "income" && isManualIncomeTransaction(revisionTransaction));
  const legacyLeadOnlyRevision = Boolean(
    revisionTransaction
    && !manualIncomeRevisionMode
    && transactionDirection === "expense"
    && expenseMode === "regular"
    && !stringValue(revisionTransaction, "quotation_id")
    && Boolean(stringValue(revisionTransaction, "lead_id"))
    && !stringValue(revisionTransaction, "supplier_payable_id"),
  );
  const projectExpenseSelection = transactionValues.quotation_id
    ? `quotation:${transactionValues.quotation_id}`
    : "";

  const selectedProjectExpense = useMemo(
    () => projectExpenseRows.find((project) => String(project.quotation_id) === String(transactionValues.quotation_id)) ?? null,
    [projectExpenseRows, transactionValues.quotation_id],
  );
  const selectedProjectExpenseCapacity = useMemo(() => {
    if (!selectedProjectExpense) return null;
    const totalDirectCost = Math.max(0, numericValue(selectedProjectExpense, "total_direct_cost"));
    const committedProjectExpense = Math.max(0, numericValue(selectedProjectExpense, "committed_project_expense"));
    const currentProjectExpenseAmount = revisionTransaction
      && String(revisionTransaction.quotation_id) === String(selectedProjectExpense.quotation_id)
      && isActiveProjectExpenseCommitment(revisionTransaction)
      ? numericValue(revisionTransaction, "amount")
      : 0;
    return {
      totalDirectCost,
      committedProjectExpense,
      remainingDirectCost: remainingProjectExpense(totalDirectCost, committedProjectExpense),
      availableToExpense: remainingProjectExpense(
        totalDirectCost,
        Math.max(0, committedProjectExpense - currentProjectExpenseAmount),
      ),
    };
  }, [revisionTransaction, selectedProjectExpense]);
  const projectExpenseAmount = Number(transactionValues.amount);
  const projectExpenseAmountError = projectExpenseMode
    && selectedProjectExpenseCapacity
    && Number.isFinite(projectExpenseAmount)
    && exceedsProjectExpenseLimit(projectExpenseAmount, selectedProjectExpenseCapacity.availableToExpense)
    ? `Enter ${peso.format(selectedProjectExpenseCapacity.availableToExpense)} or less for this quotation.`
    : null;

  const selectedQuotationPayment = useMemo(
    () => quotations.find((quotation) => String(quotation.id) === transactionValues.quotation_id) ?? null,
    [quotations, transactionValues.quotation_id],
  );
  const selectedQuotationPaymentSummary = useMemo(
    () => selectedQuotationPayment ? financeQuotationPaymentSummary(selectedQuotationPayment, quotationPaymentRecords) : null,
    [quotationPaymentRecords, selectedQuotationPayment],
  );
  const selectedQuotationPaymentRevision = useMemo(
    () => quotationPaymentRecords
      .filter((record) => String(record.quotation_id ?? "") === String(transactionValues.quotation_id) && stringValue(record, "status") === "revision_requested")
      .filter((record) => !currentUserId || stringValue(record, "submitted_by") === currentUserId)
      .sort((left, right) => stringValue(right, "submitted_at", stringValue(right, "created_at")).localeCompare(stringValue(left, "submitted_at", stringValue(left, "created_at"))))[0] ?? null,
    [currentUserId, quotationPaymentRecords, transactionValues.quotation_id],
  );
  const quotationPaymentAccountOptions = useMemo<SearchableOption[]>(
    () => {
      const requiresCheck = Boolean(
        selectedQuotationPayment
        && transactionValues.payment_kind === "full_payment"
        && stringValue(selectedQuotationPayment, "payment_terms_option") === "pdc_50_50",
      );
      return activeAccounts
        .filter((account) => !requiresCheck || stringValue(account, "payment_method") === "check")
        .map((account) => ({
          value: String(account.id),
          label: stringValue(account, "account_name"),
          searchText: [stringValue(account, "account_name"), stringValue(account, "account_type"), financePaymentMethodLabel(account.payment_method)].join(" "),
        }));
    }, [activeAccounts, selectedQuotationPayment, transactionValues.payment_kind],
  );
  const transactionDialogTitle = quotationPaymentMode
    ? selectedQuotationPaymentRevision ? "Resubmit quotation receipt" : "Record quotation payment"
    : manualIncomeMode
      ? "Record Cash In"
      : manualIncomeRevisionMode
        ? "Correct Cash In"
        : revisionTransaction
          ? "Revise Cash Out"
          : commissionPayoutMode
            ? "Pay commission"
              : projectExpenseMode
                ? "Submit project expense"
            : "Submit Cash Out";
  const transactionDialogDetail = quotationPaymentMode
    ? "Submit a client receipt for an approved quotation. Internal Finance verifies it before it becomes Cash In."
    : manualIncomeMode
      ? "Submit other income for Internal Finance verification. The account balance updates only after verification."
      : manualIncomeRevisionMode
        ? "Correct the returned Cash In and resubmit it for Internal Finance verification."
        : revisionTransaction
          ? legacyLeadOnlyRevision
            ? "This returned lead-linked Cash Out will be resubmitted as a regular expense unless you choose an approved project quotation."
            : "Correct the returned fields and resubmit this Cash Out for Internal Finance review."
          : commissionPayoutMode
            ? "Create a controlled commission payout after full quotation payment and the three-day hold."
            : projectExpenseMode
              ? "Link this Cash Out to an approved quotation; the remaining direct-cost capacity limits the amount you can submit."
            : supplierPaymentMode
              ? "Submit a supplier payment for Internal Finance approval."
              : "Submit a regular expense for Internal Finance approval.";

  const chooseExpenseMode = (mode: ExpenseMode) => {
    setExpenseMode(mode);
    setTransactionValues((current) => ({
      ...current,
      supplier_payable_id: "",
      quotation_id: "",
      lead_id: "",
    }));
  };

  const chooseProjectExpense = (selection: string) => {
    if (selection.startsWith("quotation:")) {
      const quotationId = selection.slice("quotation:".length);
      const project = projectExpenseRows.find((item) => String(item.quotation_id) === quotationId);
      setTransactionValues((current) => ({
        ...current,
        quotation_id: quotationId,
        lead_id: project ? String(project.lead_id ?? "") : "",
      }));
      return;
    }
    setTransactionValues((current) => ({ ...current, quotation_id: "", lead_id: "" }));
  };

  const quotationPaymentAccountIdFor = (quotation: Row | null, kind: string) => {
    const requiresCheck = Boolean(
      quotation
      && kind === "full_payment"
      && stringValue(quotation, "payment_terms_option") === "pdc_50_50",
    );
    const eligibleAccounts = activeAccounts.filter((account) => !requiresCheck || stringValue(account, "payment_method") === "check");
    return eligibleAccounts.length === 1 ? String(eligibleAccounts[0].id) : "";
  };

  const chooseCashInSource = (source: CashInSource) => {
    setCashInSource(source);
    setTransactionValues((current) => ({
      ...current,
      amount: "",
      category_id: "",
      account_id: "",
      reference_number: "",
      note: "",
      lead_id: "",
      quotation_id: "",
      payment_kind: "downpayment",
    }));
    setTransactionFile(null);
  };

  const chooseQuotationPayment = (quotationId: string) => {
    const quotation = quotations.find((item) => String(item.id) === quotationId) ?? null;
    if (!quotation) {
      setTransactionValues((current) => ({ ...current, quotation_id: "", amount: "", account_id: "" }));
      return;
    }
    const records = quotationPaymentRecords.filter((record) => String(record.quotation_id ?? "") === quotationId);
    const summary = financeQuotationPaymentSummary(quotation, quotationPaymentRecords);
    const revision = records
      .filter((record) => stringValue(record, "status") === "revision_requested")
      .filter((record) => !currentUserId || stringValue(record, "submitted_by") === currentUserId)
      .sort((left, right) => stringValue(right, "submitted_at", stringValue(right, "created_at")).localeCompare(stringValue(left, "submitted_at", stringValue(left, "created_at"))))[0] ?? null;
    const paymentKind = revision ? stringValue(revision, "payment_kind", financeQuotationPaymentDefaultKind(summary)) : financeQuotationPaymentDefaultKind(summary);
    setTransactionValues((current) => ({
      ...current,
      quotation_id: quotationId,
      payment_kind: paymentKind,
      amount: revision ? numericValue(revision, "amount").toFixed(2) : financeQuotationPaymentSuggestedAmount(paymentKind, summary),
      account_id: revision ? stringValue(revision, "finance_account_id") : quotationPaymentAccountIdFor(quotation, paymentKind),
      reference_number: revision ? stringValue(revision, "reference_no") : "",
      note: revision ? stringValue(revision, "notes") : "",
      category_id: "",
      lead_id: "",
    }));
    setTransactionFile(null);
  };

  const chooseSupplierPayable = (payableId: string) => {
    const payable = payables.find((item) => String(item.id) === payableId);
    const remaining = payable
      ? Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0)
      : 0;
    setTransactionValues((current) => ({
      ...current,
      supplier_payable_id: payableId,
      amount: payableId && remaining > 0 ? remaining.toFixed(2) : "",
      quotation_id: payableId ? stringValue(payable, "quotation_id") : "",
      lead_id: payableId ? stringValue(payable, "lead_id") : "",
    }));
  };

  const setFormDirection = useCallback((direction: Direction) => {
    setRevisionTransaction(null);
    setTransactionDirection(direction);
    setCashInSource("other_income");
    setExpenseMode("regular");
    setTransactionValues(defaultTransaction(direction));
    setTransactionFile(null);
  }, []);

  useEffect(() => {
    const canOpenAction = openAction === "income" ? canRecordIncome : openAction === "expense" && canSubmitExpense;
    if (!openAction || !canOpenAction) return;
    setFormDirection(openAction);
    onOpenActionHandled?.();
  }, [canRecordIncome, canSubmitExpense, onOpenActionHandled, openAction, setFormDirection]);

  const closeTransactionForm = () => {
    setTransactionDirection(null);
    setRevisionTransaction(null);
    setCashInSource("other_income");
    setTransactionFile(null);
  };

  const openRevisionEditor = (transaction: Row) => {
    const manualIncomeRevision = isManualIncomeTransaction(transaction)
      && stringValue(transaction, "income_review_status") === "revision_requested";
    if (internal || (!manualIncomeRevision && stringValue(transaction, "approval_status") !== "revision_requested")) return;
    const supplierPayableId = stringValue(transaction, "supplier_payable_id");
    const quotationId = stringValue(transaction, "quotation_id");
    setRevisionTransaction(transaction);
    setTransactionDirection(manualIncomeRevision ? "income" : "expense");
    setExpenseMode(manualIncomeRevision ? "regular" : supplierPayableId ? "supplier" : quotationId ? "project" : "regular");
    setTransactionValues({
      ...defaultTransaction(manualIncomeRevision ? "income" : "expense"),
      amount: numericValue(transaction, "amount").toFixed(2),
      category_id: stringValue(transaction, "category_id"),
      account_id: stringValue(transaction, "account_id"),
      note: stringValue(transaction, "note"),
      reference_number: stringValue(transaction, "reference_number"),
      transaction_date: stringValue(transaction, "transaction_date", localDate()),
      transaction_time: stringValue(transaction, "transaction_time"),
      lead_id: manualIncomeRevision ? "" : stringValue(transaction, "lead_id"),
      quotation_id: manualIncomeRevision ? "" : stringValue(transaction, "quotation_id"),
      supplier_payable_id: manualIncomeRevision ? "" : supplierPayableId,
      payment_status: "unpaid",
    });
    setTransactionFile(null);
  };

  const openCommissionPayout = (allocationId: string) => {
    const allocation = eligibleCommissionAllocations.find((item) => String(item.id) === allocationId);
    if (!allocation) return setErrorMessage("That commission allocation is not yet eligible for payment.");
    setTransactionDirection("expense");
    setExpenseMode("regular");
    setTransactionValues({
      ...defaultTransaction("expense"),
      quotation_id: String(allocation.quotation_id ?? ""),
      commission_allocation_id: allocationId,
      payment_status: "paid",
      note: `Commission payout - ${quotationName(allocation.quotation_id)} - ${profileName(allocation.recipient_user_id)}`,
    });
    setTransactionFile(null);
  };

  const uploadReceipt = async (file: File, path: string) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new Error("Receipts must be JPEG, PNG, or WebP files no larger than 10 MB.");
    }
    const { error } = await client.storage.from("finance-receipts").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
  };

  const removeReceipt = async (path: string) => {
    await client.storage.from("finance-receipts").remove([path]);
  };

  const saveQuotationPayment = async () => {
    const submittedFile = transactionFile;
    const quotation = selectedQuotationPayment;
    const amount = Number(transactionValues.amount);
    const accountIsEligible = quotationPaymentAccountOptions.some((option) => option.value === transactionValues.account_id);
    if (!quotation) return setErrorMessage("Choose the approved quotation for this Cash In.");
    if (!transactionValues.payment_kind || !["downpayment", "full_payment"].includes(transactionValues.payment_kind)) return setErrorMessage("Choose a valid quotation payment type.");
    if (!Number.isFinite(amount) || amount <= 0) return setErrorMessage("Enter a payment amount greater than zero.");
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(transactionValues.transaction_date)) return setErrorMessage("Choose a valid paid date.");
    if (!transactionValues.account_id || !accountIsEligible) return setErrorMessage("Choose an active Finance receiving account.");
    if (!submittedFile) return setErrorMessage(selectedQuotationPaymentRevision ? "Upload the replacement receipt image." : "Upload the payment receipt image.");
    if (submittedFile.size <= 0 || submittedFile.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(submittedFile.type)) return setErrorMessage("Payment receipts must be JPEG, PNG, or WebP files no larger than 10 MB.");

    setSaving(true);
    try {
      const form = new FormData();
      form.set("organization_id", organizationId);
      form.set("quotation_id", String(quotation.id));
      if (selectedQuotationPaymentRevision) form.set("payment_id", String(selectedQuotationPaymentRevision.id));
      form.set("payment_kind", transactionValues.payment_kind);
      form.set("amount", String(amount));
      form.set("paid_at", transactionValues.transaction_date);
      form.set("finance_account_id", transactionValues.account_id);
      form.set("reference_no", transactionValues.reference_number.trim());
      form.set("notes", transactionValues.note.trim());
      form.set("receipt", submittedFile);
      const response = await fetch("/api/quotation-payments/submit", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The payment receipt could not be submitted.");
      setMessage(selectedQuotationPaymentRevision ? "Quotation payment receipt resubmitted for Internal Finance verification." : "Quotation payment receipt submitted for Internal Finance verification.");
      closeTransactionForm();
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The quotation payment receipt could not be submitted.");
    } finally {
      setSaving(false);
    }
  };

  const saveTransaction = async () => {
    const submittedFile = transactionFile;
    if (!transactionDirection) return setErrorMessage("Choose a finance transaction type.");
    if (quotationPaymentMode) {
      await saveQuotationPayment();
      return;
    }
    if (!revisionTransaction && !submittedFile) return setErrorMessage("Upload the transaction receipt image.");
    if (revisionTransaction && internal) return setErrorMessage("Only External Finance can resubmit returned Finance records.");
    if (!internal && !manualIncomeMode && !manualIncomeRevisionMode && (transactionDirection !== "expense" || !canSubmitExpense)) return setErrorMessage("External Finance can submit Cash Out or standalone Cash In.");
    if (!internal && transactionValues.payment_status !== "unpaid") return setErrorMessage("External Finance submissions must remain unpaid until Internal Finance confirms the payment.");
    if (supplierPaymentMode && !transactionValues.supplier_payable_id) return setErrorMessage("Choose an open supplier payable.");
    if (projectExpenseMode && (!transactionValues.quotation_id || !selectedProjectExpense || !selectedProjectExpenseCapacity)) return setErrorMessage("Choose an approved quotation with direct-cost capacity for this project expense.");
    const enteredAmount = Number(transactionValues.amount);
    if (!transactionValues.amount || !Number.isFinite(enteredAmount) || enteredAmount <= 0) return setErrorMessage("Enter an amount greater than zero.");
    if (projectExpenseMode && selectedProjectExpenseCapacity && exceedsProjectExpenseLimit(enteredAmount, selectedProjectExpenseCapacity.availableToExpense)) {
      return setErrorMessage(`This project expense exceeds the available direct-cost capacity of ${peso.format(selectedProjectExpenseCapacity.availableToExpense)}.`);
    }
    if (!transactionValues.category_id || ((transactionDirection === "expense" || manualIncomeMode || manualIncomeRevisionMode) && !transactionValues.account_id)) return setErrorMessage(transactionDirection === "income" ? "Choose an income category and receiving account." : "Choose an expense category and payment account.");
    const selectedAllocation = eligibleCommissionAllocations.find((allocation) => allocation.id === transactionValues.commission_allocation_id);
    if (revisionTransaction && selectedAllocation) return setErrorMessage("Commission payouts cannot be resubmitted through this workflow.");
    if (internal && (!selectedAllocation || transactionDirection !== "expense")) return setErrorMessage("Internal Finance can create Cash Out only through an eligible commission payout.");
    if (transactionValues.commission_allocation_id && !selectedAllocation) return setErrorMessage("That commission allocation is not yet eligible for payment.");
    if (!revisionTransaction && !internal && transactionDirection === "expense" && !selectedAllocation && Number(transactionValues.amount) > approvedBudgetRemainingTotal + 0.001) return setErrorMessage(`This expense is higher than the available budget of ${peso.format(approvedBudgetRemainingTotal)}. Request a new budget before submitting it.`);
    setSaving(true);
    const transactionId = crypto.randomUUID();
    const receiptRevisionId = submittedFile ? crypto.randomUUID() : null;
    const receiptKey = revisionTransaction ? receiptRevisionId : transactionId;
    const path = submittedFile && receiptKey ? `${organizationId}/transactions/${receiptKey}.${extensionFor(submittedFile)}` : null;
    const transactionTime = internal ? transactionValues.transaction_time || null : null;
    try {
      if (submittedFile && path) await uploadReceipt(submittedFile, path);
      if (revisionTransaction) {
        const cashOutResubmissionPayload = {
          p_transaction_id: revisionTransaction.id,
          p_amount: Number(transactionValues.amount),
          p_category_id: transactionValues.category_id,
          p_account_id: transactionValues.account_id,
          p_note: transactionValues.note.trim() || null,
          p_transaction_date: transactionValues.transaction_date,
          p_transaction_time: transactionTime,
          p_lead_id: transactionValues.lead_id || null,
          p_quotation_id: transactionValues.quotation_id || null,
          p_supplier_payable_id: supplierPaymentMode ? transactionValues.supplier_payable_id || null : null,
          p_receipt_storage_path: path,
          p_receipt_file_name: submittedFile?.name ?? null,
          p_receipt_content_type: submittedFile?.type ?? null,
          p_receipt_file_size: submittedFile?.size ?? null,
        };
        const result = manualIncomeRevisionMode
          ? await client.rpc("resubmit_manual_finance_income", {
              p_transaction_id: revisionTransaction.id,
              p_amount: Number(transactionValues.amount),
              p_category_id: transactionValues.category_id,
              p_account_id: transactionValues.account_id,
              p_note: transactionValues.note.trim() || null,
              p_reference_number: transactionValues.reference_number.trim() || null,
              p_transaction_date: transactionValues.transaction_date,
              p_transaction_time: transactionTime,
              p_receipt_storage_path: path,
              p_receipt_file_name: submittedFile?.name ?? null,
              p_receipt_content_type: submittedFile?.type ?? null,
              p_receipt_file_size: submittedFile?.size ?? null,
            })
          : await client.rpc(
              legacyLeadOnlyRevision ? "resubmit_finance_transaction_as_regular" : "resubmit_finance_transaction",
              cashOutResubmissionPayload,
            );
        if (result.error) throw result.error;
        setMessage(manualIncomeRevisionMode ? "Cash In resubmitted for Internal Finance verification." : "Cash Out resubmitted for Internal Finance review.");
        closeTransactionForm();
        await load();
        return;
      }
      if (!submittedFile || !path) throw new Error("Upload the transaction receipt image.");
      const transactionPayload = {
        p_transaction_id: transactionId,
        p_transaction_type: transactionDirection,
        p_amount: Number(transactionValues.amount),
        p_category_id: transactionValues.category_id,
        p_account_id: transactionValues.account_id || null,
        p_note: transactionValues.note.trim() || null,
        p_transaction_date: transactionValues.transaction_date,
        p_transaction_time: transactionTime,
        p_payment_status: selectedAllocation ? "paid" : transactionValues.payment_status,
        p_lead_id: transactionValues.lead_id || null,
        p_customer_id: null,
        p_quotation_id: transactionValues.quotation_id || String(selectedAllocation?.quotation_id ?? "") || null,
        p_supplier_payable_id: supplierPaymentMode ? transactionValues.supplier_payable_id || null : null,
        p_commission_summary_id: null,
        p_receipt_storage_path: path,
        p_receipt_file_name: submittedFile.name,
        p_receipt_content_type: submittedFile.type,
        p_receipt_file_size: submittedFile.size,
      };
      const result = manualIncomeMode
        ? await client.rpc("create_manual_finance_income", {
            p_income_id: transactionId,
            p_amount: Number(transactionValues.amount),
            p_category_id: transactionValues.category_id,
            p_account_id: transactionValues.account_id,
            p_note: transactionValues.note.trim() || null,
            p_reference_number: transactionValues.reference_number.trim() || null,
            p_transaction_date: transactionValues.transaction_date,
            p_transaction_time: transactionTime,
            p_receipt_storage_path: path,
            p_receipt_file_name: submittedFile.name,
            p_receipt_content_type: submittedFile.type,
            p_receipt_file_size: submittedFile.size,
          })
        : selectedAllocation
        ? await client.rpc("create_finance_transaction_with_commission_allocation", {
            ...transactionPayload,
            p_commission_summary_id: null,
            p_supplier_payable_id: null,
            p_commission_allocation_id: selectedAllocation.id,
          })
        : await client.rpc("create_finance_transaction", transactionPayload);
      if (result.error) throw result.error;
      setMessage(manualIncomeMode ? "Cash In submitted for Internal Finance verification." : transactionDirection === "expense" && !internal ? "Cash Out submitted for Internal Finance approval." : "Finance transaction saved.");
      closeTransactionForm();
      await load();
    } catch (error) {
      if (path) await removeReceipt(path);
      setErrorMessage(error instanceof Error ? error.message : "The transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async () => {
    if (!internal) return setErrorMessage("Only Internal Finance can manage finance categories.");
    if (!transactionDirection || !categoryDraft.name.trim()) return setErrorMessage("Enter a category name.");
    setSaving(true);
    const { error } = await client.rpc("create_finance_category", {
      p_direction: transactionDirection,
      p_name: categoryDraft.name.trim(),
      p_expense_class: transactionDirection === "expense" ? categoryDraft.expense_class : null,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setCategoryDraft({ name: "", expense_class: "operating" });
    setMessage("Category added.");
    await load();
  };

  const archiveCategory = async (category: Row) => {
    if (!internal) return setErrorMessage("Only Internal Finance can manage finance categories.");
    const { error } = await client.rpc("archive_finance_category", { p_category_id: category.id });
    if (error) return setErrorMessage(error.message);
    setMessage("Category removed from the list.");
    await load();
  };

  const openAccountEditor = (account?: Row) => {
    setAccountEditing(account ?? null);
    setAccountFile(null);
    const accountType = account ? stringValue(account, "account_type", "bank") : "bank";
    setAccountValues({
      name: account ? stringValue(account, "account_name") : "",
      type: accountType,
      number: account ? stringValue(account, "account_number") : "",
      opening_balance: account ? numericValue(account, "opening_balance").toFixed(2) : "",
      payment_method: account
        ? stringValue(account, "payment_method", "bank_transfer")
        : defaultPaymentMethodForAccountType(accountType),
    });
    setAccountOpen(true);
  };

  const closeAccountEditor = () => {
    setAccountOpen(false);
    setAccountEditing(null);
    setAccountFile(null);
  };

  const openAccountFunding = (accountId = "") => {
    setAccountFundingValues({ account_id: accountId, amount: "", funding_source: "owner_funding", funding_date: localDate(), note: "" });
    setAccountFundingFile(null);
    setAccountFundingOpen(true);
  };

  const saveAccount = async () => {
    if (!accountValues.name.trim()) return setErrorMessage("Enter an account name.");
    const paymentMethod = accountEditing
      ? accountValues.payment_method
      : defaultPaymentMethodForAccountType(accountValues.type);
    if (accountEditing) {
      setSaving(true);
      try {
        const { error } = await client.rpc("update_finance_account", {
          p_account_id: accountEditing.id,
          p_account_name: accountValues.name.trim(),
          p_account_type: accountValues.type,
          p_account_number: accountValues.number.trim() || null,
          p_payment_method: paymentMethod,
        });
        if (error) throw error;
        closeAccountEditor();
        setMessage("Account updated.");
        await load();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "The account could not be updated.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!accountFile) return setErrorMessage("Upload the account opening receipt image.");
    setSaving(true);
    const id = crypto.randomUUID();
    const path = `${organizationId}/accounts/${id}.${extensionFor(accountFile)}`;
    try {
      await uploadReceipt(accountFile, path);
      const { error } = await client.rpc("create_finance_account_with_mapping", {
        p_account_id: id,
        p_account_name: accountValues.name.trim(),
        p_account_type: accountValues.type,
        p_account_number: accountValues.number.trim() || null,
        p_opening_balance: Number(accountValues.opening_balance || 0),
        p_receipt_storage_path: path,
        p_receipt_file_name: accountFile.name,
        p_receipt_content_type: accountFile.type,
        p_receipt_file_size: accountFile.size,
        p_payment_method: paymentMethod,
      });
      if (error) throw error;
      closeAccountEditor();
      setAccountValues({ name: "", type: "bank", number: "", opening_balance: "", payment_method: "bank_transfer" });
      setMessage("Account added.");
      await load();
    } catch (error) {
      await removeReceipt(path);
      setErrorMessage(error instanceof Error ? error.message : "The account could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveAccountFunding = async () => {
    if (!accountFundingValues.account_id) return setErrorMessage("Choose the account receiving the funds.");
    if (!accountFundingValues.amount || Number(accountFundingValues.amount) <= 0) return setErrorMessage("Enter a funding amount greater than zero.");
    if (!accountFundingFile) return setErrorMessage("Upload proof of the account funding.");
    setSaving(true);
    const id = crypto.randomUUID();
    const path = `${organizationId}/account-funding/${id}.${extensionFor(accountFundingFile)}`;
    try {
      await uploadReceipt(accountFundingFile, path);
      const { error } = await client.rpc("create_finance_account_funding", {
        p_funding_id: id,
        p_account_id: accountFundingValues.account_id,
        p_amount: Number(accountFundingValues.amount),
        p_funding_source: accountFundingValues.funding_source,
        p_note: accountFundingValues.note.trim() || null,
        p_funding_date: accountFundingValues.funding_date,
        p_receipt_storage_path: path,
        p_receipt_file_name: accountFundingFile.name,
        p_receipt_content_type: accountFundingFile.type,
        p_receipt_file_size: accountFundingFile.size,
      });
      if (error) throw error;
      setAccountFundingOpen(false);
      setAccountFundingFile(null);
      setAccountFundingValues({ account_id: "", amount: "", funding_source: "owner_funding", funding_date: localDate(), note: "" });
      setMessage("Account funding recorded. It increased the account balance without being counted as customer income.");
      await load();
    } catch (error) {
      await removeReceipt(path);
      setErrorMessage(error instanceof Error ? error.message : "The account funding could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveSupplierCosting = async () => {
    if (!supplierCostValues.supplier_id) return setErrorMessage("Choose a supplier.");
    if (!supplierCostValues.description.trim()) return setErrorMessage("Enter a supplier costing description.");
    if (!supplierCostValues.amount || Number(supplierCostValues.amount) <= 0) return setErrorMessage("Enter a supplier costing amount greater than zero.");
    setSaving(true);
    const payableId = crypto.randomUUID();
    const { error } = await client.rpc("create_supplier_payable", {
      p_payable_id: payableId,
      p_supplier_id: supplierCostValues.supplier_id,
      p_quotation_id: supplierCostValues.quotation_id || null,
      p_lead_id: supplierCostValues.lead_id || null,
      p_description: supplierCostValues.description.trim(),
      p_amount: Number(supplierCostValues.amount),
      p_due_date: supplierCostValues.due_date || null,
      p_notes: supplierCostValues.notes.trim() || null,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setSupplierCostOpen(false);
    setSupplierCostValues({ supplier_id: "", quotation_id: "", lead_id: "", description: "", amount: "", due_date: "", notes: "" });
    setMessage("Supplier costing recorded in the payable logbook.");
    await load();
  };

  const openBudgetRequest = () => {
    setBudgetRevision(null);
    setBudgetValues({ amount: "", note: "" });
    setBudgetOpen(true);
  };

  const openBudgetRevision = (budget: Row) => {
    if (internal || stringValue(budget, "status") !== "revision_requested") return;
    setBudgetRevision(budget);
    setBudgetValues({
      amount: numericValue(budget, "amount").toFixed(2),
      note: stringValue(budget, "note"),
    });
    setBudgetOpen(true);
  };

  const closeBudgetForm = () => {
    setBudgetOpen(false);
    setBudgetRevision(null);
    setBudgetValues({ amount: "", note: "" });
  };

  const saveBudget = async () => {
    if (!budgetValues.amount || Number(budgetValues.amount) <= 0) return setErrorMessage("Enter a budget amount greater than zero.");
    setSaving(true);
    try {
      const result = budgetRevision
        ? await client.rpc("resubmit_finance_budget_request", {
            p_request_id: budgetRevision.id,
            p_amount: Number(budgetValues.amount),
            p_note: budgetValues.note.trim() || null,
          })
        : await client.rpc("create_finance_budget_request", {
            p_amount: Number(budgetValues.amount),
            p_note: budgetValues.note.trim() || null,
          });
      if (result.error) throw result.error;
      const wasRevision = Boolean(budgetRevision);
      closeBudgetForm();
      setMessage(wasRevision ? "Budget request resubmitted for Internal Finance review." : "Budget request submitted.");
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The budget request could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const approveAndPay = async (transactionId: string, decisionNote: string | null = null) => {
    setSaving(true);
    const { error } = await client.rpc("approve_and_pay_finance_transaction", {
      p_transaction_id: transactionId,
      p_decision_note: decisionNote,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Cash Out approved and paid. The selected account was deducted.");
    await load();
    return true;
  };

  const requestTransactionRevision = async (transactionId: string, reason: string) => {
    setSaving(true);
    const { error } = await client.rpc("request_finance_transaction_revision", {
      p_transaction_id: transactionId,
      p_reason: reason,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Cash Out returned to External Finance for revision.");
    await load();
    return true;
  };

  const verifyManualIncome = async (transactionId: string, decisionNote: string | null = null) => {
    setSaving(true);
    const { error } = await client.rpc("verify_manual_finance_income", {
      p_transaction_id: transactionId,
      p_decision_note: decisionNote,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Cash In verified. The selected receiving account balance was updated.");
    await load();
    return true;
  };

  const requestManualIncomeRevision = async (transactionId: string, reason: string) => {
    setSaving(true);
    const { error } = await client.rpc("request_manual_finance_income_revision", {
      p_transaction_id: transactionId,
      p_reason: reason,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Cash In returned to External Finance for correction.");
    await load();
    return true;
  };

  const reviewQuotationPayment = async (
    paymentId: string,
    decision: QuotationPaymentDecision,
    decisionNote: string | null = null,
  ) => {
    setSaving(true);
    const { error } = await client.rpc("review_quotation_payment", {
      p_payment_id: paymentId,
      p_decision: decision,
      p_decision_note: decisionNote,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage(decision === "verified" ? "Quotation payment verified and posted as Cash In." : decision === "revision_requested" ? "Quotation payment returned to External Finance for correction." : "Quotation payment rejected.");
    await load();
    return true;
  };

  const voidManualIncome = async (transactionId: string, reason: string) => {
    setSaving(true);
    const { error } = await client.rpc("void_manual_finance_income", {
      p_transaction_id: transactionId,
      p_void_reason: reason,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Cash In reversed. The selected receiving account balance was updated and the audit record was preserved.");
    await load();
    return true;
  };

  const markPaid = async (transactionId: string) => {
    setSaving(true);
    const { error } = await client.rpc("mark_finance_transaction_paid", { p_transaction_id: transactionId });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Transaction marked paid.");
    await load();
    return true;
  };

  const voidAccountFunding = async (fundingId: string, voidReason: string) => {
    setSaving(true);
    const { error } = await client.rpc("void_finance_account_funding", {
      p_funding_id: fundingId,
      p_void_reason: voidReason,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage("Account funding voided. The account balance was updated and the audit record was preserved.");
    await load();
    return true;
  };

  const setAccountActive = async (accountId: string, isActive: boolean) => {
    setSaving(true);
    const { error } = await client.rpc("set_finance_account_active", {
      p_account_id: accountId,
      p_is_active: isActive,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage(isActive ? "Finance account reactivated." : "Finance account deactivated. Historical records were preserved.");
    await load();
    return true;
  };

  const assignAccount = async (transactionId: string, accountId: string) => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await client.rpc("assign_finance_transaction_account", {
      p_transaction_id: transactionId,
      p_account_id: accountId,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setMessage("Finance payment account updated.");
    await load();
  };

  const assignQuotationPaymentAccount = async (paymentId: string, accountId: string) => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await client.rpc("update_pending_quotation_payment_account", {
      p_payment_id: paymentId,
      p_finance_account_id: accountId,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setMessage("Quotation payment receiving account updated.");
    await load();
  };

  const reviewBudget = async (requestId: string, decision: BudgetDecision, decisionNote: string | null = null) => {
    setSaving(true);
    const { error } = await client.rpc("review_finance_budget_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_decision_note: decisionNote,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage(decision === "revision_requested" ? "Budget request returned for revision." : `Budget request ${decision}.`);
    await load();
    return true;
  };

  const requestApproveAndPay = (transactionId: string) => {
    setDecisionNote("");
    setPendingAction({ kind: "approve_and_pay", id: transactionId, label: "regular Cash Out" });
  };

  const requestTransactionRevisionReview = (transactionId: string) => {
    setDecisionNote("");
    setPendingAction({ kind: "revision", id: transactionId, label: "Cash Out" });
  };

  const requestQuotationPaymentReview = (paymentId: string, decision: QuotationPaymentDecision) => {
    setDecisionNote("");
    setPendingAction({ kind: "quotation_payment", id: paymentId, decision, label: "quotation payment receipt" });
  };

  const requestVerifyIncome = (transactionId: string) => {
    setDecisionNote("");
    setPendingAction({ kind: "verify_income", id: transactionId, label: "Cash In" });
  };

  const requestManualIncomeRevisionReview = (transactionId: string) => {
    setDecisionNote("");
    setPendingAction({ kind: "income_revision", id: transactionId, label: "Cash In" });
  };

  const requestVoidManualIncome = (transactionId: string) => {
    setDecisionNote("");
    setPendingAction({ kind: "income_void", id: transactionId, label: "Cash In" });
  };

  const requestBudgetReview = (requestId: string, decision: BudgetDecision) => {
    setDecisionNote("");
    setPendingAction({ kind: "budget", id: requestId, decision, label: "budget request" });
  };

  const requestMarkPaid = (transactionId: string, label = "transaction") => {
    setDecisionNote("");
    setPendingAction({ kind: "paid", id: transactionId, label });
  };

  const requestVoidAccountFunding = (fundingId: string, label = "account funding") => {
    setDecisionNote("");
    setPendingAction({ kind: "funding", id: fundingId, label });
  };

  const requestAccountStatusChange = (account: Row) => {
    setDecisionNote("");
    setPendingAction({
      kind: "account",
      id: String(account.id),
      active: !Boolean(account.is_active),
      label: stringValue(account, "account_name", "Finance account"),
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const isBudgetRevision = pendingAction.kind === "budget" && pendingAction.decision === "revision_requested";
    const requiresNote = pendingAction.kind === "funding"
      || pendingAction.kind === "revision"
      || (pendingAction.kind === "quotation_payment" && ["revision_requested", "rejected"].includes(pendingAction.decision))
      || pendingAction.kind === "income_revision"
      || pendingAction.kind === "income_void"
      || isBudgetRevision
      || (pendingAction.kind === "budget" && pendingAction.decision === "rejected");
    if (requiresNote && !decisionNote.trim()) {
      setErrorMessage(pendingAction.kind === "funding"
        ? "Add a reason before voiding this funding entry."
        : pendingAction.kind === "revision"
          ? "Add a reason before returning Cash Out for revision."
          : pendingAction.kind === "income_revision"
            ? "Add a reason before returning Cash In for correction."
            : pendingAction.kind === "income_void"
              ? "Add a reason before reversing Cash In."
              : pendingAction.kind === "quotation_payment"
                ? pendingAction.decision === "revision_requested" ? "Add a correction reason before returning this quotation payment receipt." : "Add a reason before rejecting this quotation payment receipt."
          : isBudgetRevision
            ? "Add a reason before returning this budget request for revision."
            : "Add a decision note before rejecting this request.");
      return;
    }
    let succeeded = false;
    if (pendingAction.kind === "approve_and_pay") {
      succeeded = await approveAndPay(pendingAction.id, decisionNote.trim() || null);
    } else if (pendingAction.kind === "revision") {
      succeeded = await requestTransactionRevision(pendingAction.id, decisionNote.trim());
    } else if (pendingAction.kind === "quotation_payment") {
      succeeded = await reviewQuotationPayment(pendingAction.id, pendingAction.decision, decisionNote.trim() || null);
    } else if (pendingAction.kind === "verify_income") {
      succeeded = await verifyManualIncome(pendingAction.id, decisionNote.trim() || null);
    } else if (pendingAction.kind === "income_revision") {
      succeeded = await requestManualIncomeRevision(pendingAction.id, decisionNote.trim());
    } else if (pendingAction.kind === "income_void") {
      succeeded = await voidManualIncome(pendingAction.id, decisionNote.trim());
    } else if (pendingAction.kind === "budget") {
      succeeded = await reviewBudget(pendingAction.id, pendingAction.decision, decisionNote.trim() || null);
    } else if (pendingAction.kind === "funding") {
      succeeded = await voidAccountFunding(pendingAction.id, decisionNote.trim());
    } else if (pendingAction.kind === "account") {
      succeeded = await setAccountActive(pendingAction.id, pendingAction.active);
    } else {
      succeeded = await markPaid(pendingAction.id);
    }
    if (succeeded) {
      setPendingAction(null);
      setDecisionNote("");
      setSelectedApprovalKey(null);
    }
  };

  const openReceipt = async (path: string, bucket = "finance-receipts") => {
    if (!path) return setErrorMessage("This record has no receipt file.");
    // Open synchronously from the click handler so the browser does not block
    // the receipt tab while the signed URL is being generated.
    const receiptWindow = window.open("about:blank", "_blank");
    if (!receiptWindow) return setErrorMessage("Allow pop-ups for this site to view receipts.");
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      receiptWindow.close();
      return setErrorMessage(error?.message ?? "The receipt could not be opened.");
    }
    receiptWindow.opener = null;
    receiptWindow.location.href = data.signedUrl;
  };

  const downloadReport = async () => {
    setSaving(true);
    try {
      const blob = await pdf(
        <FinanceReportDocument
          rows={filteredTransactions}
          income={totals.income}
          expense={totals.expense}
          balance={totals.income - totals.expense}
          period={transactionPeriod}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `huswell-finance-${transactionPeriod}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The Finance PDF could not be generated.");
    } finally {
      setSaving(false);
    }
  };

  if (!canUseFinance(role)) return null;

  return (
    <div className="space-y-5">
      {!overviewOnly && !reportOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <nav className="app-tabs min-w-0 flex-1" aria-label="Finance sections">
            {financeTabs.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined} className="app-tab">
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {(loadError || errorMessage || message) && (
        <NotificationDialog
          message={loadError ?? errorMessage ?? message ?? "Finance could not complete the request."}
          tone={loadError || errorMessage ? "error" : "success"}
          close={() => {
            setLoadError(null);
            setErrorMessage(null);
            setMessage(null);
          }}
          retry={loadError ? () => void load() : undefined}
          retrying={loading}
        />
      )}

      {loading && !hasLoadedOnce ? <FinanceLoadingState cardCount={internal ? 5 : 4} /> : <>
      {tab === "reports" && reportOnly && (
        <MonthlyFinanceReport transactions={transactions} quotationPayments={overviewQuotationPaymentRows} />
      )}
      {tab === "overview" && (
        <>
          {internal ? (
            <div className="space-y-4">
              <div className="border-b border-[#d9e0e9] pb-5">
                <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">Net earnings</p>
                <p className="mt-2 text-5xl font-bold tracking-tight text-[#202938]">{peso.format(periodTotals.income - periodTotals.expense)}</p>
                <p className="mt-1 text-[11px] text-[#7d8797]">This month</p>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.08em] text-[#7d8797]">Finance activity</p>
                <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <FinanceOverviewMetricCard label="Cash In" value={peso.format(periodTotals.income)} color="text-[var(--color-success-text)]" detail={periodLabel} />
                  <FinanceOverviewMetricCard label="Cash Out" value={peso.format(periodTotals.expense)} color="text-[var(--color-danger-text)]" detail={periodLabel} />
                  <FinanceOverviewMetricCard label="Available cash" value={peso.format(currentCashBalance)} color="text-[#202938]" detail="Across Finance accounts" />
                  <FinanceOverviewMetricCard label="Open receivables" value={peso.format(openQuotationReceivableBalance)} color="text-[var(--color-success-text)]" detail="Remaining from approved quotations" />
                  <FinanceOverviewMetricCard label="Open payables" value={peso.format(openSupplierBalance + openCommissionBalance + openLedgerPayableBalance)} color="text-[var(--color-danger-text)]" detail="Awaiting settlement" />
                  <FinanceOverviewMetricCard label="Pending approvals" value={String(pendingApprovalCount)} color="text-[var(--color-warning-text)]" detail="Open Finance approval queue" />
                  <FinanceOverviewMetricCard label="Returned for correction" value={String(revisionRequests)} color="text-[#6941c6]" detail={revisionRequests ? `${peso.format(revisionRequestAmount)} returned to External Finance` : "Returned to External Finance"} />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border-b border-[#d9e0e9] pb-5">
                <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">Net earnings</p>
                <p className="mt-2 text-5xl font-bold tracking-tight text-[#202938]">{peso.format(periodTotals.income - periodTotals.expense)}</p>
                <p className="mt-1 text-[11px] text-[#7d8797]">This month</p>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.08em] text-[#7d8797]">Finance activity</p>
                <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <FinanceOverviewMetricCard label="Cash In" value={peso.format(periodTotals.income)} color="text-[var(--color-success-text)]" detail={periodLabel} />
                  <FinanceOverviewMetricCard label="Cash Out" value={peso.format(periodTotals.expense)} color="text-[var(--color-danger-text)]" detail={periodLabel} />
                  <FinanceOverviewMetricCard label="Available budget" value={peso.format(approvedBudgetRemainingTotal)} color="text-[var(--color-warning-text)]" detail={`${peso.format(approvedBudgetTotal)} approved total`} />
                  <FinanceOverviewMetricCard label="Awaiting confirmation" value={String(awaitingConfirmationCount)} color="text-[var(--color-warning-text)]" detail={`${peso.format(awaitingConfirmationAmount)} submitted`} />
                  <FinanceOverviewMetricCard label="Returned for correction" value={String(revisionRequests)} color="text-[#6941c6]" detail={revisionRequests ? `${peso.format(revisionRequestAmount)} returned by Internal Finance` : "Returned by Internal Finance"} />
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Link href="/finance/reports" className={secondaryButton}>
              <CalendarDays size={14} />
              Monthly report
            </Link>
          </div>
          <Panel title={internal ? "Recent finance activity" : "Recent submissions"} detail={internal ? "Posted and pending finance activity. Pending approvals are handled in Pending approvals." : "Recent Cash In and Cash Out submissions. Confirmation is handled in Internal Finance."}>
            <TransactionTable rows={recentTransactions} categoryName={categoryName} accountName={accountName} leadName={leadName} quotationName={quotationName} budgetLabel={budgetLabel} accounts={activeAccounts} internal={internal} allowActions={false} approveAndPay={requestApproveAndPay} requestRevision={requestTransactionRevisionReview} verifyIncome={requestVerifyIncome} requestIncomeRevision={requestManualIncomeRevisionReview} voidIncome={requestVoidManualIncome} editRevision={openRevisionEditor} markPaid={requestMarkPaid} assignAccount={assignAccount} openReceipt={openReceipt} onSelectTransaction={setSelectedTransaction} saving={saving} />
          </Panel>
        </>
      )}

      {tab === "approvals" && internal && (
        <Panel title="Pending approvals" detail="Review every open Cash In and Cash Out decision in one queue. Quotation receipts become Cash In only after verification; posted ledger history is in Transaction history.">
          <nav aria-label="Pending Finance approval type" className="app-tabs border-b border-[#edf0f5] px-4 sm:px-5">
            {([
              ["all", "All", pendingApprovalRows.length],
              ["income", "Cash In", pendingApprovalIncomeCount],
              ["expense", "Cash Out", pendingApprovalExpenseCount],
            ] as Array<[PendingApprovalFilter, string, number]>).map(([value, label, count]) => (
              <button key={value} type="button" onClick={() => setPendingApprovalFilter(value)} aria-current={pendingApprovalFilter === value ? "page" : undefined} className="app-tab">{label} ({count})</button>
            ))}
          </nav>

          <section className="border-b border-[#edf0f5]">
            <div className="px-4 py-4 sm:px-5">
              <h3 className="text-[13px] font-semibold text-[#202938]">Cash In and Cash Out approvals</h3>
              <p className="mt-1 text-[11px] text-[#7d8797]">Quotation receipts, manual Cash In, and pending Cash Out submissions use the same approval table while their underlying records remain separate.</p>
            </div>
            <PendingApprovalTable
              rows={visiblePendingApprovalRows}
              accountName={accountName}
              onSelectReview={(row) => {
                setSelectedTransaction(null);
                setSelectedApprovalKey(`${row.kind}:${row.id}`);
              }}
              saving={saving}
            />
          </section>

          {pendingBudgetRows.length > 0 && (
            <section>
              <div className="px-4 py-4 sm:px-5">
                <h3 className="text-[13px] font-semibold text-[#202938]">Budget requests</h3>
                <p className="mt-1 text-[11px] text-[#7d8797]">Approve, reject, or return pending budget requests from the same queue.</p>
              </div>
              <div className="table-shell overflow-x-auto">
                <table className="app-table w-full min-w-[850px]">
                  <thead><tr><th>Requested by</th><th>Requested on</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead>
                  <tbody>
                    {pendingBudgetRows.map((budget) => (
                      <tr key={String(budget.id)}>
                        <td>{financeUserName(budget.requested_by)}</td>
                        <td>{displayDate(budget.requested_at)}</td>
                        <td className="font-semibold">{peso.format(numericValue(budget, "amount"))}</td>
                        <td>{stringValue(budget, "note") || "—"}</td>
                        <td><span className="flex gap-1"><button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "rejected")} className="button-danger text-[10px]"><XCircle size={13} /> Reject</button><button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "revision_requested")} className="button-secondary text-[10px] text-[#6941c6]"><Undo2 size={13} /> Return</button><button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "approved")} className="button-secondary text-[10px] text-[#218b55]"><Check size={13} /> Approve</button></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!pendingApprovalCount && <div className="px-4 py-10 text-center text-[12px] text-[#7d8797]">No Finance approvals are currently waiting for review.</div>}
        </Panel>
      )}

      {tab === "transactions" && (
        <Panel title="Transaction history" detail={internal ? "Review verified project activity. Pending approvals are handled in Pending approvals." : "Review the finance ledger by Cash In, Cash Out, source, and status."}>
          {!internal && <div className="border-b border-[#edf0f5] px-4 pt-4 sm:px-5">
            <div className="app-tabs overflow-x-auto" role="tablist" aria-label="Transaction type">
              {transactionViewOptions.map((option) => {
                const active = transactionView === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTransactionView(option.value);
                      setTransactionSourceFilter("all");
                      setTransactionStatusFilter("all");
                      setTransactionAccountFilter("all");
                      setTransactionCategoryFilter("all");
                      setTransactionsPage(1);
                    }}
                    className="app-tab whitespace-nowrap"
                  >
                    {option.label}
                    <span className="app-tab-count ml-1.5">{transactionViewCounts[option.value]}</span>
                  </button>
                );
              })}
            </div>
          </div>}
          {internal ? (
            <div className="border-b border-[#edf0f5] p-4 sm:px-5">
              <label className="relative block max-w-md"><Search size={15} className="search-icon pointer-events-none absolute left-3 text-[#8b92a1]" /><input value={transactionQuery} onChange={(event) => { setTransactionQuery(event.target.value); setTransactionsPage(1); }} className="input mt-0 w-full search-input text-[12px]" placeholder="Search project, client, or quotation" aria-label="Search project transaction history" /></label>
            </div>
          ) : (
          <div className="grid gap-2 border-b border-[#edf0f5] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <select value={transactionPeriod} onChange={(event) => { setTransactionPeriod(event.target.value as Period); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]" aria-label="Transaction period"><option value="weekly">This week</option><option value="monthly">This month</option><option value="yearly">This year</option><option value="all">All time</option></select>
            <select value={transactionSourceFilter} onChange={(event) => { setTransactionSourceFilter(event.target.value as TransactionSourceFilter); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]" aria-label="Transaction source"><option value="all">All sources</option>{transactionSourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={transactionStatusFilter} onChange={(event) => { setTransactionStatusFilter(event.target.value as TransactionStatusFilter); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]" aria-label="Transaction status">{transactionStatusFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={transactionAccountFilter} onChange={(event) => { setTransactionAccountFilter(event.target.value); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]" aria-label="Finance account"><option value="all">All accounts</option>{activeAccounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select>
            <select value={transactionCategoryFilter} onChange={(event) => { setTransactionCategoryFilter(event.target.value); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]" aria-label="Transaction category"><option value="all">All categories</option>{categories.map((category) => <option key={String(category.id)} value={String(category.id)}>{stringValue(category, "name")}</option>)}</select>
            <label className="relative block min-w-0"><Search size={15} className="search-icon pointer-events-none absolute left-3 text-[#8b92a1]" /><input value={transactionQuery} onChange={(event) => { setTransactionQuery(event.target.value); setTransactionsPage(1); }} className="input mt-0 w-full search-input text-[12px]" placeholder="Search history" /></label>
          </div>)}
          <div className="flex flex-col gap-2 border-b border-[#edf0f5] px-4 py-3 text-[11px] text-[#7d8797] sm:flex-row sm:items-center sm:justify-between sm:px-5">
            {internal ? <span>Showing {projectHistoryRows.length ? (activeProjectHistoryPage - 1) * TABLE_PAGE_SIZE + 1 : 0}-{Math.min(activeProjectHistoryPage * TABLE_PAGE_SIZE, projectHistoryRows.length)} of {projectHistoryRows.length} projects</span> : <span>Showing {filteredTransactions.length ? (activeTransactionsPage - 1) * TABLE_PAGE_SIZE + 1 : 0}-{Math.min(activeTransactionsPage * TABLE_PAGE_SIZE, filteredTransactions.length)} of {filteredTransactions.length} transactions</span>}
            <div className="flex flex-wrap gap-2">
              {!internal && <button type="button" onClick={downloadReport} disabled={saving || loading} className={secondaryButton}><Download size={13} /> Download view</button>}
            </div>
          </div>
          {internal ? <>
            <ProjectHistoryTable rows={visibleProjectHistoryRows} onSelectProject={(project) => { setSelectedTransaction(null); setSelectedProjectHistory(project); }} />
            <TablePagination page={activeProjectHistoryPage} pageCount={projectHistoryPageCount} total={projectHistoryRows.length} onPageChange={setTransactionsPage} label="Project transaction history pagination" />
          </> : <>
            <TransactionTable rows={visibleTransactions} categoryName={categoryName} accountName={accountName} leadName={leadName} quotationName={quotationName} budgetLabel={budgetLabel} accounts={activeAccounts} internal={internal} allowActions={true} approveAndPay={requestApproveAndPay} requestRevision={requestTransactionRevisionReview} verifyIncome={requestVerifyIncome} requestIncomeRevision={requestManualIncomeRevisionReview} voidIncome={requestVoidManualIncome} editRevision={openRevisionEditor} markPaid={requestMarkPaid} assignAccount={assignAccount} openReceipt={openReceipt} onSelectTransaction={setSelectedTransaction} saving={saving} />
            <TablePagination page={activeTransactionsPage} pageCount={transactionPageCount} total={filteredTransactions.length} onPageChange={setTransactionsPage} label="Finance transactions pagination" />
          </>}
        </Panel>
      )}

      {tab === "accounts" && (
        <Panel
          title="Bank and e-wallet accounts"
          detail="Internal Finance manages payment accounts, opening balances, and later account funding. Funding changes cash but is not counted as customer income."
          action={internal ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openAccountFunding()} className={secondaryButton}><Plus size={13} /> Add funds</button>
              <button type="button" onClick={() => openAccountEditor()} className={primaryButton}><Plus size={13} /> Add account</button>
            </div>
          ) : undefined}
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const active = Boolean(account.is_active);
              return (
                <div key={String(account.id)} className={`rounded-lg border border-[#d9e0e9] p-4 ${active ? "bg-white" : "bg-[#f8fafc] opacity-80"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[#202938]">{stringValue(account, "account_name")}</p>
                      <p className="mt-1 text-[11px] capitalize text-[#7d8797]">{stringValue(account, "account_type").replaceAll("_", " ")} {stringValue(account, "account_number") || "No identifier"}</p>
                      <p className="mt-1 text-[10px] text-[#8b92a1]">Payments: {stringValue(account, "payment_method", "other").replaceAll("_", " ")}</p>
                    </div>
                    <Wallet size={17} className="text-[#c43b43]" />
                  </div>
                  <div className="mt-3"><StatusPill value={active ? "active" : "inactive"} /></div>
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-[.06em] text-[#7d8797]">Available cash</p>
                  <p className="mt-1 text-lg font-semibold text-[#202938]">{peso.format(accountBalance(String(account.id)))}</p>
                  <p className="mt-1 text-[10px] text-[#8b92a1]">Opening balance: {peso.format(numericValue(account, "opening_balance"))}</p>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-[#edf0f5] pt-3">
                    {stringValue(account, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(account, "receipt_storage_path"), "finance-receipts")} className="button-secondary text-[10px]"><ReceiptText size={13} /> View receipt</button>}
                    {internal && <button type="button" onClick={() => openAccountEditor(account)} className="button-secondary text-[10px]">Edit</button>}
                    {internal && <button type="button" disabled={saving} onClick={() => requestAccountStatusChange(account)} className={active ? "button-danger text-[10px]" : "button-secondary text-[10px]"}>{active ? "Deactivate" : "Reactivate"}</button>}
                  </div>
                </div>
              );
            })}
            {!accounts.length && <p className="text-[12px] text-[#7d8797]">No finance accounts have been added yet.</p>}
          </div>
          {accountFundingEntries.length > 0 && (
            <div className="border-t border-[#edf0f5]">
              <div className="px-4 py-3 sm:px-5">
                <h3 className="text-[12px] font-semibold text-[#202938]">Account funding history</h3>
                <p className="mt-1 text-[11px] text-[#7d8797]">These entries increase the selected account balance but remain separate from customer income.</p>
              </div>
              <div className="table-shell overflow-x-auto">
                <table className="app-table w-full min-w-[820px]">
                  <thead><tr><th>Date</th><th>Account</th><th>Source</th><th>Amount</th><th>Note</th><th>Receipt</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {accountFundingEntries.map((funding) => {
                      const isVoided = Boolean(funding.is_voided);
                      return (
                        <tr key={String(funding.id)} className={isVoided ? "opacity-60" : undefined}>
                          <td>{displayDate(funding.funding_date)}</td>
                          <td>{accountName(funding.account_id)}</td>
                          <td className="capitalize">{stringValue(funding, "funding_source", "other").replaceAll("_", " ")}</td>
                          <td className="font-semibold text-[#218b55]">{peso.format(numericValue(funding, "amount"))}</td>
                          <td>{isVoided ? stringValue(funding, "void_reason", "Voided funding") : stringValue(funding, "note", "—")}</td>
                          <td>{stringValue(funding, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(funding, "receipt_storage_path"))} className="button-secondary text-[10px]"><ReceiptText size={13} /> Receipt</button> : "—"}</td>
                          <td><StatusPill value={isVoided ? "voided" : "posted"} /></td>
                          <td>{internal && !isVoided ? <button type="button" disabled={saving} onClick={() => requestVoidAccountFunding(String(funding.id))} className="button-danger text-[10px]">Void</button> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      )}

      {tab === "budget" && (
        <Panel title="Budget" detail="Approved budget requests are consolidated here. Every External Finance Cash Out uses the available approved budget automatically." action={canRequestBudget ? <button type="button" onClick={openBudgetRequest} className={primaryButton}><Plus size={13} /> Request budget</button> : undefined}>
          <div className="border-b border-[#edf0f5] p-4 sm:p-5">
            <FinanceSummaryLayout primaryLabel="Available budget" primaryValue={peso.format(approvedBudgetRemainingTotal)} primaryDetail="Available for Cash Out">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[12px] text-[#4f5663]">Budget usage</p>
                  <p className="text-[11px] font-semibold text-[#687386]">{approvedBudgetUsagePercent}% allocated</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0f5]" role="progressbar" aria-label="Budget usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={approvedBudgetUsagePercent}>
                  <div className="h-full rounded-full bg-[#c43b43] transition-[width]" style={{ width: `${approvedBudgetUsagePercent}%` }} />
                </div>
                <p className="mt-2 text-[10px] text-[#7d8797]">{peso.format(approvedBudgetConsumedTotal)} of {peso.format(approvedBudgetTotal)} allocated</p>
                <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-3">
                  <FinanceSummaryMetric label="Approved total" value={peso.format(approvedBudgetTotal)} color="text-[#a76605]" />
                  <FinanceSummaryMetric label="Used" value={peso.format(approvedBudgetUsedTotal)} color="text-[#b42318]" />
                  <FinanceSummaryMetric label="Committed" value={peso.format(approvedBudgetCommittedTotal)} color="text-[#a76605]" />
                </div>
              </div>
            </FinanceSummaryLayout>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <h3 className="text-[13px] font-semibold text-[#202938]">Budget request history</h3>
            <p className="mt-1 text-[11px] text-[#7d8797]">Every submitted request remains here with its amount, note, review status, and decision actions.</p>
          </div>
          <div className="table-shell overflow-x-auto">
            <table className="app-table w-full min-w-[1260px]">
              <thead>
                <tr>
                  <th>Requested by</th>
                  <th>Requested on</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Approved / reviewed by</th>
                  <th>Review date</th>
                  <th>Decision note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleBudgets.map((budget) => {
                  const status = stringValue(budget, "status");
                  return (
                    <tr key={String(budget.id)}>
                      <td>{financeUserName(budget.requested_by)}</td>
                      <td>{displayDate(stringValue(budget, "requested_at"))}</td>
                      <td className="font-semibold">{peso.format(numericValue(budget, "amount"))}</td>
                      <td>{stringValue(budget, "note") || "—"}</td>
                      <td><StatusPill value={status} /></td>
                      <td>{financeUserName(budget.decided_by)}</td>
                      <td>{displayDate(stringValue(budget, "decided_at"))}</td>
                      <td>{stringValue(budget, "decision_note") || "—"}</td>
                      <td>
                        {internal && status === "pending" ? (
                          <span className="flex gap-1">
                            <button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "approved")} className="icon-button text-[#218b55]" title="Approve budget" aria-label="Approve budget"><Check size={15} /></button>
                            <button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "rejected")} className="icon-button text-[#b42318]" title="Reject budget" aria-label="Reject budget"><XCircle size={15} /></button>
                            <button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "revision_requested")} className="icon-button text-[#6941c6]" title="Return budget for revision" aria-label="Return budget for revision"><Undo2 size={15} /></button>
                          </span>
                        ) : canRequestBudget && status === "revision_requested" ? (
                          <button type="button" disabled={saving} onClick={() => openBudgetRevision(budget)} className="button-secondary whitespace-nowrap text-[10px]" title="Edit and resubmit budget request"><Undo2 size={13} /> Edit &amp; resubmit</button>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!budgets.length && <tr><td colSpan={9} className="text-center text-[#7d8797]">No budget requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination page={activeBudgetPage} pageCount={budgetPageCount} total={budgets.length} onPageChange={setBudgetPage} label="Budget requests pagination" />
        </Panel>
      )}

      {tab === "supplier_costing" && (
        <Panel title="Supplier Costing logbook" detail="External Finance records supplier obligations here. These entries become Cash Out only when an actual supplier payment is made." action={canRecordSupplierCosting ? <button type="button" onClick={() => setSupplierCostOpen(true)} className={primaryButton}><Plus size={13} /> Log supplier cost</button> : undefined}>
          <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Supplier</th><th>Quotation</th><th>Name / Company</th><th>Description</th><th>Total cost</th><th>Paid</th><th>Remaining</th><th>Due</th><th>Status</th></tr></thead><tbody>{visibleSupplierCostingRows.map((payable) => { const linkedLead = stringValue(payable, "lead_id"); const linkedQuotation = quotations.find((quotation) => quotation.id === payable.quotation_id); const nameCompany = stringValue(linkedQuotation, "client_name") || leadName(linkedLead); return <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}</td><td>{quotationName(payable.quotation_id)}</td><td>{nameCompany || "—"}</td><td>{stringValue(payable, "description", "—")}</td><td className="font-semibold">{peso.format(numericValue(payable, "amount"))}</td><td>{peso.format(numericValue(payable, "amount_paid"))}</td><td className="font-semibold text-[#b42318]">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td>{displayDate(payable.due_date)}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>; })}{!supplierCostingRows.length && <tr><td colSpan={9} className="text-center text-[#7d8797]">No supplier costing entries yet.</td></tr>}</tbody></table></div>
          <TablePagination page={activeSupplierCostingPage} pageCount={supplierCostingPageCount} total={supplierCostingRows.length} onPageChange={setSupplierCostingPage} label="Supplier costing pagination" />
        </Panel>
      )}

      {tab === "payables" && (
        <div className="space-y-4">
          <nav className="app-tabs overflow-x-auto" role="tablist" aria-label="Payables categories">
              {payablesSectionOptions.map(({ value, label }) => {
                const active = payablesSection === value;
                const count = payablesRowsBySection[value].length;
                return (
                  <button
                    key={value}
                    id={`payables-tab-${value}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`payables-panel-${value}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setPayablesSection(value);
                      setPayablesPage(1);
                    }}
                    className="app-tab whitespace-nowrap"
                  >
                    {label}
                    <span className="app-tab-count ml-1.5">{count}</span>
                  </button>
                );
              })}
          </nav>

          {payablesSection === "commission" && (
            <div id="payables-panel-commission" role="tabpanel" aria-labelledby="payables-tab-commission">
          <Panel title="Commission payouts" detail="Each S.E. Origin and Co-Worker allocation is paid separately only after the quotation is fully paid and the existing three-day hold has passed.">
            {internal && eligibleCommissionAllocations.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-[#edf0f5] p-4">
                {eligibleCommissionAllocations.map((allocation) => (
                  <button key={String(allocation.id)} type="button" onClick={() => openCommissionPayout(String(allocation.id))} disabled={saving} className="button-secondary text-[10px]">
                    Pay commission - {quotationName(allocation.quotation_id)} - {peso.format(numericValue(allocation, "amount"))}
                  </button>
                ))}
              </div>
            )}
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[1040px]"><thead><tr><th>Quotation</th><th>Name / Company</th><th>Recipient</th><th>Role</th><th>Division</th><th>Amount</th><th>Eligible</th><th>Status</th></tr></thead><tbody>{visiblePayablesRows.map((allocation) => { const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id")); const eligibleAt = verifiedAt ? new Date(new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000) : null; const eligible = Boolean(eligibleAt && currentTime >= eligibleAt.getTime()); const quotation = quotations.find((item) => item.id === allocation.quotation_id); return <tr key={String(allocation.id)}><td>{quotationName(allocation.quotation_id)}</td><td>{stringValue(quotation, "client_name", "—")}</td><td>{profileName(allocation.recipient_user_id)}</td><td>{commissionRoleLabel(allocation.allocation_role)}</td><td>{commissionDivisionLabel(quotation?.commission_split_option)}</td><td className="font-semibold text-[#b42318]">{peso.format(numericValue(allocation, "amount"))}</td><td>{eligible ? <StatusPill value="approved" /> : <span className="text-[11px] text-[#a76605]">{eligibleAt ? displayDate(eligibleAt) : "Awaiting verified payment"}</span>}</td><td><StatusPill value={stringValue(allocation, "status")} /></td></tr>; })}{!activePayablesRows.length && <tr><td colSpan={8} className="text-center text-[#7d8797]">No commission allocations yet.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}

          {payablesSection === "supplier" && (
            <div id="payables-panel-supplier" role="tabpanel" aria-labelledby="payables-tab-supplier">
          <Panel title="Supplier payables" detail="Confirmed supplier obligations remain payable until paid.">
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[760px]"><thead><tr><th>Supplier</th><th>Payable number</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead><tbody>{visiblePayablesRows.map((payable) => <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}</td><td>{stringValue(payable, "payable_no") || "-"}</td><td>{displayDate(payable.due_date)}</td><td className="font-semibold">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>)}{!activePayablesRows.length && <tr><td colSpan={5} className="text-center text-[#7d8797]">No open supplier payables.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}

        </div>
      )}

      </>}

      {selectedApprovalRow && (
        <FinanceApprovalReviewDialog
          row={selectedApprovalRow}
          accounts={activeAccounts}
          accountName={accountName}
          categoryName={categoryName}
          quotationName={quotationName}
          budgetLabel={budgetLabel}
          profileName={profileName}
          openReceipt={openReceipt}
          assignAccount={assignAccount}
          assignQuotationPaymentAccount={assignQuotationPaymentAccount}
          requestQuotationPaymentReview={requestQuotationPaymentReview}
          requestApproveAndPay={requestApproveAndPay}
          requestRevision={requestTransactionRevisionReview}
          requestVerifyIncome={requestVerifyIncome}
          requestIncomeRevision={requestManualIncomeRevisionReview}
          close={() => setSelectedApprovalKey(null)}
          saving={saving}
        />
      )}

      {selectedTransaction && (
        <TransactionDetailDialog
          transaction={selectedTransaction}
          categoryName={categoryName}
          accountName={accountName}
          quotationName={quotationName}
          quotationPaymentRecords={quotationPaymentRecords}
          budgetLabel={budgetLabel}
          profileName={profileName}
          openReceipt={openReceipt}
          close={() => setSelectedTransaction(null)}
        />
      )}

      {selectedProjectHistory && (
        <ProjectFinanceDialog
          project={selectedProjectHistory}
          accountName={accountName}
          categoryName={categoryName}
          quotations={quotations}
          directCostTotalsByQuotation={quotationDirectCostTotalsByQuotation}
          projectExpenseRows={projectExpenseRows}
          openReceipt={openReceipt}
          close={() => setSelectedProjectHistory(null)}
        />
      )}

      {pendingAction && (
        <FinanceConfirmDialog
          action={pendingAction}
          note={decisionNote}
          setNote={setDecisionNote}
          saving={saving}
          close={() => {
            setPendingAction(null);
            setDecisionNote("");
          }}
          confirm={confirmPendingAction}
        />
      )}

      {transactionDirection && (
        <FinanceDialog title={transactionDialogTitle} detail={transactionDialogDetail} close={closeTransactionForm}>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {transactionDirection === "expense" && !commissionPayoutMode && !internal && <div className="field-label sm:col-span-2">
              <span>Budget</span>
              <div className="mt-1 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong className="text-xl font-semibold text-[#202938]">{peso.format(approvedBudgetRemainingTotal)}</strong>
                  <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#218b55]">Available</span>
                </div>
                {!approvedBudgetRemainingTotal && <p className="mt-2 text-[11px] font-semibold text-[#b42318]">No available approved budget. Request a budget before submitting Cash Out.</p>}
              </div>
            </div>}
            {!internal && transactionDirection === "income" && !revisionTransaction && (
              <fieldset className="field-label sm:col-span-2">
                <legend>Cash In source</legend>
                <div role="group" aria-label="Cash In source" className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1">
                  <button type="button" aria-pressed={cashInSource === "quotation_payment"} onClick={() => chooseCashInSource("quotation_payment")} className={cashInSource === "quotation_payment" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Project payment</button>
                  <button type="button" aria-pressed={cashInSource === "other_income"} onClick={() => chooseCashInSource("other_income")} className={cashInSource === "other_income" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Other income</button>
                </div>
              </fieldset>
            )}
            {quotationPaymentMode ? (
              <>
                <div className="field-label sm:col-span-2">
                  <span>Quotation</span>
                  <SearchableSelect
                    options={normalizedQuotationPaymentOptions}
                    value={transactionValues.quotation_id}
                    onChange={chooseQuotationPayment}
                    placeholder={normalizedQuotationPaymentOptions.length ? "Choose company and client" : "No approved quotations available"}
                    searchPlaceholder="Search company or client"
                    noResultsLabel="No approved quotation found."
                    ariaLabel="Quotation payment source"
                    required
                    clearable={false}
                    disabled={!normalizedQuotationPaymentOptions.length}
                    className="mt-1"
                  />
                </div>
                {selectedQuotationPayment && selectedQuotationPaymentSummary && (
                  <div className="grid gap-2 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[11px] sm:col-span-2 sm:grid-cols-3">
                    <div><span className="block text-[10px] text-[#8b92a1]">Quotation total</span><strong className="block text-[#344054]">{peso.format(selectedQuotationPaymentSummary.total)}</strong></div>
                    <div><span className="block text-[10px] text-[#8b92a1]">Verified paid</span><strong className="block text-[#218b55]">{peso.format(selectedQuotationPaymentSummary.verified)}</strong></div>
                    <div><span className="block text-[10px] text-[#8b92a1]">Available balance</span><strong className="block text-[#344054]">{peso.format(selectedQuotationPaymentSummary.available)}</strong></div>
                    {selectedQuotationPaymentRevision && <p className="sm:col-span-3 rounded-md border border-[#f0d49b] bg-[#fff8e9] px-3 py-2 text-[11px] leading-[1.45] text-[#8a5a00]">This receipt was returned for correction{stringValue(selectedQuotationPaymentRevision, "correction_note") ? `: ${stringValue(selectedQuotationPaymentRevision, "correction_note")}` : ". Upload the corrected details and receipt image, then resubmit it."}</p>}
                  </div>
                )}
                <label className="field-label">Payment type<select value={transactionValues.payment_kind} onChange={(event) => {
                  const kind = event.target.value;
                  setTransactionValues((current) => ({
                    ...current,
                    payment_kind: kind,
                    amount: selectedQuotationPaymentSummary ? financeQuotationPaymentSuggestedAmount(kind, selectedQuotationPaymentSummary) : "",
                    account_id: quotationPaymentAccountIdFor(selectedQuotationPayment, kind),
                  }));
                }} className="input mt-1">{quotationPaymentKindOptions.map(([key, label]) => <option key={key} value={key}>{key === "full_payment" && stringValue(selectedQuotationPayment, "payment_terms_option") === "pdc_50_50" ? "Full balance (PDC)" : label}</option>)}</select></label>
                <label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={transactionValues.amount} onChange={(value) => setTransactionValues((current) => ({ ...current, amount: value }))} className="input mt-1" placeholder="0.00" /><span className="mt-1 block text-[10px] font-normal text-[#8b92a1]">{selectedQuotationPaymentSummary ? transactionValues.payment_kind === "downpayment" ? `Required remaining downpayment: ${peso.format(selectedQuotationPaymentSummary.downpaymentRemaining)}` : `Must equal available balance: ${peso.format(selectedQuotationPaymentSummary.available)}` : "Choose a quotation first"}</span></label>
                <label className="field-label">Paid date<input type="date" value={transactionValues.transaction_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_date: event.target.value }))} className="input mt-1" /></label>
                <label className="field-label">Received into account
                  <SearchableSelect options={quotationPaymentAccountOptions} value={transactionValues.account_id} onChange={(value) => setTransactionValues((current) => ({ ...current, account_id: value }))} placeholder={activeAccounts.length ? "Choose receiving account" : "No active account available"} searchPlaceholder="Search receiving accounts" noResultsLabel={transactionValues.payment_kind === "full_payment" && stringValue(selectedQuotationPayment, "payment_terms_option") === "pdc_50_50" ? "No active Check/PDC account found." : "No matching receiving account."} ariaLabel="Receiving Finance account" required clearable={false} disabled={!quotationPaymentAccountOptions.length} className="mt-1" />
                  <small className="mt-1 block text-[#7d8797]">Only active accounts added by Internal Finance are shown.</small>
                </label>
                <label className="field-label sm:col-span-2">Reference number (optional)<input value={transactionValues.reference_number} onChange={(event) => setTransactionValues((current) => ({ ...current, reference_number: event.target.value }))} className="input mt-1" placeholder="Receipt or transaction reference" maxLength={200} /></label>
                <label className="field-label sm:col-span-2">Note (optional)<textarea value={transactionValues.note} onChange={(event) => setTransactionValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder="Add extra context about this payment" maxLength={1000} /></label>
                <div className="field-label sm:col-span-2"><span>{selectedQuotationPaymentRevision ? "Replacement receipt image" : "Receipt image"}</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel={selectedQuotationPaymentRevision ? "Choose replacement payment receipt image" : "Choose payment receipt image"} className="mt-1" emptyLabel={selectedQuotationPaymentRevision ? "Choose replacement receipt image" : "Choose receipt image"} files={transactionFile ? [transactionFile] : []} onFilesSelected={(files) => setTransactionFile(files[0] ?? null)} /></div>
              </>
            ) : (
            <>
            {!internal && transactionDirection === "expense" && (
              <fieldset className="field-label sm:col-span-2">
                <legend>Expense type</legend>
                <div role="group" aria-label="Expense type" className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1">
                  <button type="button" aria-pressed={expenseMode === "regular"} onClick={() => chooseExpenseMode("regular")} className={expenseMode === "regular" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Non-Project Expense</button>
                  <button type="button" aria-pressed={expenseMode === "project"} onClick={() => chooseExpenseMode("project")} className={expenseMode === "project" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Project expense</button>
                  <button type="button" aria-pressed={expenseMode === "supplier"} onClick={() => chooseExpenseMode("supplier")} className={expenseMode === "supplier" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Supplier payment</button>
                </div>
              </fieldset>
            )}
            {projectExpenseMode && <div className="field-label sm:col-span-2">
              <span>Project / quotation</span>
              <SearchableSelect
                options={projectExpenseOptions}
                value={projectExpenseSelection}
                onChange={chooseProjectExpense}
                placeholder={projectExpenseOptions.length ? "Choose an approved project quotation" : "No approved project quotations available"}
                searchPlaceholder="Search project, client, or quotation"
                noResultsLabel="No matching approved project quotation found."
                ariaLabel="Project or quotation for expense"
                required
                clearable={false}
                disabled={!projectExpenseOptions.length}
                className="mt-1"
              />
              {selectedProjectExpenseCapacity ? (
                <div aria-live="polite" className="mt-2 grid gap-2 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[11px] sm:grid-cols-3">
                  <div><span className="block text-[10px] text-[#8b92a1]">Total direct cost</span><strong className="block text-[#344054]">{peso.format(selectedProjectExpenseCapacity.totalDirectCost)}</strong></div>
                  <div><span className="block text-[10px] text-[#8b92a1]">Committed expenses</span><strong className="block text-[#a76605]">{peso.format(selectedProjectExpenseCapacity.committedProjectExpense)}</strong></div>
                  <div><span className="block text-[10px] text-[#8b92a1]">Available to expense</span><strong className={`block ${(selectedProjectExpenseCapacity.availableToExpense ?? 0) > 0 ? "text-[#218b55]" : "text-[#b42318]"}`}>{peso.format(selectedProjectExpenseCapacity.availableToExpense ?? 0)}</strong></div>
                  {(selectedProjectExpenseCapacity.availableToExpense ?? 0) <= 0 && <p className="sm:col-span-3 rounded-md border border-[#f2b8b5] bg-[#fef3f2] px-3 py-2 text-[11px] leading-[1.45] text-[#b42318]">This quotation has no remaining direct-cost capacity for another project expense.</p>}
                </div>
              ) : <small className="mt-1 block text-[#7d8797]">Only approved direct quotations can receive a capped project expense.</small>}
            </div>}
            <label className="field-label">Amount<NumberInput min="0.01" max={projectExpenseMode ? selectedProjectExpenseCapacity?.availableToExpense : undefined} step="0.01" value={transactionValues.amount} onChange={(value) => setTransactionValues((current) => ({ ...current, amount: value }))} aria-invalid={Boolean(projectExpenseAmountError)} className="input mt-1" />{projectExpenseMode && selectedProjectExpenseCapacity && <span className="mt-1 block text-[10px] font-normal text-[#8b92a1]">Maximum for this quotation: {peso.format(selectedProjectExpenseCapacity.availableToExpense ?? 0)}</span>}{projectExpenseAmountError && <span role="alert" className="mt-1 block text-[11px] font-semibold text-[#b42318]">{projectExpenseAmountError}</span>}</label>
            <label className="field-label">
              {transactionDirection === "income" ? "Income category" : "Expense category"}
              <SearchableSelect options={categoryOptions} value={transactionValues.category_id} onChange={(value) => setTransactionValues((current) => ({ ...current, category_id: value }))} placeholder="Choose category" searchPlaceholder="Search categories" ariaLabel={transactionDirection === "income" ? "Income category" : "Expense category"} required clearable={false} className="mt-1" />
            </label>
            {supplierPaymentMode && <div className="field-label sm:col-span-2">
              <span>Supplier payable</span>
              <SearchableSelect
                options={supplierPayableOptions}
                value={transactionValues.supplier_payable_id}
                onChange={chooseSupplierPayable}
                placeholder={supplierPayableOptions.length ? "Choose supplier bill" : "No open supplier bills"}
                searchPlaceholder="Search supplier bills"
                noResultsLabel="No open supplier bills found."
                ariaLabel="Supplier payable"
                required
                clearable={false}
                disabled={!supplierPayableOptions.length}
                className="mt-1"
              />
              {selectedSupplierPayable ? (
                <div className="mt-2 grid gap-2 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[11px] sm:grid-cols-3">
                  <div><span className="block text-[10px] text-[#8b92a1]">Supplier</span><strong className="block text-[#344054]">{supplierName(selectedSupplierPayable.supplier_id)}</strong></div>
                  <div><span className="block text-[10px] text-[#8b92a1]">Due date</span><strong className="block text-[#344054]">{displayDate(selectedSupplierPayable.due_date)}</strong></div>
                  <div><span className="block text-[10px] text-[#8b92a1]">Remaining</span><strong className="block text-[#b42318]">{peso.format(selectedSupplierPayableRemaining)}</strong></div>
                  <div className="sm:col-span-3"><span className="block text-[10px] text-[#8b92a1]">Description</span><span className="block text-[#344054]">{stringValue(selectedSupplierPayable, "description", "Supplier payment")}</span></div>
                </div>
              ) : <small className="mt-1 block text-[#7d8797]">{supplierPayableOptions.length ? "Choose the supplier bill this payment settles." : "Record supplier costing first before submitting a supplier payment."}</small>}
            </div>}
            {(transactionDirection === "expense" || manualIncomeMode || manualIncomeRevisionMode) && <label className="field-label">
              {transactionDirection === "income" ? "Receiving account" : "Payment account"}
              <SearchableSelect options={accountOptions} value={transactionValues.account_id} onChange={(value) => setTransactionValues((current) => ({ ...current, account_id: value }))} placeholder={activeAccounts.length ? `Choose ${transactionDirection === "income" ? "receiving" : "payment"} account` : "No active account available"} searchPlaceholder="Search payment accounts" ariaLabel={transactionDirection === "income" ? "Receiving account" : "Payment account"} required clearable={false} disabled={!activeAccounts.length} className="mt-1" />
              {!activeAccounts.length && <small className="mt-1 block text-[#a76605]">Internal Finance must add an active payment account before this record can be submitted.</small>}
            </label>}
            {(!supplierPaymentMode && !projectExpenseMode && !manualIncomeMode && !manualIncomeRevisionMode || internal) && <label className="field-label">Name / Company from Leads<SearchableLeadSelect options={leadOptions} value={transactionValues.lead_id} onChange={(value) => setTransactionValues((current) => ({ ...current, lead_id: value }))} placeholder="Not linked" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Name / Company from Leads" className="mt-1" /></label>}
            <label className="field-label">Date<input type="date" value={transactionValues.transaction_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_date: event.target.value }))} className="input mt-1" /></label>
            {internal && <label className="field-label">Time<input type="time" value={transactionValues.transaction_time} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_time: event.target.value }))} className="input mt-1" /></label>}
            {(manualIncomeMode || manualIncomeRevisionMode) && <label className="field-label">Reference number (optional)<input value={transactionValues.reference_number} onChange={(event) => setTransactionValues((current) => ({ ...current, reference_number: event.target.value }))} className="input mt-1" placeholder="Receipt or transaction reference" maxLength={200} /></label>}
            <label className="field-label sm:col-span-2">{projectExpenseMode ? "Purpose / details" : "Note (optional)"}<textarea value={transactionValues.note} onChange={(event) => setTransactionValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder={projectExpenseMode ? "Explain what this project expense is for" : "Add a note"} /></label>
            {internal && !commissionPayoutMode && <div className="field-label"><span>Payment status</span><div className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1"><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "paid" }))} className={transactionValues.payment_status === "paid" ? "flex-1 rounded-md bg-[#edf9f2] px-3 py-2 text-[11px] font-semibold text-[#218b55]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Paid</button><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "unpaid" }))} className={transactionValues.payment_status === "unpaid" ? "flex-1 rounded-md bg-[#fff8e9] px-3 py-2 text-[11px] font-semibold text-[#a76605]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Unpaid</button></div></div>}
              <div className="field-label"><span>{revisionTransaction ? "Replacement proof (optional)" : manualIncomeMode ? "Receipt or proof" : "Receipt image"}</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel={revisionTransaction ? "Choose replacement finance receipt image" : "Choose finance receipt image"} className="mt-1" emptyLabel={revisionTransaction ? "Keep current proof or choose replacement" : manualIncomeMode ? "Choose receipt or proof" : "Choose receipt image"} files={transactionFile ? [transactionFile] : []} onFilesSelected={(files) => setTransactionFile(files[0] ?? null)} /></div>
            {transactionDirection === "expense" && <>
              {internal && <label className="field-label">
                Commission payout allocation
                <SearchableSelect options={eligibleCommissionOptions} value={transactionValues.commission_allocation_id} onChange={(value) => setTransactionValues((current) => ({ ...current, commission_allocation_id: value }))} placeholder="Choose eligible commission" searchPlaceholder="Search commission allocations" ariaLabel="Commission payout allocation" disabled={commissionPayoutMode} clearable={!commissionPayoutMode} className="mt-1" />
                {!eligibleCommissionOptions.length && <small className="mt-1 block text-[#7d8797]">No commission allocation is currently eligible.</small>}
              </label>}

            </>}
            </>
            )}
          </div>
          {internal && (
          <div className="mt-4 rounded-lg border border-[#edf0f5] bg-[#fafbfc] p-3"><p className="text-[11px] font-semibold text-[#344054]">Add a custom {transactionDirection} category</p><div className="mt-2 flex flex-wrap gap-2"><input value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} className="input min-w-[200px] flex-1 text-[12px]" placeholder="Category name" />{transactionDirection === "expense" && <select value={categoryDraft.expense_class} onChange={(event) => setCategoryDraft((current) => ({ ...current, expense_class: event.target.value }))} className="input text-[12px]"><option value="operating">Operating Expense</option><option value="non_operating">Non Operating Expense</option></select>}<button type="button" onClick={() => void saveCategory()} disabled={saving} className="button-secondary">Add category</button></div><div className="mt-3 flex flex-wrap gap-1.5">{activeCategories.filter((category) => !Boolean(category.is_system)).map((category) => <button key={String(category.id)} type="button" onClick={() => void archiveCategory(category)} className="inline-flex items-center gap-1 rounded-full border border-[#d9e0e9] px-2 py-1 text-[10px] text-[#687386] hover:border-[#f2b8b5] hover:text-[#b42318]">{stringValue(category, "name")} <X size={11} /></button>)}</div></div>
          )}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeTransactionForm} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveTransaction()} disabled={saving || (quotationPaymentMode && (!transactionValues.quotation_id || !transactionValues.account_id || !transactionFile || !quotationPaymentAccountOptions.length)) || (!revisionTransaction && !internal && !manualIncomeMode && !commissionPayoutMode && transactionDirection === "expense" && approvedBudgetRemainingTotal <= 0) || ((transactionDirection === "expense" || manualIncomeMode || manualIncomeRevisionMode) && (!activeAccounts.length || !transactionValues.account_id)) || (supplierPaymentMode && !transactionValues.supplier_payable_id) || (projectExpenseMode && (!transactionValues.quotation_id || !selectedProjectExpense || !((selectedProjectExpenseCapacity?.availableToExpense ?? 0) > 0))) || (internal && !transactionValues.commission_allocation_id)} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} {saving ? "Saving..." : quotationPaymentMode ? selectedQuotationPaymentRevision ? "Resubmit receipt" : "Submit receipt" : manualIncomeMode ? "Submit Cash In" : manualIncomeRevisionMode ? "Resubmit Cash In" : revisionTransaction ? "Resubmit Cash Out" : commissionPayoutMode ? "Create commission payout" : projectExpenseMode ? "Submit project expense" : supplierPaymentMode ? "Submit supplier payment" : "Submit regular expense"}</button></div>
        </FinanceDialog>
      )}

      {canRecordSupplierCosting && supplierCostOpen && (
        <FinanceDialog
          title="Log supplier costing"
          detail="This records an amount owed to a supplier. It does not reduce cash until a linked Cash Out is paid and approved."
          close={() => setSupplierCostOpen(false)}
        >
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="field-label">
              Supplier
              <SearchableSelect options={supplierOptions} value={supplierCostValues.supplier_id} onChange={(value) => setSupplierCostValues((current) => ({ ...current, supplier_id: value }))} placeholder="Choose supplier" searchPlaceholder="Search suppliers" ariaLabel="Supplier" required clearable={false} className="mt-1" />
            </label>
            <label className="field-label">
              Related quotation (optional)
              <SearchableSelect
                options={normalizedQuotationOptions}
                value={supplierCostValues.quotation_id}
                onChange={(value) => {
                  const quotation = quotations.find((item) => item.id === value);
                  setSupplierCostValues((current) => ({ ...current, quotation_id: value, lead_id: value ? stringValue(quotation, "lead_id") : "" }));
                }}
                placeholder="Not linked"
                searchPlaceholder="Search quotations"
                ariaLabel="Related quotation"
                className="mt-1"
              />
            </label>
            <label className="field-label">
              Name / Company (optional)
              <SearchableLeadSelect options={leadOptions} value={supplierCostValues.lead_id} onChange={(value) => setSupplierCostValues((current) => ({ ...current, lead_id: value }))} placeholder="Not linked" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Name / Company" className="mt-1" />
            </label>
            <label className="field-label">
              Amount
              <NumberInput min="0.01" step="0.01" value={supplierCostValues.amount} onChange={(value) => setSupplierCostValues((current) => ({ ...current, amount: value }))} className="input mt-1" />
            </label>
            <label className="field-label sm:col-span-2">
              Description
              <input value={supplierCostValues.description} onChange={(event) => setSupplierCostValues((current) => ({ ...current, description: event.target.value }))} className="input mt-1" placeholder="Example: Supplier materials for quotation" />
            </label>
            <label className="field-label">
              Due date
              <input type="date" value={supplierCostValues.due_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setSupplierCostValues((current) => ({ ...current, due_date: event.target.value }))} className="input mt-1" />
            </label>
            <label className="field-label">
              Notes
              <textarea value={supplierCostValues.notes} onChange={(event) => setSupplierCostValues((current) => ({ ...current, notes: event.target.value }))} className="input mt-1 min-h-20" placeholder="Add supplier or payment notes" />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setSupplierCostOpen(false)} className="button-secondary">Cancel</button>
            <button type="button" onClick={() => void saveSupplierCosting()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Save costing</button>
          </div>
        </FinanceDialog>
      )}

      {accountFundingOpen && (
        <FinanceDialog title="Add funds to account" detail="Record owner funding, a loan, or another deposit. This increases cash but does not create customer income." close={() => setAccountFundingOpen(false)}>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="field-label">Account<select value={accountFundingValues.account_id} onChange={(event) => setAccountFundingValues((current) => ({ ...current, account_id: event.target.value }))} className="input mt-1"><option value="">Choose account</option>{activeAccounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select></label>
            <label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={accountFundingValues.amount} onChange={(value) => setAccountFundingValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label>
            <label className="field-label">Funding source<select value={accountFundingValues.funding_source} onChange={(event) => setAccountFundingValues((current) => ({ ...current, funding_source: event.target.value }))} className="input mt-1">{accountFundingSources.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field-label">Date<input type="date" value={accountFundingValues.funding_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setAccountFundingValues((current) => ({ ...current, funding_date: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label sm:col-span-2">Note<textarea value={accountFundingValues.note} onChange={(event) => setAccountFundingValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder="Explain where the funds came from" /></label>
            <div className="field-label sm:col-span-2"><span>Proof of funding</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose account funding receipt image" className="mt-1" emptyLabel="Choose receipt image" files={accountFundingFile ? [accountFundingFile] : []} onFilesSelected={(files) => setAccountFundingFile(files[0] ?? null)} /></div>
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAccountFundingOpen(false)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveAccountFunding()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Save funding</button></div>
        </FinanceDialog>
      )}

      {accountOpen && (
        <FinanceDialog
          title={accountEditing ? "Edit Finance account" : "Add bank or e-wallet account"}
          detail={accountEditing ? "Update the account details. Existing receipt routing is preserved. Opening balances remain fixed; record later deposits as account funding." : "Internal Finance owns the account directory and opening balances. Payment routing is set automatically from the account type."}
          close={closeAccountEditor}
        >
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="field-label">Account name<input value={accountValues.name} onChange={(event) => setAccountValues((current) => ({ ...current, name: event.target.value }))} className="input mt-1" placeholder="Example: BDO Operating Account" /></label>
            <label className="field-label">Account type<select value={accountValues.type} onChange={(event) => setAccountValues((current) => ({ ...current, type: event.target.value }))} className="input mt-1"><option value="bank">Bank</option><option value="e_wallet">E-wallet</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
            <label className="field-label">Account number / identifier<input value={accountValues.number} onChange={(event) => setAccountValues((current) => ({ ...current, number: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label">Opening amount<NumberInput min="0" step="0.01" disabled={Boolean(accountEditing)} value={accountValues.opening_balance} onChange={(value) => setAccountValues((current) => ({ ...current, opening_balance: value }))} className="input mt-1" />{accountEditing && <span className="mt-1 block text-[10px] text-[#7d8797]">Fixed after account creation.</span>}</label>
            {!accountEditing && <div className="field-label sm:col-span-2"><span>Receipt image</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose account receipt image" className="mt-1" emptyLabel="Choose receipt image" files={accountFile ? [accountFile] : []} onFilesSelected={(files) => setAccountFile(files[0] ?? null)} /></div>}
            {accountEditing && stringValue(accountEditing, "receipt_storage_path") && <div className="sm:col-span-2"><button type="button" onClick={() => void openReceipt(stringValue(accountEditing, "receipt_storage_path"), "finance-receipts")} className="button-secondary text-[10px]"><ReceiptText size={13} /> View account receipt</button></div>}
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeAccountEditor} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveAccount()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} {accountEditing ? "Save changes" : "Save account"}</button></div>
        </FinanceDialog>
      )}

      {budgetOpen && <FinanceDialog title={budgetRevision ? "Revise budget request" : "Request budget"} detail={budgetRevision ? "Correct the returned request and resubmit it for Internal Finance review." : "The request will be reviewed by Internal Finance."} close={closeBudgetForm}><div className="mt-5 space-y-3"><label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={budgetValues.amount} onChange={(value) => setBudgetValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label><label className="field-label">Note<textarea value={budgetValues.note} onChange={(event) => setBudgetValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-24" placeholder="Explain the budget request" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeBudgetForm} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveBudget()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} {budgetRevision ? "Resubmit request" : "Submit request"}</button></div></FinanceDialog>}

      {loading && <LoadingState label="Updating Finance data..." />}
    </div>
  );
}

// Kept as a compatibility reference for the previous table markup; the active
// TransactionTable above is the rendered component.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyTransactionTable({
  rows,
  categoryName,
  accountName,
  leadName,
  budgetLabel,
  accounts,
  internal,
  approveAndPay,
  requestRevision,
  editRevision,
  markPaid,
  assignAccount,
  openReceipt,
  saving,
}: {
  rows: Row[];
  categoryName: (id: unknown) => string;
  accountName: (id: unknown) => string;
  leadName: (id: unknown) => string;
  budgetLabel: (id: unknown) => string;
  accounts: Row[];
  internal: boolean;
  approveAndPay: (id: string) => void;
  requestRevision: (id: string) => void;
  editRevision: (transaction: Row) => void;
  markPaid: (id: string, label?: string) => void;
  assignAccount: (id: string, accountId: string) => Promise<void>;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="finance-transaction-table">
      <div className="space-y-2 md:hidden">
        {rows.map((transaction) => {
          const type = stringValue(transaction, "transaction_type");
          const approval = stringValue(transaction, "approval_status");
          const paid = stringValue(transaction, "payment_status");
          const isVoided = Boolean(transaction.is_voided);
          const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canApproveAndPay = internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval);
          const canMarkPaid = internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved";
          const canRequestRevision = internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id;
          const canEditRevision = !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested";
          const accountId = stringValue(transaction, "account_id");
          const canChangeAccount = internal && !isVoided && (
            (type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval))
            || (!accountId && Boolean(transaction.source_payment_id))
          );
          const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts");
          return (
            <article key={String(transaction.id)} className={`rounded-lg border border-[#d9e0e9] bg-white p-3 ${isVoided ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#202938]">{leadName(transaction.lead_id)}</p>
                  <p className="mt-1 text-[10px] text-[#7d8797]">{displayDate(transaction.transaction_date)}{stringValue(transaction, "transaction_time") ? ` · ${stringValue(transaction, "transaction_time")}` : ""}</p>
                </div>
                <StatusPill value={isVoided ? "voided" : paid} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div><span className="block text-[10px] text-[#8b92a1]">Category</span><span className="font-medium text-[#344054]">{categoryName(transaction.category_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Account</span><span className="font-medium text-[#344054]">{accountName(transaction.account_id)}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Cash In</span><span className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Cash Out</span><span className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Approval</span><StatusPill value={approval} /></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 text-[#344054]">{isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : approval === "revision_requested" ? `Revision requested: ${stringValue(transaction, "decision_note", "See reviewer note")}` : stringValue(transaction, "note", "-")}</span></div>
              </div>
              {budgetLabel(transaction.budget_request_id) && <p className="mt-2 text-[10px] text-[#687386]">Budget: {budgetLabel(transaction.budget_request_id)}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
                {canChangeAccount && <select aria-label="Payment account" defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] flex-1 text-[10px]"><option value="">Choose payment account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select>}
                {!canChangeAccount && !accountId && internal && !isVoided && <span className="text-[10px] text-[#a76605]">Needs payment account</span>}
                {stringValue(transaction, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="button-secondary" title="View receipt"><ReceiptText size={14} /> Receipt</button>}
                {canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[#218b55]">{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}
                {canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[#6941c6]">Return for revision</button>}
                {canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[#6941c6]">Edit &amp; resubmit</button>}
                {canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary">Mark paid</button>}
              </div>
            </article>
          );
        })}
        {!rows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-6 text-center text-[11px] text-[#7d8797]">No transactions match the current filter.</p>}
      </div>
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[1080px]"><thead><tr><th>Date</th><th>Name / Company</th><th>Category</th><th>Account</th><th>Cash In</th><th>Cash Out</th><th>Payment</th><th>Approval</th><th>Receipt</th><th>Action</th></tr></thead><tbody>{rows.map((transaction) => { const type = stringValue(transaction, "transaction_type"); const approval = stringValue(transaction, "approval_status"); const paid = stringValue(transaction, "payment_status"); const isVoided = Boolean(transaction.is_voided); const isRegularExpense = type === "expense" && !transaction.source_payment_id && !transaction.supplier_payable_id && !transaction.commission_summary_id && !transaction.commission_allocation_id; const canApproveAndPay = internal && !isVoided && isRegularExpense && paid === "unpaid" && ["pending", "approved"].includes(approval); const canMarkPaid = internal && !isVoided && type === "expense" && !isRegularExpense && paid === "unpaid" && approval === "approved"; const canRequestRevision = internal && !isVoided && type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval) && !transaction.source_payment_id && !transaction.commission_summary_id && !transaction.commission_allocation_id; const canEditRevision = !internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "revision_requested"; const accountId = stringValue(transaction, "account_id"); const canChangeAccount = internal && !isVoided && ((type === "expense" && paid === "unpaid" && ["pending", "approved"].includes(approval)) || (!accountId && Boolean(transaction.source_payment_id))); const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts"); return <tr key={String(transaction.id)} className={isVoided ? "opacity-60" : undefined}><td>{displayDate(transaction.transaction_date)}<small>{stringValue(transaction, "transaction_time")}</small></td><td>{leadName(transaction.lead_id)}{Boolean(transaction.source_payment_id) && <small>Automatic quotation payment</small>}</td><td>{categoryName(transaction.category_id)}<small>{isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : approval === "revision_requested" ? `Revision requested: ${stringValue(transaction, "decision_note", "See reviewer note")}` : stringValue(transaction, "note", "-")}</small></td><td>{canChangeAccount ? <select aria-label="Payment account" defaultValue={accountId} onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] text-[10px]"><option value="">Choose payment account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select> : accountName(transaction.account_id)}</td><td className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td><StatusPill value={isVoided ? "voided" : paid} /></td><td><StatusPill value={approval} /></td><td>{stringValue(transaction, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="text-[#c43b43]" title="View receipt"><ReceiptText size={15} /></button> : "-"}</td><td><span className="flex flex-wrap gap-1">{canApproveAndPay && <button type="button" disabled={saving || !accountId} onClick={() => approveAndPay(String(transaction.id))} className="button-secondary text-[10px]" title={approval === "pending" ? "Approve and pay Cash Out" : "Pay approved Cash Out"}>{approval === "pending" ? "Approve and pay" : "Pay now"}</button>}{canRequestRevision && <button type="button" disabled={saving} onClick={() => requestRevision(String(transaction.id))} className="button-secondary text-[10px]" title="Return Cash Out for revision">Return</button>}{canEditRevision && <button type="button" disabled={saving} onClick={() => editRevision(transaction)} className="button-secondary text-[10px] text-[#6941c6]">Edit &amp; resubmit</button>}{canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Cash Out")} className="button-secondary text-[10px]">Mark paid</button>}{!canApproveAndPay && !canRequestRevision && !canEditRevision && !canMarkPaid && !(internal && !isVoided && type === "expense" && approval === "pending") && "-"}</span></td></tr>; })}{!rows.length && <tr><td colSpan={10} className="text-center text-[#7d8797]">No transactions match the current filter.</td></tr>}</tbody></table></div>
    </div>
  );
}
