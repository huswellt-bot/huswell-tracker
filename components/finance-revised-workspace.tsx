"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Download,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { FinanceProjectPdf } from "@/components/finance-project-pdf";
import { LoadingState } from "@/components/ui/loading-state";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, unknown>;
type RevisedTab = "dashboard" | "funds" | "daily_fund" | "cash_on_hand" | "transactions" | "requests" | "approvals" | "projects" | "commissions" | "history";
type DialogKind = "capital" | "transfer" | "daily_request" | "daily_return" | "cash_in" | "cash_out" | null;
type CategoryDirection = "income" | "expense";
type ApprovalTab = "all" | "cash_in" | "cash_out" | "working_funds" | "daily_fund";
type ApprovalItemKind = "transaction" | "working_request" | "daily_request";

const addCategoryOptionValue = "__add_revised_finance_category__";

type RequestLine = {
  description: string;
  category: string;
  amount: string;
};

const localDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const localMonth = () => localDate().slice(0, 7);

const amount = (value: unknown) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const numberValue = (row: Row | null | undefined, key: string) => {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : 0;
};

const textValue = (row: Row | null | undefined, key: string, fallback = "") => {
  const value = row?.[key];
  return value === null || value === undefined ? fallback : String(value);
};

const dateLabel = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + "T00:00:00" : raw);
  return Number.isNaN(parsed.getTime())
    ? raw.slice(0, 10)
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
};

const titleCase = (value: unknown) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const transactionLabel = (row: Row) => {
  const kind = textValue(row, "transaction_kind");
  if (kind === "project_cash_in") return "Project Cash In";
  if (kind === "project_cash_out") return "Project Cash Out";
  if (kind === "commission_payout") return "Commission payout";
  if (kind === "operating_cash_out") return "Daily Fund Cash Out";
  if (kind === "daily_fund_allocation") return "Daily Fund allocation";
  if (kind === "daily_fund_return") return "Daily Fund return";
  if (kind === "working_fund_support") return "Working Fund support";
  if (kind === "working_fund_repayment") return "Working Fund repayment";
  if (kind === "capital_contribution") return "Capital Funds";
  if (kind === "capital_to_working") return "Capital → Working Funds";
  if (kind === "adjustment") return "Reversal adjustment";
  return titleCase(kind);
};

const canRequestTransactionRevision = (row: Row) =>
  row.has_active_revision_child !== true
  && ["project_cash_in", "project_cash_out", "operating_cash_out", "commission_payout"].includes(textValue(row, "transaction_kind"));

const transactionSourceLabel = (row: Row) => {
  const projectName = textValue(row, "project_name").trim();
  if (projectName) return projectName;
  const kind = textValue(row, "transaction_kind");
  if (["operating_cash_out", "daily_fund_allocation", "daily_fund_return"].includes(kind)) return "Daily Fund";
  if (["working_fund_support", "working_fund_repayment", "capital_to_working"].includes(kind)) return "Working Funds";
  if (kind === "capital_contribution") return "Capital Funds";
  return "Unassigned";
};

const approvalBucket = (transaction: Row): Exclude<ApprovalTab, "all"> => {
  const kind = textValue(transaction, "transaction_kind");
  if (kind === "project_cash_in") return "cash_in";
  if (["working_fund_support", "working_fund_repayment"].includes(kind)) return "working_funds";
  if (["daily_fund_allocation", "daily_fund_return"].includes(kind)) return "daily_fund";
  return "cash_out";
};

type FinanceApprovalItem = {
  id: string;
  kind: ApprovalItemKind;
  bucket: Exclude<ApprovalTab, "all">;
  date: unknown;
  project: string;
  activity: string;
  category: string;
  amount: number;
  requestedBy: string;
  status: string;
  transaction?: Row;
  request?: Row;
  dailyRequest?: Row;
};

const buildApprovalItems = (
  transactions: Row[],
  requests: Row[],
  dailyFundRequests: Row[],
): FinanceApprovalItem[] => [
  ...transactions.map((transaction) => ({
    id: textValue(transaction, "id"),
    kind: "transaction" as const,
    bucket: approvalBucket(transaction),
    date: transaction.transaction_date,
    project: transactionSourceLabel(transaction),
    activity: transactionLabel(transaction),
    category: textValue(transaction, "category", "—"),
    amount: numberValue(transaction, "amount"),
    requestedBy: textValue(transaction, "submitted_by_name", textValue(transaction, "submitted_by", "Unknown")),
    status: textValue(transaction, "status"),
    transaction,
  })),
  ...requests.map((request) => ({
    id: textValue(request, "id"),
    kind: "working_request" as const,
    bucket: "working_funds" as const,
    date: request.requested_at,
    project: textValue(request, "project_name", "Project"),
    activity: textValue(request, "purpose", "Working Fund request"),
    category: `${textValue(request, "breakdown_line_count", "0")} lines`,
    amount: numberValue(request, "requested_amount"),
    requestedBy: textValue(request, "requested_by_name", textValue(request, "requested_by", "Unknown")),
    status: textValue(request, "status"),
    request,
  })),
  ...dailyFundRequests.map((request) => ({
    id: textValue(request, "id"),
    kind: "daily_request" as const,
    bucket: "daily_fund" as const,
    date: request.requested_at ?? request.fund_date,
    project: "Daily Fund",
    activity: textValue(request, "purpose", "Daily Fund request"),
    category: "Non-project expenses",
    amount: numberValue(request, "requested_amount"),
    requestedBy: textValue(request, "requested_by_name", textValue(request, "requested_by", "Unknown")),
    status: textValue(request, "status"),
    dailyRequest: request,
  })),
].sort((left, right) => {
  const leftTime = new Date(String(left.date ?? "")).getTime();
  const rightTime = new Date(String(right.date ?? "")).getTime();
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
});

type CostingGroup = {
  key: string;
  productDescription: string;
  productQuantity: number;
  totalDirectCost: number;
  lines: Row[];
};

const groupCostingLines = (lines: Row[]): CostingGroup[] => {
  const groups = new Map<string, CostingGroup>();
  lines.forEach((line, index) => {
    const key = textValue(line, "quotation_item_id", "product-" + index);
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.totalDirectCost = numberValue(line, "product_total_direct_cost") || existing.totalDirectCost;
      return;
    }
    groups.set(key, {
      key,
      productDescription: textValue(line, "product_description", "Product"),
      productQuantity: numberValue(line, "product_quantity"),
      totalDirectCost: numberValue(line, "product_total_direct_cost"),
      lines: [line],
    });
  });
  return [...groups.values()];
};

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
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {detail ? <p className="mt-1 max-w-3xl text-[11px] leading-4 text-[var(--color-text-secondary)]">{detail}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--color-success-text)]"
      : tone === "negative"
        ? "text-[var(--color-danger-text)]"
        : tone === "warning"
          ? "text-[var(--color-warning-text)]"
          : "text-[var(--color-text-primary)]";
  return (
    <div className="min-w-0 pb-1">
      <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-[var(--color-text-secondary)]">{label}</p>
      <p className={"mt-1 text-xl font-bold tracking-tight " + toneClass}>{value}</p>
      {detail ? <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-secondary)]">{detail}</p> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="block text-[11px] font-medium text-[var(--color-text-primary)]">
      <span>{label}</span>
      <input
        className="input mt-1 w-full"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[11px] font-medium text-[var(--color-text-primary)]">
      <span>{label}</span>
      <textarea
        className="input mt-1 min-h-20 w-full resize-y"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  const positive = ["approved", "repaid", "partially repaid"].includes(normalized);
  const negative = ["rejected", "voided", "cancelled"].includes(normalized);
  const className = positive
    ? "border-[var(--color-success-border)] bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
    : negative
      ? "border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)] text-[var(--color-danger-text)]"
      : "border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] text-[var(--color-warning-text)]";
  return (
    <span className={"inline-flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[10px] font-semibold capitalize " + className}>
      <span aria-hidden="true">{positive ? "✓" : negative ? "!" : "•"}</span>
      {normalized}
    </span>
  );
}

function Modal({
  title,
  detail,
  close,
  children,
  wide = false,
}: {
  title: string;
  detail?: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/45 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div role="dialog" aria-modal="true" className={"max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 " + (wide ? "max-w-5xl" : "max-w-2xl")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
            {detail ? <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">{detail}</p> : null}
          </div>
          <button type="button" onClick={close} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" aria-label="Close dialog"><X size={18} /></button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-[12px] text-[var(--color-text-secondary)]">{children}</div>;
}

export function FinanceRevisedWorkspace({
  organizationId,
  role,
  isGm,
  initialTab,
  openAction,
  onOpenActionHandled,
}: {
  organizationId: string;
  role: string;
  isGm?: boolean;
  initialTab?: RevisedTab | "approvals" | "accounts" | "budget" | "activity_history" | "supplier_costing" | "payables";
  openAction?: "income" | "expense" | null;
  onOpenActionHandled?: () => void;
}) {
  const client = useMemo(() => createClient(), []);
  const gm = isGm ?? ["super_admin", "owner", "admin"].includes(role);
  const canOperate = gm || role === "accountant";
  const startingTab: RevisedTab =
    initialTab === "funds"
      ? "funds"
      : initialTab === "daily_fund"
        ? "daily_fund"
      : initialTab === "cash_on_hand"
        ? "cash_on_hand"
      : initialTab === "approvals"
      ? "approvals"
      : initialTab === "budget"
      ? "requests"
      : initialTab === "accounts" || initialTab === "supplier_costing" || initialTab === "payables"
        ? "projects"
        : initialTab === "activity_history"
          ? "history"
          : initialTab === "transactions"
            ? "transactions"
            : initialTab === "projects"
              ? "projects"
              : initialTab === "commissions"
                ? "commissions"
              : initialTab === "requests"
                ? "requests"
                : "dashboard";

  const [tab, setTab] = useState<RevisedTab>(startingTab);
  const [month, setMonth] = useState(localMonth());
  const [snapshot, setSnapshot] = useState<Row | null>(null);
  const [dailySnapshot, setDailySnapshot] = useState<Row | null>(null);
  const [projects, setProjects] = useState<Row[]>([]);
  const [transactions, setTransactions] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [dailyFundRequests, setDailyFundRequests] = useState<Row[]>([]);
  const [commissionPayables, setCommissionPayables] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [approvalTab, setApprovalTab] = useState<ApprovalTab>("all");
  const [selectedProject, setSelectedProject] = useState<Row | null>(null);
  const [costingLines, setCostingLines] = useState<Row[]>([]);
  const [costingError, setCostingError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Row | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<Row | null>(null);
  const [requestLines, setRequestLines] = useState<Row[]>([]);
  const [reviewRequest, setReviewRequest] = useState<Row | null>(null);
  const [reviewDailyFundRequest, setReviewDailyFundRequest] = useState<Row | null>(null);
  const [reviewTransaction, setReviewTransaction] = useState<Row | null>(null);
  const [revisionSource, setRevisionSource] = useState<Row | null>(null);
  const [voidTransaction, setVoidTransaction] = useState<Row | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [repaymentRequest, setRepaymentRequest] = useState<Row | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("");
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [dailyFundReturnRequest, setDailyFundReturnRequest] = useState<Row | null>(null);
  const [dailyFundReturnAmount, setDailyFundReturnAmount] = useState("");
  const [dailyFundForm, setDailyFundForm] = useState({
    amount: "",
    date: localDate(),
    purpose: "",
    note: "",
  });
  const [selectedCommission, setSelectedCommission] = useState<Row | null>(null);
  const [commissionForm, setCommissionForm] = useState({
    date: localDate(),
    reference: "",
    note: "",
  });
  const [categoryManagerDirection, setCategoryManagerDirection] = useState<CategoryDirection | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [editingCategory, setEditingCategory] = useState<Row | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<Row | null>(null);

  const [cashIn, setCashIn] = useState({
    projectId: "",
    categoryId: "",
    amount: "",
    date: localDate(),
    reference: "",
    note: "",
  });
  const [cashOut, setCashOut] = useState({
    projectId: "",
    dailyFundRequestId: "",
    categoryId: "",
    amount: "",
    date: localDate(),
    reference: "",
    note: "",
  });
  const [capitalForm, setCapitalForm] = useState({
    amount: "",
  });
  const [workingForm, setWorkingForm] = useState({
    amount: "",
  });
  const [requestForm, setRequestForm] = useState<{
    projectId: string;
    purpose: string;
    note: string;
    lines: RequestLine[];
  }>({
    projectId: "",
    purpose: "",
    note: "",
    lines: [{ description: "", category: "Project expense", amount: "" }],
  });

  const cashInProjects = projects.filter((project) => ["open", "on_hold", "closed"].includes(textValue(project, "project_status")));
  const openProjects = projects.filter((project) => ["open", "on_hold"].includes(textValue(project, "project_status")));
  const hasActiveRevisionChild = (transaction: Row) => {
    const transactionId = textValue(transaction, "id");
    return Boolean(transactionId) && transactions.some((candidate) =>
      textValue(candidate, "revision_of_transaction_id") === transactionId
      && !["rejected", "voided"].includes(textValue(candidate, "status"))
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const periodStart = month + "-01";
    const [year, monthNumber] = month.split("-").map(Number);
    const periodEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    const pageSize = 500;
    const loadTransactions = async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const result = await client
          .from("finance_revised_transaction_feed")
          .select("*")
          .eq("organization_id", organizationId)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (result.error) return { data: rows, error: result.error };
        const page = (result.data as Row[] | null) ?? [];
        rows.push(...page);
        if (page.length < pageSize) return { data: rows, error: null };
      }
    };
    const loadWorkingRequests = async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const result = await client
          .from("finance_revised_working_fund_request_feed")
          .select("*")
          .eq("organization_id", organizationId)
          .order("requested_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (result.error) return { data: rows, error: result.error };
        const page = (result.data as Row[] | null) ?? [];
        rows.push(...page);
        if (page.length < pageSize) return { data: rows, error: null };
      }
    };
    const loadDailyFundRequests = async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const result = await client
          .from("finance_revised_daily_fund_request_feed")
          .select("*")
          .eq("organization_id", organizationId)
          .order("fund_date", { ascending: false })
          .order("requested_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (result.error) return { data: rows, error: result.error };
        const page = (result.data as Row[] | null) ?? [];
        rows.push(...page);
        if (page.length < pageSize) return { data: rows, error: null };
      }
    };
    const [snapshotResult, dailySnapshotResult, projectResult, transactionResult, requestResult, dailyRequestResult, commissionResult, categoryResult] = await Promise.all([
      client.rpc("get_finance_revised_snapshot", {
        p_organization_id: organizationId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      }),
      client.rpc("get_finance_revised_daily_fund_snapshot", { p_organization_id: organizationId }),
      client.rpc("list_finance_revised_projects", { p_organization_id: organizationId }),
      loadTransactions(),
      loadWorkingRequests(),
      loadDailyFundRequests(),
      client.rpc("list_finance_revised_commission_payables", { p_organization_id: organizationId }),
      client.rpc("list_finance_revised_categories", { p_organization_id: organizationId }),
    ]);

    const errors = [snapshotResult.error, dailySnapshotResult.error, projectResult.error, transactionResult.error, requestResult.error, dailyRequestResult.error, commissionResult.error, categoryResult.error]
      .filter(Boolean)
      .map((item) => item?.message ?? "Finance data could not be loaded");
    if (errors.length) setError(errors.join(" "));
    setSnapshot((snapshotResult.data as Row | null) ?? null);
    setDailySnapshot((dailySnapshotResult.data as Row | null) ?? null);
    setProjects((projectResult.data as Row[] | null) ?? []);
    const loadedTransactions = (transactionResult.data as Row[] | null) ?? [];
    const activeRevisionParents = new Set(
      loadedTransactions
        .filter((transaction) => textValue(transaction, "revision_of_transaction_id") && !["rejected", "voided"].includes(textValue(transaction, "status")))
        .map((transaction) => textValue(transaction, "revision_of_transaction_id")),
    );
    setTransactions(loadedTransactions.map((transaction) => ({
      ...transaction,
      project_name: transactionSourceLabel(transaction),
      has_active_revision_child: activeRevisionParents.has(textValue(transaction, "id")),
    })));
    setRequests((requestResult.data as Row[] | null) ?? []);
    setDailyFundRequests((dailyRequestResult.data as Row[] | null) ?? []);
    setCommissionPayables((commissionResult.data as Row[] | null) ?? []);
    setCategories((categoryResult.data as Row[] | null) ?? []);
    setLoading(false);
  }, [client, month, organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!openAction) return;
    const timer = window.setTimeout(() => {
      setTab("transactions");
      setDialog(openAction === "income" ? "cash_in" : "cash_out");
      onOpenActionHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onOpenActionHandled, openAction]);

  const finish = (message: string) => {
    setNotice(message);
    setError(null);
    void load();
  };

  const showError = (value: unknown) => {
    setError(value instanceof Error ? value.message : String(value));
    setNotice(null);
  };

  const closeTransactionDialog = () => {
    setDialog(null);
    setRevisionSource(null);
  };

  const beginTransactionRevision = (transaction: Row) => {
    const kind = textValue(transaction, "transaction_kind");
    if (!canRequestTransactionRevision(transaction) || hasActiveRevisionChild(transaction)) return;
    setRevisionSource(transaction);
    setError(null);
    if (kind === "project_cash_in") {
      setCashIn({
        projectId: textValue(transaction, "project_fund_id"),
        categoryId: textValue(transaction, "category_id"),
        amount: textValue(transaction, "amount"),
        date: textValue(transaction, "transaction_date", localDate()),
        reference: textValue(transaction, "reference_number"),
        note: textValue(transaction, "note"),
      });
      setDialog("cash_in");
      return;
    }
    setCashOut({
      projectId: ["project_cash_out", "commission_payout"].includes(kind) ? textValue(transaction, "project_fund_id") : "",
      dailyFundRequestId: kind === "operating_cash_out" ? textValue(transaction, "daily_fund_request_id") : "",
      categoryId: textValue(transaction, "category_id"),
      amount: textValue(transaction, "amount"),
      date: textValue(transaction, "transaction_date", localDate()),
      reference: textValue(transaction, "reference_number"),
      note: textValue(transaction, "note"),
    });
    setDialog("cash_out");
  };

  const handleCashIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cashIn.projectId || !cashIn.categoryId || Number(cashIn.amount) <= 0) return;
    setSaving(true);
    try {
      const { error: requestError } = revisionSource
        ? await client.rpc("resubmit_finance_revised_transaction", {
          p_original_transaction_id: textValue(revisionSource, "id"),
          p_project_fund_id: cashIn.projectId,
          p_amount: Number(cashIn.amount),
          p_category_id: cashIn.categoryId,
          p_transaction_date: cashIn.date,
          p_reference_number: cashIn.reference || null,
          p_note: cashIn.note || null,
          p_daily_fund_request_id: null,
        })
        : await client.rpc("create_finance_revised_cash_in_with_category", {
          p_organization_id: organizationId,
          p_project_fund_id: cashIn.projectId,
          p_amount: Number(cashIn.amount),
          p_category_id: cashIn.categoryId,
          p_transaction_date: cashIn.date,
          p_reference_number: cashIn.reference || null,
          p_note: cashIn.note || null,
        });
      if (requestError) throw new Error(requestError.message);
      closeTransactionDialog();
      setCashIn({ projectId: "", categoryId: "", amount: "", date: localDate(), reference: "", note: "" });
      finish(revisionSource ? "Corrected Project Cash In was resubmitted for GM approval." : "Project Cash In was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const handleCashOut = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const commissionRevision = revisionSource && textValue(revisionSource, "transaction_kind") === "commission_payout";
    if ((!cashOut.categoryId && !commissionRevision) || Number(cashOut.amount) <= 0 || (!cashOut.projectId && !cashOut.dailyFundRequestId)) return;
    setSaving(true);
    try {
      const { error: requestError } = revisionSource
        ? await client.rpc("resubmit_finance_revised_transaction", {
          p_original_transaction_id: textValue(revisionSource, "id"),
          p_project_fund_id: cashOut.projectId || null,
          p_amount: Number(cashOut.amount),
          p_category_id: cashOut.categoryId || null,
          p_transaction_date: cashOut.date,
          p_reference_number: cashOut.reference || null,
          p_note: cashOut.note || null,
          p_daily_fund_request_id: cashOut.projectId ? null : cashOut.dailyFundRequestId,
        })
        : await client.rpc("create_finance_revised_cash_out_with_category", {
          p_organization_id: organizationId,
          p_project_fund_id: cashOut.projectId || null,
          p_amount: Number(cashOut.amount),
          p_category_id: cashOut.categoryId,
          p_transaction_date: cashOut.date,
          p_reference_number: cashOut.reference || null,
          p_note: cashOut.note || null,
          p_daily_fund_request_id: cashOut.projectId ? null : cashOut.dailyFundRequestId,
        });
      if (requestError) throw new Error(requestError.message);
      closeTransactionDialog();
      setCashOut({ projectId: "", dailyFundRequestId: "", categoryId: "", amount: "", date: localDate(), reference: "", note: "" });
      finish(revisionSource ? "Corrected Cash Out was resubmitted for GM approval." : "Cash Out was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const openCategoryManager = (direction: CategoryDirection) => {
    setCategoryManagerDirection(direction);
    setCategoryDraft("");
    setEditingCategory(null);
    setDeleteCategoryTarget(null);
    setError(null);
  };

  const closeCategoryManager = () => {
    setCategoryManagerDirection(null);
    setCategoryDraft("");
    setEditingCategory(null);
    setDeleteCategoryTarget(null);
  };

  const handleCategorySelection = (direction: CategoryDirection, value: string) => {
    if (value === addCategoryOptionValue) {
      openCategoryManager(direction);
      return;
    }
    if (direction === "income") {
      setCashIn((current) => ({ ...current, categoryId: value }));
    } else {
      setCashOut((current) => ({ ...current, categoryId: value }));
    }
  };

  const startCategoryEdit = (category: Row) => {
    setEditingCategory(category);
    setCategoryDraft(textValue(category, "name"));
    setDeleteCategoryTarget(null);
  };

  const saveCategory = async () => {
    if (!categoryManagerDirection || !categoryDraft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const editing = Boolean(editingCategory);
      const { data, error: requestError } = editing
        ? await client.rpc("update_finance_revised_category", {
          p_organization_id: organizationId,
          p_category_id: textValue(editingCategory, "category_id"),
          p_name: categoryDraft.trim(),
        })
        : await client.rpc("create_finance_revised_category", {
          p_organization_id: organizationId,
          p_direction: categoryManagerDirection,
          p_name: categoryDraft.trim(),
          p_expense_class: categoryManagerDirection === "expense" ? "operating" : null,
        });
      if (requestError) throw new Error(requestError.message);

      const savedId = data ? String(data) : "";
      if (!editing && savedId) {
        if (categoryManagerDirection === "income") {
          setCashIn((current) => ({ ...current, categoryId: savedId }));
        } else {
          setCashOut((current) => ({ ...current, categoryId: savedId }));
        }
      }
      setCategoryDraft("");
      setEditingCategory(null);
      setNotice(editing ? "Finance category was renamed." : "Finance category was added.");
      await load();
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;
    const targetId = textValue(deleteCategoryTarget, "category_id");
    const targetName = textValue(deleteCategoryTarget, "name", "Finance category");
    setSaving(true);
    setError(null);
    try {
      const { data, error: requestError } = await client.rpc("delete_finance_revised_category", {
        p_organization_id: organizationId,
        p_category_id: targetId,
      });
      if (requestError) throw new Error(requestError.message);
      if (textValue(deleteCategoryTarget, "direction") === "income" && cashIn.categoryId === targetId) {
        setCashIn((current) => ({ ...current, categoryId: "" }));
      }
      if (textValue(deleteCategoryTarget, "direction") === "expense" && cashOut.categoryId === targetId) {
        setCashOut((current) => ({ ...current, categoryId: "" }));
      }
      setDeleteCategoryTarget(null);
      setEditingCategory(null);
      setCategoryDraft("");
      setNotice(data === "archived" ? `${targetName} was archived because it is already in use.` : `${targetName} was deleted.`);
      await load();
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const submitDailyFundRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Number(dailyFundForm.amount) <= 0 || !dailyFundForm.purpose.trim()) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_daily_fund_request", {
        p_organization_id: organizationId,
        p_requested_amount: Number(dailyFundForm.amount),
        p_fund_date: dailyFundForm.date,
        p_purpose: dailyFundForm.purpose.trim(),
        p_note: dailyFundForm.note || null,
      });
      if (requestError) throw new Error(requestError.message);
      setDialog(null);
      setDailyFundForm({ amount: "", date: localDate(), purpose: "", note: "" });
      finish("Daily Fund request was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const reviewDailyFundDecision = async (decision: "approved" | "rejected") => {
    if (!reviewDailyFundRequest) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("review_finance_revised_daily_fund_request", {
        p_request_id: textValue(reviewDailyFundRequest, "id"),
        p_decision: decision,
        p_approved_amount: decision === "approved" ? Number(approvalAmount) : null,
        p_decision_note: decisionNote || null,
      });
      if (requestError) throw new Error(requestError.message);
      setReviewDailyFundRequest(null);
      setApprovalAmount("");
      setDecisionNote("");
      finish(decision === "approved" ? "Daily Fund was approved and allocated." : "Daily Fund request was updated.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const submitDailyFundReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dailyFundReturnRequest || Number(dailyFundReturnAmount) <= 0) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_daily_fund_return", {
        p_request_id: textValue(dailyFundReturnRequest, "id"),
        p_amount: Number(dailyFundReturnAmount),
        p_transaction_date: localDate(),
        p_note: "Unused Daily Fund returned to Working Funds",
      });
      if (requestError) throw new Error(requestError.message);
      setDailyFundReturnRequest(null);
      setDailyFundReturnAmount("");
      finish("Unused Daily Fund return was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const openCommissionPayout = (commission: Row) => {
    setSelectedCommission(commission);
    setCommissionForm({ date: localDate(), reference: "", note: "" });
  };

  const submitCommissionPayout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCommission) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_commission_payout", {
        p_organization_id: organizationId,
        p_commission_allocation_id: textValue(selectedCommission, "allocation_id"),
        p_transaction_date: commissionForm.date,
        p_reference_number: commissionForm.reference || null,
        p_note: commissionForm.note || null,
      });
      if (requestError) throw new Error(requestError.message);
      setSelectedCommission(null);
      setCommissionForm({ date: localDate(), reference: "", note: "" });
      finish("Commission payout was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const requestWorkingFundsForCommission = (commission: Row) => {
    const projectName = textValue(commission, "project_name", "Selected project");
    const recipientName = textValue(commission, "recipient_name", "Sales & Pricing Officer");
    setRequestForm({
      projectId: textValue(commission, "project_fund_id"),
      purpose: `Commission payout - ${projectName}`,
      note: `Project balance is insufficient for the ${recipientName} commission payout.`,
      lines: [{
        description: `Commission payout - ${recipientName}`,
        category: "Commission",
        amount: String(numberValue(commission, "commission_amount")),
      }],
    });
    setSelectedRequest({ new: true });
  };

  const handleCapital = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Number(capitalForm.amount) <= 0) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_capital_contribution", {
        p_organization_id: organizationId,
        p_amount: Number(capitalForm.amount),
      });
      if (requestError) throw new Error(requestError.message);
      setDialog(null);
      setCapitalForm({ amount: "" });
      finish("Capital Funds were added to the ledger.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const handleWorkingTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Number(workingForm.amount) <= 0) return;
    if (Number(workingForm.amount) > numberValue(snapshot, "capital_funds")) {
      showError(new Error("Transfer amount cannot exceed the available Capital Funds balance."));
      return;
    }
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_capital_to_working", {
        p_organization_id: organizationId,
        p_amount: Number(workingForm.amount),
      });
      if (requestError) throw new Error(requestError.message);
      setDialog(null);
      setWorkingForm({ amount: "" });
      finish("Capital Funds were transferred to Working Funds.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const handleRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lines = requestForm.lines
      .map((line) => ({
        description: line.description.trim(),
        category: line.category.trim() || "Project expense",
        amount: Number(line.amount),
      }))
      .filter((line) => line.description && line.amount > 0);
    if (!requestForm.projectId || !requestForm.purpose.trim() || !lines.length) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_working_fund_request", {
        p_organization_id: organizationId,
        p_project_fund_id: requestForm.projectId,
        p_purpose: requestForm.purpose.trim(),
        p_note: requestForm.note || null,
        p_lines: lines,
      });
      if (requestError) throw new Error(requestError.message);
      setRequestForm({
        projectId: "",
        purpose: "",
        note: "",
        lines: [{ description: "", category: "Project expense", amount: "" }],
      });
      setSelectedRequest(null);
      finish("Working Fund request was submitted to the GM.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const reviewRequestDecision = async (decision: "approved" | "rejected") => {
    if (!reviewRequest) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("review_finance_revised_working_fund_request", {
        p_request_id: textValue(reviewRequest, "id"),
        p_decision: decision,
        p_approved_amount: decision === "approved" ? Number(approvalAmount || textValue(reviewRequest, "requested_amount")) : null,
        p_decision_note: decisionNote || null,
      });
      if (requestError) throw new Error(requestError.message);
      setReviewRequest(null);
      setDecisionNote("");
      setApprovalAmount("");
      finish(decision === "approved" ? "Working Fund support was approved and transferred." : "Working Fund request decision was recorded.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const reviewTransactionDecision = async (decision: "approved" | "revision_requested") => {
    if (!reviewTransaction) return;
    if (decision === "revision_requested" && !decisionNote.trim()) {
      showError(new Error("A revision note is required so Finance knows what to correct."));
      return;
    }
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("review_finance_revised_transaction", {
        p_transaction_id: textValue(reviewTransaction, "id"),
        p_decision: decision,
        p_decision_note: decisionNote || null,
      });
      if (requestError) throw new Error(requestError.message);
      setReviewTransaction(null);
      setDecisionNote("");
      finish(decision === "approved" ? "Finance transaction was approved and posted." : "Revision requested. The original transaction remains in the audit history.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const submitVoid = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!voidTransaction || !voidReason.trim()) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("void_finance_revised_transaction", {
        p_transaction_id: textValue(voidTransaction, "id"),
        p_reason: voidReason.trim(),
      });
      if (requestError) throw new Error(requestError.message);
      setVoidTransaction(null);
      setVoidReason("");
      finish("Finance transaction was reversed with an audited adjustment.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const openRequest = async (request: Row) => {
    setSelectedRequest(request);
    setRequestLines([]);
    const { data, error: requestError } = await client
      .from("finance_working_fund_request_lines")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("request_id", textValue(request, "id"))
      .order("sort_order");
    if (requestError) showError(requestError);
    setRequestLines((data as Row[] | null) ?? []);
  };

  const openProject = async (project: Row) => {
    setSelectedProject(project);
    setCostingLines([]);
    setCostingError(null);
    setDetailLoading(true);
    const { data, error: costingError } = await client.rpc("list_finance_revised_costing_breakdown", {
      p_organization_id: organizationId,
      p_project_fund_id: textValue(project, "project_fund_id"),
    });
    if (costingError) {
      setCostingError(costingError.message);
      showError(costingError);
    } else {
      setCostingLines((data as Row[] | null) ?? []);
    }
    setDetailLoading(false);
  };

  const startRepayment = (request: Row) => {
    setRepaymentRequest(request);
    const project = projects.find((item) => textValue(item, "project_fund_id") === textValue(request, "project_fund_id"));
    const clientAvailableBalance = Math.max(
      numberValue(project, "client_cash_in") - numberValue(project, "cash_out") - numberValue(project, "working_fund_repaid"),
      0,
    );
    setRepaymentAmount(String(Math.min(
      numberValue(request, "outstanding_amount") || numberValue(request, "approved_amount") || numberValue(request, "requested_amount"),
      clientAvailableBalance,
    )));
  };

  const submitRepayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repaymentRequest || Number(repaymentAmount) <= 0) return;
    setSaving(true);
    try {
      const { error: requestError } = await client.rpc("create_finance_revised_repayment", {
        p_request_id: textValue(repaymentRequest, "id"),
        p_amount: Number(repaymentAmount),
        p_transaction_date: localDate(),
        p_note: "Completed project Working Fund repayment",
      });
      if (requestError) throw new Error(requestError.message);
      setRepaymentRequest(null);
      setRepaymentAmount("");
      finish("Working Fund repayment was submitted for GM approval.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const generateProjectPdf = async () => {
    if (!selectedProject) return;
    if (costingError) {
      showError(new Error("Load the costing breakdown successfully before generating the project PDF."));
      return;
    }
    setSaving(true);
    try {
      const blob = await pdf(
        <FinanceProjectPdf
          project={selectedProject}
          costingLines={costingLines}
          activities={transactions.filter((item) => textValue(item, "project_fund_id") === textValue(selectedProject, "project_fund_id"))}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "project-finance-" + textValue(selectedProject, "project_name").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".pdf";
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Project Finance PDF was generated.");
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const renderDashboard = () => {
    const pendingApprovalItems = buildApprovalItems(
      transactions.filter((item) => textValue(item, "status") === "pending"),
      requests.filter((request) => textValue(request, "status") === "pending"),
      dailyFundRequests.filter((request) => textValue(request, "status") === "pending"),
    ).slice(0, 6);
    return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block text-[11px] font-medium text-[var(--color-text-primary)]">
          <span>Reporting month</span>
          <input className="input mt-1" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button type="button" className="button-secondary inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> Refresh ledger
        </button>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total Cash on Hand" value={amount(projects.reduce((total, project) => total + numberValue(project, "available_balance"), 0) + numberValue(dailySnapshot, "daily_fund_balance"))} detail="Project balances + Daily Fund; unallocated Working Funds excluded" tone="positive" />
          <Metric label="Capital Funds balance" value={amount(snapshot?.capital_funds)} detail="Owner investment remaining after transfers" />
          <Metric label="Beginning Working Funds" value={amount(snapshot?.beginning_working_funds)} detail={"Balance before " + month} />
          <Metric label="Ending Working Funds" value={amount(snapshot?.ending_working_funds)} detail="Available company operating pool" tone={numberValue(snapshot, "ending_working_funds") < 0 ? "negative" : "positive"} />
          <Metric label="Pending GM approvals" value={String(numberValue(snapshot, "pending_approvals"))} detail="Cash In, Cash Out, Working Funds, and Daily Fund requests" tone={numberValue(snapshot, "pending_approvals") ? "warning" : "positive"} />
          <Metric label="Period Cash In" value={amount(snapshot?.period_cash_in)} detail="Client collections recorded manually" tone="positive" />
          <Metric label="Period Cash Out" value={amount(snapshot?.period_cash_out)} detail="Approved project and operating expenses" />
          <Metric label="Daily Fund balance" value={amount(dailySnapshot?.daily_fund_balance)} detail="Available for non-project Cash Out" tone={numberValue(dailySnapshot, "daily_fund_balance") < 0 ? "negative" : "positive"} />
          <Metric label="Open commission payables" value={amount(snapshot?.commission_payables_open)} detail="Locked commission allocations not yet paid" tone={numberValue(snapshot, "commission_payables_open") ? "warning" : "positive"} />
        </div>
      </div>
      <Panel title="How the revised flow works" detail="The ledger keeps each project budget isolated. Working Fund support is an internal transfer, not project Cash In.">
        <div className="grid gap-3 p-4 text-[11px] leading-5 text-[var(--color-text-secondary)] md:grid-cols-3">
          <div className="border-l-2 border-[var(--color-success-border)] pl-3"><strong className="text-[var(--color-text-primary)]">1. Capital → Working</strong><br />GM records owner investment and transfers the allowed amount into Working Funds.</div>
          <div className="border-l-2 border-[var(--color-warning-border)] pl-3"><strong className="text-[var(--color-text-primary)]">2. Project budget first</strong><br />Client Cash In belongs only to its selected project. A project Cash Out cannot use another project&apos;s balance.</div>
          <div className="border-l-2 border-[var(--color-border-strong)] pl-3"><strong className="text-[var(--color-text-primary)]">3. Return after completion</strong><br />Only a completed project can repay approved Working Fund support, fully or partially.</div>
        </div>
      </Panel>
      <Panel title="Approval queue" detail="GM approval is the posting event. Pending rows have not changed a balance yet.">
        <ApprovalTable
          items={pendingApprovalItems}
          canReview={gm}
          onTransactionDetails={(transaction) => setSelectedTransaction(transaction)}
          onTransactionReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }}
          onWorkingDetails={(request) => void openRequest(request)}
          onWorkingReview={(request) => { setReviewRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}
          onDailyReview={(request) => { setReviewDailyFundRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}
        />
      </Panel>
    </div>
  );
  };
  const renderFunds = () => {
    const capitalTransactions = transactions.filter((transaction) =>
      ["capital_contribution", "capital_to_working"].includes(textValue(transaction, "transaction_kind")),
    );
    const workingTransactions = transactions.filter((transaction) =>
      ["capital_to_working", "working_fund_support", "working_fund_repayment", "daily_fund_allocation", "daily_fund_return"].includes(textValue(transaction, "transaction_kind")),
    );

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block text-[11px] font-medium text-[var(--color-text-primary)]">
            <span>Reporting month</span>
            <input className="input mt-1" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button type="button" className="button-secondary inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> Refresh funds
          </button>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Capital Funds balance" value={amount(snapshot?.capital_funds)} detail="Owner investment remaining after transfers" />
            <Metric label="Beginning Working Funds" value={amount(snapshot?.beginning_working_funds)} detail={"Balance before " + month} />
            <Metric label="Ending Working Funds" value={amount(snapshot?.ending_working_funds)} detail="Available company operating pool" tone={numberValue(snapshot, "ending_working_funds") < 0 ? "negative" : "positive"} />
            <Metric label="Completed-project repayments" value={amount(snapshot?.period_working_fund_repayment)} detail="Working Funds returned this period" tone="positive" />
          </div>
        </div>

        <Panel title="GM fund controls" detail="Capital Funds are owner investment. Working Funds can only be created by transferring an approved amount from Capital Funds.">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="max-w-2xl text-[11px] leading-5 text-[var(--color-text-secondary)]">Adding Capital Funds and transferring Capital → Working Funds posts directly through the GM-only ledger controls. Operating expenses, project support, and completed-project repayments are monitored below.</p>
            {gm ? <div className="flex flex-wrap gap-2"><button type="button" className="button-secondary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("capital")}><Landmark size={14} /> Add Capital Funds</button><button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("transfer")}><Wallet size={14} /> Transfer to Working Funds</button></div> : <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">GM controls required for fund changes</span>}
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Capital Funds activity" detail="Owner contributions increase Capital Funds. Capital → Working transfers reduce the Capital balance by the same amount.">
            <ActivityTable transactions={capitalTransactions} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} />
          </Panel>
          <Panel title="Working Funds activity" detail="Shows Capital transfers, project support, Daily Fund allocations, completed-project repayments, and Daily Fund returns.">
            <ActivityTable transactions={workingTransactions} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} />
          </Panel>
        </div>
      </div>
    );
  };

  const renderDailyFund = () => {
    const dailyTransactions = transactions.filter((transaction) => [
      "daily_fund_allocation",
      "operating_cash_out",
      "daily_fund_return",
    ].includes(textValue(transaction, "transaction_kind")));

    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Daily Fund balance" value={amount(dailySnapshot?.daily_fund_balance)} detail="Available for all non-project Cash Out" tone={numberValue(dailySnapshot, "daily_fund_balance") < 0 ? "negative" : "positive"} />
            <Metric label="Working Funds balance" value={amount(dailySnapshot?.working_funds_balance)} detail="Source of approved Daily Fund allocations" />
            <Metric label="Unused by request" value={amount(dailySnapshot?.unused_by_request)} detail="Can be returned to Working Funds" tone="warning" />
            <Metric label="Pending requests" value={String(numberValue(dailySnapshot, "pending_requests"))} detail="Waiting for GM approval" tone={numberValue(dailySnapshot, "pending_requests") ? "warning" : "positive"} />
          </div>
        </div>

        <Panel
          title="Daily Fund"
          detail="Daily Fund is a controlled sub-budget for non-project expenses. Approved allocations reduce Working Funds, and non-project Cash Out reduces Daily Fund."
          action={<button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("daily_request")} disabled={!canOperate}><Plus size={14} /> Request Daily Fund</button>}
        >
          <div className="grid gap-3 p-4 text-[11px] text-[var(--color-text-secondary)] sm:grid-cols-3">
            <div><span className="font-semibold text-[var(--color-text-primary)]">Allocate</span><br />Finance requests a Daily Fund amount for a date and purpose. GM approval transfers it from Working Funds.</div>
            <div><span className="font-semibold text-[var(--color-text-primary)]">Spend</span><br />Every non-project Cash Out uses the Daily Fund balance and keeps its Cash Out category.</div>
            <div><span className="font-semibold text-[var(--color-text-primary)]">Return</span><br />Unused Daily Fund can be returned to Working Funds after the day or period.</div>
          </div>
        </Panel>

        <Panel title="Daily Fund requests" detail="Approved amounts become Daily Fund only after GM approval. Spending and returns are tracked against each request.">
          {dailyFundRequests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-[11px]"><thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Spent</th><th className="px-4 py-3">Returned</th><th className="px-4 py-3">Unused</th><th className="px-4 py-3">Requested by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody>{dailyFundRequests.map((request) => { const status = textValue(request, "status"); const unused = numberValue(request, "unused_amount"); return <tr key={textValue(request, "id")} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-3 text-[var(--color-text-secondary)]">{dateLabel(request.fund_date)}</td><td className="max-w-[250px] px-4 py-3"><p className="font-semibold text-[var(--color-text-primary)]">{textValue(request, "purpose")}</p>{textValue(request, "note") ? <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{textValue(request, "note")}</p> : null}</td><td className="px-4 py-3">{amount(request.requested_amount)}</td><td className="px-4 py-3 font-semibold">{amount(request.approved_amount)}</td><td className="px-4 py-3">{amount(request.spent_amount)}</td><td className="px-4 py-3">{amount(request.returned_amount)}</td><td className="px-4 py-3 font-semibold text-[var(--color-warning-text)]">{amount(request.unused_amount)}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(request, "requested_by_name", textValue(request, "requested_by", "Unknown"))}</td><td className="px-4 py-3"><StatusBadge status={status} /></td><td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">{gm && status === "pending" ? <button type="button" className="button-secondary text-[10px]" onClick={() => { setReviewDailyFundRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}>Review</button> : null}{canOperate && ["approved", "partially_returned"].includes(status) && unused > 0 ? <button type="button" className="button-secondary text-[10px]" onClick={() => { setDailyFundReturnRequest(request); setDailyFundReturnAmount(String(unused)); }}>Return unused</button> : null}</div></td></tr>; })}</tbody></table></div> : <EmptyState>No Daily Fund requests yet.</EmptyState>}
        </Panel>

        <Panel title="Daily Fund activity" detail="This activity shows allocations from Working Funds, non-project Cash Out, and returns to Working Funds.">
          <ActivityTable transactions={dailyTransactions} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} />
        </Panel>
      </div>
    );
  };

  const renderCashOnHand = () => {
    const totalProjectAvailable = projects.reduce((total, project) => total + numberValue(project, "available_balance"), 0);
    const dailyFundBalance = numberValue(dailySnapshot, "daily_fund_balance");
    const totalCashOnHand = totalProjectAvailable + dailyFundBalance;

    return (
      <div className="space-y-5">
        <div className="flex justify-end">
          <button type="button" className="button-secondary inline-flex items-center gap-2 text-[11px]" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> Refresh Cash on Hand</button>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric label="Total Cash on Hand" value={amount(totalCashOnHand)} detail="Each project balance + Daily Fund" tone={totalCashOnHand < 0 ? "negative" : "positive"} />
            <Metric label="Daily Fund" value={amount(dailyFundBalance)} detail="Available for non-project Cash Out" />
          </div>
        </div>

        <Panel title="Cash on Hand breakdown" detail="Each project keeps its own balance. Daily Fund is shown as the separate non-project pool. Unallocated Working Funds are excluded from this page.">
          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[11px]">
              <thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Source</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Current balance</th><th className="px-4 py-3"></th></tr></thead>
              <tbody>
                {projects.map((project) => <tr key={textValue(project, "project_fund_id")} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-3"><p className="font-semibold text-[var(--color-text-primary)]">{textValue(project, "project_name", "Project")}</p><p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{textValue(project, "client_name", "—")} · {textValue(project, "company_name", "—")}</p></td><td className="px-4 py-3 text-[var(--color-text-secondary)]">Project budget</td><td className="px-4 py-3 font-bold text-[var(--color-text-primary)]">{amount(project.available_balance)}</td><td className="px-4 py-3 text-right"><button type="button" className="button-secondary text-[10px]" onClick={() => setSelectedProject(project)}>Open monitoring</button></td></tr>)}
                <tr className="bg-[var(--color-surface-muted)]"><td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">Daily Fund</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">Non-project expense pool</td><td className="px-4 py-3 font-bold text-[var(--color-text-primary)]">{amount(dailyFundBalance)}</td><td className="px-4 py-3 text-right"><button type="button" className="button-secondary text-[10px]" onClick={() => setTab("requests")}>Open requests</button></td></tr>
                {!projects.length ? <tr><td colSpan={4}><EmptyState>No project balances are available.</EmptyState></td></tr> : null}
              </tbody>
              <tfoot><tr className="border-t-2 border-[var(--color-border-strong)]"><td className="px-4 py-3 font-bold text-[var(--color-text-primary)]" colSpan={2}>Total Cash on Hand</td><td className="px-4 py-3 font-bold text-[var(--color-text-primary)]">{amount(totalCashOnHand)}</td><td></td></tr></tfoot>
            </table>
          </div>
        </Panel>
      </div>
    );
  };

  const renderTransactions = () => (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Project Cash In" detail="Enter any collection amount manually. No downpayment percentage or automatic payment restriction is applied." action={<button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("cash_in")} disabled={!canOperate}><ArrowDownToLine size={15} /> Record Cash In</button>}>
          <p className="p-4 text-[11px] leading-5 text-[var(--color-text-secondary)]">The project, amount, collection date, reference, and note are entered in a modal. GM approval is required before the selected project balance changes.</p>
        </Panel>
        <Panel title="Cash Out" detail="Choose a project for project expenses or Working Funds for an operating expense." action={<button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("cash_out")} disabled={!canOperate}><ArrowUpFromLine size={15} /> Record Cash Out</button>}>
        <p className="p-4 text-[11px] leading-5 text-[var(--color-text-secondary)]">Project Cash Out is limited to that project&apos;s balance. Non-project Cash Out is limited to the Daily Fund balance. GM approval is required before posting.</p>
        </Panel>
      </div>
      <Panel title="Revised Finance activity" detail="Only approved rows affect the Capital, Working Fund, or project balances.">
        <ActivityTable transactions={transactions} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} />
      </Panel>
    </div>
  );

  const renderRequests = () => (
    <div className="space-y-5">
      <Panel
        title="Working Fund requests"
        detail="Request a selected project budget with an itemized breakdown. GM approval releases Working Funds to that project."
        action={<button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setSelectedRequest({ new: true })} disabled={!canOperate}><Plus size={14} /> Request Working Funds</button>}
      >
        {requests.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[11px]">
              <thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Breakdown</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Requested by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
              <tbody>
                {requests.map((request) => {
                  const project = projects.find((item) => textValue(item, "project_fund_id") === textValue(request, "project_fund_id"));
                  const completed = Boolean(project?.is_completed);
                  const clientAvailableBalance = Math.max(numberValue(project, "client_cash_in") - numberValue(project, "cash_out") - numberValue(project, "working_fund_repaid"), 0);
                  return <tr key={textValue(request, "id")} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{textValue(request, "project_name")}</td>
                    <td className="max-w-[220px] px-4 py-3 text-[var(--color-text-secondary)]">{textValue(request, "purpose")}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(request, "breakdown_line_count", "0")} lines</td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{amount(request.approved_amount ?? request.requested_amount)}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(request, "requested_by_name", textValue(request, "requested_by", "Unknown"))}</td>
                    <td className="px-4 py-3"><StatusBadge status={textValue(request, "status")} /></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2"><button type="button" className="button-secondary text-[10px]" onClick={() => void openRequest(request)}>View breakdown</button>{gm && textValue(request, "status") === "pending" ? <button type="button" className="button-secondary text-[10px]" onClick={() => { setReviewRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}>Review</button> : null}{canOperate && completed && ["approved", "partially_repaid"].includes(textValue(request, "status")) && numberValue(request, "outstanding_amount") > 0 && clientAvailableBalance > 0 ? <button type="button" className="button-secondary text-[10px]" onClick={() => startRepayment(request)}>Repay</button> : null}</div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No Working Fund requests yet.</EmptyState>}
      </Panel>
      <Panel
        title="Daily Fund requests"
        detail="Request budget for non-project expenses. Approved requests transfer money from Working Funds into the Daily Fund."
        action={<button type="button" className="button-primary inline-flex items-center gap-2 text-[11px]" onClick={() => setDialog("daily_request")} disabled={!canOperate}><Plus size={14} /> Request Daily Fund</button>}
      >
        {dailyFundRequests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-[11px]"><thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Fund date</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Spent</th><th className="px-4 py-3">Unused</th><th className="px-4 py-3">Requested by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody>{dailyFundRequests.map((request) => { const status = textValue(request, "status"); const unused = numberValue(request, "unused_amount"); return <tr key={textValue(request, "id")} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-3 text-[var(--color-text-secondary)]">{dateLabel(request.fund_date)}</td><td className="max-w-[260px] px-4 py-3 font-semibold text-[var(--color-text-primary)]">{textValue(request, "purpose")}</td><td className="px-4 py-3">{amount(request.requested_amount)}</td><td className="px-4 py-3 font-semibold">{amount(request.approved_amount)}</td><td className="px-4 py-3">{amount(request.spent_amount)}</td><td className="px-4 py-3 font-semibold text-[var(--color-warning-text)]">{amount(unused)}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(request, "requested_by_name", textValue(request, "requested_by", "Unknown"))}</td><td className="px-4 py-3"><StatusBadge status={status} /></td><td className="px-4 py-3 text-right">{canOperate && ["approved", "partially_returned"].includes(status) && unused > 0 ? <button type="button" className="button-secondary text-[10px]" onClick={() => { setDailyFundReturnRequest(request); setDailyFundReturnAmount(String(unused)); }}>Return unused</button> : null}</td></tr>; })}</tbody></table></div> : <EmptyState>No Daily Fund requests yet.</EmptyState>}
      </Panel>
      <Panel title="What happens after approval" detail="The support transfer is recorded as Working Funds out and project funds in. It does not count as a client collection.">
        <div className="grid gap-3 p-4 text-[11px] leading-5 text-[var(--color-text-secondary)] md:grid-cols-3">
          <div><span className="font-semibold text-[var(--color-text-primary)]">Request</span><br />Accounting & Finance selects the project and adds each planned expense.</div>
          <div><span className="font-semibold text-[var(--color-text-primary)]">GM approves</span><br />GM may approve the full amount, a lower amount, or reject. A corrected request can then be submitted as a new request.</div>
          <div><span className="font-semibold text-[var(--color-text-primary)]">Repayment</span><br />After completion, the project returns the borrowed support. Partial repayment is allowed.</div>
        </div>
      </Panel>
    </div>
  );

  const renderCommissions = () => (
    <div className="space-y-5">
      <Panel
        title="Commission Payables"
        detail="A commission becomes payable only after approved project Cash In reaches the quotation total. GM approval posts the payout as Cash Out for that same project."
        action={<button type="button" className="button-secondary inline-flex items-center gap-2 text-[11px]" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> Refresh payables</button>}
      >
        {commissionPayables.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-[11px]">
              <thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Quotation</th><th className="px-4 py-3">Client Cash In</th><th className="px-4 py-3">Project balance</th><th className="px-4 py-3">Commission</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
              <tbody>
                {commissionPayables.map((commission) => {
                  const ready = Boolean(commission.ready_for_payout);
                  const pending = textValue(commission, "payout_status") === "pending";
                  const insufficient = textValue(commission, "eligibility_note").toLowerCase().includes("project balance");
                  return (
                    <tr key={textValue(commission, "allocation_id")} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3"><p className="font-semibold text-[var(--color-text-primary)]">{textValue(commission, "project_name", "Project")}</p><p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{textValue(commission, "client_name", "—")} · {textValue(commission, "company_name", "—")}</p></td>
                      <td className="px-4 py-3 text-[var(--color-text-primary)]">{textValue(commission, "recipient_name")}</td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">{titleCase(commission.allocation_role)}</td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]"><p>{textValue(commission, "quotation_number", "—")}</p><p className="mt-1">{amount(commission.total_quotation)}</p></td>
                      <td className="px-4 py-3 font-semibold text-[var(--color-success-text)]">{amount(commission.client_cash_in)}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{amount(commission.project_balance)}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--color-danger-text)]">{amount(commission.commission_amount)}</td>
                      <td className="px-4 py-3"><StatusBadge status={pending ? "pending GM approval" : ready ? "eligible" : textValue(commission, "eligibility_note", "waiting")} /></td>
                      <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">{ready && !pending ? <button type="button" className="button-primary text-[10px]" onClick={() => openCommissionPayout(commission)} disabled={saving}>Request payout</button> : null}{!ready && !pending && insufficient ? <button type="button" className="button-secondary text-[10px]" onClick={() => requestWorkingFundsForCommission(commission)} disabled={saving}>Request Working Funds</button> : null}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No unpaid commission allocations are available.</EmptyState>}
      </Panel>
      <Panel title="Commission rule" detail="Commission amounts are fixed by the approved quotation and paid in full per allocation. Partial client collections do not release commission. Working Fund support never counts as client Cash In.">
        <p className="p-4 text-[11px] leading-5 text-[var(--color-text-secondary)]">A commission allocation is a payable record first. It becomes a project Cash Out only after the project is fully collected and the GM approves the payout.</p>
      </Panel>
    </div>
  );

  const renderProjects = () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {projects.length ? (
        <>
          {projects.map((project) => (
            <article key={textValue(project, "project_fund_id")} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{textValue(project, "project_name", "Project")}</p><p className="mt-1 truncate text-[10px] text-[var(--color-text-secondary)]">{textValue(project, "client_name", "—")} · {textValue(project, "company_name", "—")}</p></div>
                <StatusBadge status={textValue(project, "project_status", "open")} />
              </div>
              <dl className="mt-4 grid gap-x-5 gap-y-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Quotation</dt><dd className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">{amount(project.total_quotation)}</dd></div>
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Total Direct Cost</dt><dd className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">{amount(project.total_direct_cost)}</dd></div>
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Cash In</dt><dd className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--color-success-text)]">{amount(project.client_cash_in)}</dd></div>
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Cash Out</dt><dd className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">{amount(project.cash_out)}</dd></div>
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Project balance</dt><dd className={"mt-1 text-[13px] font-semibold tabular-nums " + (numberValue(project, "available_balance") < 0 ? "text-[var(--color-danger-text)]" : "text-[var(--color-text-primary)]")}>{amount(project.available_balance)}</dd></div>
                <div><dt className="text-[10px] text-[var(--color-text-secondary)]">Outstanding support</dt><dd className={"mt-1 text-[13px] font-semibold tabular-nums " + (numberValue(project, "outstanding_working_fund") ? "text-[var(--color-warning-text)]" : "text-[var(--color-success-text)]")}>{amount(project.outstanding_working_fund)}</dd></div>
              </dl>
              <button type="button" className="button-secondary mt-4 inline-flex items-center gap-1 text-[11px]" onClick={() => void openProject(project)}>Open breakdown <ChevronRight size={14} /></button>
            </article>
          ))}
        </>
      ) : <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"><EmptyState>No project funds are available for this organization.</EmptyState></div>}
    </div>
  );

  const renderHistory = () => (
    <Panel title="Finance activity history" detail="A journal-style view of approved and pending movements across Capital Funds, Working Funds, and project budgets.">
      <ActivityTable transactions={transactions} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} />
    </Panel>
  );

  const renderApprovals = () => {
    const pendingTransactions = transactions.filter((transaction) => textValue(transaction, "status") === "pending");
    const pendingRequests = requests.filter((request) => textValue(request, "status") === "pending");
    const pendingDailyFundRequests = dailyFundRequests.filter((request) => textValue(request, "status") === "pending");
    const pendingItems = buildApprovalItems(pendingTransactions, pendingRequests, pendingDailyFundRequests);
    const transactionCounts = {
      cash_in: pendingItems.filter((item) => item.bucket === "cash_in").length,
      cash_out: pendingItems.filter((item) => item.bucket === "cash_out").length,
      working_funds: pendingItems.filter((item) => item.bucket === "working_funds").length,
      daily_fund: pendingItems.filter((item) => item.bucket === "daily_fund").length,
    };
    const approvalCounts: Record<ApprovalTab, number> = {
      all: pendingItems.length,
      ...transactionCounts,
    };
    const visibleItems = approvalTab === "all"
      ? pendingItems
      : pendingItems.filter((item) => item.bucket === approvalTab);
    const approvalTabs: Array<{ key: ApprovalTab; label: string }> = [
      { key: "all", label: "All" },
      { key: "cash_in", label: "Cash In" },
      { key: "cash_out", label: "Cash Out" },
      { key: "working_funds", label: "Working Funds" },
      { key: "daily_fund", label: "Daily Fund" },
    ];
    const approvalTitle = approvalTab === "cash_in"
      ? "Pending Cash In"
      : approvalTab === "cash_out"
        ? "Pending Cash Out"
        : approvalTab === "working_funds"
          ? "Pending Working Fund activity"
          : approvalTab === "daily_fund"
            ? "Pending Daily Fund activity"
          : "Pending Finance approvals";

    return (
      <div className="space-y-5">
        <div role="tablist" aria-label="GM approval request types" className="flex overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          {approvalTabs.map((item) => {
            const selected = approvalTab === item.key;
            return <button key={item.key} type="button" role="tab" aria-selected={selected} onClick={() => setApprovalTab(item.key)} className={"inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[11px] font-semibold transition-colors " + (selected ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]")}>
              {item.label}
              {approvalCounts[item.key] > 0 ? <span className={"min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] " + (selected ? "bg-white text-[var(--color-accent-text)]" : "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]")}>{approvalCounts[item.key] > 99 ? "99+" : approvalCounts[item.key]}</span> : null}
            </button>;
          })}
        </div>
        <Panel title={approvalTitle} detail="All approval types use one queue. Pending rows do not change a balance until the GM approves them.">
          <ApprovalTable
            items={visibleItems}
            canReview={gm}
            onTransactionDetails={(transaction) => setSelectedTransaction(transaction)}
            onTransactionReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }}
            onWorkingDetails={(request) => void openRequest(request)}
            onWorkingReview={(request) => { setReviewRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}
            onDailyReview={(request) => { setReviewDailyFundRequest(request); setApprovalAmount(textValue(request, "requested_amount")); setDecisionNote(""); }}
          />
        </Panel>
      </div>
    );
  };

  const selectedCostingGroups = groupCostingLines(costingLines);
  const selectedCostingTotal = costingLines.length
    ? numberValue(costingLines[0], "total_direct_cost")
    : numberValue(selectedProject, "total_direct_cost");
  const commissionRevisionSource = revisionSource && textValue(revisionSource, "transaction_kind") === "commission_payout";

  if (loading && !snapshot && !projects.length && !transactions.length && !requests.length) {
    return <LoadingState variant="section" label="Loading Accounting & Finance..." />;
  }

  return (
    <div className="finance-revised-workspace space-y-5">
      <h1 className="text-[24px] font-bold tracking-tight text-[var(--color-text-primary)]">{tab === "funds" ? "Capital & Working Funds" : tab === "daily_fund" ? "Daily Fund" : tab === "cash_on_hand" ? "Cash on Hand" : tab === "transactions" ? "Cash In & Cash Out" : tab === "requests" ? "Finance Requests" : tab === "approvals" ? "GM Approvals" : tab === "projects" ? "Finance Monitoring" : tab === "history" ? "Activity History" : "Accounting & Finance"}</h1>

      {notice ? <div className="rounded-lg border border-[var(--color-success-border)] bg-[var(--color-success-subtle)] px-4 py-3 text-[12px] text-[var(--color-success-text)]">{notice}</div> : null}
      {error ? <div className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)] px-4 py-3 text-[12px] text-[var(--color-danger-text)]">{error}</div> : null}

      {tab === "dashboard" ? renderDashboard() : tab === "funds" ? renderFunds() : tab === "daily_fund" ? renderDailyFund() : tab === "cash_on_hand" ? renderCashOnHand() : tab === "transactions" ? renderTransactions() : tab === "requests" ? renderRequests() : tab === "approvals" ? renderApprovals() : tab === "projects" ? renderProjects() : tab === "commissions" ? renderCommissions() : renderHistory()}

      {dialog === "cash_in" ? <Modal title={revisionSource ? "Correct and resubmit Cash In" : "Record project Cash In"} detail={revisionSource ? "Update the requested correction. The original submission remains in the audit history." : "Enter any collection amount manually. GM approval is required before the project balance changes."} close={closeTransactionDialog}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleCashIn}>
          <label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Project</span><select className="input mt-1 w-full" value={cashIn.projectId} onChange={(event) => setCashIn((current) => ({ ...current, projectId: event.target.value }))} required><option value="">Select project</option>{cashInProjects.map((project) => <option key={textValue(project, "project_fund_id")} value={textValue(project, "project_fund_id")}>{textValue(project, "project_name")} · {textValue(project, "client_name", "No client")}{textValue(project, "project_status") === "closed" ? " · Completed" : ""}</option>)}</select></label>
          <label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Cash In category</span><div className="mt-1 flex items-center gap-2"><select className="input w-full" value={cashIn.categoryId} onChange={(event) => handleCategorySelection("income", event.target.value)} required><option value="">Select Cash In category</option>{categories.filter((category) => textValue(category, "direction") === "income").map((category) => <option key={textValue(category, "category_id")} value={textValue(category, "category_id")}>{textValue(category, "name")}</option>)}<option value={addCategoryOptionValue}>＋ Add Cash In category</option></select><button type="button" className="button-secondary inline-flex shrink-0 items-center gap-1 text-[10px]" onClick={() => openCategoryManager("income")}><Tag size={13} /> Manage</button></div></label>
          <Field label="Amount" value={cashIn.amount} onChange={(value) => setCashIn((current) => ({ ...current, amount: value }))} type="number" min="0.01" step="0.01" required />
          <Field label="Collection date" value={cashIn.date} onChange={(value) => setCashIn((current) => ({ ...current, date: value }))} type="date" required />
          <Field label="Reference" value={cashIn.reference} onChange={(value) => setCashIn((current) => ({ ...current, reference: value }))} placeholder="Receipt or collection reference" />
          <Field label="Note" value={cashIn.note} onChange={(value) => setCashIn((current) => ({ ...current, note: value }))} placeholder="Optional detail" />
          {revisionSource && textValue(revisionSource, "decision_note") ? <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] p-3 text-[11px] sm:col-span-2"><p className="font-semibold text-[var(--color-warning-text)]">GM revision note</p><p className="mt-1 whitespace-pre-wrap leading-5 text-[var(--color-text-primary)]">{textValue(revisionSource, "decision_note")}</p></div> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={closeTransactionDialog}>Cancel</button><button type="submit" className="button-primary inline-flex items-center gap-2" disabled={!canOperate || saving}><ArrowDownToLine size={15} /> {revisionSource ? "Resubmit Cash In" : "Submit Cash In"}</button></div>
        </form>
      </Modal> : null}

      {dialog === "cash_out" && !commissionRevisionSource ? <Modal title={revisionSource ? "Correct and resubmit Cash Out" : "Record Cash Out"} detail={revisionSource ? "Update the requested correction. The original submission remains in the audit history." : "Choose a project for project expenses or leave Project blank for a non-project expense from Daily Fund."} close={closeTransactionDialog}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleCashOut}>
        <label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Budget source</span><select className="input mt-1 w-full" value={cashOut.projectId} onChange={(event) => setCashOut((current) => ({ ...current, projectId: event.target.value, dailyFundRequestId: "" }))} disabled={Boolean(revisionSource)}><option value="">Daily Fund · Non-project expense</option>{openProjects.map((project) => <option key={textValue(project, "project_fund_id")} value={textValue(project, "project_fund_id")}>{textValue(project, "project_name")} · Project budget</option>)}</select></label>
          {!cashOut.projectId ? <label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Daily Fund request</span><select className="input mt-1 w-full" value={cashOut.dailyFundRequestId} onChange={(event) => setCashOut((current) => ({ ...current, dailyFundRequestId: event.target.value }))} required><option value="">Select an approved Daily Fund request</option>{dailyFundRequests.filter((request) => ["approved", "partially_returned"].includes(textValue(request, "status")) && numberValue(request, "unused_amount") > 0).map((request) => <option key={textValue(request, "id")} value={textValue(request, "id")}>{dateLabel(request.fund_date)} · {textValue(request, "purpose")} · {amount(request.unused_amount)} remaining</option>)}</select><span className="mt-1 block text-[10px] text-[var(--color-text-secondary)]">Every non-project Cash Out is assigned to an approved Daily Fund request so its remaining budget can be tracked.</span></label> : null}
          <label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Cash Out category</span><div className="mt-1 flex items-center gap-2"><select className="input w-full" value={cashOut.categoryId} onChange={(event) => handleCategorySelection("expense", event.target.value)} required><option value="">Select Cash Out category</option>{categories.filter((category) => textValue(category, "direction") === "expense").map((category) => <option key={textValue(category, "category_id")} value={textValue(category, "category_id")}>{textValue(category, "name")}</option>)}<option value={addCategoryOptionValue}>＋ Add Cash Out category</option></select><button type="button" className="button-secondary inline-flex shrink-0 items-center gap-1 text-[10px]" onClick={() => openCategoryManager("expense")}><Tag size={13} /> Manage</button></div></label>
          <Field label="Amount" value={cashOut.amount} onChange={(value) => setCashOut((current) => ({ ...current, amount: value }))} type="number" min="0.01" step="0.01" required />
          <Field label="Cash Out date" value={cashOut.date} onChange={(value) => setCashOut((current) => ({ ...current, date: value }))} type="date" required />
          <Field label="Reference" value={cashOut.reference} onChange={(value) => setCashOut((current) => ({ ...current, reference: value }))} placeholder="Voucher or receipt reference" />
          <div className="sm:col-span-2"><TextArea label="Note" value={cashOut.note} onChange={(value) => setCashOut((current) => ({ ...current, note: value }))} placeholder="What is this Cash Out for?" /></div>
          {revisionSource && textValue(revisionSource, "decision_note") ? <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] p-3 text-[11px] sm:col-span-2"><p className="font-semibold text-[var(--color-warning-text)]">GM revision note</p><p className="mt-1 whitespace-pre-wrap leading-5 text-[var(--color-text-primary)]">{textValue(revisionSource, "decision_note")}</p></div> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={closeTransactionDialog}>Cancel</button><button type="submit" className="button-primary inline-flex items-center gap-2" disabled={!canOperate || saving}><ArrowUpFromLine size={15} /> {revisionSource ? "Resubmit Cash Out" : "Submit Cash Out"}</button></div>
        </form>
      </Modal> : null}

      {dialog === "cash_out" && commissionRevisionSource ? <Modal title="Correct and resubmit commission payout" detail="Update the payout date, reference, or note. The project and amount remain tied to the approved commission allocation." close={closeTransactionDialog}>
        <form className="space-y-4" onSubmit={handleCashOut}>
          <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 sm:grid-cols-3"><Metric label="Project" value={transactionSourceLabel(revisionSource ?? {})} /><Metric label="Expense type" value="Commission payout" /><Metric label="Commission amount" value={amount(cashOut.amount)} /></div>
          <Field label="Cash Out date" value={cashOut.date} onChange={(value) => setCashOut((current) => ({ ...current, date: value }))} type="date" required />
          <Field label="Reference" value={cashOut.reference} onChange={(value) => setCashOut((current) => ({ ...current, reference: value }))} placeholder="Voucher or receipt reference" />
          <TextArea label="Note" value={cashOut.note} onChange={(value) => setCashOut((current) => ({ ...current, note: value }))} placeholder="What should be corrected?" />
          {revisionSource && textValue(revisionSource, "decision_note") ? <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] p-3 text-[11px]"><p className="font-semibold text-[var(--color-warning-text)]">GM revision note</p><p className="mt-1 whitespace-pre-wrap leading-5 text-[var(--color-text-primary)]">{textValue(revisionSource, "decision_note")}</p></div> : null}
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={closeTransactionDialog}>Cancel</button><button type="submit" className="button-primary inline-flex items-center gap-2" disabled={!canOperate || saving}><ArrowUpFromLine size={15} /> Resubmit commission payout</button></div>
        </form>
      </Modal> : null}

      {categoryManagerDirection ? <Modal title="Manage Finance categories" detail="Accounting & Finance can add, rename, or delete categories for both Cash In and Cash Out." close={closeCategoryManager}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3">
            {(["income", "expense"] as CategoryDirection[]).map((direction) => (
              <button
                key={direction}
                type="button"
                className={"button-secondary text-[11px] " + (categoryManagerDirection === direction ? "border-[var(--color-accent)] bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]" : "")}
                onClick={() => {
                  setCategoryManagerDirection(direction);
                  setCategoryDraft("");
                  setEditingCategory(null);
                  setDeleteCategoryTarget(null);
                }}
              >
                {direction === "income" ? "Cash In categories" : "Cash Out categories"}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1 text-[11px] font-medium text-[var(--color-text-primary)]">
                {editingCategory ? "Edit category name" : "Add category"}
                <input className="input mt-1 w-full" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder={categoryManagerDirection === "income" ? "Downpayment, progress payment..." : "Materials, payroll, rent..."} maxLength={100} />
              </label>
              <button type="button" className="button-primary inline-flex items-center gap-1 text-[11px]" onClick={() => void saveCategory()} disabled={saving || !categoryDraft.trim()}>
                <Plus size={13} /> {editingCategory ? "Save name" : "Add category"}
              </button>
              {editingCategory ? <button type="button" className="button-secondary text-[11px]" onClick={() => { setEditingCategory(null); setCategoryDraft(""); }}>Cancel edit</button> : null}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[var(--color-text-primary)]">{categoryManagerDirection === "income" ? "Cash In categories" : "Cash Out categories"}</p>
              <span className="text-[10px] text-[var(--color-text-secondary)]">Hover a category to show actions</span>
            </div>
            <div className="space-y-1.5">
              {categories.filter((category) => textValue(category, "direction") === categoryManagerDirection).map((category) => (
                <div key={textValue(category, "category_id")} className="group flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{textValue(category, "name")}</p><p className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">{Boolean(category.is_system) ? "Default category" : "Custom category"}</p></div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]" onClick={() => startCategoryEdit(category)} aria-label={`Edit ${textValue(category, "name")} category`} title="Edit category"><Pencil size={14} /></button>
                    {!Boolean(category.is_system) ? <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger-text)]" onClick={() => { setDeleteCategoryTarget(category); setEditingCategory(null); setCategoryDraft(""); }} aria-label={`Delete ${textValue(category, "name")} category`} title="Delete category"><Trash2 size={14} /></button> : null}
                  </div>
                </div>
              ))}
              {!categories.some((category) => textValue(category, "direction") === categoryManagerDirection) ? <EmptyState>No categories yet.</EmptyState> : null}
            </div>
          </div>

          {deleteCategoryTarget ? <div className="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)] p-3">
            <p className="text-[11px] font-semibold text-[var(--color-danger-text)]">Delete “{textValue(deleteCategoryTarget, "name") }”?</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--color-danger-text)]">If it is already used, it will be archived so historical Finance records keep their category.</p>
            <div className="mt-3 flex justify-end gap-2"><button type="button" className="button-secondary text-[11px]" onClick={() => setDeleteCategoryTarget(null)}>Cancel</button><button type="button" className="button-danger text-[11px]" onClick={() => void confirmDeleteCategory()} disabled={saving}>Delete category</button></div>
          </div> : null}

          <div className="flex justify-end"><button type="button" className="button-secondary" onClick={closeCategoryManager}>Done</button></div>
        </div>
      </Modal> : null}

      {selectedCommission ? <Modal title="Submit commission payout" detail="This payout will be recorded as Cash Out for the selected project after GM approval." close={() => setSelectedCommission(null)}>
        <form className="space-y-4" onSubmit={submitCommissionPayout}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Project" value={textValue(selectedCommission, "project_name", "—")} />
            <Metric label="Recipient" value={textValue(selectedCommission, "recipient_name", "—")} />
            <Metric label="Role" value={titleCase(selectedCommission.allocation_role)} />
            <Metric label="Quotation total" value={amount(selectedCommission.total_quotation)} />
            <Metric label="Client Cash In" value={amount(selectedCommission.client_cash_in)} tone="positive" />
            <Metric label="Project balance" value={amount(selectedCommission.project_balance)} />
            <Metric label="Commission amount" value={amount(selectedCommission.commission_amount)} tone="negative" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Payout date" value={commissionForm.date} onChange={(value) => setCommissionForm((current) => ({ ...current, date: value }))} type="date" required /><Field label="Reference" value={commissionForm.reference} onChange={(value) => setCommissionForm((current) => ({ ...current, reference: value }))} placeholder="Optional voucher/reference" /></div>
          <TextArea label="Note" value={commissionForm.note} onChange={(value) => setCommissionForm((current) => ({ ...current, note: value }))} placeholder="Optional commission payout note" />
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">The approved commission allocation is paid in full. The amount cannot be edited, and the project balance will change only after GM approval.</p>
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setSelectedCommission(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Submit for GM approval</button></div>
        </form>
      </Modal> : null}

      {dialog === "capital" ? <Modal title="Add Capital Funds" detail="Record owner investment. The GM action posts immediately to the Capital Funds ledger." close={() => setDialog(null)}>
        <form className="grid gap-4" onSubmit={handleCapital}>
          <Field label="Amount" value={capitalForm.amount} onChange={(value) => setCapitalForm((current) => ({ ...current, amount: value }))} type="number" min="0.01" step="0.01" required />
          <p className="text-[10px] leading-4 text-[var(--color-text-secondary)]">The date will be recorded automatically when the Capital Funds transaction is submitted.</p>
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Add Capital Funds</button></div>
        </form>
      </Modal> : null}

      {dialog === "transfer" ? <Modal title="Transfer Capital to Working Funds" detail="This transfer reduces Capital Funds and increases Working Funds by the same amount." close={() => setDialog(null)}>
        <form className="grid gap-4" onSubmit={handleWorkingTransfer}>
          <div className="rounded-lg border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] px-4 py-5 text-center"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--color-accent-text)]">Available Capital Funds</p><p className="mt-2 text-[28px] font-bold tracking-tight text-[var(--color-accent-text)]">{amount(snapshot?.capital_funds)}</p></div>
          <Field label="Transfer amount" value={workingForm.amount} onChange={(value) => setWorkingForm((current) => ({ ...current, amount: value }))} type="number" min="0.01" max={String(numberValue(snapshot, "capital_funds"))} step="0.01" required />
          <p className="text-[10px] leading-4 text-[var(--color-text-secondary)]">The transfer date will be recorded automatically.</p>
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Transfer funds</button></div>
        </form>
      </Modal> : null}

      {dialog === "daily_request" ? <Modal title="Request Daily Fund" detail="Request a non-project expense budget. GM approval transfers the approved amount from Working Funds into Daily Fund." close={() => setDialog(null)}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitDailyFundRequest}>
          <Field label="Requested amount" value={dailyFundForm.amount} onChange={(value) => setDailyFundForm((current) => ({ ...current, amount: value }))} type="number" min="0.01" step="0.01" required />
          <Field label="Fund date" value={dailyFundForm.date} onChange={(value) => setDailyFundForm((current) => ({ ...current, date: value }))} type="date" required />
          <div className="sm:col-span-2"><Field label="Purpose" value={dailyFundForm.purpose} onChange={(value) => setDailyFundForm((current) => ({ ...current, purpose: value }))} placeholder="Daily office and operating expenses" required /></div>
          <div className="sm:col-span-2"><TextArea label="Note" value={dailyFundForm.note} onChange={(value) => setDailyFundForm((current) => ({ ...current, note: value }))} placeholder="Optional breakdown or context for the GM" /></div>
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)] sm:col-span-2">After approval, this budget becomes available for all non-project Cash Out. Unused funds can be returned to Working Funds.</p>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Submit Daily Fund request</button></div>
        </form>
      </Modal> : null}

      {dailyFundReturnRequest ? <Modal title="Return unused Daily Fund" detail="The return goes back to Working Funds after GM approval." close={() => setDailyFundReturnRequest(null)}>
        <form className="space-y-4" onSubmit={submitDailyFundReturn}>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Fund date" value={dateLabel(dailyFundReturnRequest.fund_date)} /><Metric label="Unused amount" value={amount(dailyFundReturnRequest.unused_amount)} tone="warning" /><Field label="Return amount" value={dailyFundReturnAmount} onChange={setDailyFundReturnAmount} type="number" min="0.01" step="0.01" required /></div>
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">This does not create Cash In or Cash Out. It moves unused Daily Fund back into the Working Funds pool.</p>
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setDailyFundReturnRequest(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Submit return</button></div>
        </form>
      </Modal> : null}

      {selectedRequest?.new ? <Modal title="Request Working Funds" detail="Select one project and provide the exact breakdown the GM will review." close={() => setSelectedRequest(null)} wide>
        <form className="space-y-4" onSubmit={handleRequest}>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-[11px] font-medium text-[var(--color-text-primary)]"><span>Project</span><select className="input mt-1 w-full" value={requestForm.projectId} onChange={(event) => setRequestForm((current) => ({ ...current, projectId: event.target.value }))} required><option value="">Select project</option>{openProjects.map((project) => <option key={textValue(project, "project_fund_id")} value={textValue(project, "project_fund_id")}>{textValue(project, "project_name")} · {textValue(project, "client_name", "No client")}</option>)}</select></label><Field label="Purpose" value={requestForm.purpose} onChange={(value) => setRequestForm((current) => ({ ...current, purpose: value }))} placeholder="Materials needed to continue..." required /></div>
          <TextArea label="Request note" value={requestForm.note} onChange={(value) => setRequestForm((current) => ({ ...current, note: value }))} placeholder="Optional context for the GM" />
          <div className="rounded-lg border border-[var(--color-border)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2"><p className="text-[11px] font-semibold text-[var(--color-text-primary)]">Expense breakdown</p><button type="button" className="button-secondary inline-flex items-center gap-1 text-[10px]" onClick={() => setRequestForm((current) => ({ ...current, lines: [...current.lines, { description: "", category: "Project expense", amount: "" }] }))}><Plus size={13} /> Add line</button></div>
            <div className="space-y-2 p-3">
              {requestForm.lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_170px_140px_auto]"><input className="input" value={line.description} onChange={(event) => setRequestForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} placeholder="Expense description" required /><input className="input" value={line.category} onChange={(event) => setRequestForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item) }))} placeholder="Category" /><input className="input" type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => setRequestForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) }))} placeholder="Amount" required /><button type="button" className="button-secondary px-2" aria-label="Remove line" onClick={() => setRequestForm((current) => ({ ...current, lines: current.lines.length === 1 ? current.lines : current.lines.filter((_, itemIndex) => itemIndex !== index) }))}><X size={14} /></button></div>)}
            </div>
            <div className="flex justify-end border-t border-[var(--color-border)] px-3 py-3 text-[12px] font-semibold text-[var(--color-text-primary)]">Total: {amount(requestForm.lines.reduce((total, line) => total + (Number(line.amount) || 0), 0))}</div>
          </div>
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setSelectedRequest(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Submit request</button></div>
        </form>
      </Modal> : null}

      {selectedRequest && !selectedRequest.new ? (
        <Modal title={textValue(selectedRequest, "purpose")} detail={textValue(selectedRequest, "project_name") + " · " + dateLabel(selectedRequest.requested_at)} close={() => setSelectedRequest(null)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Requested" value={amount(selectedRequest.requested_amount)} />
              <Metric label="Approved" value={amount(selectedRequest.approved_amount)} />
              <Metric label="Status" value={titleCase(selectedRequest.status)} />
            </div>
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] sm:grid-cols-2">
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(selectedRequest, "requested_by_name", textValue(selectedRequest, "requested_by", "Unknown"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(selectedRequest.requested_at)}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(selectedRequest, "approved_by_name", textValue(selectedRequest, "approved_by", "Pending"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(selectedRequest.approved_at)}</p></div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)]">
              <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text-primary)]">Breakdown</div>
              {requestLines.length ? <div className="divide-y divide-[var(--color-border)]">{requestLines.map((line) => <div key={textValue(line, "id")} className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"><span>{textValue(line, "description")} <span className="text-[10px] text-[var(--color-text-secondary)]"> · {textValue(line, "category")}</span></span><strong>{amount(line.amount)}</strong></div>)}</div> : <EmptyState>No breakdown lines found.</EmptyState>}
            </div>
            {textValue(selectedRequest, "note") ? <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">{textValue(selectedRequest, "note")}</p> : null}
            {textValue(selectedRequest, "decision_note") ? <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">{textValue(selectedRequest, "decision_note")}</p> : null}
          </div>
        </Modal>
      ) : null}

      {reviewRequest ? (
        <Modal title="Review Working Fund request" detail={textValue(reviewRequest, "project_name") + " · " + textValue(reviewRequest, "purpose")} close={() => setReviewRequest(null)}>
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] sm:grid-cols-2">
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(reviewRequest, "requested_by_name", textValue(reviewRequest, "requested_by", "Unknown"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(reviewRequest.requested_at)}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(reviewRequest, "approved_by_name", textValue(reviewRequest, "approved_by", "Pending"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(reviewRequest.approved_at)}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Requested amount" value={amount(reviewRequest.requested_amount)} />
              <Field label="Approved amount" value={approvalAmount} onChange={setApprovalAmount} type="number" min="0.01" step="0.01" required />
            </div>
            <TextArea label="Decision note" value={decisionNote} onChange={setDecisionNote} placeholder="Optional note for Accounting & Finance" />
            <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">If the breakdown is wrong, reject this request and submit a corrected request.</p>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" className="button-secondary" onClick={() => void reviewRequestDecision("rejected")} disabled={saving}>Reject</button><button type="button" className="button-primary inline-flex items-center gap-1" onClick={() => void reviewRequestDecision("approved")} disabled={saving}><Check size={14} /> Approve &amp; release</button></div>
          </div>
        </Modal>
      ) : null}

      {reviewDailyFundRequest ? (
        <Modal title="Review Daily Fund request" detail={textValue(reviewDailyFundRequest, "purpose") + " · " + dateLabel(reviewDailyFundRequest.fund_date)} close={() => setReviewDailyFundRequest(null)}>
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] sm:grid-cols-2">
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(reviewDailyFundRequest, "requested_by_name", textValue(reviewDailyFundRequest, "requested_by", "Unknown"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Requested at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(reviewDailyFundRequest.requested_at)}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(reviewDailyFundRequest, "approved_by_name", textValue(reviewDailyFundRequest, "approved_by", "Pending"))}</p></div>
              <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(reviewDailyFundRequest.approved_at)}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Requested amount" value={amount(reviewDailyFundRequest.requested_amount)} />
              <Field label="Approved amount" value={approvalAmount} onChange={setApprovalAmount} type="number" min="0.01" step="0.01" required />
            </div>
            {textValue(reviewDailyFundRequest, "note") ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] leading-5 text-[var(--color-text-secondary)]">{textValue(reviewDailyFundRequest, "note")}</p> : null}
            <TextArea label="Decision note" value={decisionNote} onChange={setDecisionNote} placeholder="Optional note for Accounting & Finance" />
            <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">If the request is wrong, reject it and submit a corrected Daily Fund request.</p>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" className="button-secondary" onClick={() => void reviewDailyFundDecision("rejected")} disabled={saving}>Reject</button><button type="button" className="button-primary inline-flex items-center gap-1" onClick={() => void reviewDailyFundDecision("approved")} disabled={saving}><Check size={14} /> Approve &amp; allocate</button></div>
          </div>
        </Modal>
      ) : null}

      {reviewTransaction ? <Modal title="Review Finance transaction" detail={transactionLabel(reviewTransaction) + " · " + textValue(reviewTransaction, "project_name", "Working Funds")} close={() => setReviewTransaction(null)}>
        <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Amount" value={amount(reviewTransaction.amount)} /><Metric label="Date" value={dateLabel(reviewTransaction.transaction_date)} /><Metric label="Reference" value={textValue(reviewTransaction, "reference_number", "—")} /></div>{textValue(reviewTransaction, "commission_allocation_id") ? <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 sm:grid-cols-3"><Metric label="Commission recipient" value={textValue(reviewTransaction, "commission_recipient_name", "—")} /><Metric label="Commission role" value={titleCase(reviewTransaction.commission_allocation_role)} /><Metric label="Project" value={textValue(reviewTransaction, "project_name", "—")} /></div> : null}<TextArea label={canRequestTransactionRevision(reviewTransaction) ? "Decision note" : "Approval note"} value={decisionNote} onChange={setDecisionNote} placeholder={canRequestTransactionRevision(reviewTransaction) ? "Required when requesting a revision" : "Optional approval note"} /><p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">{canRequestTransactionRevision(reviewTransaction) ? "Approve to post this Cash In or Cash Out. If the details are wrong, request a revision with a clear correction note; no ledger entry is posted." : "Approve to post this transaction. Corrections for Cash In and Cash Out use the revision workflow."}</p><div className="flex flex-wrap justify-end gap-2">{canRequestTransactionRevision(reviewTransaction) ? <button type="button" className="button-secondary" onClick={() => void reviewTransactionDecision("revision_requested")} disabled={saving || !decisionNote.trim()}>Request revision</button> : null}<button type="button" className="button-primary inline-flex items-center gap-1" onClick={() => void reviewTransactionDecision("approved")} disabled={saving}><Check size={14} /> Approve &amp; post</button></div></div>
      </Modal> : null}

      {repaymentRequest ? <Modal title="Return Working Funds" detail="Only completed projects can return approved support. The repayment is an internal project-to-Working-Funds transfer." close={() => setRepaymentRequest(null)}>
        <form className="space-y-4" onSubmit={submitRepayment}><div className="grid gap-3 sm:grid-cols-2"><Metric label="Project" value={textValue(repaymentRequest, "project_name")} /><Field label="Repayment amount" value={repaymentAmount} onChange={setRepaymentAmount} type="number" min="0.01" step="0.01" required /></div><p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">This does not create a client Cash In and does not add a project expense. GM approval is still required before the Working Funds balance changes.</p><div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => setRepaymentRequest(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>Submit repayment</button></div></form>
      </Modal> : null}

      {selectedTransaction ? <Modal title={transactionLabel(selectedTransaction)} detail={textValue(selectedTransaction, "project_name", "Daily Fund")} close={() => setSelectedTransaction(null)}>
        <div className="space-y-4">
          {gm && textValue(selectedTransaction, "status") === "approved" ? <div className="flex justify-end"><button type="button" className="button-danger text-[11px]" onClick={() => { setVoidTransaction(selectedTransaction); setVoidReason(""); setSelectedTransaction(null); }}>Reverse posted transaction</button></div> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Status" value={titleCase(selectedTransaction.status)} />
            <Metric label="Amount" value={amount(selectedTransaction.amount)} />
            <Metric label="Transaction date" value={dateLabel(selectedTransaction.transaction_date)} />
            <Metric label="Category" value={textValue(selectedTransaction, "category", "—")} />
            <Metric label="Reference" value={textValue(selectedTransaction, "reference_number", "—")} />
            <Metric label="Submitted at" value={dateLabel(selectedTransaction.submitted_at)} />
            <Metric label="Reverses" value={textValue(selectedTransaction, "reversal_of_transaction_id", "—")} />
          </div>
          <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] sm:grid-cols-2">
            <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Submitted by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(selectedTransaction, "submitted_by_name", textValue(selectedTransaction, "submitted_by", "—"))}</p></div>
            <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed by</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(selectedTransaction, "reviewed_by_name", textValue(selectedTransaction, "approved_by_name", textValue(selectedTransaction, "reviewed_by", textValue(selectedTransaction, "approved_by", "Pending"))))}</p></div>
            <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Reviewed at</p><p className="mt-1 text-[var(--color-text-primary)]">{dateLabel(selectedTransaction.reviewed_at ?? selectedTransaction.approved_at)}</p></div>
            <div><p className="text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Daily Fund request</p><p className="mt-1 break-all text-[var(--color-text-primary)]">{textValue(selectedTransaction, "daily_fund_request_id", "—")}</p></div>
          </div>
          {textValue(selectedTransaction, "note") ? <div><p className="text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Note</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-primary)]">{textValue(selectedTransaction, "note")}</p></div> : null}
          {textValue(selectedTransaction, "decision_note") ? <div><p className="text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Decision note</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-primary)]">{textValue(selectedTransaction, "decision_note")}</p></div> : null}
        </div>
      </Modal> : null}

      {voidTransaction ? <Modal title="Reverse Finance transaction" detail={transactionLabel(voidTransaction) + " · " + amount(voidTransaction.amount)} close={() => { setVoidTransaction(null); setVoidReason(""); }}>
        <form className="space-y-4" onSubmit={submitVoid}>
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">This keeps the original posted row in history as voided and creates an opposite ledger adjustment. The reversal is blocked if an incoming balance has already been used.</p>
          <TextArea label="Reversal reason" value={voidReason} onChange={setVoidReason} placeholder="Explain why this posted transaction must be reversed" />
          <div className="flex justify-end gap-2"><button type="button" className="button-secondary" onClick={() => { setVoidTransaction(null); setVoidReason(""); }}>Cancel</button><button type="submit" className="button-danger" disabled={saving || !voidReason.trim()}>Reverse transaction</button></div>
        </form>
      </Modal> : null}

      {selectedProject ? <Modal title={textValue(selectedProject, "project_name")} detail={textValue(selectedProject, "client_name", "No client") + " · " + textValue(selectedProject, "company_name", "No company")} close={() => setSelectedProject(null)} wide>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--color-text-secondary)]">Project Finance Monitoring</p>
              <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Quotation {textValue(selectedProject, "quotation_number", "—")} · client collections and expenses remain isolated to this project.</p>
            </div>
            <button type="button" className="button-secondary inline-flex items-center gap-2 text-[11px]" onClick={() => void generateProjectPdf()} disabled={saving || detailLoading || Boolean(costingError)}><Download size={14} /> Generate PDF</button>
          </div>
          <dl className="grid gap-x-6 gap-y-3 border-y border-[var(--color-border)] py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Quotation" value={amount(selectedProject.total_quotation)} />
            <Metric label="Client Cash In" value={amount(selectedProject.client_cash_in)} tone="positive" />
            <Metric label="Project balance" value={amount(selectedProject.available_balance)} tone={numberValue(selectedProject, "available_balance") < 0 ? "negative" : "positive"} />
            <Metric label="Project Cash Out" value={amount(selectedProject.cash_out)} />
            <Metric label="Working Fund support" value={amount(selectedProject.working_fund_support)} />
            <Metric label="Working Fund repaid" value={amount(selectedProject.working_fund_repaid)} tone="positive" />
            <Metric label="Outstanding support" value={amount(selectedProject.outstanding_working_fund)} tone={numberValue(selectedProject, "outstanding_working_fund") ? "warning" : "positive"} />
          </dl>
          <Panel title="Costing breakdown" detail="Pricing Officer submitted direct-cost lines grouped under each quotation product. GM markups, selling price, VAT, commission, and profit are excluded.">
            {detailLoading ? <LoadingState variant="section" label="Loading submitted costing..." /> : costingError ? <div className="space-y-3 p-4 text-[11px]"><p className="text-[var(--color-danger)]">The costing breakdown could not be loaded, so PDF export is disabled.</p><p className="text-[var(--color-text-secondary)]">{costingError}</p><button type="button" className="button-secondary" onClick={() => void openProject(selectedProject)} disabled={detailLoading}>Retry costing</button></div> : costingLines.length ? <div className="flex flex-col gap-4 p-4">
              <div className="order-last flex items-center justify-between gap-3 border-t-2 border-b-0 border-[var(--color-border-strong)] pt-3"><span className="text-[11px] font-bold uppercase tracking-[.04em] text-[var(--color-text-primary)]">Total Direct Cost</span><span className="text-[15px] font-bold tabular-nums text-[var(--color-text-primary)]">{amount(selectedCostingTotal)}</span></div>
              {selectedCostingGroups.map((group) => <div key={group.key} className="border-b border-[var(--color-border)] pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-[11px] font-semibold text-[var(--color-text-primary)]">{group.productDescription}</p><p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">Quotation quantity: {group.productQuantity}</p></div><span className="text-[11px] font-semibold tabular-nums text-[var(--color-text-primary)]">Product direct cost: {amount(group.totalDirectCost)}</span></div>
                <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-[11px]"><thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-2 py-2">Direct-cost line</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Unit cost</th><th className="px-2 py-2">Line total</th></tr></thead><tbody>{group.lines.map((line) => <tr key={textValue(line, "line_id")} className="border-b border-[var(--color-border)] last:border-0"><td className="px-2 py-2">{textValue(line, "description")}</td><td className="px-2 py-2">{textValue(line, "quantity")}</td><td className="px-2 py-2">{amount(line.unit_cost)}</td><td className="px-2 py-2 font-semibold">{amount(line.line_total)}</td></tr>)}</tbody></table></div>
              </div>)}
            </div> : <EmptyState>No submitted direct-cost lines are available for this quotation.</EmptyState>}
          </Panel>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Project Cash In breakdown" detail="Approved and pending Cash In records for this project.">{transactions.filter((item) => textValue(item, "project_fund_id") === textValue(selectedProject, "project_fund_id") && textValue(item, "transaction_kind") === "project_cash_in").length ? <ActivityTable transactions={transactions.filter((item) => textValue(item, "project_fund_id") === textValue(selectedProject, "project_fund_id") && textValue(item, "transaction_kind") === "project_cash_in")} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} /> : <EmptyState>No project Cash In records yet.</EmptyState>}</Panel>
            <Panel title="Project Cash Out breakdown" detail="Approved and pending project expenses and commission payouts for this project.">{transactions.filter((item) => textValue(item, "project_fund_id") === textValue(selectedProject, "project_fund_id") && ["project_cash_out", "commission_payout"].includes(textValue(item, "transaction_kind"))).length ? <ActivityTable transactions={transactions.filter((item) => textValue(item, "project_fund_id") === textValue(selectedProject, "project_fund_id") && ["project_cash_out", "commission_payout"].includes(textValue(item, "transaction_kind")))} canApprove={gm} onDetails={(transaction) => setSelectedTransaction(transaction)} onReview={(transaction) => { setReviewTransaction(transaction); setDecisionNote(""); }} onRevise={canOperate ? beginTransactionRevision : undefined} /> : <EmptyState>No project Cash Out records yet.</EmptyState>}</Panel>
          </div>
        </div>
      </Modal> : null}
    </div>
  );
}

function ActivityTable({
  transactions,
  canApprove,
  onDetails,
  onReview,
  onRevise,
}: {
  transactions: Row[];
  canApprove: boolean;
  onDetails?: (transaction: Row) => void;
  onReview: (transaction: Row) => void;
  onRevise?: (transaction: Row) => void;
}) {
  if (!transactions.length) return <EmptyState>No revised Finance transactions yet.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-[11px]">
        <thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Project / source</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3"></th></tr></thead>
        <tbody>{transactions.map((transaction) => <tr key={textValue(transaction, "id")} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-3 text-[var(--color-text-secondary)]">{dateLabel(transaction.transaction_date)}</td><td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{transactionLabel(transaction)}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(transaction, "project_name", "Daily Fund")}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(transaction, "category", "—")}</td><td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{amount(transaction.amount)}</td><td className="px-4 py-3"><StatusBadge status={textValue(transaction, "status")} /></td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{textValue(transaction, "submitted_by_name", textValue(transaction, "submitted_by", "Unknown"))}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-1">{onDetails ? <button type="button" className="button-secondary text-[10px]" onClick={() => onDetails(transaction)}>Details</button> : null}{canApprove && textValue(transaction, "status") === "pending" ? <button type="button" className="button-secondary text-[10px]" onClick={() => onReview(transaction)}>Review</button> : null}{onRevise && textValue(transaction, "status") === "revision_requested" && canRequestTransactionRevision(transaction) ? <button type="button" className="button-secondary text-[10px]" onClick={() => onRevise(transaction)}>Correct &amp; resubmit</button> : null}</div></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ApprovalTable({
  items,
  canReview,
  onTransactionDetails,
  onTransactionReview,
  onWorkingDetails,
  onWorkingReview,
  onDailyReview,
}: {
  items: FinanceApprovalItem[];
  canReview: boolean;
  onTransactionDetails: (transaction: Row) => void;
  onTransactionReview: (transaction: Row) => void;
  onWorkingDetails: (request: Row) => void;
  onWorkingReview: (request: Row) => void;
  onDailyReview: (request: Row) => void;
}) {
  if (!items.length) return <EmptyState>No pending Finance approvals.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-[11px]">
        <thead><tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-[.06em] text-[var(--color-text-secondary)]"><th className="px-4 py-3">Type</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Project / source</th><th className="px-4 py-3">Activity / purpose</th><th className="px-4 py-3">Category / breakdown</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Requested by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
        <tbody>{items.map((item) => <tr key={`${item.kind}-${item.id}`} className="border-b border-[var(--color-border)] last:border-0">
          <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{item.kind === "transaction" ? "Transaction" : item.kind === "working_request" ? "Working Funds" : "Daily Fund"}</td>
          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{dateLabel(item.date)}</td>
          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.project}</td>
          <td className="max-w-[260px] px-4 py-3 font-semibold text-[var(--color-text-primary)]">{item.activity}</td>
          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.category}</td>
          <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{amount(item.amount)}</td>
          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.requestedBy}</td>
          <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
          <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1">
            {item.kind === "transaction" && item.transaction ? <><button type="button" className="button-secondary text-[10px]" onClick={() => onTransactionDetails(item.transaction as Row)}>Details</button>{canReview ? <button type="button" className="button-secondary text-[10px]" onClick={() => onTransactionReview(item.transaction as Row)}>Review</button> : null}</> : null}
            {item.kind === "working_request" && item.request ? <><button type="button" className="button-secondary text-[10px]" onClick={() => onWorkingDetails(item.request as Row)}>View breakdown</button>{canReview ? <button type="button" className="button-secondary text-[10px]" onClick={() => onWorkingReview(item.request as Row)}>Review</button> : null}</> : null}
            {item.kind === "daily_request" && item.dailyRequest ? canReview ? <button type="button" className="button-secondary text-[10px]" onClick={() => onDailyReview(item.dailyRequest!)}>Review</button> : <span className="text-[10px] text-[var(--color-text-secondary)]">GM review required</span> : null}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}
