"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import {
  Check,
  Download,
  LoaderCircle,
  Plus,
  ReceiptText,
  Search,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
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
import { FileUploadControl } from "@/components/ui/file-upload-control";
import { NumberInput } from "@/components/ui/number-input";
import { SearchableLeadSelect } from "@/components/ui/searchable-lead-select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { TABLE_PAGE_SIZE, TablePagination } from "@/components/ui/table-pagination";
import { NotificationDialog } from "@/components/ui/notification-dialog";

type Row = { id?: string; [key: string]: unknown };
type Direction = "income" | "expense";
type ExpenseMode = "regular" | "supplier";
type Tab = "overview" | "transactions" | "accounts" | "budget" | "supplier_costing" | "payables";
type PayablesSection = "commission" | "supplier" | "receivables" | "other";
type Period = "all" | "weekly" | "monthly" | "yearly";

const payablesSectionOptions: { value: PayablesSection; label: string }[] = [
  { value: "commission", label: "Commission payouts" },
  { value: "supplier", label: "Supplier payables" },
  { value: "receivables", label: "Receivables" },
  { value: "other", label: "Other payables" },
];

const financePaymentMethods = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
  ["gcash", "GCash"],
  ["card", "Card"],
  ["check", "Check"],
  ["other", "Other"],
] as const;

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
  transaction_date: localDate(),
  transaction_time: new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()),
  payment_status: direction === "income" ? "paid" : "unpaid",
  lead_id: "",
  quotation_id: "",
  supplier_payable_id: "",
  commission_allocation_id: "",
});

const statusClass = (value: string) => {
  if (["rejected", "cancelled"].includes(value)) return "bg-[#fef3f2] text-[#b42318]";
  if (["pending", "unpaid"].includes(value)) return "bg-[#fff8e9] text-[#a76605]";
  if (["approved", "paid", "verified"].includes(value)) return "bg-[#edf9f2] text-[#218b55]";
  return "bg-[#f1f4f8] text-[#626b7a]";
};

const primaryButton =
  "button-primary";
const secondaryButton =
  "button-secondary";

type FinanceAction =
  | { kind: "transaction"; id: string; decision: "approved" | "rejected"; label: string }
  | { kind: "budget"; id: string; decision: "approved" | "rejected"; label: string }
  | { kind: "paid"; id: string; label: string }
  | { kind: "funding"; id: string; label: string };

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
          <PdfText>Money In: {peso.format(income)}</PdfText>
          <PdfText>Money Out: {peso.format(expense)}</PdfText>
          <PdfText>Balance: {peso.format(balance)}</PdfText>
        </PdfView>
        <PdfView style={pdfStyles.table}>
          <PdfView style={pdfStyles.headerRow}>
            <PdfText style={pdfStyles.date}>Date</PdfText>
            <PdfText style={pdfStyles.description}>Description</PdfText>
            <PdfText style={pdfStyles.amount}>Type</PdfText>
            <PdfText style={pdfStyles.amount}>Amount</PdfText>
            <PdfText style={pdfStyles.status}>Status</PdfText>
          </PdfView>
          {rows.map((row, index) => (
            <PdfView key={String(row.id ?? index)} style={pdfStyles.row}>
              <PdfText style={pdfStyles.date}>{stringValue(row, "transaction_date")}</PdfText>
              <PdfText style={pdfStyles.description}>{stringValue(row, "note", "Finance transaction")}</PdfText>
              <PdfText style={pdfStyles.amount}>{stringValue(row, "transaction_type")}</PdfText>
              <PdfText style={pdfStyles.amount}>{peso.format(numericValue(row, "amount"))}</PdfText>
              <PdfText style={pdfStyles.status}>{Boolean(row.is_voided) ? "voided" : stringValue(row, "payment_status")}</PdfText>
            </PdfView>
          ))}
        </PdfView>
      </PdfPage>
    </PdfDocument>
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

function FinanceSummaryCard({
  primaryLabel,
  primaryValue,
  primaryDetail,
  children,
}: {
  primaryLabel: string;
  primaryValue: ReactNode;
  primaryDetail?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[#d9e0e9] bg-white p-5">
      <FinanceSummaryLayout primaryLabel={primaryLabel} primaryValue={primaryValue} primaryDetail={primaryDetail}>
        {children}
      </FinanceSummaryLayout>
    </section>
  );
}

function FinanceDialog({
  title,
  detail,
  close,
  children,
  compact = false,
  layer = "base",
}: {
  title: string;
  detail?: string;
  close: () => void;
  children: ReactNode;
  compact?: boolean;
  layer?: "base" | "top";
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
        className={`max-h-[calc(100dvh-2rem)] w-full ${compact ? "max-w-sm" : "max-w-3xl"} overflow-y-auto rounded-lg border border-[#d9e0e9] bg-white p-5`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold text-[#202938]">{title}</h2>
            {detail && <p id={detailId} className="mt-1 text-[12px] text-[#7d8797]">{detail}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-[#687386] hover:text-[#202938]"><X size={18} /></button>
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
  const isDecision = action.kind === "transaction" || action.kind === "budget";
  const isRejection = isDecision && action.decision === "rejected";
  const requiresNote = isRejection || action.kind === "funding";
  const actionLabel = action.kind === "paid"
    ? "Mark paid"
    : action.kind === "funding"
      ? "Void"
      : action.decision === "approved" ? "Approve" : "Reject";

  return (
    <FinanceDialog
      title={`${actionLabel} ${action.label}`}
      detail={action.kind === "funding" ? "This removes the funding amount from the account balance but preserves the audit record." : isDecision ? "Add a note so the financial decision is clear to the next reviewer." : "This changes the settlement status in the finance ledger."}
      close={close}
    >
      {(isDecision || action.kind === "funding") && (
        <label className="field-label mt-5 block">
          {action.kind === "funding" ? "Void reason (required)" : `Decision note${isRejection ? " (required)" : " (optional)"}`}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input mt-1 min-h-24" placeholder={action.kind === "funding" ? "Explain why this funding entry is being voided" : isRejection ? "Explain why this request is being rejected" : "Add context for this approval"} />
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
    <div role="status" className="space-y-4" aria-label="Loading Finance">
      <div className="flex items-center gap-2 rounded-lg border border-[#d9e0e9] bg-white px-4 py-3 text-[12px] text-[#687386]">
        <LoaderCircle size={15} className="animate-spin text-[#c43b43]" />
        Loading Finance workspace…
      </div>
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
}: {
  organizationId: string;
  role: string;
  overviewOnly?: boolean;
}) {
  const client = useMemo(() => createClient(), []);
  const internal = isInternalRole(role);
  const canRequestBudget = role === "external_finance";
  const canSubmitExpense = role === "external_finance";
  const canRecordSupplierCosting = role === "external_finance";
  const financeTabs = useMemo<[Tab, string][]>(
    () => [
      ["transactions", "Transactions"],
      ...(internal ? [["accounts", "Accounts"] as [Tab, string]] : []),
      ["budget", "Budget requests"],
      ...(internal || canRecordSupplierCosting ? [["supplier_costing", "Supplier costing"] as [Tab, string]] : []),
      ...(internal ? [["payables", "Payables"] as [Tab, string]] : []),
    ],
    [canRecordSupplierCosting, internal],
  );
  const [tab, setTab] = useState<Tab>(overviewOnly ? "overview" : "transactions");
  const [payablesSection, setPayablesSection] = useState<PayablesSection>("commission");
  const [payablesPage, setPayablesPage] = useState(1);
  const [budgetPage, setBudgetPage] = useState(1);
  const [supplierCostingPage, setSupplierCostingPage] = useState(1);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [period, setPeriod] = useState<Period>("monthly");
  const [query, setQuery] = useState("");
  const [transactions, setTransactions] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [balances, setBalances] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<Row[]>([]);
  const [leads, setLeads] = useState<Row[]>([]);
  const [quotations, setQuotations] = useState<Row[]>([]);
  const [payables, setPayables] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [commissionAllocations, setCommissionAllocations] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Row[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<Row[]>([]);
  const [accountFundingEntries, setAccountFundingEntries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<FinanceAction | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [transactionDirection, setTransactionDirection] = useState<Direction | null>(null);
  const [expenseMode, setExpenseMode] = useState<ExpenseMode>("regular");
  const [transactionFile, setTransactionFile] = useState<File | null>(null);
  const [transactionValues, setTransactionValues] = useState(defaultTransaction("income"));
  const [categoryDraft, setCategoryDraft] = useState({ name: "", expense_class: "operating" });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFile, setAccountFile] = useState<File | null>(null);
  const [accountValues, setAccountValues] = useState({ name: "", type: "bank", number: "", opening_balance: "", payment_method: "bank_transfer", is_default_for_payment_method: true });
  const [accountFundingOpen, setAccountFundingOpen] = useState(false);
  const [accountFundingFile, setAccountFundingFile] = useState<File | null>(null);
  const [accountFundingValues, setAccountFundingValues] = useState({ account_id: "", amount: "", funding_source: "owner_funding", funding_date: localDate(), note: "" });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetValues, setBudgetValues] = useState({ amount: "", note: "" });
  const [supplierCostOpen, setSupplierCostOpen] = useState(false);
  const [supplierCostValues, setSupplierCostValues] = useState({ supplier_id: "", quotation_id: "", lead_id: "", description: "", amount: "", due_date: "", notes: "" });

  useEffect(() => {
    if (overviewOnly || tab === "overview" || financeTabs.some(([value]) => value === tab)) return;
    setTab(financeTabs[0]?.[0] ?? "transactions");
  }, [financeTabs, overviewOnly, tab]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const requests = await Promise.all([
        client.from("finance_transactions").select("*").eq("organization_id", organizationId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
        client.from("finance_categories").select("*").eq("organization_id", organizationId).eq("is_active", true).order("direction").order("name"),
        client.from("finance_accounts").select("*").eq("organization_id", organizationId).eq("is_active", true).order("account_name"),
        client.from("finance_account_balances").select("*").eq("organization_id", organizationId).order("account_name"),
        client.from("finance_budget_requests").select("*").eq("organization_id", organizationId).order("requested_at", { ascending: false }),
        client.from("leads").select("id,lead_no,client_name,contact_name,phone,email,project_name").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        client.from("quotations").select("id,quotation_no,project_name,client_name,lead_id,customer_id,document_type,status,total_amount").eq("organization_id", organizationId).in("document_type", ["price_quotation", "mockup_quotation"]).order("created_at", { ascending: false }),
        client.from("supplier_payables").select("*").eq("organization_id", organizationId).order("due_date", { ascending: true }),
        client.from("suppliers").select("id,company_name").eq("organization_id", organizationId).order("company_name"),
        client.from("commission_summary_allocations").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        client.from("profiles").select("id,full_name"),
        client.from("quotation_payment_records").select("quotation_id,status,amount,verified_at").eq("organization_id", organizationId).eq("status", "verified"),
        client.from("finance_account_funding_entries").select("*").eq("organization_id", organizationId).order("funding_date", { ascending: false }).order("created_at", { ascending: false }),
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
      setPayables((requests[7].data ?? []) as Row[]);
      setSuppliers((requests[8].data ?? []) as Row[]);
      const loadedAllocations = (requests[9].data ?? []) as Row[];
      setCommissionAllocations(loadedAllocations);
      setProfiles((requests[10].data ?? []) as Row[]);
      setPaymentRecords((requests[11].data ?? []) as Row[]);
      setAccountFundingEntries((requests[12].data ?? []) as Row[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Finance data could not load.");
    } finally {
      setHasLoadedOnce(true);
      setLoading(false);
    }
  }, [client, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCategories = useMemo(
    () => categories.filter((category) => stringValue(category, "direction") === (transactionDirection ?? "income")),
    [categories, transactionDirection],
  );

  const categoryOptions = useMemo<SearchableOption[]>(
    () => activeCategories.map((category) => ({
      value: String(category.id),
      label: `${stringValue(category, "name")}${transactionDirection === "expense" ? ` · ${stringValue(category, "expense_class").replaceAll("_", " ")}` : ""}`,
      searchText: [stringValue(category, "name"), stringValue(category, "expense_class")].join(" "),
    })),
    [activeCategories, transactionDirection],
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
    () => accounts.map((account) => ({
      value: String(account.id),
      label: `${stringValue(account, "account_name")} · ${stringValue(account, "account_type").replaceAll("_", " ")}`,
      searchText: [stringValue(account, "account_name"), stringValue(account, "account_number"), stringValue(account, "payment_method")].join(" "),
    })),
    [accounts],
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

  const eligibleCommissionOptions = useMemo<SearchableOption[]>(
    () => eligibleCommissionAllocationsForOptions.map((allocation) => ({
      value: String(allocation.id),
      label: `${quotationName(allocation.quotation_id)} · ${profileName(allocation.recipient_user_id)} · ${stringValue(allocation, "allocation_role").replaceAll("_", " ")} · ${peso.format(numericValue(allocation, "amount"))}`,
      searchText: [quotationName(allocation.quotation_id), profileName(allocation.recipient_user_id), stringValue(allocation, "allocation_role")].join(" "),
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

  const periodRange = useMemo(() => {
    if (period === "all") return { start: "", end: "" };
    const today = localDate();
    const [year, month, date] = today.split("-").map(Number);
    if (period === "yearly") return { start: `${year}-01-01`, end: today };
    if (period === "monthly") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
    const current = new Date(Date.UTC(year, month - 1, date));
    const day = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() - day + 1);
    return { start: current.toISOString().slice(0, 10), end: today };
  }, [period]);
  const periodStart = periodRange.start;
  const periodEnd = periodRange.end;

  const periodTransactions = useMemo(
    () => transactions.filter((transaction) => {
      const transactionDate = stringValue(transaction, "transaction_date");
      if (periodStart && transactionDate < periodStart) return false;
      if (periodEnd && transactionDate > periodEnd) return false;
      return true;
    }),
    [periodEnd, periodStart, transactions],
  );

  const filteredTransactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return periodTransactions.filter((transaction) => {
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
        stringValue(transaction, "payment_status"),
        stringValue(transaction, "approval_status"),
        stringValue(suppliers.find((item) => item.id === payable?.supplier_id), "company_name"),
      ].join(" ").toLowerCase().includes(normalized);
    });
  }, [accounts, categories, leads, payables, periodTransactions, query, quotations, suppliers]);

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
    () => periodTransactions.reduce<{ income: number; expense: number }>(
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
    [periodTransactions],
  );
  const pendingApprovals = useMemo(
    () => transactions.filter((transaction) => (
      !Boolean(transaction.is_voided)
      && stringValue(transaction, "transaction_type") === "expense"
      && stringValue(transaction, "approval_status") === "pending"
    )).length,
    [transactions],
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
  const receivables = useMemo(
    () => transactions.filter((transaction) => !Boolean(transaction.is_voided) && stringValue(transaction, "transaction_type") === "income" && stringValue(transaction, "payment_status") === "unpaid"),
    [transactions],
  );
  const transactionPayables = useMemo(
    () => transactions.filter((transaction) => !Boolean(transaction.is_voided) && stringValue(transaction, "transaction_type") === "expense" && stringValue(transaction, "approval_status") === "approved" && stringValue(transaction, "payment_status") === "unpaid"),
    [transactions],
  );
  const payablesRowsBySection = useMemo<Record<PayablesSection, Row[]>>(
    () => ({
      commission: commissionAllocations.filter((allocation) => stringValue(allocation, "status") !== "not_applicable"),
      supplier: payables.filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status"))),
      receivables,
      other: transactionPayables,
    }),
    [commissionAllocations, payables, receivables, transactionPayables],
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
  const openSupplierBalance = useMemo(
    () => payables.reduce((total, payable) => {
      if (["paid", "cancelled"].includes(stringValue(payable, "status"))) return total;
      return total + Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0);
    }, 0),
    [payables],
  );
  const openLedgerPayableBalance = useMemo(
    () => transactionPayables.reduce((total, transaction) => total + numericValue(transaction, "amount"), 0),
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
          || ["rejected", "cancelled"].includes(stringValue(transaction, "approval_status"))
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
  const netBalance = periodTotals.income - periodTotals.expense;
  const periodLabel = period === "weekly" ? "This week" : period === "monthly" ? "This month" : period === "yearly" ? "This year" : "All time";

  const accountBalance = (accountId: string) => numericValue(balances.find((balance) => balance.id === accountId), "current_balance");
  const commissionPayoutMode = internal && Boolean(transactionValues.commission_allocation_id);
  const supplierPaymentMode = !internal && transactionDirection === "expense" && expenseMode === "supplier";

  const chooseExpenseMode = (mode: ExpenseMode) => {
    setExpenseMode(mode);
    setTransactionValues((current) => ({
      ...current,
      supplier_payable_id: "",
      quotation_id: "",
      lead_id: "",
    }));
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

  const setFormDirection = (direction: Direction) => {
    setTransactionDirection(direction);
    setExpenseMode("regular");
    setTransactionValues(defaultTransaction(direction));
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

  const saveTransaction = async () => {
    if (!transactionDirection || !transactionFile) return setErrorMessage("Upload the transaction receipt image.");
    if (!internal && (transactionDirection !== "expense" || !canSubmitExpense)) return setErrorMessage("External Finance can submit Money Out only.");
    if (!internal && transactionValues.payment_status !== "unpaid") return setErrorMessage("External Finance submissions must remain unpaid until Internal Finance confirms the payment.");
    if (supplierPaymentMode && !transactionValues.supplier_payable_id) return setErrorMessage("Choose an open supplier payable.");
    if (!transactionValues.amount || Number(transactionValues.amount) <= 0) return setErrorMessage("Enter an amount greater than zero.");
    if (!transactionValues.category_id || (internal && !transactionValues.account_id)) return setErrorMessage(internal ? "Choose a category and payment account." : "Choose an expense category.");
    const selectedAllocation = eligibleCommissionAllocations.find((allocation) => allocation.id === transactionValues.commission_allocation_id);
    if (internal && (!selectedAllocation || transactionDirection !== "expense")) return setErrorMessage("Internal Finance can create Money Out only through an eligible commission payout.");
    if (transactionValues.commission_allocation_id && !selectedAllocation) return setErrorMessage("That commission allocation is not yet eligible for payment.");
    if (!internal && !selectedAllocation && Number(transactionValues.amount) > approvedBudgetRemainingTotal + 0.001) return setErrorMessage(`This expense is higher than the available budget of ${peso.format(approvedBudgetRemainingTotal)}. Request a new budget before submitting it.`);
    setSaving(true);
    const transactionId = crypto.randomUUID();
    const path = `${organizationId}/transactions/${transactionId}.${extensionFor(transactionFile)}`;
    try {
      await uploadReceipt(transactionFile, path);
      const transactionPayload = {
        p_transaction_id: transactionId,
        p_transaction_type: transactionDirection,
        p_amount: Number(transactionValues.amount),
        p_category_id: transactionValues.category_id,
        p_account_id: transactionValues.account_id || null,
        p_note: transactionValues.note.trim() || null,
        p_transaction_date: transactionValues.transaction_date,
        p_transaction_time: transactionValues.transaction_time || null,
        p_payment_status: transactionValues.payment_status,
        p_lead_id: transactionValues.lead_id || null,
        p_customer_id: null,
        p_quotation_id: transactionValues.quotation_id || String(selectedAllocation?.quotation_id ?? "") || null,
        p_supplier_payable_id: supplierPaymentMode ? transactionValues.supplier_payable_id || null : null,
        p_commission_summary_id: null,
        p_receipt_storage_path: path,
        p_receipt_file_name: transactionFile.name,
        p_receipt_content_type: transactionFile.type,
        p_receipt_file_size: transactionFile.size,
      };
      const result = selectedAllocation
        ? await client.rpc("create_finance_transaction_with_commission_allocation", {
            ...transactionPayload,
            p_commission_summary_id: null,
            p_supplier_payable_id: null,
            p_commission_allocation_id: selectedAllocation.id,
          })
        : await client.rpc("create_finance_transaction", transactionPayload);
      if (result.error) throw result.error;
      setMessage(transactionDirection === "expense" && !internal ? "Money Out submitted for Internal Finance approval." : "Finance transaction saved.");
      setTransactionDirection(null);
      setTransactionFile(null);
      await load();
    } catch (error) {
      await removeReceipt(path);
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

  const openAccountFunding = (accountId = "") => {
    setAccountFundingValues({ account_id: accountId, amount: "", funding_source: "owner_funding", funding_date: localDate(), note: "" });
    setAccountFundingFile(null);
    setAccountFundingOpen(true);
  };

  const saveAccount = async () => {
    if (!accountValues.name.trim() || !accountFile) return setErrorMessage("Enter an account name and upload its receipt image.");
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
        p_payment_method: accountValues.payment_method,
        p_is_default_for_payment_method: accountValues.is_default_for_payment_method,
      });
      if (error) throw error;
      setAccountOpen(false);
      setAccountFile(null);
      setAccountValues({ name: "", type: "bank", number: "", opening_balance: "", payment_method: "bank_transfer", is_default_for_payment_method: true });
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

  const saveBudget = async () => {
    if (!budgetValues.amount || Number(budgetValues.amount) <= 0) return setErrorMessage("Enter a budget amount greater than zero.");
    setSaving(true);
    const { error } = await client.rpc("create_finance_budget_request", {
      p_amount: Number(budgetValues.amount),
      p_note: budgetValues.note.trim() || null,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setBudgetOpen(false);
    setBudgetValues({ amount: "", note: "" });
    setMessage("Budget request submitted.");
    await load();
  };

  const reviewTransaction = async (transactionId: string, decision: "approved" | "rejected", decisionNote: string | null = null) => {
    setSaving(true);
    const { error } = await client.rpc("review_finance_transaction", {
      p_transaction_id: transactionId,
      p_decision: decision,
      p_decision_note: decisionNote,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    setMessage(`Money Out ${decision}.`);
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

  const assignAccount = async (transactionId: string, accountId: string) => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await client.rpc("assign_finance_transaction_account", {
      p_transaction_id: transactionId,
      p_account_id: accountId,
    });
    setSaving(false);
    if (error) return setErrorMessage(error.message);
    setMessage("Automatic Money In reconciled to the selected account.");
    await load();
  };

  const reviewBudget = async (requestId: string, decision: "approved" | "rejected", decisionNote: string | null = null) => {
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
    setMessage(`Budget request ${decision}.`);
    await load();
    return true;
  };

  const requestTransactionReview = (transactionId: string, decision: "approved" | "rejected") => {
    setDecisionNote("");
    setPendingAction({ kind: "transaction", id: transactionId, decision, label: "Money Out" });
  };

  const requestBudgetReview = (requestId: string, decision: "approved" | "rejected") => {
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

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const requiresNote = pendingAction.kind === "funding"
      || ((pendingAction.kind === "transaction" || pendingAction.kind === "budget") && pendingAction.decision === "rejected");
    if (requiresNote && !decisionNote.trim()) {
      setErrorMessage(pendingAction.kind === "funding" ? "Add a reason before voiding this funding entry." : "Add a decision note before rejecting this request.");
      return;
    }
    let succeeded = false;
    if (pendingAction.kind === "transaction") {
      succeeded = await reviewTransaction(pendingAction.id, pendingAction.decision, decisionNote.trim() || null);
    } else if (pendingAction.kind === "budget") {
      succeeded = await reviewBudget(pendingAction.id, pendingAction.decision, decisionNote.trim() || null);
    } else if (pendingAction.kind === "funding") {
      succeeded = await voidAccountFunding(pendingAction.id, decisionNote.trim());
    } else {
      succeeded = await markPaid(pendingAction.id);
    }
    if (succeeded) {
      setPendingAction(null);
      setDecisionNote("");
    }
  };

  const openReceipt = async (path: string, bucket = "finance-receipts") => {
    const receiptWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      receiptWindow?.close();
      return setErrorMessage(error?.message ?? "The receipt could not be opened.");
    }
    if (receiptWindow) receiptWindow.location.href = data.signedUrl;
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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
          period={period}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `huswell-finance-${period}.pdf`;
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
      {!overviewOnly && (
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

      {loading && !hasLoadedOnce ? <FinanceLoadingState cardCount={internal ? 4 : 3} /> : <>
      {tab === "overview" && (
        <>
          {internal ? (
            <FinanceSummaryCard primaryLabel="Balance" primaryValue={peso.format(netBalance)} primaryDetail={periodLabel}>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <FinanceSummaryMetric label="Total income" value={peso.format(periodTotals.income)} color="text-[#218b55]" />
                <FinanceSummaryMetric label="Total expenses" value={peso.format(periodTotals.expense)} color="text-[#b42318]" />
                <div className="border-t border-[#edf0f5] pt-4 sm:col-span-2">
                  <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <FinanceSummaryMetric label="Cash balance" value={peso.format(currentCashBalance)} />
                    <FinanceSummaryMetric label="Pending approvals" value={String(pendingApprovals)} color="text-[#a76605]" />
                    <FinanceSummaryMetric label="Open receivables" value={peso.format(receivables.reduce((total, transaction) => total + numericValue(transaction, "amount"), 0))} color="text-[#218b55]" />
                    <FinanceSummaryMetric label="Open payables" value={peso.format(openSupplierBalance + openLedgerPayableBalance)} color="text-[#b42318]" />
                  </div>
                </div>
              </div>
            </FinanceSummaryCard>
          ) : (
            <FinanceSummaryCard primaryLabel="Balance" primaryValue={peso.format(netBalance)} primaryDetail={periodLabel}>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <FinanceSummaryMetric label="Total income" value={peso.format(periodTotals.income)} color="text-[#218b55]" />
                <FinanceSummaryMetric label="Total expenses" value={peso.format(periodTotals.expense)} color="text-[#b42318]" />
                <FinanceSummaryMetric label="Available budget" value={peso.format(approvedBudgetRemainingTotal)} color="text-[#a76605]" detail={`${peso.format(approvedBudgetTotal)} approved total`} />
              </div>
            </FinanceSummaryCard>
          )}
          <Panel
            title="Recent transactions"
            action={(
              <div className="flex w-full flex-wrap gap-2 md:w-auto">
                <div className="grid min-w-0 flex-1 gap-2 md:w-[344px] md:flex-none md:grid-cols-[125px_minmax(0,1fr)]">
                  <select value={period} onChange={(event) => { setPeriod(event.target.value as Period); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]"><option value="weekly">This week</option><option value="monthly">This month</option><option value="yearly">This year</option><option value="all">All time</option></select>
                  <label className="relative block min-w-0"><Search size={15} className="search-icon pointer-events-none absolute left-3 text-[#8b92a1]" /><input value={query} onChange={(event) => { setQuery(event.target.value); setTransactionsPage(1); }} className="input mt-0 w-full search-input text-[12px]" placeholder="Search transactions" /></label>
                </div>
                <button type="button" onClick={downloadReport} disabled={saving || loading} className={`${secondaryButton} shrink-0`}><Download size={13} /> Download PDF</button>
              </div>
            )}
          >
            <TransactionTable rows={filteredTransactions.slice(0, 8)} categoryName={categoryName} accountName={accountName} leadName={leadName} budgetLabel={budgetLabel} accounts={accounts} internal={internal} reviewTransaction={requestTransactionReview} markPaid={requestMarkPaid} assignAccount={assignAccount} openReceipt={openReceipt} saving={saving} />
          </Panel>
        </>
      )}

      {tab === "transactions" && (
        <Panel title="All transactions" detail="Search, filter, approve, and monitor the finance ledger.">
          <div className="flex flex-col gap-3 border-b border-[#edf0f5] p-4 md:flex-row md:items-center md:justify-between">
            <div className="grid w-full gap-2 md:w-[344px] md:grid-cols-[125px_minmax(0,1fr)]"><select value={period} onChange={(event) => { setPeriod(event.target.value as Period); setTransactionsPage(1); }} className="input mt-0 min-w-0 text-[12px]"><option value="weekly">This week</option><option value="monthly">This month</option><option value="yearly">This year</option><option value="all">All time</option></select><label className="relative block min-w-0"><Search size={15} className="search-icon pointer-events-none absolute left-3 text-[#8b92a1]" /><input value={query} onChange={(event) => { setQuery(event.target.value); setTransactionsPage(1); }} className="input mt-0 w-full search-input text-[12px]" placeholder="Search" /></label></div>
            <div className="flex flex-wrap gap-2 md:shrink-0">{canSubmitExpense && <button type="button" onClick={() => setFormDirection("expense")} className={primaryButton}><Plus size={13} /> Submit Money Out</button>}</div>
          </div>
          <TransactionTable rows={visibleTransactions} categoryName={categoryName} accountName={accountName} leadName={leadName} budgetLabel={budgetLabel} accounts={accounts} internal={internal} reviewTransaction={requestTransactionReview} markPaid={requestMarkPaid} assignAccount={assignAccount} openReceipt={openReceipt} saving={saving} />
          <TablePagination page={activeTransactionsPage} pageCount={transactionPageCount} total={filteredTransactions.length} onPageChange={setTransactionsPage} label="Finance transactions pagination" />
        </Panel>
      )}

      {tab === "accounts" && (
        <Panel
          title="Bank and e-wallet accounts"
          detail="Internal Finance manages payment accounts, opening balances, and later account funding. Funding changes cash but is not counted as customer income."
          action={internal ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openAccountFunding()} className={secondaryButton}><Plus size={13} /> Add funds</button>
              <button type="button" onClick={() => setAccountOpen(true)} className={primaryButton}><Plus size={13} /> Add account</button>
            </div>
          ) : undefined}
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => <div key={String(account.id)} className="rounded-lg border border-[#d9e0e9] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-semibold text-[#202938]">{stringValue(account, "account_name")}</p><p className="mt-1 text-[11px] capitalize text-[#7d8797]">{stringValue(account, "account_type").replaceAll("_", " ")} {stringValue(account, "account_number") || "No identifier"}</p><p className="mt-1 text-[10px] text-[#8b92a1]">Payments: {stringValue(account, "payment_method", "other").replaceAll("_", " ")}{Boolean(account.is_default_for_payment_method) ? " · Default" : ""}</p></div><Wallet size={17} className="text-[#c43b43]" /></div><p className="mt-4 text-lg font-semibold text-[#202938]">{peso.format(accountBalance(String(account.id)))}</p><p className="mt-1 text-[10px] text-[#8b92a1]">Opening balance: {peso.format(numericValue(account, "opening_balance"))}</p>{stringValue(account, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(account, "receipt_storage_path"))} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#c43b43]"><ReceiptText size={13} /> View receipt</button>}</div>)}
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
        <Panel title="Budget" detail="Approved budget requests are consolidated here. Every External Finance Money Out uses the available approved budget automatically." action={canRequestBudget ? <button type="button" onClick={() => setBudgetOpen(true)} className={primaryButton}><Plus size={13} /> Request budget</button> : undefined}>
          <div className="border-b border-[#edf0f5] p-4 sm:p-5">
            <FinanceSummaryLayout primaryLabel="Available budget" primaryValue={peso.format(approvedBudgetRemainingTotal)} primaryDetail="Available for Money Out">
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
          <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[760px]"><thead><tr><th>Requested</th><th>Amount</th><th>Note</th><th>Status</th><th>Action</th></tr></thead><tbody>{visibleBudgets.map((budget) => <tr key={String(budget.id)}><td>{displayDate(stringValue(budget, "requested_at"))}</td><td className="font-semibold">{peso.format(numericValue(budget, "amount"))}</td><td>{stringValue(budget, "note", "—")}</td><td><StatusPill value={stringValue(budget, "status")} /></td><td>{internal && stringValue(budget, "status") === "pending" ? <span className="flex gap-1"><button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "approved")} className="icon-button text-[#218b55]" title="Approve budget"><Check size={15} /></button><button type="button" disabled={saving} onClick={() => requestBudgetReview(String(budget.id), "rejected")} className="icon-button text-[#b42318]" title="Reject budget"><XCircle size={15} /></button></span> : "—"}</td></tr>)}{!budgets.length && <tr><td colSpan={5} className="text-center text-[#7d8797]">No budget requests yet.</td></tr>}</tbody></table></div>
          <TablePagination page={activeBudgetPage} pageCount={budgetPageCount} total={budgets.length} onPageChange={setBudgetPage} label="Budget requests pagination" />
        </Panel>
      )}

      {tab === "supplier_costing" && (
        <Panel title="Supplier Costing logbook" detail="External Finance records supplier obligations here. These entries become Money Out only when an actual supplier payment is made." action={canRecordSupplierCosting ? <button type="button" onClick={() => setSupplierCostOpen(true)} className={primaryButton}><Plus size={13} /> Log supplier cost</button> : undefined}>
          <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Supplier</th><th>Quotation</th><th>Name / Company</th><th>Description</th><th>Total cost</th><th>Paid</th><th>Remaining</th><th>Due</th><th>Status</th></tr></thead><tbody>{visibleSupplierCostingRows.map((payable) => { const linkedLead = stringValue(payable, "lead_id"); const linkedQuotation = quotations.find((quotation) => quotation.id === payable.quotation_id); const nameCompany = stringValue(linkedQuotation, "client_name") || leadName(linkedLead); return <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}</td><td>{quotationName(payable.quotation_id)}</td><td>{nameCompany || "—"}</td><td>{stringValue(payable, "description", "—")}</td><td className="font-semibold">{peso.format(numericValue(payable, "amount"))}</td><td>{peso.format(numericValue(payable, "amount_paid"))}</td><td className="font-semibold text-[#b42318]">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td>{displayDate(payable.due_date)}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>; })}{!supplierCostingRows.length && <tr><td colSpan={9} className="text-center text-[#7d8797]">No supplier costing entries yet.</td></tr>}</tbody></table></div>
          <TablePagination page={activeSupplierCostingPage} pageCount={supplierCostingPageCount} total={supplierCostingRows.length} onPageChange={setSupplierCostingPage} label="Supplier costing pagination" />
        </Panel>
      )}

      {tab === "payables" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[#d9e0e9] bg-[#f8fafc] p-1" role="tablist" aria-label="Payables categories">
            <div className="flex gap-1 overflow-x-auto">
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
                    onClick={() => {
                      setPayablesSection(value);
                      setPayablesPage(1);
                    }}
                    className={`inline-flex min-h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-[11px] font-semibold transition-colors ${active ? "border-[#c43b43] bg-white text-[#a92f37]" : "border-transparent text-[#687386] hover:border-[#d9e0e9] hover:bg-white"}`}
                  >
                    {label}
                    <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-[#f8e4e5] text-[#a92f37]" : "bg-white text-[#687386]"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

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
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[920px]"><thead><tr><th>Quotation</th><th>Name / Company</th><th>Recipient</th><th>Role</th><th>Amount</th><th>Eligible</th><th>Status</th></tr></thead><tbody>{visiblePayablesRows.map((allocation) => { const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id")); const eligibleAt = verifiedAt ? new Date(new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000) : null; const eligible = Boolean(eligibleAt && currentTime >= eligibleAt.getTime()); const roleLabel = stringValue(allocation, "allocation_role").replaceAll("_", " "); return <tr key={String(allocation.id)}><td>{quotationName(allocation.quotation_id)}</td><td>{stringValue(quotations.find((quotation) => quotation.id === allocation.quotation_id), "client_name", "—")}</td><td>{profileName(allocation.recipient_user_id)}</td><td className="capitalize">{roleLabel}</td><td className="font-semibold text-[#b42318]">{peso.format(numericValue(allocation, "amount"))}</td><td>{eligible ? <StatusPill value="approved" /> : <span className="text-[11px] text-[#a76605]">{eligibleAt ? displayDate(eligibleAt) : "Awaiting verified payment"}</span>}</td><td><StatusPill value={stringValue(allocation, "status")} /></td></tr>; })}{!activePayablesRows.length && <tr><td colSpan={7} className="text-center text-[#7d8797]">No commission allocations yet.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}

          {payablesSection === "supplier" && (
            <div id="payables-panel-supplier" role="tabpanel" aria-labelledby="payables-tab-supplier">
          <Panel title="Supplier payables" detail="Confirmed supplier obligations remain payable until paid.">
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[650px]"><thead><tr><th>Supplier</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead><tbody>{visiblePayablesRows.map((payable) => <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}<small>{stringValue(payable, "payable_no")}</small></td><td>{displayDate(payable.due_date)}</td><td className="font-semibold">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>)}{!activePayablesRows.length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open supplier payables.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}

          {payablesSection === "receivables" && (
            <div id="payables-panel-receivables" role="tabpanel" aria-labelledby="payables-tab-receivables">
          <Panel title="Receivables" detail="Money In is created automatically after Internal Finance verifies a client payment. Legacy unpaid entries remain for review only.">
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[650px]"><thead><tr><th>Name / Company</th><th>Category</th><th>Amount</th><th>Action</th></tr></thead><tbody>{visiblePayablesRows.map((transaction) => <tr key={String(transaction.id)}><td>{leadName(transaction.lead_id)}<small>{displayDate(transaction.transaction_date)}</small></td><td>{categoryName(transaction.category_id)}</td><td className="font-semibold text-[#218b55]">{peso.format(numericValue(transaction, "amount"))}</td><td>—</td></tr>)}{!activePayablesRows.length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open receivables.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}

          {payablesSection === "other" && (
            <div id="payables-panel-other" role="tabpanel" aria-labelledby="payables-tab-other">
          <Panel title="Other payables" detail="Approved unpaid Money Out remains a payable until settlement.">
            <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[650px]"><thead><tr><th>Category</th><th>Note</th><th>Amount</th><th>Action</th></tr></thead><tbody>{visiblePayablesRows.map((transaction) => <tr key={String(transaction.id)}><td>{categoryName(transaction.category_id)}<small>{displayDate(transaction.transaction_date)}</small></td><td>{stringValue(transaction, "note", "—")}</td><td className="font-semibold text-[#b42318]">{peso.format(numericValue(transaction, "amount"))}</td><td>{internal ? <button type="button" disabled={saving} onClick={() => requestMarkPaid(String(transaction.id), "Money Out")} className="button-secondary text-[10px]">Mark paid</button> : "—"}</td></tr>)}{!activePayablesRows.length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open ledger payables.</td></tr>}</tbody></table></div>
          </Panel>
          <TablePagination page={activePayablesPage} pageCount={payablesPageCount} total={activePayablesRows.length} onPageChange={setPayablesPage} label="Payables pagination" />
            </div>
          )}
        </div>
      )}

      </>}

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
        <FinanceDialog title={commissionPayoutMode ? "Pay commission" : "Submit Money Out"} detail={commissionPayoutMode ? "Create a controlled commission payout after full quotation payment and the three-day hold." : supplierPaymentMode ? "Submit a supplier payment for Internal Finance approval." : "Submit a regular expense for Internal Finance approval."} close={() => setTransactionDirection(null)}>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {!internal && transactionDirection === "expense" && (
              <fieldset className="field-label sm:col-span-2">
                <legend>Expense type</legend>
                <div role="group" aria-label="Expense type" className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1">
                  <button type="button" aria-pressed={expenseMode === "regular"} onClick={() => chooseExpenseMode("regular")} className={expenseMode === "regular" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Regular expense</button>
                  <button type="button" aria-pressed={expenseMode === "supplier"} onClick={() => chooseExpenseMode("supplier")} className={expenseMode === "supplier" ? "flex-1 rounded-md bg-[#c43b43] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#a92f37]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797] hover:bg-white"}>Supplier payment</button>
                </div>
              </fieldset>
            )}
            <label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={transactionValues.amount} onChange={(value) => setTransactionValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label>
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
            {internal && <label className="field-label">
              Payment account
              <SearchableSelect options={accountOptions} value={transactionValues.account_id} onChange={(value) => setTransactionValues((current) => ({ ...current, account_id: value }))} placeholder={accounts.length ? "Choose account" : "No Finance account available"} searchPlaceholder="Search accounts" ariaLabel="Payment method / account" required clearable={false} disabled={!accounts.length} className="mt-1" />
              {!accounts.length && <small className="mt-1 block text-[#a76605]">Add an account before paying a commission.</small>}
            </label>}
            {(!supplierPaymentMode || internal) && <label className="field-label">Name / Company from Leads<SearchableLeadSelect options={leadOptions} value={transactionValues.lead_id} onChange={(value) => setTransactionValues((current) => ({ ...current, lead_id: value }))} placeholder="Not linked" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Name / Company from Leads" className="mt-1" /></label>}
            <label className="field-label">Date<input type="date" value={transactionValues.transaction_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_date: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label">Time<input type="time" value={transactionValues.transaction_time} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_time: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label sm:col-span-2">Note<textarea value={transactionValues.note} onChange={(event) => setTransactionValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder="Add a note" /></label>
            {internal && <div className="field-label"><span>Payment status</span><div className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1"><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "paid" }))} className={transactionValues.payment_status === "paid" ? "flex-1 rounded-md bg-[#edf9f2] px-3 py-2 text-[11px] font-semibold text-[#218b55]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Paid</button><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "unpaid" }))} className={transactionValues.payment_status === "unpaid" ? "flex-1 rounded-md bg-[#fff8e9] px-3 py-2 text-[11px] font-semibold text-[#a76605]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Unpaid</button></div></div>}
            <div className="field-label"><span>Receipt image</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose finance receipt image" className="mt-1" emptyLabel="Choose receipt image" files={transactionFile ? [transactionFile] : []} onFilesSelected={(files) => setTransactionFile(files[0] ?? null)} /></div>
            {transactionDirection === "expense" && <>
              {!commissionPayoutMode && !internal && <div className="field-label sm:col-span-2">
                <span>Budget</span>
                <div className="mt-1 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="text-xl font-semibold text-[#202938]">{peso.format(approvedBudgetRemainingTotal)}</strong>
                    <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#218b55]">Available</span>
                  </div>
                  {!approvedBudgetRemainingTotal && <p className="mt-2 text-[11px] font-semibold text-[#b42318]">No available approved budget. Request a budget before submitting Money Out.</p>}
                </div>
              </div>}
              {internal && <label className="field-label">
                Commission payout allocation
                <SearchableSelect options={eligibleCommissionOptions} value={transactionValues.commission_allocation_id} onChange={(value) => setTransactionValues((current) => ({ ...current, commission_allocation_id: value }))} placeholder="Choose eligible commission" searchPlaceholder="Search commission allocations" ariaLabel="Commission payout allocation" disabled={commissionPayoutMode} clearable={!commissionPayoutMode} className="mt-1" />
                {!eligibleCommissionOptions.length && <small className="mt-1 block text-[#7d8797]">No commission allocation is currently eligible.</small>}
              </label>}

            </>}
          </div>
          {internal && (
          <div className="mt-4 rounded-lg border border-[#edf0f5] bg-[#fafbfc] p-3"><p className="text-[11px] font-semibold text-[#344054]">Add a custom {transactionDirection} category</p><div className="mt-2 flex flex-wrap gap-2"><input value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} className="input min-w-[200px] flex-1 text-[12px]" placeholder="Category name" />{transactionDirection === "expense" && <select value={categoryDraft.expense_class} onChange={(event) => setCategoryDraft((current) => ({ ...current, expense_class: event.target.value }))} className="input text-[12px]"><option value="operating">Operating Expense</option><option value="non_operating">Non Operating Expense</option></select>}<button type="button" onClick={() => void saveCategory()} disabled={saving} className="button-secondary">Add category</button></div><div className="mt-3 flex flex-wrap gap-1.5">{activeCategories.filter((category) => !Boolean(category.is_system)).map((category) => <button key={String(category.id)} type="button" onClick={() => void archiveCategory(category)} className="inline-flex items-center gap-1 rounded-full border border-[#d9e0e9] px-2 py-1 text-[10px] text-[#687386] hover:border-[#f2b8b5] hover:text-[#b42318]">{stringValue(category, "name")} <X size={11} /></button>)}</div></div>
          )}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTransactionDirection(null)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveTransaction()} disabled={saving || (!internal && !commissionPayoutMode && approvedBudgetRemainingTotal <= 0) || (supplierPaymentMode && !transactionValues.supplier_payable_id) || (internal && (!accounts.length || !transactionValues.commission_allocation_id))} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} {saving ? "Saving..." : commissionPayoutMode ? "Create commission payout" : supplierPaymentMode ? "Submit supplier payment" : "Submit regular expense"}</button></div>
        </FinanceDialog>
      )}

      {canRecordSupplierCosting && supplierCostOpen && (
        <FinanceDialog
          title="Log supplier costing"
          detail="This records an amount owed to a supplier. It does not reduce cash until a linked Money Out is paid and approved."
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
                options={quotationOptions}
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
            <label className="field-label">Account<select value={accountFundingValues.account_id} onChange={(event) => setAccountFundingValues((current) => ({ ...current, account_id: event.target.value }))} className="input mt-1"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")} · {stringValue(account, "account_number", "No identifier")}</option>)}</select></label>
            <label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={accountFundingValues.amount} onChange={(value) => setAccountFundingValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label>
            <label className="field-label">Funding source<select value={accountFundingValues.funding_source} onChange={(event) => setAccountFundingValues((current) => ({ ...current, funding_source: event.target.value }))} className="input mt-1">{accountFundingSources.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field-label">Date<input type="date" value={accountFundingValues.funding_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setAccountFundingValues((current) => ({ ...current, funding_date: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label sm:col-span-2">Note<textarea value={accountFundingValues.note} onChange={(event) => setAccountFundingValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder="Explain where the funds came from" /></label>
            <div className="field-label sm:col-span-2"><span>Proof of funding</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose account funding receipt image" className="mt-1" emptyLabel="Choose receipt image" files={accountFundingFile ? [accountFundingFile] : []} onFilesSelected={(files) => setAccountFundingFile(files[0] ?? null)} /></div>
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAccountFundingOpen(false)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveAccountFunding()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Save funding</button></div>
        </FinanceDialog>
      )}

      {accountOpen && <FinanceDialog title="Add bank or e-wallet account" detail="Internal Finance owns the account directory and opening balances." close={() => setAccountOpen(false)}><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="field-label">Account name<input value={accountValues.name} onChange={(event) => setAccountValues((current) => ({ ...current, name: event.target.value }))} className="input mt-1" placeholder="Example: BDO Operating Account" /></label><label className="field-label">Account type<select value={accountValues.type} onChange={(event) => setAccountValues((current) => ({ ...current, type: event.target.value }))} className="input mt-1"><option value="bank">Bank</option><option value="e_wallet">E-wallet</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label className="field-label">Payment method mapping<select value={accountValues.payment_method} onChange={(event) => setAccountValues((current) => ({ ...current, payment_method: event.target.value }))} className="input mt-1">{financePaymentMethods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field-label">Account number / identifier<input value={accountValues.number} onChange={(event) => setAccountValues((current) => ({ ...current, number: event.target.value }))} className="input mt-1" /></label><label className="field-label">Opening amount<NumberInput min="0" step="0.01" value={accountValues.opening_balance} onChange={(value) => setAccountValues((current) => ({ ...current, opening_balance: value }))} className="input mt-1" /></label><label className="flex items-center gap-2 self-end pb-2 text-[11px] text-[#344054]"><input type="checkbox" checked={accountValues.is_default_for_payment_method} onChange={(event) => setAccountValues((current) => ({ ...current, is_default_for_payment_method: event.target.checked }))} /> Default for automatic quotation payments</label><div className="field-label sm:col-span-2"><span>Receipt image</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose account receipt image" className="mt-1" emptyLabel="Choose receipt image" files={accountFile ? [accountFile] : []} onFilesSelected={(files) => setAccountFile(files[0] ?? null)} /></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAccountOpen(false)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveAccount()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Save account</button></div></FinanceDialog>}

      {budgetOpen && <FinanceDialog title="Request budget" detail="The request will be reviewed by Internal Finance." close={() => setBudgetOpen(false)}><div className="mt-5 space-y-3"><label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={budgetValues.amount} onChange={(value) => setBudgetValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label><label className="field-label">Note<textarea value={budgetValues.note} onChange={(event) => setBudgetValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-24" placeholder="Explain the budget request" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setBudgetOpen(false)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveBudget()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Submit request</button></div></FinanceDialog>}

      {loading && <p className="text-[12px] text-[#7d8797]">Loading Finance…</p>}
    </div>
  );
}

function TransactionTable({
  rows,
  categoryName,
  accountName,
  leadName,
  budgetLabel,
  accounts,
  internal,
  reviewTransaction,
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
  reviewTransaction: (id: string, decision: "approved" | "rejected") => void;
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
          const canMarkPaid = internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "approved";
          const accountId = stringValue(transaction, "account_id");
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
                <div><span className="block text-[10px] text-[#8b92a1]">Money In</span><span className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Money Out</span><span className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</span></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Approval</span><StatusPill value={approval} /></div>
                <div><span className="block text-[10px] text-[#8b92a1]">Note</span><span className="line-clamp-2 text-[#344054]">{isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : stringValue(transaction, "note", "-")}</span></div>
              </div>
              {budgetLabel(transaction.budget_request_id) && <p className="mt-2 text-[10px] text-[#687386]">Budget: {budgetLabel(transaction.budget_request_id)}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#edf0f5] pt-3">
                {!accountId && internal  && !isVoided && <select aria-label="Assign account" defaultValue="" onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] flex-1 text-[10px]"><option value="">Needs account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select>}
                {stringValue(transaction, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="button-secondary" title="View receipt"><ReceiptText size={14} /> Receipt</button>}
                {internal && !isVoided && type === "expense" && approval === "pending" && <><button type="button" disabled={saving} onClick={() => reviewTransaction(String(transaction.id), "approved")} className="button-secondary text-[#218b55]">Approve</button><button type="button" disabled={saving} onClick={() => reviewTransaction(String(transaction.id), "rejected")} className="button-secondary text-[#b42318]">Reject</button></>}
                {canMarkPaid && <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Money Out")} className="button-secondary">Mark paid</button>}
              </div>
            </article>
          );
        })}
        {!rows.length && <p className="rounded-lg border border-dashed border-[#d9e0e9] px-3 py-6 text-center text-[11px] text-[#7d8797]">No transactions match the current filter.</p>}
      </div>
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[1080px]"><thead><tr><th>Date</th><th>Name / Company</th><th>Category</th><th>Account</th><th>Money In</th><th>Money Out</th><th>Payment</th><th>Approval</th><th>Receipt</th><th>Action</th></tr></thead><tbody>{rows.map((transaction) => { const type = stringValue(transaction, "transaction_type"); const approval = stringValue(transaction, "approval_status"); const paid = stringValue(transaction, "payment_status"); const isVoided = Boolean(transaction.is_voided); const canMarkPaid = internal && !isVoided && type === "expense" && paid === "unpaid" && approval === "approved"; const accountId = stringValue(transaction, "account_id"); const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts"); return <tr key={String(transaction.id)} className={isVoided ? "opacity-60" : undefined}><td>{displayDate(transaction.transaction_date)}<small>{stringValue(transaction, "transaction_time")}</small></td><td>{leadName(transaction.lead_id)}{Boolean(transaction.source_payment_id) && <small>Automatic quotation payment</small>}</td><td>{categoryName(transaction.category_id)}<small>{isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : stringValue(transaction, "note", "-")}</small></td><td>{!accountId && internal  && !isVoided ? <select aria-label="Assign account" defaultValue="" onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] text-[10px]"><option value="">Needs account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select> : accountName(transaction.account_id)}</td><td className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "-"}</td><td><StatusPill value={isVoided ? "voided" : paid} /></td><td><StatusPill value={approval} /></td><td>{stringValue(transaction, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="text-[#c43b43]" title="View receipt"><ReceiptText size={15} /></button> : "-"}</td><td>{internal && !isVoided && type === "expense" && approval === "pending" ? <span className="flex gap-1"><button type="button" disabled={saving} onClick={() => reviewTransaction(String(transaction.id), "approved")} className="icon-button text-[#218b55]" title="Approve Money Out"><Check size={15} /></button><button type="button" disabled={saving} onClick={() => reviewTransaction(String(transaction.id), "rejected")} className="icon-button text-[#b42318]" title="Reject Money Out"><XCircle size={15} /></button></span> : canMarkPaid ? <button type="button" disabled={saving} onClick={() => markPaid(String(transaction.id), "Money Out")} className="button-secondary text-[10px]">Mark paid</button> : "-"}</td></tr>; })}{!rows.length && <tr><td colSpan={10} className="text-center text-[#7d8797]">No transactions match the current filter.</td></tr>}</tbody></table></div>
    </div>
  );
}
