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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadControl } from "@/components/ui/file-upload-control";
import { NumberInput } from "@/components/ui/number-input";
import { SearchableLeadSelect } from "@/components/ui/searchable-lead-select";

type Row = { id?: string; [key: string]: unknown };
type Direction = "income" | "expense";
type Tab = "overview" | "transactions" | "accounts" | "budget" | "supplier_costing" | "payables";
type Period = "all" | "weekly" | "monthly" | "yearly";

const financePaymentMethods = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
  ["gcash", "GCash"],
  ["card", "Card"],
  ["check", "Check"],
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
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-[#c43b43] px-3 text-[11px] font-semibold text-white hover:bg-[#a92f37] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[11px] font-semibold text-[#344054] hover:bg-[#f8faff] disabled:cursor-not-allowed disabled:opacity-50";

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

function FinanceDialog({
  title,
  detail,
  close,
  children,
}: {
  title: string;
  detail?: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#202938]">{title}</h2>
            {detail && <p className="mt-1 text-[12px] text-[#7d8797]">{detail}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-[#687386] hover:text-[#202938]"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FinanceWorkspace({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string;
}) {
  const client = useMemo(() => createClient(), []);
  const internal = isInternalRole(role);
  const canRequestBudget = role === "external_finance";
  const canRecordSupplierCosting = role === "external_finance";
  const [tab, setTab] = useState<Tab>("overview");
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
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transactionDirection, setTransactionDirection] = useState<Direction | null>(null);
  const [transactionFile, setTransactionFile] = useState<File | null>(null);
  const [transactionValues, setTransactionValues] = useState(defaultTransaction("income"));
  const [categoryDraft, setCategoryDraft] = useState({ name: "", expense_class: "operating" });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFile, setAccountFile] = useState<File | null>(null);
  const [accountValues, setAccountValues] = useState({ name: "", type: "bank", number: "", opening_balance: "", payment_method: "bank_transfer", is_default_for_payment_method: true });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetValues, setBudgetValues] = useState({ amount: "", note: "" });
  const [supplierCostOpen, setSupplierCostOpen] = useState(false);
  const [supplierCostValues, setSupplierCostValues] = useState({ supplier_id: "", quotation_id: "", lead_id: "", description: "", amount: "", due_date: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const requests = await Promise.all([
      client.from("finance_transactions").select("*").eq("organization_id", organizationId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
      client.from("finance_categories").select("*").eq("organization_id", organizationId).eq("is_active", true).order("direction").order("name"),
      client.from("finance_accounts").select("*").eq("organization_id", organizationId).eq("is_active", true).order("account_name"),
      client.from("finance_account_balances").select("*").eq("organization_id", organizationId).order("account_name"),
      client.from("finance_budget_requests").select("*").eq("organization_id", organizationId).order("requested_at", { ascending: false }),
      client.from("leads").select("id,lead_no,client_name,contact_name,phone,email,project_name").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      client.from("quotations").select("id,quotation_no,project_name,client_name,lead_id,customer_id,document_type").eq("organization_id", organizationId).in("document_type", ["price_quotation", "mockup_quotation"]).order("created_at", { ascending: false }),
      client.from("supplier_payables").select("*").eq("organization_id", organizationId).order("due_date", { ascending: true }),
      client.from("suppliers").select("id,company_name").eq("organization_id", organizationId).order("company_name"),
      client.from("commission_summary_allocations").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      client.from("profiles").select("id,full_name"),
      client.from("quotation_payment_records").select("quotation_id,status,verified_at").eq("organization_id", organizationId).eq("status", "verified"),
    ]);
    const failed = requests.find((request) => request.error);
    if (failed?.error) setMessage(`Finance data could not load: ${failed.error.message}`);
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
    setLoading(false);
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

  const periodStart = useMemo(() => {
    if (period === "all") return "";
    const now = new Date();
    if (period === "yearly") return `${now.getFullYear()}-01-01`;
    if (period === "monthly") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  }, [period]);

  const filteredTransactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const transactionDate = stringValue(transaction, "transaction_date");
      if (periodStart && transactionDate < periodStart) return false;
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
        stringValue(lead, "client_name"),
        stringValue(lead, "contact_name"),
        stringValue(quotation, "quotation_no"),
        stringValue(payable, "payable_no"),
        stringValue(suppliers.find((item) => item.id === payable?.supplier_id), "company_name"),
      ].join(" ").toLowerCase().includes(normalized);
    });
  }, [accounts, categories, leads, payables, periodStart, query, quotations, suppliers, transactions]);

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

  const verifiedPaymentByQuotation = useMemo(() => {
    const map = new Map<string, string>();
    paymentRecords.forEach((record) => {
      const quotationId = stringValue(record, "quotation_id");
      const verifiedAt = stringValue(record, "verified_at");
      if (quotationId && verifiedAt && (!map.has(quotationId) || verifiedAt > String(map.get(quotationId)))) map.set(quotationId, verifiedAt);
    });
    return map;
  }, [paymentRecords]);

  const eligibleCommissionAllocations = useMemo(() => commissionAllocations.filter((allocation) => {
    if (stringValue(allocation, "status") !== "not_yet_paid") return false;
    const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id"));
    return Boolean(verifiedAt && currentTime >= new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000);
  }), [commissionAllocations, currentTime, verifiedPaymentByQuotation]);
  const receivables = useMemo(
    () => transactions.filter((transaction) => !Boolean(transaction.is_voided) && stringValue(transaction, "transaction_type") === "income" && stringValue(transaction, "payment_status") === "unpaid"),
    [transactions],
  );
  const transactionPayables = useMemo(
    () => transactions.filter((transaction) => !Boolean(transaction.is_voided) && stringValue(transaction, "transaction_type") === "expense" && stringValue(transaction, "approval_status") === "approved" && stringValue(transaction, "payment_status") === "unpaid"),
    [transactions],
  );

  const accountBalance = (accountId: string) => numericValue(balances.find((balance) => balance.id === accountId), "current_balance");
  const categoryName = (categoryId: unknown) => stringValue(categories.find((category) => category.id === categoryId), "name", "Uncategorized");
  const accountName = (accountId: unknown) => stringValue(accounts.find((account) => account.id === accountId), "account_name", "—");
  const leadName = (leadId: unknown) => stringValue(leads.find((lead) => lead.id === leadId), "client_name", "—");
  const supplierName = (supplierId: unknown) => stringValue(suppliers.find((supplier) => supplier.id === supplierId), "company_name", "—");
  const quotationName = (quotationId: unknown) => stringValue(quotations.find((quotation) => quotation.id === quotationId), "quotation_no", "—");
  const profileName = (profileId: unknown) => stringValue(profiles.find((profile) => profile.id === profileId), "full_name", "Sales & Pricing Officer");

  const setFormDirection = (direction: Direction) => {
    const nextCategory = categories.find((category) => stringValue(category, "direction") === direction)?.id ?? "";
    setTransactionDirection(direction);
    setTransactionValues(defaultTransaction(direction, nextCategory));
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
    if (!transactionDirection || !transactionFile) return setMessage("Upload the transaction receipt image.");
    if (!transactionValues.amount || Number(transactionValues.amount) <= 0) return setMessage("Enter an amount greater than zero.");
    if (!transactionValues.category_id || !transactionValues.account_id) return setMessage("Choose a category and payment account.");
    const selectedAllocation = eligibleCommissionAllocations.find((allocation) => allocation.id === transactionValues.commission_allocation_id);
    if (transactionValues.commission_allocation_id && !selectedAllocation) return setMessage("That commission allocation is not yet eligible for payment.");
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
        p_account_id: transactionValues.account_id,
        p_note: transactionValues.note.trim() || null,
        p_transaction_date: transactionValues.transaction_date,
        p_transaction_time: transactionValues.transaction_time || null,
        p_payment_status: transactionValues.payment_status,
        p_lead_id: transactionValues.lead_id || null,
        p_customer_id: null,
        p_quotation_id: transactionValues.quotation_id || String(selectedAllocation?.quotation_id ?? "") || null,
        p_supplier_payable_id: transactionValues.supplier_payable_id || null,
        p_commission_summary_id: null,
        p_receipt_storage_path: path,
        p_receipt_file_name: transactionFile.name,
        p_receipt_content_type: transactionFile.type,
        p_receipt_file_size: transactionFile.size,
      };
      const { error } = selectedAllocation
        ? await client.rpc("create_finance_transaction_with_commission_allocation", {
            ...transactionPayload,
            p_commission_summary_id: null,
            p_supplier_payable_id: null,
            p_commission_allocation_id: selectedAllocation.id,
          })
        : await client.rpc("create_finance_transaction", transactionPayload);
      if (error) throw error;
      setMessage(transactionDirection === "expense" && !internal ? "Money Out submitted for Internal Finance approval." : "Finance transaction saved.");
      setTransactionDirection(null);
      setTransactionFile(null);
      await load();
    } catch (error) {
      await removeReceipt(path);
      setMessage(error instanceof Error ? error.message : "The transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async () => {
    if (!transactionDirection || !categoryDraft.name.trim()) return setMessage("Enter a category name.");
    setSaving(true);
    const { error } = await client.rpc("create_finance_category", {
      p_direction: transactionDirection,
      p_name: categoryDraft.name.trim(),
      p_expense_class: transactionDirection === "expense" ? categoryDraft.expense_class : null,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setCategoryDraft({ name: "", expense_class: "operating" });
    setMessage("Category added.");
    await load();
  };

  const archiveCategory = async (category: Row) => {
    const { error } = await client.rpc("archive_finance_category", { p_category_id: category.id });
    if (error) return setMessage(error.message);
    setMessage("Category removed from the list.");
    await load();
  };

  const saveAccount = async () => {
    if (!accountValues.name.trim() || !accountFile) return setMessage("Enter an account name and upload its receipt image.");
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
      setMessage(error instanceof Error ? error.message : "The account could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveSupplierCosting = async () => {
    if (!supplierCostValues.supplier_id) return setMessage("Choose a supplier.");
    if (!supplierCostValues.description.trim()) return setMessage("Enter a supplier costing description.");
    if (!supplierCostValues.amount || Number(supplierCostValues.amount) <= 0) return setMessage("Enter a supplier costing amount greater than zero.");
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
    if (error) return setMessage(error.message);
    setSupplierCostOpen(false);
    setSupplierCostValues({ supplier_id: "", quotation_id: "", lead_id: "", description: "", amount: "", due_date: "", notes: "" });
    setMessage("Supplier costing recorded in the payable logbook.");
    await load();
  };

  const saveBudget = async () => {
    if (!budgetValues.amount || Number(budgetValues.amount) <= 0) return setMessage("Enter a budget amount greater than zero.");
    setSaving(true);
    const { error } = await client.rpc("create_finance_budget_request", {
      p_amount: Number(budgetValues.amount),
      p_note: budgetValues.note.trim() || null,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setBudgetOpen(false);
    setBudgetValues({ amount: "", note: "" });
    setMessage("Budget request submitted.");
    await load();
  };

  const reviewTransaction = async (transactionId: string, decision: "approved" | "rejected") => {
    setSaving(true);
    const { error } = await client.rpc("review_finance_transaction", {
      p_transaction_id: transactionId,
      p_decision: decision,
      p_decision_note: null,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage(`Money Out ${decision}.`);
    await load();
  };

  const markPaid = async (transactionId: string) => {
    setSaving(true);
    const { error } = await client.rpc("mark_finance_transaction_paid", { p_transaction_id: transactionId });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage("Transaction marked paid.");
    await load();
  };

  const assignAccount = async (transactionId: string, accountId: string) => {
    if (!accountId) return;
    setSaving(true);
    const { error } = await client.rpc("assign_finance_transaction_account", {
      p_transaction_id: transactionId,
      p_account_id: accountId,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage("Automatic Money In reconciled to the selected account.");
    await load();
  };

  const reviewBudget = async (requestId: string, decision: "approved" | "rejected") => {
    setSaving(true);
    const { error } = await client.rpc("review_finance_budget_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_decision_note: null,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage(`Budget request ${decision}.`);
    await load();
  };

  const openReceipt = async (path: string, bucket = "finance-receipts") => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return setMessage(error?.message ?? "The receipt could not be opened.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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
      setMessage(error instanceof Error ? error.message : "The Finance PDF could not be generated.");
    } finally {
      setSaving(false);
    }
  };

  if (!canUseFinance(role)) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-[#d9e0e9] bg-white p-1">
          {([
            ["overview", "Overview"],
            ["transactions", "Transactions"],
            ["accounts", "Accounts"],
            ["budget", "Budget requests"],
            ["supplier_costing", "Supplier costing"],
            ["payables", "Payables"],
          ] as [Tab, string][]).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${tab === value ? "bg-[#c43b43] text-white" : "text-[#687386] hover:bg-[#f1f4f8]"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {canRequestBudget && <button type="button" onClick={() => setBudgetOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[11px] font-semibold text-[#344054] hover:bg-[#f8faff]"><Plus size={13} /> Request budget</button>}
          <button type="button" onClick={downloadReport} disabled={saving} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[11px] font-semibold text-[#344054] hover:bg-[#f8faff] disabled:opacity-50"><Download size={13} /> Download PDF</button>
        </div>
      </div>

      {message && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[#d9e0e9] bg-white px-3 py-2.5 text-[12px] text-[#344054]">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-[14px] border border-[#d9e0e9] bg-white p-4">
            <div>
              <h2 className="text-[15px] font-semibold text-[#202938]">Finance overview</h2>
              <p className="mt-1 text-[11px] text-[#7d8797]">Paid and approved movements are used for the cash balance. Receivables and payables remain separate.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="input min-w-[125px] text-[12px]"><option value="weekly">This week</option><option value="monthly">This month</option><option value="yearly">This year</option><option value="all">All time</option></select>
              <label className="relative block"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[#8b92a1]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="input pl-8 text-[12px]" placeholder="Search transactions" /></label>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Money In", totals.income, "text-[#218b55]"],
              ["Money Out", totals.expense, "text-[#b42318]"],
              ["Balance", totals.income - totals.expense, totals.income - totals.expense >= 0 ? "text-[#218b55]" : "text-[#b42318]"],
              ["Pending approvals", totals.pending, "text-[#a76605]"],
            ].map(([label, value, color]) => <div key={String(label)} className="rounded-[14px] border border-[#d9e0e9] bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#8b92a1]">{label}</p><p className={`mt-2 text-xl font-semibold ${color}`}>{label === "Pending approvals" ? String(value) : peso.format(Number(value))}</p></div>)}
          </div>
          <Panel title="Add transaction" detail="Record an income or expense with its receipt, account, and Name / Company link.">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <button type="button" onClick={() => setFormDirection("income")} className="flex items-center justify-between rounded-lg border border-[#b7dfc5] bg-[#f1fbf4] p-4 text-left hover:bg-[#e8f8ed]"><span><b className="block text-[13px] text-[#176b40]">Money In</b><span className="mt-1 block text-[11px] text-[#5f7667]">Customer payments, capital, loans, refunds, or asset sales.</span></span><Plus size={17} className="text-[#218b55]" /></button>
              <button type="button" onClick={() => setFormDirection("expense")} className="flex items-center justify-between rounded-lg border border-[#f2b8b5] bg-[#fff5f4] p-4 text-left hover:bg-[#fff0ef]"><span><b className="block text-[13px] text-[#b42318]">Money Out</b><span className="mt-1 block text-[11px] text-[#8d5a58]">Expenses, supplier payments, commissions, and refunds.</span></span><Plus size={17} className="text-[#b42318]" /></button>
            </div>
          </Panel>
          <Panel title="Recent transactions" detail="Money In is green; Money Out is red.">
            <TransactionTable rows={filteredTransactions.slice(0, 8)} categoryName={categoryName} accountName={accountName} leadName={leadName} accounts={accounts} internal={internal} reviewTransaction={reviewTransaction} markPaid={markPaid} assignAccount={assignAccount} openReceipt={openReceipt} saving={saving} />
          </Panel>
        </>
      )}

      {tab === "transactions" && (
        <Panel title="All transactions" detail="Search, filter, approve, and monitor the finance ledger.">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f5] p-4">
            <div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="input text-[12px]"><option value="weekly">This week</option><option value="monthly">This month</option><option value="yearly">This year</option><option value="all">All time</option></select><label className="relative block"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[#8b92a1]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="input pl-8 text-[12px]" placeholder="Search" /></label></div>
            <div className="flex gap-2"><button type="button" onClick={() => setFormDirection("income")} className={primaryButton}><Plus size={13} /> Money In</button><button type="button" onClick={() => setFormDirection("expense")} className={secondaryButton}><Plus size={13} /> Money Out</button></div>
          </div>
          <TransactionTable rows={filteredTransactions} categoryName={categoryName} accountName={accountName} leadName={leadName} accounts={accounts} internal={internal} reviewTransaction={reviewTransaction} markPaid={markPaid} assignAccount={assignAccount} openReceipt={openReceipt} saving={saving} />
        </Panel>
      )}

      {tab === "accounts" && (
        <Panel title="Bank and e-wallet accounts" detail="Internal Finance manages payment accounts and opening balances." action={internal ? <button type="button" onClick={() => setAccountOpen(true)} className={primaryButton}><Plus size={13} /> Add account</button> : undefined}>
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => <div key={String(account.id)} className="rounded-lg border border-[#d9e0e9] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-semibold text-[#202938]">{stringValue(account, "account_name")}</p><p className="mt-1 text-[11px] capitalize text-[#7d8797]">{stringValue(account, "account_type").replaceAll("_", " ")} {stringValue(account, "account_number") || "No identifier"}</p><p className="mt-1 text-[10px] text-[#8b92a1]">Payments: {stringValue(account, "payment_method", "other").replaceAll("_", " ")}{Boolean(account.is_default_for_payment_method) ? " · Default" : ""}</p></div><Wallet size={17} className="text-[#c43b43]" /></div><p className="mt-4 text-lg font-semibold text-[#202938]">{peso.format(accountBalance(String(account.id)))}</p><p className="mt-1 text-[10px] text-[#8b92a1]">Opening balance: {peso.format(numericValue(account, "opening_balance"))}</p>{stringValue(account, "receipt_storage_path") && <button type="button" onClick={() => void openReceipt(stringValue(account, "receipt_storage_path"))} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#c43b43]"><ReceiptText size={13} /> View receipt</button>}</div>)}
            {!accounts.length && <p className="text-[12px] text-[#7d8797]">No finance accounts have been added yet.</p>}
          </div>
        </Panel>
      )}

      {tab === "budget" && (
        <Panel title="Budget requests" detail="External Finance requests a budget; Internal Finance approves or rejects it." action={canRequestBudget ? <button type="button" onClick={() => setBudgetOpen(true)} className={primaryButton}><Plus size={13} /> Request budget</button> : undefined}>
          <div className="overflow-x-auto"><table className="app-table min-w-[760px]"><thead><tr><th>Requested</th><th>Amount</th><th>Note</th><th>Status</th><th>Action</th></tr></thead><tbody>{budgets.map((budget) => <tr key={String(budget.id)}><td>{displayDate(stringValue(budget, "requested_at"))}</td><td className="font-semibold">{peso.format(numericValue(budget, "amount"))}</td><td>{stringValue(budget, "note", "—")}</td><td><StatusPill value={stringValue(budget, "status")} /></td><td>{internal && stringValue(budget, "status") === "pending" ? <span className="flex gap-1"><button type="button" onClick={() => void reviewBudget(String(budget.id), "approved")} className="icon-button text-[#218b55]" title="Approve budget"><Check size={15} /></button><button type="button" onClick={() => void reviewBudget(String(budget.id), "rejected")} className="icon-button text-[#b42318]" title="Reject budget"><XCircle size={15} /></button></span> : "—"}</td></tr>)}{!budgets.length && <tr><td colSpan={5} className="text-center text-[#7d8797]">No budget requests yet.</td></tr>}</tbody></table></div>
        </Panel>
      )}

      {tab === "supplier_costing" && (
        <Panel title="Supplier Costing logbook" detail="External Finance records supplier obligations here. These entries become Money Out only when an actual supplier payment is made." action={canRecordSupplierCosting ? <button type="button" onClick={() => setSupplierCostOpen(true)} className={primaryButton}><Plus size={13} /> Log supplier cost</button> : undefined}>
          <div className="overflow-x-auto"><table className="app-table min-w-[980px]"><thead><tr><th>Supplier</th><th>Quotation</th><th>Name / Company</th><th>Description</th><th>Total cost</th><th>Paid</th><th>Remaining</th><th>Due</th><th>Status</th></tr></thead><tbody>{payables.filter((payable) => stringValue(payable, "status") !== "cancelled").map((payable) => { const linkedLead = stringValue(payable, "lead_id"); const linkedQuotation = quotations.find((quotation) => quotation.id === payable.quotation_id); const nameCompany = stringValue(linkedQuotation, "client_name") || leadName(linkedLead); return <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}</td><td>{quotationName(payable.quotation_id)}</td><td>{nameCompany || "—"}</td><td>{stringValue(payable, "description", "—")}</td><td className="font-semibold">{peso.format(numericValue(payable, "amount"))}</td><td>{peso.format(numericValue(payable, "amount_paid"))}</td><td className="font-semibold text-[#b42318]">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td>{displayDate(payable.due_date)}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>; })}{!payables.filter((payable) => stringValue(payable, "status") !== "cancelled").length && <tr><td colSpan={9} className="text-center text-[#7d8797]">No supplier costing entries yet.</td></tr>}</tbody></table></div>
        </Panel>
      )}

      {tab === "payables" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Commission payouts" detail="Each S.E. Origin and Co-Worker allocation is paid separately after the related client payment has been verified for three days.">
            <div className="overflow-x-auto"><table className="app-table min-w-[920px]"><thead><tr><th>Quotation</th><th>Name / Company</th><th>Recipient</th><th>Role</th><th>Amount</th><th>Eligible</th><th>Status</th></tr></thead><tbody>{commissionAllocations.filter((allocation) => stringValue(allocation, "status") !== "not_applicable").map((allocation) => { const verifiedAt = verifiedPaymentByQuotation.get(stringValue(allocation, "quotation_id")); const eligibleAt = verifiedAt ? new Date(new Date(verifiedAt).getTime() + 3 * 24 * 60 * 60 * 1000) : null; const eligible = Boolean(eligibleAt && currentTime >= eligibleAt.getTime()); const roleLabel = stringValue(allocation, "allocation_role").replaceAll("_", " "); return <tr key={String(allocation.id)}><td>{quotationName(allocation.quotation_id)}</td><td>{stringValue(quotations.find((quotation) => quotation.id === allocation.quotation_id), "client_name", "—")}</td><td>{profileName(allocation.recipient_user_id)}</td><td className="capitalize">{roleLabel}</td><td className="font-semibold text-[#b42318]">{peso.format(numericValue(allocation, "amount"))}</td><td>{eligible ? <StatusPill value="approved" /> : <span className="text-[11px] text-[#a76605]">{eligibleAt ? displayDate(eligibleAt) : "Awaiting verified payment"}</span>}</td><td><StatusPill value={stringValue(allocation, "status")} /></td></tr>; })}{!commissionAllocations.filter((allocation) => stringValue(allocation, "status") !== "not_applicable").length && <tr><td colSpan={7} className="text-center text-[#7d8797]">No commission allocations yet.</td></tr>}</tbody></table></div>
          </Panel>
          <Panel title="Supplier payables" detail="Confirmed supplier obligations remain payable until paid.">
            <div className="overflow-x-auto"><table className="app-table min-w-[650px]"><thead><tr><th>Supplier</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead><tbody>{payables.filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status"))).map((payable) => <tr key={String(payable.id)}><td>{supplierName(payable.supplier_id)}<small>{stringValue(payable, "payable_no")}</small></td><td>{displayDate(payable.due_date)}</td><td className="font-semibold">{peso.format(Math.max(numericValue(payable, "amount") - numericValue(payable, "amount_paid"), 0))}</td><td><StatusPill value={stringValue(payable, "status")} /></td></tr>)}{!payables.filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status"))).length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open supplier payables.</td></tr>}</tbody></table></div>
          </Panel>
          <Panel title="Receivables" detail="Unpaid Money In remains a receivable until Internal Finance marks it paid.">
            <div className="overflow-x-auto"><table className="app-table min-w-[650px]"><thead><tr><th>Name / Company</th><th>Category</th><th>Amount</th><th>Action</th></tr></thead><tbody>{receivables.map((transaction) => <tr key={String(transaction.id)}><td>{leadName(transaction.lead_id)}<small>{displayDate(transaction.transaction_date)}</small></td><td>{categoryName(transaction.category_id)}</td><td className="font-semibold text-[#218b55]">{peso.format(numericValue(transaction, "amount"))}</td><td>{internal ? <button type="button" disabled={saving} onClick={() => void markPaid(String(transaction.id))} className="button-secondary text-[10px]">Mark paid</button> : "—"}</td></tr>)}{!receivables.length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open receivables.</td></tr>}</tbody></table></div>
          </Panel>
          <Panel title="Other payables" detail="Approved unpaid Money Out remains a payable until settlement.">
            <div className="overflow-x-auto"><table className="app-table min-w-[650px]"><thead><tr><th>Category</th><th>Note</th><th>Amount</th><th>Action</th></tr></thead><tbody>{transactionPayables.map((transaction) => <tr key={String(transaction.id)}><td>{categoryName(transaction.category_id)}<small>{displayDate(transaction.transaction_date)}</small></td><td>{stringValue(transaction, "note", "—")}</td><td className="font-semibold text-[#b42318]">{peso.format(numericValue(transaction, "amount"))}</td><td>{internal ? <button type="button" disabled={saving} onClick={() => void markPaid(String(transaction.id))} className="button-secondary text-[10px]">Mark paid</button> : "—"}</td></tr>)}{!transactionPayables.length && <tr><td colSpan={4} className="text-center text-[#7d8797]">No open ledger payables.</td></tr>}</tbody></table></div>
          </Panel>
        </div>
      )}

      {transactionDirection && (
        <FinanceDialog title={transactionDirection === "income" ? "Add Money In" : "Add Money Out"} detail="Receipt, account, status, and Name / Company are recorded together." close={() => setTransactionDirection(null)}>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={transactionValues.amount} onChange={(value) => setTransactionValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label>
            <label className="field-label">{transactionDirection === "income" ? "Income category" : "Expense category"}<select value={transactionValues.category_id} onChange={(event) => setTransactionValues((current) => ({ ...current, category_id: event.target.value }))} className="input mt-1"><option value="">Choose category</option>{activeCategories.map((category) => <option key={String(category.id)} value={String(category.id)}>{stringValue(category, "name")}{transactionDirection === "expense" ? ` · ${stringValue(category, "expense_class").replaceAll("_", " ")}` : ""}</option>)}</select></label>
            <label className="field-label">Payment method / account<select value={transactionValues.account_id} onChange={(event) => setTransactionValues((current) => ({ ...current, account_id: event.target.value }))} className="input mt-1"><option value="">Choose account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")} · {stringValue(account, "account_type").replaceAll("_", " ")}</option>)}</select></label>
            <label className="field-label">Name / Company from Leads<SearchableLeadSelect options={leadOptions} value={transactionValues.lead_id} onChange={(value) => setTransactionValues((current) => ({ ...current, lead_id: value }))} placeholder="Not linked" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Name / Company from Leads" className="mt-1" /></label>
            <label className="field-label">Date<input type="date" value={transactionValues.transaction_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_date: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label">Time<input type="time" value={transactionValues.transaction_time} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setTransactionValues((current) => ({ ...current, transaction_time: event.target.value }))} className="input mt-1" /></label>
            <label className="field-label sm:col-span-2">Note<textarea value={transactionValues.note} onChange={(event) => setTransactionValues((current) => ({ ...current, note: event.target.value }))} className="input mt-1 min-h-20" placeholder="Add a note" /></label>
            <div className="field-label"><span>Payment status</span><div className="mt-1 flex rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-1"><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "paid" }))} className={transactionValues.payment_status === "paid" ? "flex-1 rounded-md bg-[#edf9f2] px-3 py-2 text-[11px] font-semibold text-[#218b55]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Paid</button><button type="button" onClick={() => setTransactionValues((current) => ({ ...current, payment_status: "unpaid" }))} className={transactionValues.payment_status === "unpaid" ? "flex-1 rounded-md bg-[#fff8e9] px-3 py-2 text-[11px] font-semibold text-[#a76605]" : "flex-1 rounded-md px-3 py-2 text-[11px] font-semibold text-[#7d8797]"}>Unpaid</button></div></div>
            <div className="field-label"><span>Receipt image</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose finance receipt image" className="mt-1" emptyLabel="Choose receipt image" files={transactionFile ? [transactionFile] : []} onFilesSelected={(files) => setTransactionFile(files[0] ?? null)} /></div>
            {transactionDirection === "expense" && <>
              <label className="field-label">Commission payout allocation (optional)<select value={transactionValues.commission_allocation_id} onChange={(event) => setTransactionValues((current) => ({ ...current, commission_allocation_id: event.target.value }))} className="input mt-1"><option value="">Not linked</option>{eligibleCommissionAllocations.map((allocation) => <option key={String(allocation.id)} value={String(allocation.id)}>{quotationName(allocation.quotation_id)} - {profileName(allocation.recipient_user_id)} - {stringValue(allocation, "allocation_role").replaceAll("_", " ")} - {peso.format(numericValue(allocation, "amount"))}</option>)}</select>{!eligibleCommissionAllocations.length && <small>No commission allocation is currently eligible.</small>}</label>
              <label className="field-label">Supplier payable (optional)<select value={transactionValues.supplier_payable_id} onChange={(event) => setTransactionValues((current) => ({ ...current, supplier_payable_id: event.target.value }))} className="input mt-1"><option value="">Not linked</option>{payables.filter((payable) => !["paid", "cancelled"].includes(stringValue(payable, "status"))).map((payable) => <option key={String(payable.id)} value={String(payable.id)}>{stringValue(payable, "payable_no")} · {supplierName(payable.supplier_id)}</option>)}</select></label>

            </>}
          </div>
          <div className="mt-4 rounded-lg border border-[#edf0f5] bg-[#fafbfc] p-3"><p className="text-[11px] font-semibold text-[#344054]">Add a custom {transactionDirection} category</p><div className="mt-2 flex flex-wrap gap-2"><input value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} className="input min-w-[200px] flex-1 text-[12px]" placeholder="Category name" />{transactionDirection === "expense" && <select value={categoryDraft.expense_class} onChange={(event) => setCategoryDraft((current) => ({ ...current, expense_class: event.target.value }))} className="input text-[12px]"><option value="operating">Operating Expense</option><option value="non_operating">Non Operating Expense</option></select>}<button type="button" onClick={() => void saveCategory()} disabled={saving} className="button-secondary">Add category</button></div><div className="mt-3 flex flex-wrap gap-1.5">{activeCategories.filter((category) => !Boolean(category.is_system)).map((category) => <button key={String(category.id)} type="button" onClick={() => void archiveCategory(category)} className="inline-flex items-center gap-1 rounded-full border border-[#d9e0e9] px-2 py-1 text-[10px] text-[#687386] hover:border-[#f2b8b5] hover:text-[#b42318]">{stringValue(category, "name")} <X size={11} /></button>)}</div></div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTransactionDirection(null)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveTransaction()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} {saving ? "Saving…" : transactionDirection === "income" ? "Add Income" : "Add Expense"}</button></div>
        </FinanceDialog>
      )}

      {canRecordSupplierCosting && supplierCostOpen && <FinanceDialog title="Log supplier costing" detail="This records an amount owed to a supplier. It does not reduce cash until a linked Money Out is paid and approved." close={() => setSupplierCostOpen(false)}><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="field-label">Supplier<select value={supplierCostValues.supplier_id} onChange={(event) => setSupplierCostValues((current) => ({ ...current, supplier_id: event.target.value }))} className="input mt-1"><option value="">Choose supplier</option>{suppliers.map((supplier) => <option key={String(supplier.id)} value={String(supplier.id)}>{stringValue(supplier, "company_name")}</option>)}</select></label><label className="field-label">Related quotation (optional)<select value={supplierCostValues.quotation_id} onChange={(event) => { const quotationId = event.target.value; const quotation = quotations.find((item) => item.id === quotationId); setSupplierCostValues((current) => ({ ...current, quotation_id: quotationId, lead_id: stringValue(quotation, "lead_id") })); }} className="input mt-1"><option value="">Not linked</option>{quotations.map((quotation) => <option key={String(quotation.id)} value={String(quotation.id)}>{stringValue(quotation, "quotation_no")} · {stringValue(quotation, "client_name", "Name / Company not set")}</option>)}</select></label><label className="field-label">Name / Company (optional)<SearchableLeadSelect options={leadOptions} value={supplierCostValues.lead_id} onChange={(value) => setSupplierCostValues((current) => ({ ...current, lead_id: value }))} placeholder="Not linked" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Name / Company" className="mt-1" /></label><label className="field-label">Amount<NumberInput min="0.01" step="0.01" value={supplierCostValues.amount} onChange={(value) => setSupplierCostValues((current) => ({ ...current, amount: value }))} className="input mt-1" /></label><label className="field-label sm:col-span-2">Description<input value={supplierCostValues.description} onChange={(event) => setSupplierCostValues((current) => ({ ...current, description: event.target.value }))} className="input mt-1" placeholder="Example: Supplier materials for quotation" /></label><label className="field-label">Due date<input type="date" value={supplierCostValues.due_date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setSupplierCostValues((current) => ({ ...current, due_date: event.target.value }))} className="input mt-1" /></label><label className="field-label">Notes<textarea value={supplierCostValues.notes} onChange={(event) => setSupplierCostValues((current) => ({ ...current, notes: event.target.value }))} className="input mt-1 min-h-20" placeholder="Add supplier or payment notes" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSupplierCostOpen(false)} className="button-secondary">Cancel</button><button type="button" onClick={() => void saveSupplierCosting()} disabled={saving} className="button-primary">{saving && <LoaderCircle size={14} className="animate-spin" />} Save costing</button></div></FinanceDialog>}

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
  accounts: Row[];
  internal: boolean;
  reviewTransaction: (id: string, decision: "approved" | "rejected") => Promise<void>;
  markPaid: (id: string) => Promise<void>;
  assignAccount: (id: string, accountId: string) => Promise<void>;
  openReceipt: (path: string, bucket?: string) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="overflow-x-auto"><table className="app-table min-w-[1080px]"><thead><tr><th>Date</th><th>Name / Company</th><th>Category</th><th>Account</th><th>Money In</th><th>Money Out</th><th>Payment</th><th>Approval</th><th>Receipt</th><th>Action</th></tr></thead><tbody>{rows.map((transaction) => { const type = stringValue(transaction, "transaction_type"); const approval = stringValue(transaction, "approval_status"); const paid = stringValue(transaction, "payment_status"); const isVoided = Boolean(transaction.is_voided); const canMarkPaid = internal && !isVoided && paid === "unpaid" && ((type === "income" && approval === "not_required") || (type === "expense" && approval === "approved")); const accountId = stringValue(transaction, "account_id"); const receiptBucket = stringValue(transaction, "receipt_bucket", "finance-receipts"); return <tr key={String(transaction.id)} className={isVoided ? "opacity-60" : undefined}><td>{displayDate(transaction.transaction_date)}<small>{stringValue(transaction, "transaction_time")}</small></td><td>{leadName(transaction.lead_id)}{Boolean(transaction.source_payment_id) && <small>Automatic quotation payment</small>}</td><td>{categoryName(transaction.category_id)}<small>{isVoided ? `Voided: ${stringValue(transaction, "void_reason", "Reversed source payment")}` : stringValue(transaction, "note", "—")}</small></td><td>{!accountId && internal && Boolean(transaction.source_payment_id) && !isVoided ? <select aria-label="Assign account" defaultValue="" onChange={(event) => void assignAccount(String(transaction.id), event.target.value)} disabled={saving} className="input min-w-[150px] text-[10px]"><option value="">Needs account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{stringValue(account, "account_name")}</option>)}</select> : accountName(transaction.account_id)}</td><td className="font-semibold text-[#218b55]">{type === "income" ? peso.format(numericValue(transaction, "amount")) : "—"}</td><td className="font-semibold text-[#b42318]">{type === "expense" ? peso.format(numericValue(transaction, "amount")) : "—"}</td><td><StatusPill value={isVoided ? "voided" : paid} /></td><td><StatusPill value={approval} /></td><td>{stringValue(transaction, "receipt_storage_path") ? <button type="button" onClick={() => void openReceipt(stringValue(transaction, "receipt_storage_path"), receiptBucket)} className="text-[#c43b43]" title="View receipt"><ReceiptText size={15} /></button> : "—"}</td><td>{internal && !isVoided && type === "expense" && approval === "pending" ? <span className="flex gap-1"><button type="button" disabled={saving} onClick={() => void reviewTransaction(String(transaction.id), "approved")} className="icon-button text-[#218b55]" title="Approve Money Out"><Check size={15} /></button><button type="button" disabled={saving} onClick={() => void reviewTransaction(String(transaction.id), "rejected")} className="icon-button text-[#b42318]" title="Reject Money Out"><XCircle size={15} /></button></span> : canMarkPaid ? <button type="button" disabled={saving} onClick={() => void markPaid(String(transaction.id))} className="button-secondary text-[10px]">Mark paid</button> : "—"}</td></tr>; })}{!rows.length && <tr><td colSpan={10} className="text-center text-[#7d8797]">No transactions match the current filter.</td></tr>}</tbody></table></div>
  );
}
