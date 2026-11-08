"use client";

import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  Coins,
  Landmark,
  Plus,
  RefreshCw,
  Settings2,
  Wallet,
  XCircle,
} from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadControl } from "@/components/ui/file-upload-control";
import { LoadingState } from "@/components/ui/loading-state";
import { NotificationDialog } from "@/components/ui/notification-dialog";

type Row = { id?: string; [key: string]: unknown };
type FoundationTab = "dashboard" | "working_funds" | "project_funds" | "labor" | "operating_costs" | "break_even";

type Snapshot = {
  capital_funds: number;
  working_funds: number;
  minimum_working_funds: number;
  working_funds_above_threshold: boolean;
  cash_position: number;
  cash_in: number;
  cash_out: number;
  project_funds: number;
  outstanding_advances: number;
  sales: number;
  collections: number;
  direct_costs: number;
  variable_costs: number;
  fixed_operating_actual: number;
  fixed_operating_budget: number;
  contribution_margin_ratio: number;
  break_even_sales: number;
  required_sales: number;
  desired_monthly_profit: number;
  profit: number;
  revenue_basis: string;
  status: string;
  month_start: string;
};

const EMPTY_SNAPSHOT: Snapshot = {
  capital_funds: 0,
  working_funds: 0,
  minimum_working_funds: 0,
  working_funds_above_threshold: false,
  cash_position: 0,
  cash_in: 0,
  cash_out: 0,
  project_funds: 0,
  outstanding_advances: 0,
  sales: 0,
  collections: 0,
  direct_costs: 0,
  variable_costs: 0,
  fixed_operating_actual: 0,
  fixed_operating_budget: 0,
  contribution_margin_ratio: 0,
  break_even_sales: 0,
  required_sales: 0,
  desired_monthly_profit: 0,
  profit: 0,
  revenue_basis: "net_sales",
  status: "below_break_even",
  month_start: "",
};

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const localMonth = () => localDate().slice(0, 7);
const value = (row: Row | null | undefined, key: string, fallback = "") => {
  const raw = row?.[key];
  return raw === null || raw === undefined ? fallback : String(raw);
};
const numberValue = (row: Row | null | undefined, key: string) => {
  const raw = Number(row?.[key]);
  return Number.isFinite(raw) ? raw : 0;
};
const dateLabel = (raw: unknown) => {
  const text = String(raw ?? "");
  if (!text) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
};
const inputValue = (row: Row | null | undefined, key: string) => {
  const raw = row?.[key];
  return raw === null || raw === undefined ? "" : String(raw);
};

const roleCanManage = (role: string) => ["super_admin", "owner", "admin", "internal_finance"].includes(role);
const roleCanRequest = (role: string) => ["external_finance", "project_manager"].includes(role);

function FoundationStatus({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  const positive = ["target hit", "profitable", "paid", "approved", "repaid", "verified", "open"].includes(normalized);
  const negative = ["negative", "rejected", "voided", "closed"].includes(normalized);
  const className = positive
    ? "border-[var(--color-success-border)] bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
    : negative
      ? "border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)] text-[var(--color-danger-text)]"
      : "border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] text-[var(--color-warning-text)]";
  return <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[10px] font-semibold capitalize ${className}`}><span aria-hidden="true">{positive ? "✓" : negative ? "!" : "•"}</span>{normalized}</span>;
}

function FoundationPanel({ title, detail, children, action }: { title: string; detail?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
      <div><h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</h2>{detail && <p className="mt-1 max-w-3xl text-[11px] leading-4 text-[var(--color-text-secondary)]">{detail}</p>}</div>
      {action}
    </div>
    {children}
  </section>;
}

function FoundationMetric({ label, amount, detail, tone = "neutral", icon }: { label: string; amount: string; detail?: string; tone?: "neutral" | "positive" | "negative" | "warning"; icon?: ReactNode }) {
  const toneClass = tone === "positive" ? "text-[var(--color-success-text)]" : tone === "negative" ? "text-[var(--color-danger-text)]" : tone === "warning" ? "text-[var(--color-warning-text)]" : "text-[var(--color-text-primary)]";
  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">{label}</p>{icon && <span className="text-[var(--color-text-secondary)]">{icon}</span>}</div>
    <p className={`mt-3 text-2xl font-bold tracking-tight ${toneClass}`}>{amount}</p>
    {detail && <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-secondary)]">{detail}</p>}
  </div>;
}

function FoundationInput({ label, value, onChange, type = "text", placeholder, required = false, min, max, step }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; min?: string; max?: string; step?: string }) {
  return <label className="block text-[11px] font-medium text-[var(--color-text-primary)]"><span>{label}</span><input className="input mt-1 w-full" type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} min={min} max={max} step={step} /></label>;
}

function FoundationSelect({ label, value, onChange, children, required = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; required?: boolean }) {
  return <label className="block text-[11px] font-medium text-[var(--color-text-primary)]"><span>{label}</span><select className="input mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)} required={required}>{children}</select></label>;
}

function FoundationDialog({ title, detail, close, children, wide = false }: { title: string; detail?: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const detailId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, button");
      firstField?.focus();
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
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={detail ? detailId : undefined} className={`max-h-[calc(100dvh-2rem)] w-full ${wide ? "max-w-5xl" : "max-w-3xl"} overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 id={titleId} className="text-[17px] font-semibold text-[var(--color-text-primary)]">{title}</h2>{detail && <p id={detailId} className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{detail}</p>}</div>
        <button type="button" onClick={close} aria-label="Close" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><XCircle size={18} /></button>
      </div>
      {children}
    </div>
  </div>;
}

type WorkingForm = { entryType: string; direction: string; amount: string; date: string; reference: string; note: string };
type AdvanceForm = { amount: string; note: string };
type LaborRateForm = { fundId: string; boxMaker: string; task: string; unit: string; unitRate: string; plannedQuantity: string; totalRate: string; note: string };
type AccomplishmentForm = { rateId: string; date: string; completed: string; accepted: string; rejected: string; note: string };
type RunForm = { paymentDate: string; note: string };
type TemplateForm = { name: string; category: string; costClass: string; expected: string; dueDay: string; note: string };
type OperatingEntryForm = { date: string; name: string; category: string; costClass: string; amount: string; status: string; templateId: string; note: string };
type FoundationDialogKind = "settings" | "working" | "advance_request" | "advance_repayment" | "labor_rate" | "accomplishment" | "payment_run" | "operating_template" | "operating_entry" | null;
type ReleaseDialog = { kind: "advance" | "labor"; row: Row } | null;

export function FinanceFoundationWorkspace({ organizationId, role }: { organizationId: string; role: string }) {
  const client = useMemo(() => createClient(), []);
  const canManage = roleCanManage(role);
  const canRequest = roleCanRequest(role);
  const canViewFinancialSnapshot = canManage || role === "external_finance";
  const canRecordLabor = canManage || ["project_manager", "production"].includes(role);
  const canVerifyLabor = canManage || role === "project_manager";
  const canPrepareLaborRun = role === "external_finance";
  const canReleaseFoundation = role === "external_finance";
  const canEditOperatingCosts = role === "external_finance";
  const [tab, setTab] = useState<FoundationTab>(canViewFinancialSnapshot ? "dashboard" : role === "production" ? "labor" : "project_funds");
  const [month, setMonth] = useState(localMonth());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Row | null>(null);
  const [funds, setFunds] = useState<Row[]>([]);
  const [advances, setAdvances] = useState<Row[]>([]);
  const [laborRates, setLaborRates] = useState<Row[]>([]);
  const [accomplishments, setAccomplishments] = useState<Row[]>([]);
  const [paymentRuns, setPaymentRuns] = useState<Row[]>([]);
  const [operatingTemplates, setOperatingTemplates] = useState<Row[]>([]);
  const [operatingEntries, setOperatingEntries] = useState<Row[]>([]);
  const [workingEntries, setWorkingEntries] = useState<Row[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState("");
  const [selectedAdvanceId, setSelectedAdvanceId] = useState("");
  const [foundationDialog, setFoundationDialog] = useState<FoundationDialogKind>(null);
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialog>(null);
  const [releaseForm, setReleaseForm] = useState({ accountId: "", note: "" });
  const [releaseFile, setReleaseFile] = useState<File | null>(null);

  const [settingsForm, setSettingsForm] = useState({ openingCapital: "", openingWorking: "", minimumWorking: "", desiredProfit: "", vatRate: "12", revenueBasis: "net_sales" });
  const [workingForm, setWorkingForm] = useState<WorkingForm>({ entryType: "other_in", direction: "credit", amount: "", date: localDate(), reference: "", note: "" });
  const [advanceForm, setAdvanceForm] = useState<AdvanceForm>({ amount: "", note: "" });
  const [laborRateForm, setLaborRateForm] = useState<LaborRateForm>({ fundId: "", boxMaker: "", task: "", unit: "box", unitRate: "", plannedQuantity: "", totalRate: "", note: "" });
  const [accomplishmentForm, setAccomplishmentForm] = useState<AccomplishmentForm>({ rateId: "", date: localDate(), completed: "", accepted: "", rejected: "0", note: "" });
  const [runForm, setRunForm] = useState<RunForm>({ paymentDate: "", note: "" });
  const [templateForm, setTemplateForm] = useState<TemplateForm>({ name: "", category: "", costClass: "fixed", expected: "", dueDay: "", note: "" });
  const [entryForm, setEntryForm] = useState<OperatingEntryForm>({ date: localDate(), name: "", category: "", costClass: "fixed", amount: "", status: "planned", templateId: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const snapshotRequest = canViewFinancialSnapshot
      ? client.rpc("get_finance_foundation_snapshot", { p_organization_id: organizationId, p_month: `${month}-01` })
      : Promise.resolve({ data: null, error: null });
    const settingsRequest = canManage
      ? client.from("finance_foundation_settings").select("*").eq("organization_id", organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const paymentAccountsRequest = canReleaseFoundation
      ? client.rpc("list_finance_payment_accounts", { p_organization_id: organizationId })
      : Promise.resolve({ data: [], error: null });
    const [snapshotResult, settingsResult, fundsResult, advancesResult, ratesResult, accomplishmentsResult, runsResult, templatesResult, entriesResult, workingResult, paymentAccountsResult] = await Promise.all([
      snapshotRequest,
      settingsRequest,
      client.from("finance_project_fund_summary").select("*").eq("organization_id", organizationId).order("status").order("project_name"),
      client.from("project_company_advances").select("*").eq("organization_id", organizationId).order("requested_at", { ascending: false }),
      client.from("finance_project_labor_summary").select("*").eq("organization_id", organizationId).order("project_name").order("box_maker_name"),
      client.from("labor_accomplishments").select("*").eq("organization_id", organizationId).order("accomplishment_date", { ascending: false }),
      client.from("labor_payment_runs").select("*").eq("organization_id", organizationId).order("payment_date", { ascending: false }),
      client.from("operating_cost_templates").select("*").eq("organization_id", organizationId).order("category").order("name"),
      client.from("operating_cost_entries").select("*").eq("organization_id", organizationId).order("cost_date", { ascending: false }),
      client.from("company_working_fund_entries").select("*").eq("organization_id", organizationId).order("entry_date", { ascending: false }).limit(100),
      paymentAccountsRequest,
    ]);
    const failed = [snapshotResult, settingsResult, fundsResult, advancesResult, ratesResult, accomplishmentsResult, runsResult, templatesResult, entriesResult, workingResult, paymentAccountsResult].find((result) => result.error);
    if (failed?.error) setError(failed.error.message);
    if (!snapshotResult.error) setSnapshot((snapshotResult.data ?? null) as Snapshot | null);
    if (!settingsResult.error) {
      const nextSettings = (settingsResult.data ?? null) as Row | null;
      setSettings(nextSettings);
      if (nextSettings) setSettingsForm({
        openingCapital: inputValue(nextSettings, "opening_capital_funds"),
        openingWorking: inputValue(nextSettings, "opening_working_funds"),
        minimumWorking: inputValue(nextSettings, "minimum_working_funds"),
        desiredProfit: inputValue(nextSettings, "desired_monthly_profit"),
        vatRate: inputValue(nextSettings, "default_vat_rate") || "12",
        revenueBasis: inputValue(nextSettings, "revenue_basis") || "net_sales",
      });
    }
    if (!fundsResult.error) setFunds((fundsResult.data ?? []) as Row[]);
    if (!advancesResult.error) setAdvances((advancesResult.data ?? []) as Row[]);
    if (!ratesResult.error) setLaborRates((ratesResult.data ?? []) as Row[]);
    if (!accomplishmentsResult.error) setAccomplishments((accomplishmentsResult.data ?? []) as Row[]);
    if (!runsResult.error) setPaymentRuns((runsResult.data ?? []) as Row[]);
    if (!templatesResult.error) setOperatingTemplates((templatesResult.data ?? []) as Row[]);
    if (!entriesResult.error) setOperatingEntries((entriesResult.data ?? []) as Row[]);
    if (!workingResult.error) setWorkingEntries((workingResult.data ?? []) as Row[]);
    if (!paymentAccountsResult.error) setPaymentAccounts((paymentAccountsResult.data ?? []) as Row[]);
    setLoading(false);
  }, [canManage, canReleaseFoundation, canViewFinancialSnapshot, client, month, organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const runAction = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    const result = await action();
    setSaving(false);
    if (result.error) { setError(result.error.message); return false; }
    setNotice(success);
    await load();
    return true;
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await runAction(() => client.rpc("upsert_finance_foundation_settings", {
      p_organization_id: organizationId,
      p_opening_capital_funds: Number(settingsForm.openingCapital || 0),
      p_opening_working_funds: Number(settingsForm.openingWorking || 0),
      p_minimum_working_funds: Number(settingsForm.minimumWorking || 0),
      p_desired_monthly_profit: Number(settingsForm.desiredProfit || 0),
      p_default_vat_rate: Number(settingsForm.vatRate || 12),
      p_revenue_basis: settingsForm.revenueBasis,
    }), "Financial foundation settings saved.");
    if (saved) setFoundationDialog(null);
  };

  const saveWorkingEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!workingForm.amount || Number(workingForm.amount) <= 0) return setError("Enter a positive Working Funds amount.");
    const saved = await runAction(() => client.rpc("record_company_working_fund_entry", {
      p_organization_id: organizationId, p_entry_type: workingForm.entryType, p_direction: workingForm.direction,
      p_amount: Number(workingForm.amount), p_entry_date: workingForm.date, p_reference_no: workingForm.reference || null,
      p_note: workingForm.note || null,
    }), "Working Funds entry recorded.");
    if (saved) { setWorkingForm({ entryType: "other_in", direction: "credit", amount: "", date: localDate(), reference: "", note: "" }); setFoundationDialog(null); }
  };

  const saveAdvance = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFundId || !advanceForm.amount || Number(advanceForm.amount) <= 0) return setError("Choose a project and enter a positive advance amount.");
    const saved = await runAction(() => client.rpc("request_project_company_advance", {
      p_project_fund_id: selectedFundId, p_requested_amount: Number(advanceForm.amount), p_note: advanceForm.note || null,
    }), "Company Working Fund advance requested.");
    if (saved) { setAdvanceForm({ amount: "", note: "" }); setSelectedFundId(""); setFoundationDialog(null); }
  };

  const saveLaborRate = async (event: FormEvent) => {
    event.preventDefault();
    if (!laborRateForm.fundId || !laborRateForm.boxMaker || !laborRateForm.task || !laborRateForm.unitRate || !laborRateForm.totalRate) return setError("Project, box maker, task, unit rate, and total rate are required.");
    const saved = await runAction(() => client.rpc("create_project_labor_rate", {
      p_project_fund_id: laborRateForm.fundId, p_box_maker_name: laborRateForm.boxMaker, p_task_name: laborRateForm.task,
      p_unit_label: laborRateForm.unit, p_unit_rate: Number(laborRateForm.unitRate), p_planned_quantity: Number(laborRateForm.plannedQuantity || 0),
      p_agreed_total_rate: Number(laborRateForm.totalRate), p_note: laborRateForm.note || null,
    }), "Individual project labor rate assigned.");
    if (saved) { setLaborRateForm({ fundId: "", boxMaker: "", task: "", unit: "box", unitRate: "", plannedQuantity: "", totalRate: "", note: "" }); setFoundationDialog(null); }
  };

  const saveAccomplishment = async (event: FormEvent) => {
    event.preventDefault();
    if (!accomplishmentForm.rateId || !accomplishmentForm.completed || !accomplishmentForm.accepted) return setError("Choose a labor rate and enter the completed and accepted quantities.");
    const saved = await runAction(() => client.rpc("record_labor_accomplishment", {
      p_labor_rate_id: accomplishmentForm.rateId, p_accomplishment_date: accomplishmentForm.date,
      p_completed_quantity: Number(accomplishmentForm.completed), p_accepted_quantity: Number(accomplishmentForm.accepted),
      p_rejected_quantity: Number(accomplishmentForm.rejected || 0), p_note: accomplishmentForm.note || null,
    }), "Work accomplishment submitted for verification.");
    if (saved) { setAccomplishmentForm({ rateId: "", date: localDate(), completed: "", accepted: "", rejected: "0", note: "" }); setFoundationDialog(null); }
  };

  const savePaymentRun = async (event: FormEvent) => {
    event.preventDefault();
    if (!runForm.paymentDate) return setError("Choose a Tuesday or Friday payment date.");
    const saved = await runAction(() => client.rpc("create_labor_payment_run", { p_organization_id: organizationId, p_payment_date: runForm.paymentDate, p_note: runForm.note || null }), "Labor payment run prepared.");
    if (saved) { setRunForm({ paymentDate: "", note: "" }); setFoundationDialog(null); }
  };

  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!templateForm.name || !templateForm.category || !templateForm.expected) return setError("Name, category, and expected monthly amount are required.");
    const saved = await runAction(() => client.rpc("create_operating_cost_template", {
      p_organization_id: organizationId, p_name: templateForm.name, p_category: templateForm.category, p_cost_class: templateForm.costClass,
      p_expected_monthly_amount: Number(templateForm.expected), p_due_day: templateForm.dueDay ? Number(templateForm.dueDay) : null, p_note: templateForm.note || null,
    }), "Operating cost template saved.");
    if (saved) { setTemplateForm({ name: "", category: "", costClass: "fixed", expected: "", dueDay: "", note: "" }); setFoundationDialog(null); }
  };

  const saveOperatingEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!entryForm.name || !entryForm.category || !entryForm.amount) return setError("Name, category, and amount are required.");
    const saved = await runAction(() => client.rpc("record_operating_cost_entry", {
      p_organization_id: organizationId, p_cost_date: entryForm.date, p_name: entryForm.name, p_category: entryForm.category,
      p_cost_class: entryForm.costClass, p_amount: Number(entryForm.amount), p_status: "planned", p_template_id: entryForm.templateId || null, p_note: entryForm.note || null,
    }), "Planned operating cost recorded. Submit it through Finance Cash Out when it is paid.");
    if (saved) { setEntryForm({ date: localDate(), name: "", category: "", costClass: "fixed", amount: "", status: "planned", templateId: "", note: "" }); setFoundationDialog(null); }
  };

  const reviewAdvance = async (advance: Row, decision: "approved" | "rejected") => {
    const amount = numberValue(advance, "requested_amount");
    await runAction(() => client.rpc("review_project_company_advance", { p_advance_id: advance.id, p_decision: decision, p_approved_amount: amount, p_note: null }), decision === "approved" ? "Company advance approved." : "Company advance rejected.");
  };

  const releaseAdvance = (advance: Row) => {
    setReleaseForm({ accountId: paymentAccounts.length === 1 ? String(paymentAccounts[0].id) : "", note: "" });
    setReleaseFile(null);
    setReleaseDialog({ kind: "advance", row: advance });
  };

  const repayAdvance = (advance: Row) => {
    const outstanding = Math.max(numberValue(advance, "released_amount"), 0);
    if (!outstanding) return setError("This advance has no released balance.");
    setSelectedAdvanceId(String(advance.id));
    setAdvanceForm({ amount: outstanding.toFixed(2), note: "Client balance collection repayment" });
    setFoundationDialog("advance_repayment");
  };

  const submitRepayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAdvanceId || !advanceForm.amount) return setError("Choose an advance and enter a repayment amount.");
    const saved = await runAction(() => client.rpc("record_project_company_advance_repayment", { p_advance_id: selectedAdvanceId, p_amount: Number(advanceForm.amount), p_note: advanceForm.note || null }), "Company advance repayment recorded.");
    if (saved) { setSelectedAdvanceId(""); setAdvanceForm({ amount: "", note: "" }); setFoundationDialog(null); }
  };

  const verifyAccomplishment = async (row: Row, decision: "verified" | "rejected") => {
    await runAction(() => client.rpc("verify_labor_accomplishment", { p_accomplishment_id: row.id, p_decision: decision, p_note: null }), decision === "verified" ? "Accomplishment verified." : "Accomplishment rejected.");
  };

  const approveRun = async (row: Row) => {
    await runAction(() => client.rpc("approve_labor_payment_run", { p_payment_run_id: row.id, p_note: null }), "Labor payment run approved. External Finance can now release it.");
  };

  const openLaborRelease = (row: Row) => {
    setReleaseForm({ accountId: paymentAccounts.length === 1 ? String(paymentAccounts[0].id) : "", note: "" });
    setReleaseFile(null);
    setReleaseDialog({ kind: "labor", row });
  };

  const submitFoundationRelease = async (event: FormEvent) => {
    event.preventDefault();
    if (!releaseDialog) return;
    if (!releaseForm.accountId) return setError("Choose the active Cash Out payment account.");
    if (!releaseFile) return setError("Upload the payment proof image before releasing.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(releaseFile.type) || releaseFile.size < 1 || releaseFile.size > 10 * 1024 * 1024) return setError("Use a JPG, PNG, or WEBP image up to 10 MB.");
    const extension = releaseFile.type === "image/jpeg" ? "jpg" : releaseFile.type === "image/png" ? "png" : "webp";
    const path = `${organizationId}/foundation-releases/${releaseDialog.kind === "advance" ? "advances" : "labor-runs"}/${String(releaseDialog.row.id)}.${extension}`;
    setSaving(true);
    setError(null);
    const upload = await client.storage.from("finance-receipts").upload(path, releaseFile, { contentType: releaseFile.type, upsert: false });
    if (upload.error) { setSaving(false); setError(upload.error.message); return; }
    const result = releaseDialog.kind === "advance"
      ? await client.rpc("release_project_company_advance", { p_advance_id: releaseDialog.row.id, p_account_id: releaseForm.accountId, p_note: releaseForm.note || null, p_receipt_storage_path: path, p_receipt_file_name: releaseFile.name, p_receipt_content_type: releaseFile.type, p_receipt_file_size: releaseFile.size })
      : await client.rpc("release_labor_payment_run", { p_payment_run_id: releaseDialog.row.id, p_account_id: releaseForm.accountId, p_note: releaseForm.note || null, p_receipt_storage_path: path, p_receipt_file_name: releaseFile.name, p_receipt_content_type: releaseFile.type, p_receipt_file_size: releaseFile.size });
    if (result.error) {
      await client.storage.from("finance-receipts").remove([path]);
      setSaving(false);
      setError(result.error.message);
      return;
    }
    setSaving(false);
    setReleaseDialog(null);
    setReleaseForm({ accountId: "", note: "" });
    setReleaseFile(null);
    setNotice(releaseDialog.kind === "advance" ? "Company Working Fund advance released to the Project Fund." : "Labor payment released and charged to each Project Fund.");
    await load();
  };

  if (loading && !snapshot) return <LoadingState variant="section" label="Loading Financial Foundation..." />;

  const current = snapshot ?? EMPTY_SNAPSHOT;
  const activeRates = laborRates.filter((rate) => value(rate, "status") === "active");
  const pendingAccomplishments = accomplishments.filter((row) => value(row, "status") === "submitted");
  const foundationTabs: Array<[FoundationTab, string]> = canViewFinancialSnapshot
    ? [["dashboard", "Dashboard"], ["working_funds", "Working Funds"], ["project_funds", "Project Funds"], ["labor", "Labor Payments"], ["operating_costs", "Operating Costs"], ["break_even", "Break-even"]]
    : [["project_funds", "Project Funds"], ["labor", "Labor Payments"]];

  return <div className="space-y-4">
    {(error || notice) && <NotificationDialog message={error ?? notice ?? "Financial Foundation update completed."} tone={error ? "error" : "success"} close={() => { setError(null); setNotice(null); }} retry={error ? () => void load() : undefined} retrying={loading} />}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[var(--color-text-secondary)]">Huswell Trading</p><h1 className="mt-1 text-[20px] font-semibold tracking-tight text-[var(--color-text-primary)]">Financial Foundation</h1><p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Project money, Company Working Funds, labor, operating costs, and break-even in one controlled flow.</p></div>
      <div className="flex items-center gap-2"><label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Month<input aria-label="Financial Foundation month" className="input mt-1 block" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" className="button-secondary mt-4 inline-flex items-center gap-1.5" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={14} aria-hidden="true" />Refresh</button></div>
    </div>
    <nav className="app-tabs overflow-x-auto" aria-label="Financial Foundation sections">{foundationTabs.map(([key, label]) => <button type="button" className="app-tab whitespace-nowrap" key={key} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === "dashboard" && <FoundationDashboard snapshot={current} funds={funds} onProjectFunds={() => setTab("project_funds")} />}
    {tab === "working_funds" && <WorkingFundsPanel canManage={canManage} snapshot={current} entries={workingEntries} onOpenEntry={() => setFoundationDialog("working")} />}
    {tab === "project_funds" && <ProjectFundsPanel canManage={canManage} canRequest={canRequest} canRelease={canReleaseFoundation} funds={funds} advances={advances} onOpenRequest={() => setFoundationDialog("advance_request")} onRepayClick={repayAdvance} onReviewAdvance={reviewAdvance} onReleaseAdvance={releaseAdvance} />}
    {tab === "labor" && <LaborPanel canRecord={canRecordLabor} canVerify={canVerifyLabor} canPrepareRun={canPrepareLaborRun} canRelease={canReleaseFoundation} rates={laborRates} accomplishments={accomplishments} runs={paymentRuns} onOpenRate={() => setFoundationDialog("labor_rate")} onOpenAccomplishment={() => setFoundationDialog("accomplishment")} onOpenRun={() => setFoundationDialog("payment_run")} onVerify={verifyAccomplishment} onApproveRun={approveRun} onReleaseRun={openLaborRelease} pendingAccomplishments={pendingAccomplishments} />}
    {tab === "operating_costs" && <OperatingCostsPanel canEdit={canEditOperatingCosts} templates={operatingTemplates} entries={operatingEntries} onOpenTemplate={() => setFoundationDialog("operating_template")} onOpenEntry={() => setFoundationDialog("operating_entry")} />}
    {tab === "break_even" && <BreakEvenPanel canManage={canManage} snapshot={current} settings={settings} onOpenSettings={() => setFoundationDialog("settings")} />}

    {foundationDialog === "settings" && <FoundationDialog title="Foundation settings" detail="Set the opening capital, Company Working Funds, minimum reserve, desired monthly profit, VAT assumption, and revenue basis." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={saveSettings}><FoundationInput label="Opening capital funds" value={settingsForm.openingCapital} onChange={(openingCapital) => setSettingsForm({ ...settingsForm, openingCapital })} type="number" min="0" step="0.01" /><FoundationInput label="Opening Working Funds" value={settingsForm.openingWorking} onChange={(openingWorking) => setSettingsForm({ ...settingsForm, openingWorking })} type="number" min="0" step="0.01" /><FoundationInput label="Minimum Working Funds" value={settingsForm.minimumWorking} onChange={(minimumWorking) => setSettingsForm({ ...settingsForm, minimumWorking })} type="number" min="0" step="0.01" /><FoundationInput label="Desired monthly profit" value={settingsForm.desiredProfit} onChange={(desiredProfit) => setSettingsForm({ ...settingsForm, desiredProfit })} type="number" min="0" step="0.01" /><FoundationInput label="Default VAT rate (%)" value={settingsForm.vatRate} onChange={(vatRate) => setSettingsForm({ ...settingsForm, vatRate })} type="number" min="0" max="100" step="0.01" /><FoundationSelect label="Revenue basis" value={settingsForm.revenueBasis} onChange={(revenueBasis) => setSettingsForm({ ...settingsForm, revenueBasis })} required><option value="net_sales">Net sales</option><option value="collections">Collections</option></FoundationSelect><div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Save settings"}</button></div></form></FoundationDialog>}
    {foundationDialog === "working" && <FoundationDialog title="Record Working Funds entry" detail="Use this ledger for company-level capital, transfers, and adjustments. Project advances are recorded automatically when released." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={saveWorkingEntry}><FoundationSelect label="Entry type" value={workingForm.entryType} onChange={(entryType) => setWorkingForm({ ...workingForm, entryType })} required><option value="capital_in">Capital in</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="other_in">Other cash in</option><option value="other_out">Other cash out</option><option value="adjustment">Adjustment</option></FoundationSelect><FoundationSelect label="Direction" value={workingForm.direction} onChange={(direction) => setWorkingForm({ ...workingForm, direction })} required><option value="credit">Cash in / credit</option><option value="debit">Cash out / debit</option></FoundationSelect><FoundationInput label="Amount" value={workingForm.amount} onChange={(amount) => setWorkingForm({ ...workingForm, amount })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Entry date" value={workingForm.date} onChange={(date) => setWorkingForm({ ...workingForm, date })} type="date" required /><FoundationInput label="Reference no." value={workingForm.reference} onChange={(reference) => setWorkingForm({ ...workingForm, reference })} placeholder="Receipt, voucher, or transfer ref." /><FoundationInput label="Purpose / note" value={workingForm.note} onChange={(note) => setWorkingForm({ ...workingForm, note })} placeholder="Why was this released?" /><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Record entry"}</button></div></form></FoundationDialog>}
    {foundationDialog === "advance_request" && <FoundationDialog title="Request temporary Company Working Fund support" detail="Choose the Project Fund that needs temporary support. Internal Finance must approve it, External Finance releases it with an account and proof, and the project repays it after client collection." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={saveAdvance}><FoundationSelect label="Project Fund" value={selectedFundId} onChange={setSelectedFundId} required><option value="">Choose an open Project Fund</option>{funds.filter((fund) => value(fund, "status") === "open").map((fund) => <option key={String(fund.id)} value={String(fund.id)}>{value(fund, "project_name", "Unnamed project")}</option>)}</FoundationSelect><FoundationInput label="Requested amount" value={advanceForm.amount} onChange={(amount) => setAdvanceForm({ ...advanceForm, amount })} type="number" min="0.01" step="0.01" required /><label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Purpose / note</span><textarea className="input mt-1 min-h-20 w-full" value={advanceForm.note} onChange={(event) => setAdvanceForm({ ...advanceForm, note: event.target.value })} placeholder="Why does this project need temporary support?" /></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Submit request"}</button></div></form></FoundationDialog>}
    {foundationDialog === "advance_repayment" && <FoundationDialog title="Record project advance repayment" detail="Record the client-balance repayment back to Company Working Funds. The Project Fund receives the repayment debit and the Company Working Funds ledger receives the credit." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submitRepayment}><FoundationInput label="Repayment amount" value={advanceForm.amount} onChange={(amount) => setAdvanceForm({ ...advanceForm, amount })} type="number" min="0.01" step="0.01" required /><label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Repayment note</span><textarea className="input mt-1 min-h-20 w-full" value={advanceForm.note} onChange={(event) => setAdvanceForm({ ...advanceForm, note: event.target.value })} /></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Record repayment"}</button></div></form></FoundationDialog>}
    {foundationDialog === "labor_rate" && <FoundationDialog title="Assign individual box-maker labor rate" detail="Each box maker gets an agreed rate for a specific project and assigned work. Tuesday and Friday amounts come from verified accomplishment, not an estimated percentage." close={() => setFoundationDialog(null)} wide><form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={saveLaborRate}><FoundationSelect label="Project Fund" value={laborRateForm.fundId} onChange={(fundId) => setLaborRateForm({ ...laborRateForm, fundId })} required><option value="">Choose a project</option>{funds.filter((fund) => value(fund, "status") === "open").map((fund) => <option key={String(fund.id)} value={String(fund.id)}>{value(fund, "project_name", "Unnamed project")}</option>)}</FoundationSelect><FoundationInput label="Box maker" value={laborRateForm.boxMaker} onChange={(boxMaker) => setLaborRateForm({ ...laborRateForm, boxMaker })} placeholder="Name" required /><FoundationInput label="Assigned work" value={laborRateForm.task} onChange={(task) => setLaborRateForm({ ...laborRateForm, task })} placeholder="e.g. Assembly" required /><FoundationInput label="Unit" value={laborRateForm.unit} onChange={(unit) => setLaborRateForm({ ...laborRateForm, unit })} placeholder="box" required /><FoundationInput label="Agreed unit rate" value={laborRateForm.unitRate} onChange={(unitRate) => setLaborRateForm({ ...laborRateForm, unitRate })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Planned quantity" value={laborRateForm.plannedQuantity} onChange={(plannedQuantity) => setLaborRateForm({ ...laborRateForm, plannedQuantity })} type="number" min="0" step="0.01" /><FoundationInput label="Total agreed labor rate" value={laborRateForm.totalRate} onChange={(totalRate) => setLaborRateForm({ ...laborRateForm, totalRate })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Note" value={laborRateForm.note} onChange={(note) => setLaborRateForm({ ...laborRateForm, note })} placeholder="Optional scope note" /><div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Assign rate"}</button></div></form></FoundationDialog>}
    {foundationDialog === "accomplishment" && <FoundationDialog title="Submit verified work accomplishment" detail="Enter actual completed and accepted quantities. Internal Finance verifies the entry before it can be included in a Tuesday or Friday payment run." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={saveAccomplishment}><FoundationSelect label="Labor rate" value={accomplishmentForm.rateId} onChange={(rateId) => setAccomplishmentForm({ ...accomplishmentForm, rateId })} required><option value="">Choose a labor rate</option>{activeRates.map((rate) => <option key={String(rate.id)} value={String(rate.id)}>{value(rate, "box_maker_name")} · {value(rate, "task_name")} · {value(rate, "project_name", "Project")}</option>)}</FoundationSelect><FoundationInput label="Accomplishment date" value={accomplishmentForm.date} onChange={(date) => setAccomplishmentForm({ ...accomplishmentForm, date })} type="date" required /><FoundationInput label="Completed quantity" value={accomplishmentForm.completed} onChange={(completed) => setAccomplishmentForm({ ...accomplishmentForm, completed })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Accepted quantity" value={accomplishmentForm.accepted} onChange={(accepted) => setAccomplishmentForm({ ...accomplishmentForm, accepted })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Rejected quantity" value={accomplishmentForm.rejected} onChange={(rejected) => setAccomplishmentForm({ ...accomplishmentForm, rejected })} type="number" min="0" step="0.01" /><label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Verification note</span><textarea className="input mt-1 min-h-20 w-full" value={accomplishmentForm.note} onChange={(event) => setAccomplishmentForm({ ...accomplishmentForm, note: event.target.value })} placeholder="Evidence or supervisor note" /></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Submit accomplishment"}</button></div></form></FoundationDialog>}
    {foundationDialog === "payment_run" && <FoundationDialog title="Prepare Tuesday or Friday payment run" detail="External Finance selects the payment date. The run includes only verified, unpaid accomplishments and remains pending Internal Finance approval." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={savePaymentRun}><FoundationInput label="Payment date" value={runForm.paymentDate} onChange={(paymentDate) => setRunForm({ ...runForm, paymentDate })} type="date" required /><FoundationInput label="Run note" value={runForm.note} onChange={(note) => setRunForm({ ...runForm, note })} placeholder="Optional payroll note" /><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Prepare run"}</button></div></form></FoundationDialog>}
    {foundationDialog === "operating_template" && <FoundationDialog title="Add recurring operating-cost template" detail="Set the expected monthly amount for salaries, electricity, water, rent, subscriptions, delivery, and other operating costs." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={saveTemplate}><FoundationInput label="Cost name" value={templateForm.name} onChange={(name) => setTemplateForm({ ...templateForm, name })} placeholder="e.g. Monthly salary" required /><FoundationInput label="Category" value={templateForm.category} onChange={(category) => setTemplateForm({ ...templateForm, category })} placeholder="Salary, rent, utilities" required /><FoundationSelect label="Cost class" value={templateForm.costClass} onChange={(costClass) => setTemplateForm({ ...templateForm, costClass })} required><option value="fixed">Fixed</option><option value="variable">Variable</option></FoundationSelect><FoundationInput label="Expected monthly amount" value={templateForm.expected} onChange={(expected) => setTemplateForm({ ...templateForm, expected })} type="number" min="0" step="0.01" required /><FoundationInput label="Due day" value={templateForm.dueDay} onChange={(dueDay) => setTemplateForm({ ...templateForm, dueDay })} type="number" min="1" max="31" step="1" /><FoundationInput label="Note" value={templateForm.note} onChange={(note) => setTemplateForm({ ...templateForm, note })} placeholder="Optional cost policy" /><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Save template"}</button></div></form></FoundationDialog>}
    {foundationDialog === "operating_entry" && <FoundationDialog title="Record planned operating cost" detail="Create the planned salary, utility, rent, subscription, delivery, or other cost first. When it is paid, submit it through Finance Cash Out so Internal Finance can verify it and External Finance can release it." close={() => setFoundationDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={saveOperatingEntry}><FoundationInput label="Cost date" value={entryForm.date} onChange={(date) => setEntryForm({ ...entryForm, date })} type="date" required /><FoundationInput label="Cost name" value={entryForm.name} onChange={(name) => setEntryForm({ ...entryForm, name })} placeholder="e.g. Electricity bill" required /><FoundationInput label="Category" value={entryForm.category} onChange={(category) => setEntryForm({ ...entryForm, category })} placeholder="Salary, utilities, rent" required /><FoundationSelect label="Cost class" value={entryForm.costClass} onChange={(costClass) => setEntryForm({ ...entryForm, costClass })} required><option value="fixed">Fixed</option><option value="variable">Variable</option></FoundationSelect><FoundationInput label="Amount" value={entryForm.amount} onChange={(amount) => setEntryForm({ ...entryForm, amount })} type="number" min="0.01" step="0.01" required /><FoundationSelect label="Template" value={entryForm.templateId} onChange={(templateId) => setEntryForm({ ...entryForm, templateId })}><option value="">No template</option>{operatingTemplates.map((template) => <option key={String(template.id)} value={String(template.id)}>{value(template, "name")}</option>)}</FoundationSelect><label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Note</span><textarea className="input mt-1 min-h-20 w-full" value={entryForm.note} onChange={(event) => setEntryForm({ ...entryForm, note: event.target.value })} placeholder="Bill or payment context" /></label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setFoundationDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Record planned cost"}</button></div></form></FoundationDialog>}

    {releaseDialog && <FoundationDialog title={releaseDialog.kind === "advance" ? "Release Company Working Fund advance" : "Release labor payment"} detail="External Finance releases the verified payment from an active account. Upload proof so the Finance transaction, Project Fund, and account movement stay linked." close={() => setReleaseDialog(null)}><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submitFoundationRelease}><div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] sm:col-span-2"><p className="font-semibold text-[var(--color-text-primary)]">{releaseDialog.kind === "advance" ? "Company advance" : "Tuesday/Friday labor run"}</p><p className="mt-1 text-[var(--color-text-secondary)]">{value(releaseDialog.row, "note", "No release note")} · {peso.format(numberValue(releaseDialog.row, releaseDialog.kind === "advance" ? "approved_amount" : "total_amount"))}</p></div><FoundationSelect label="Cash Out payment account" value={releaseForm.accountId} onChange={(accountId) => setReleaseForm({ ...releaseForm, accountId })} required><option value="">Choose an active account</option>{paymentAccounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{value(account, "account_name")} · {value(account, "account_type", "account")}</option>)}</FoundationSelect><label className="block text-[11px] font-medium text-[var(--color-text-primary)]"><span>Release note</span><textarea className="input mt-1 min-h-20 w-full" value={releaseForm.note} onChange={(event) => setReleaseForm({ ...releaseForm, note: event.target.value })} placeholder="Optional payment note" /></label><label className="block text-[11px] font-medium text-[var(--color-text-primary)] sm:col-span-2"><span>Payment proof image</span><FileUploadControl accept="image/jpeg,image/png,image/webp" ariaLabel="Choose payment proof image" className="mt-1" emptyLabel="Choose JPG, PNG, or WEBP proof" files={releaseFile ? [releaseFile] : []} onFilesSelected={(files) => setReleaseFile(files[0] ?? null)} /></label>{!paymentAccounts.length && <p className="rounded-md border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[11px] text-[var(--color-warning-text)] sm:col-span-2">Internal Finance must add an active payment account before this release can be completed.</p>}<div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="button-secondary" onClick={() => setReleaseDialog(null)}>Cancel</button><button type="submit" className="button-primary" disabled={saving || !paymentAccounts.length}>{saving ? "Releasing..." : "Release payment"}</button></div></form></FoundationDialog>}
  </div>;
}

function FoundationDashboard({ snapshot, funds, onProjectFunds }: { snapshot: Snapshot; funds: Row[]; onProjectFunds: () => void }) {
  const statusLabel = snapshot.status.replaceAll("_", " ");
  const profitTone = snapshot.profit > 0 ? "positive" : snapshot.profit < 0 ? "negative" : "neutral";
  const workingTone = snapshot.working_funds_above_threshold ? "positive" : "warning";
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FoundationMetric label="Cash Position" amount={peso.format(snapshot.cash_position)} detail="Actual cash, bank, and e-wallet position" tone={snapshot.cash_position < 0 ? "negative" : "positive"} icon={<Landmark size={16} aria-hidden="true" />} />
      <FoundationMetric label="Working Funds" amount={peso.format(snapshot.working_funds)} detail={`Minimum reserve: ${peso.format(snapshot.minimum_working_funds)}`} tone={workingTone} icon={<Wallet size={16} aria-hidden="true" />} />
      <FoundationMetric label="Project Funds" amount={peso.format(snapshot.project_funds)} detail="Available dedicated project balances" tone="neutral" icon={<Coins size={16} aria-hidden="true" />} />
      <FoundationMetric label="Outstanding Advances" amount={peso.format(snapshot.outstanding_advances)} detail="Company support still to be returned" tone={snapshot.outstanding_advances > 0 ? "warning" : "positive"} icon={<CircleDollarSign size={16} aria-hidden="true" />} />
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <FoundationMetric label="Cash In" amount={peso.format(snapshot.cash_in)} detail="Collections and other recorded inflows for the selected month" tone="positive" />
      <FoundationMetric label="Cash Out" amount={peso.format(snapshot.cash_out)} detail="Verified expenses and recorded operational outflows" tone={snapshot.cash_out > snapshot.cash_in ? "negative" : "neutral"} />
      <FoundationMetric label="Profit / (Loss)" amount={peso.format(snapshot.profit)} detail={snapshot.revenue_basis === "collections" ? "Based on collections" : "Based on net sales"} tone={profitTone} />
    </div>
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${snapshot.status === "negative" ? "border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)]" : snapshot.status === "target_hit" || snapshot.status === "profitable" ? "border-[var(--color-success-border)] bg-[var(--color-success-subtle)]" : "border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)]"}`}>
      <div><div className="flex items-center gap-2"><FoundationStatus status={snapshot.status} /><p className="text-[12px] font-semibold capitalize text-[var(--color-text-primary)]">{statusLabel}</p></div><p className="mt-2 text-[11px] leading-4 text-[var(--color-text-secondary)]">Required sales for break-even plus the desired monthly profit: <span className="font-semibold text-[var(--color-text-primary)]">{peso.format(snapshot.required_sales)}</span>.</p></div>
      <button type="button" className="button-secondary inline-flex items-center gap-1.5" onClick={onProjectFunds}>Open Project Funds <span aria-hidden="true">→</span></button>
    </div>
    <FoundationPanel title="Project fund health" detail="Each project is monitored independently. A positive balance is not available to another project; it remains assigned to its own project fund.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[780px]"><thead><tr><th>Project</th><th>Status</th><th>Client collections</th><th>Project expenses</th><th>Labor paid</th><th>Available</th></tr></thead><tbody>{funds.slice(0, 8).map((fund) => <tr key={String(fund.id)}><td><p className="font-semibold">{value(fund, "project_name", "Unnamed project")}</p><p className="text-[10px] text-[var(--color-text-secondary)]">{value(fund, "client_name", "No client")}</p></td><td><FoundationStatus status={value(fund, "status", "open")} /></td><td>{peso.format(numberValue(fund, "client_payments"))}</td><td>{peso.format(numberValue(fund, "project_expenses"))}</td><td>{peso.format(numberValue(fund, "labor_payments"))}</td><td className={numberValue(fund, "available_balance") < 0 ? "font-semibold text-[var(--color-danger-text)]" : "font-semibold text-[var(--color-success-text)]"}>{peso.format(numberValue(fund, "available_balance"))}</td></tr>)}{!funds.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No approved Price Quotations have created a Project Fund yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function WorkingFundsPanel({ canManage, snapshot, entries, onOpenEntry }: { canManage: boolean; snapshot: Snapshot; entries: Row[]; onOpenEntry: () => void }) {
  return <div className="space-y-4">
    <FoundationPanel title="Company Working Funds" detail="Company-level operating money and temporary project support. Project advances are recorded automatically when External Finance releases them and must be repaid after client collection." action={canManage && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenEntry}><Plus size={14} aria-hidden="true" />Record entry</button>}>
      <div className="grid gap-3 p-4 sm:grid-cols-3"><FoundationMetric label="Available" amount={peso.format(snapshot.working_funds)} tone={snapshot.working_funds_above_threshold ? "positive" : "warning"} /><FoundationMetric label="Minimum reserve" amount={peso.format(snapshot.minimum_working_funds)} /><FoundationMetric label="Above threshold" amount={snapshot.working_funds_above_threshold ? "Yes" : "No"} tone={snapshot.working_funds_above_threshold ? "positive" : "warning"} /></div>
      {!canManage && <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Internal Finance records company-level Working Funds adjustments.</p>}
    </FoundationPanel>
    <FoundationPanel title="Working Funds ledger" detail="The audit trail for capital transfers, temporary project support, repayments, and operating cash movements.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[820px]"><thead><tr><th>Date</th><th>Type</th><th>Direction</th><th>Reference</th><th>Amount</th><th>Purpose</th></tr></thead><tbody>{entries.map((entry) => <tr key={String(entry.id)}><td>{dateLabel(entry.entry_date)}</td><td className="capitalize">{value(entry, "entry_type").replaceAll("_", " ")}</td><td><FoundationStatus status={value(entry, "direction")} /></td><td>{value(entry, "reference_no", "—")}</td><td className={value(entry, "direction") === "debit" ? "font-semibold text-[var(--color-danger-text)]" : "font-semibold text-[var(--color-success-text)]"}>{peso.format(numberValue(entry, "amount"))}</td><td>{value(entry, "note", "—")}</td></tr>)}{!entries.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No Working Funds entries recorded yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function ProjectFundsPanel({ canManage, canRequest, canRelease, funds, advances, onOpenRequest, onReviewAdvance, onReleaseAdvance, onRepayClick }: { canManage: boolean; canRequest: boolean; canRelease: boolean; funds: Row[]; advances: Row[]; onOpenRequest: () => void; onReviewAdvance: (row: Row, decision: "approved" | "rejected") => void; onReleaseAdvance: (row: Row) => void; onRepayClick: (row: Row) => void }) {
  return <div className="space-y-4">
    <FoundationPanel title="Automatic Project Fund creation" detail="A dedicated Project Fund is created automatically when a Price Quotation is approved.">
      <div className="space-y-2 p-4 text-[11px] leading-4 text-[var(--color-text-secondary)]"><p>No manual setup is required. Approved Price Quotations appear in the Project Fund balances below after the page is refreshed.</p><p>Client payments, project expenses, labor payments, company advances, and repayments remain linked to the automatically created fund.</p></div>
    </FoundationPanel>
    <FoundationPanel title="Project Fund balances" detail="Each project has its own balance. A positive balance remains assigned to that project and cannot be spent by another project.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Project</th><th>Status</th><th>Client cash in</th><th>Company advances</th><th>Expenses</th><th>Labor</th><th>Available</th></tr></thead><tbody>{funds.map((fund) => <tr key={String(fund.id)}><td><p className="font-semibold">{value(fund, "project_name", "Unnamed project")}</p><p className="text-[10px] text-[var(--color-text-secondary)]">{value(fund, "client_name", "No client")}</p></td><td><FoundationStatus status={value(fund, "status", "open")} /></td><td>{peso.format(numberValue(fund, "client_payments"))}</td><td>{peso.format(numberValue(fund, "company_advances"))}</td><td>{peso.format(numberValue(fund, "project_expenses"))}</td><td>{peso.format(numberValue(fund, "labor_payments"))}</td><td className={numberValue(fund, "available_balance") < 0 ? "font-semibold text-[var(--color-danger-text)]" : "font-semibold text-[var(--color-success-text)]"}>{peso.format(numberValue(fund, "available_balance"))}</td></tr>)}{!funds.length && <tr><td colSpan={7} className="text-center text-[var(--color-text-secondary)]">No Project Funds found.</td></tr>}</tbody></table></div>
    </FoundationPanel>
    <FoundationPanel title="Temporary Company Working Fund support" detail="Request support only when the selected Project Fund is insufficient. It is a repayable advance, not project income." action={canRequest && <button type="button" className="button-secondary inline-flex items-center gap-1.5" onClick={onOpenRequest}><Plus size={14} aria-hidden="true" />Request support</button>}>
      {!canRequest && <p className="border-b border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-text-secondary)]">External Finance or the authorized Project Manager requests temporary support. Internal Finance reviews the request; External Finance releases it.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[1040px]"><thead><tr><th>Project fund</th><th>Requested</th><th>Approved</th><th>Released</th><th>Status</th><th>Actions</th></tr></thead><tbody>{advances.map((advance) => { const status = value(advance, "status", "requested"); return <tr key={String(advance.id)}><td>{value(advance, "project_fund_id", "—").slice(0, 8)}…</td><td>{peso.format(numberValue(advance, "requested_amount"))}</td><td>{peso.format(numberValue(advance, "approved_amount"))}</td><td>{peso.format(numberValue(advance, "released_amount"))}</td><td><FoundationStatus status={status} /></td><td><div className="flex flex-wrap gap-2">{canManage && status === "requested" && <><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onReviewAdvance(advance, "approved")}><Check size={13} aria-hidden="true" />Approve</button><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onReviewAdvance(advance, "rejected")}><XCircle size={13} aria-hidden="true" />Reject</button></>}{canRelease && status === "approved" && <button type="button" className="button-primary" onClick={() => onReleaseAdvance(advance)}>Release with proof</button>}{canRelease && ["released", "partially_repaid"].includes(status) && <button type="button" className="button-secondary" onClick={() => onRepayClick(advance)}>Record repayment</button>}{!canManage && !canRelease && status === "requested" && <span className="text-[11px] text-[var(--color-text-secondary)]">Waiting for Internal Finance</span>}</div></td></tr>; })}{!advances.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No company advances requested.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function LaborPanel({ canRecord, canVerify, canPrepareRun, canRelease, rates, accomplishments, runs, onOpenRate, onOpenAccomplishment, onOpenRun, onVerify, onApproveRun, onReleaseRun, pendingAccomplishments }: { canRecord: boolean; canVerify: boolean; canPrepareRun: boolean; canRelease: boolean; rates: Row[]; accomplishments: Row[]; runs: Row[]; onOpenRate: () => void; onOpenAccomplishment: () => void; onOpenRun: () => void; onVerify: (row: Row, decision: "verified" | "rejected") => void; onApproveRun: (row: Row) => void; onReleaseRun: (row: Row) => void; pendingAccomplishments: Row[] }) {
  const [section, setSection] = useState<"rates" | "accomplishments" | "runs">("rates");
  const actions = section === "rates" ? canRecord && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenRate}><Plus size={14} aria-hidden="true" />Assign rate</button> : section === "accomplishments" ? canRecord && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenAccomplishment}><Plus size={14} aria-hidden="true" />Submit accomplishment</button> : canPrepareRun && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenRun}><Plus size={14} aria-hidden="true" />Prepare run</button>;
  return <div className="space-y-4">
    <div className="app-tabs overflow-x-auto" aria-label="Labor payment sections"><button type="button" className="app-tab whitespace-nowrap" aria-current={section === "rates" ? "page" : undefined} onClick={() => setSection("rates")}>Individual rates</button><button type="button" className="app-tab whitespace-nowrap" aria-current={section === "accomplishments" ? "page" : undefined} onClick={() => setSection("accomplishments")}>Work accomplishment</button><button type="button" className="app-tab whitespace-nowrap" aria-current={section === "runs" ? "page" : undefined} onClick={() => setSection("runs")}>Tuesday &amp; Friday runs</button></div>
    {section === "rates" && <FoundationPanel title="Individual Box Maker Labor Rates" detail="Each box maker has an agreed rate for assigned work in a specific project. Payment is calculated from verified accomplishment." action={actions}><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Project</th><th>Box maker</th><th>Work</th><th>Unit rate</th><th>Agreed total</th><th>Accepted qty.</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>{rates.map((rate) => <tr key={String(rate.id)}><td>{value(rate, "project_name", value(rate, "project_fund_id").slice(0, 8))}</td><td className="font-semibold">{value(rate, "box_maker_name")}</td><td>{value(rate, "task_name")}</td><td>{peso.format(numberValue(rate, "unit_rate"))} / {value(rate, "unit_label", "unit")}</td><td>{peso.format(numberValue(rate, "agreed_total_rate"))}</td><td>{numberValue(rate, "accepted_quantity")}</td><td>{peso.format(numberValue(rate, "paid_amount"))}</td><td className="font-semibold text-[var(--color-success-text)]">{peso.format(numberValue(rate, "remaining_amount"))}</td></tr>)}{!rates.length && <tr><td colSpan={8} className="text-center text-[var(--color-text-secondary)]">No individual project labor rates yet.</td></tr>}</tbody></table></div>{!canRecord && <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-text-secondary)]">Project Manager or Production maintains the assigned work and agreed labor rates.</p>}</FoundationPanel>}
    {section === "accomplishments" && <FoundationPanel title="Verified work accomplishment" detail="Record actual completed and accepted quantities. Internal Finance verifies the work before it enters a Tuesday or Friday payment run." action={actions}><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[860px]"><thead><tr><th>Date</th><th>Labor rate</th><th>Completed</th><th>Accepted</th><th>Payable</th><th>Status</th><th>Actions</th></tr></thead><tbody>{accomplishments.map((row) => <tr key={String(row.id)}><td>{dateLabel(row.accomplishment_date)}</td><td>{value(row, "labor_rate_id").slice(0, 8)}…</td><td>{numberValue(row, "completed_quantity")}</td><td>{numberValue(row, "accepted_quantity")}</td><td>{peso.format(numberValue(row, "payable_amount"))}</td><td><FoundationStatus status={value(row, "status", "submitted")} /></td><td>{canVerify && value(row, "status") === "submitted" && <div className="flex gap-2"><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onVerify(row, "verified")}><Check size={13} aria-hidden="true" />Verify</button><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onVerify(row, "rejected")}><XCircle size={13} aria-hidden="true" />Reject</button></div>}</td></tr>)}{!accomplishments.length && <tr><td colSpan={7} className="text-center text-[var(--color-text-secondary)]">No work accomplishment entries yet.</td></tr>}</tbody></table></div>{pendingAccomplishments.length > 0 && <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-warning-text)]"><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />{pendingAccomplishments.length} accomplishment entr{pendingAccomplishments.length === 1 ? "y is" : "ies are"} waiting for verification.</p>}</FoundationPanel>}
    {section === "runs" && <FoundationPanel title="Tuesday & Friday payment runs" detail="The run includes only verified, unpaid accomplishments. Internal Finance approves the run; External Finance releases the actual Cash Out with an account and proof." action={actions}><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[820px]"><thead><tr><th>Payment date</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead><tbody>{runs.map((run) => { const status = value(run, "status", "draft"); return <tr key={String(run.id)}><td>{dateLabel(run.payment_date)}</td><td><FoundationStatus status={status} /></td><td>{value(run, "note", "—")}</td><td><div className="flex flex-wrap gap-2">{canVerify && status === "draft" && <button type="button" className="button-secondary" onClick={() => onApproveRun(run)}>Approve run</button>}{canRelease && status === "approved" && <button type="button" className="button-primary" onClick={() => onReleaseRun(run)}>Release with proof</button>}{status === "paid" && <span className="text-[11px] text-[var(--color-success-text)]">Released</span>}</div></td></tr>; })}{!runs.length && <tr><td colSpan={4} className="text-center text-[var(--color-text-secondary)]">No Tuesday or Friday payment runs yet.</td></tr>}</tbody></table></div></FoundationPanel>}
  </div>;
}

function OperatingCostsPanel({ canEdit, templates, entries, onOpenTemplate, onOpenEntry }: { canEdit: boolean; templates: Row[]; entries: Row[]; onOpenTemplate: () => void; onOpenEntry: () => void }) {
  const [section, setSection] = useState<"recurring" | "actual">("recurring");
  return <div className="space-y-4">
    <div className="app-tabs overflow-x-auto" aria-label="Operating cost sections"><button type="button" className="app-tab whitespace-nowrap" aria-current={section === "recurring" ? "page" : undefined} onClick={() => setSection("recurring")}>Recurring plan</button><button type="button" className="app-tab whitespace-nowrap" aria-current={section === "actual" ? "page" : undefined} onClick={() => setSection("actual")}>Planned / paid costs</button></div>
    {section === "recurring" && <FoundationPanel title="Recurring operational cost templates" detail="Set expected monthly costs for salary, electricity, water, rent, subscriptions, delivery, and other categories. These feed the break-even sales quota." action={canEdit && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenTemplate}><Plus size={14} aria-hidden="true" />Add recurring cost</button>}><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[760px]"><thead><tr><th>Cost</th><th>Category</th><th>Class</th><th>Expected monthly</th><th>Due day</th><th>Status</th></tr></thead><tbody>{templates.map((template) => <tr key={String(template.id)}><td className="font-semibold">{value(template, "name")}</td><td>{value(template, "category")}</td><td className="capitalize">{value(template, "cost_class")}</td><td>{peso.format(numberValue(template, "expected_monthly_amount"))}</td><td>{value(template, "due_day", "—")}</td><td><FoundationStatus status={template.is_active === false ? "closed" : "active"} /></td></tr>)}{!templates.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No recurring costs configured.</td></tr>}</tbody></table></div>{!canEdit && <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-text-secondary)]">External Finance records operating-cost assumptions and planned entries.</p>}</FoundationPanel>}
    {section === "actual" && <FoundationPanel title="Planned operating costs" detail="Create the planned cost here, then submit the matching Finance Cash Out. Internal Finance verifies it and External Finance releases the actual payment; only then does the entry become Paid." action={canEdit && <button type="button" className="button-primary inline-flex items-center gap-1.5" onClick={onOpenEntry}><Plus size={14} aria-hidden="true" />Record planned cost</button>}><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Date</th><th>Cost</th><th>Category</th><th>Class</th><th>Amount</th><th>Status</th><th>Cash Out link</th><th>Note</th></tr></thead><tbody>{entries.map((entry) => <tr key={String(entry.id)}><td>{dateLabel(entry.cost_date)}</td><td className="font-semibold">{value(entry, "name")}</td><td>{value(entry, "category")}</td><td className="capitalize">{value(entry, "cost_class")}</td><td>{peso.format(numberValue(entry, "amount"))}</td><td><FoundationStatus status={value(entry, "status", "planned")} /></td><td>{value(entry, "finance_transaction_id") ? <span className="text-[var(--color-success-text)]">Linked</span> : <span className="text-[var(--color-warning-text)]">Needs Cash Out</span>}</td><td>{value(entry, "note", "—")}</td></tr>)}{!entries.length && <tr><td colSpan={8} className="text-center text-[var(--color-text-secondary)]">No operating cost entries yet.</td></tr>}</tbody></table></div></FoundationPanel>}
  </div>;
}

function BreakEvenPanel({ canManage, snapshot, settings, onOpenSettings }: { canManage: boolean; snapshot: Snapshot; settings: Row | null; onOpenSettings: () => void }) {
  const margin = snapshot.contribution_margin_ratio * 100;
  return <div className="space-y-4">
    <FoundationPanel title="Break-even and sales quota" detail="Formula: Break-even Sales = Fixed Operating Costs ÷ Contribution Margin Ratio. Required Sales = (Fixed Operating Costs + Desired Monthly Profit) ÷ Contribution Margin Ratio.">
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4"><FoundationMetric label="Break-even sales" amount={peso.format(snapshot.break_even_sales)} detail="Monthly sales needed to cover fixed costs" tone="warning" /><FoundationMetric label="Required sales quota" amount={peso.format(snapshot.required_sales)} detail={`Includes desired profit of ${peso.format(snapshot.desired_monthly_profit)}`} tone="positive" /><FoundationMetric label="Contribution margin" amount={`${margin.toFixed(1)}%`} detail="After variable costs" /><FoundationMetric label="Actual profit / (loss)" amount={peso.format(snapshot.profit)} detail="Selected month" tone={snapshot.profit < 0 ? "negative" : "positive"} /></div>
      <div className="grid gap-3 border-t border-[var(--color-border)] p-4 sm:grid-cols-2"><div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Inputs used</p><dl className="mt-3 space-y-2 text-[11px]"><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Fixed operating actual</dt><dd className="font-semibold">{peso.format(snapshot.fixed_operating_actual)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Fixed operating budget</dt><dd className="font-semibold">{peso.format(snapshot.fixed_operating_budget)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Variable costs</dt><dd className="font-semibold">{peso.format(snapshot.variable_costs)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Revenue basis</dt><dd className="font-semibold capitalize">{snapshot.revenue_basis.replaceAll("_", " ")}</dd></div></dl></div><div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Interpretation</p><p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">If actual sales are below the required sales quota, the month is not yet meeting the desired target. If profit is negative, Huswell Trading is operating at a loss for the selected month.</p></div></div>
    </FoundationPanel>
    <FoundationPanel title="Foundation settings" detail="Set the opening capital, Company Working Funds, minimum operating reserve, desired monthly profit, VAT assumption, and whether the target is based on net sales or collections." action={canManage && <button type="button" className="button-secondary inline-flex items-center gap-1.5" onClick={onOpenSettings}><Settings2 size={14} aria-hidden="true" />Edit settings</button>}>
      <div className="p-4 text-[11px] text-[var(--color-text-secondary)]">{canManage ? "Internal Finance maintains these assumptions. " : "Read-only settings. "}Current desired monthly profit: <span className="font-semibold text-[var(--color-text-primary)]">{peso.format(numberValue(settings, "desired_monthly_profit"))}</span>.</div>
    </FoundationPanel>
  </div>;
}
