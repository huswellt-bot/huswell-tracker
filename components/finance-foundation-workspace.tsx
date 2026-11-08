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
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
const roleCanRequest = (role: string) => roleCanManage(role) || role === "project_manager";

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

export function FinanceFoundationWorkspace({ organizationId, role }: { organizationId: string; role: string }) {
  const client = useMemo(() => createClient(), []);
  const canManage = roleCanManage(role);
  const canRequest = roleCanRequest(role);
  const canViewFinancialSnapshot = canManage || role === "external_finance";
  const canRecordLabor = canManage || ["project_manager", "production"].includes(role);
  const canVerifyLabor = canManage || role === "project_manager";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState("");
  const [selectedAdvanceId, setSelectedAdvanceId] = useState("");

  const [settingsForm, setSettingsForm] = useState({ openingCapital: "", openingWorking: "", minimumWorking: "", desiredProfit: "", vatRate: "12", revenueBasis: "net_sales" });
  const [workingForm, setWorkingForm] = useState({ entryType: "other_in", direction: "credit", amount: "", date: localDate(), reference: "", note: "" });
  const [advanceForm, setAdvanceForm] = useState({ amount: "", note: "" });
  const [laborRateForm, setLaborRateForm] = useState({ fundId: "", boxMaker: "", task: "", unit: "box", unitRate: "", plannedQuantity: "", totalRate: "", note: "" });
  const [accomplishmentForm, setAccomplishmentForm] = useState({ rateId: "", date: localDate(), completed: "", accepted: "", rejected: "0", note: "" });
  const [runForm, setRunForm] = useState({ paymentDate: "", note: "" });
  const [templateForm, setTemplateForm] = useState({ name: "", category: "", costClass: "fixed", expected: "", dueDay: "", note: "" });
  const [entryForm, setEntryForm] = useState({ date: localDate(), name: "", category: "", costClass: "fixed", amount: "", status: "planned", templateId: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const snapshotRequest = canViewFinancialSnapshot
      ? client.rpc("get_finance_foundation_snapshot", { p_organization_id: organizationId, p_month: `${month}-01` })
      : Promise.resolve({ data: null, error: null });
    const settingsRequest = canManage
      ? client.from("finance_foundation_settings").select("*").eq("organization_id", organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [snapshotResult, settingsResult, fundsResult, advancesResult, ratesResult, accomplishmentsResult, runsResult, templatesResult, entriesResult, workingResult] = await Promise.all([
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
    ]);
    const failed = [snapshotResult, settingsResult, fundsResult, advancesResult, ratesResult, accomplishmentsResult, runsResult, templatesResult, entriesResult, workingResult].find((result) => result.error);
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
    setLoading(false);
  }, [canManage, canViewFinancialSnapshot, client, month, organizationId]);

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
    await runAction(() => client.rpc("upsert_finance_foundation_settings", {
      p_organization_id: organizationId,
      p_opening_capital_funds: Number(settingsForm.openingCapital || 0),
      p_opening_working_funds: Number(settingsForm.openingWorking || 0),
      p_minimum_working_funds: Number(settingsForm.minimumWorking || 0),
      p_desired_monthly_profit: Number(settingsForm.desiredProfit || 0),
      p_default_vat_rate: Number(settingsForm.vatRate || 12),
      p_revenue_basis: settingsForm.revenueBasis,
    }), "Financial foundation settings saved.");
  };

  const saveWorkingEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!workingForm.amount || Number(workingForm.amount) <= 0) return setError("Enter a positive Working Funds amount.");
    const saved = await runAction(() => client.rpc("record_company_working_fund_entry", {
      p_organization_id: organizationId,
      p_entry_type: workingForm.entryType,
      p_direction: workingForm.direction,
      p_amount: Number(workingForm.amount),
      p_entry_date: workingForm.date,
      p_reference_no: workingForm.reference || null,
      p_note: workingForm.note || null,
    }), "Working Funds entry recorded.");
    if (saved) setWorkingForm({ entryType: "other_in", direction: "credit", amount: "", date: localDate(), reference: "", note: "" });
  };

  const saveAdvance = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFundId || !advanceForm.amount || Number(advanceForm.amount) <= 0) return setError("Choose a project and enter a positive advance amount.");
    const saved = await runAction(() => client.rpc("request_project_company_advance", {
      p_project_fund_id: selectedFundId, p_requested_amount: Number(advanceForm.amount), p_note: advanceForm.note || null,
    }), "Company Working Fund advance requested.");
    if (saved) { setAdvanceForm({ amount: "", note: "" }); setSelectedFundId(""); }
  };

  const saveLaborRate = async (event: FormEvent) => {
    event.preventDefault();
    if (!laborRateForm.fundId || !laborRateForm.boxMaker || !laborRateForm.task || !laborRateForm.unitRate || !laborRateForm.totalRate) return setError("Project, box maker, task, unit rate, and total rate are required.");
    const saved = await runAction(() => client.rpc("create_project_labor_rate", {
      p_project_fund_id: laborRateForm.fundId, p_box_maker_name: laborRateForm.boxMaker, p_task_name: laborRateForm.task,
      p_unit_label: laborRateForm.unit, p_unit_rate: Number(laborRateForm.unitRate), p_planned_quantity: Number(laborRateForm.plannedQuantity || 0),
      p_agreed_total_rate: Number(laborRateForm.totalRate), p_note: laborRateForm.note || null,
    }), "Individual project labor rate assigned.");
    if (saved) setLaborRateForm({ fundId: "", boxMaker: "", task: "", unit: "box", unitRate: "", plannedQuantity: "", totalRate: "", note: "" });
  };

  const saveAccomplishment = async (event: FormEvent) => {
    event.preventDefault();
    if (!accomplishmentForm.rateId || !accomplishmentForm.completed || !accomplishmentForm.accepted) return setError("Choose a labor rate and enter the completed and accepted quantities.");
    const saved = await runAction(() => client.rpc("record_labor_accomplishment", {
      p_labor_rate_id: accomplishmentForm.rateId, p_accomplishment_date: accomplishmentForm.date,
      p_completed_quantity: Number(accomplishmentForm.completed), p_accepted_quantity: Number(accomplishmentForm.accepted),
      p_rejected_quantity: Number(accomplishmentForm.rejected || 0), p_note: accomplishmentForm.note || null,
    }), "Work accomplishment submitted for verification.");
    if (saved) setAccomplishmentForm({ rateId: "", date: localDate(), completed: "", accepted: "", rejected: "0", note: "" });
  };

  const savePaymentRun = async (event: FormEvent) => {
    event.preventDefault();
    if (!runForm.paymentDate) return setError("Choose a Tuesday or Friday payment date.");
    const saved = await runAction(() => client.rpc("create_labor_payment_run", { p_organization_id: organizationId, p_payment_date: runForm.paymentDate, p_note: runForm.note || null }), "Labor payment run prepared.");
    if (saved) setRunForm({ paymentDate: "", note: "" });
  };

  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!templateForm.name || !templateForm.category || !templateForm.expected) return setError("Name, category, and expected monthly amount are required.");
    const saved = await runAction(() => client.rpc("create_operating_cost_template", {
      p_organization_id: organizationId, p_name: templateForm.name, p_category: templateForm.category, p_cost_class: templateForm.costClass,
      p_expected_monthly_amount: Number(templateForm.expected), p_due_day: templateForm.dueDay ? Number(templateForm.dueDay) : null, p_note: templateForm.note || null,
    }), "Operating cost template saved.");
    if (saved) setTemplateForm({ name: "", category: "", costClass: "fixed", expected: "", dueDay: "", note: "" });
  };

  const saveOperatingEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!entryForm.name || !entryForm.category || !entryForm.amount) return setError("Name, category, and amount are required.");
    const saved = await runAction(() => client.rpc("record_operating_cost_entry", {
      p_organization_id: organizationId, p_cost_date: entryForm.date, p_name: entryForm.name, p_category: entryForm.category,
      p_cost_class: entryForm.costClass, p_amount: Number(entryForm.amount), p_status: entryForm.status, p_template_id: entryForm.templateId || null, p_note: entryForm.note || null,
    }), "Operating cost recorded.");
    if (saved) setEntryForm({ date: localDate(), name: "", category: "", costClass: "fixed", amount: "", status: "planned", templateId: "", note: "" });
  };

  const reviewAdvance = async (advance: Row, decision: "approved" | "rejected") => {
    const amount = numberValue(advance, "requested_amount");
    await runAction(() => client.rpc("review_project_company_advance", { p_advance_id: advance.id, p_decision: decision, p_approved_amount: amount, p_note: null }), decision === "approved" ? "Company advance approved." : "Company advance rejected.");
  };

  const releaseAdvance = async (advance: Row) => {
    await runAction(() => client.rpc("release_project_company_advance", { p_advance_id: advance.id, p_note: null }), "Company advance released to the Project Fund.");
  };

  const repayAdvance = async (advance: Row) => {
    const outstanding = Math.max(numberValue(advance, "released_amount"), 0);
    if (!outstanding) return setError("This advance has no released balance.");
    setSelectedAdvanceId(String(advance.id));
    setAdvanceForm({ amount: outstanding.toFixed(2), note: "Client balance collection repayment" });
  };

  const submitRepayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAdvanceId || !advanceForm.amount) return setError("Choose an advance and enter a repayment amount.");
    const saved = await runAction(() => client.rpc("record_project_company_advance_repayment", { p_advance_id: selectedAdvanceId, p_amount: Number(advanceForm.amount), p_note: advanceForm.note || null }), "Company advance repayment recorded.");
    if (saved) { setSelectedAdvanceId(""); setAdvanceForm({ amount: "", note: "" }); }
  };

  const verifyAccomplishment = async (row: Row, decision: "verified" | "rejected") => {
    await runAction(() => client.rpc("verify_labor_accomplishment", { p_accomplishment_id: row.id, p_decision: decision, p_note: null }), decision === "verified" ? "Accomplishment verified." : "Accomplishment rejected.");
  };

  const approveRun = async (row: Row) => {
    await runAction(() => client.rpc("approve_labor_payment_run", { p_payment_run_id: row.id, p_note: null }), "Labor payment run approved.");
  };
  const payRun = async (row: Row) => {
    await runAction(() => client.rpc("pay_labor_payment_run", { p_payment_run_id: row.id, p_note: null }), "Labor payment run posted to Project Funds.");
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
    {tab === "working_funds" && <WorkingFundsPanel canManage={canManage} snapshot={current} entries={workingEntries} form={workingForm} setForm={setWorkingForm} onSubmit={saveWorkingEntry} />}
    {tab === "project_funds" && <ProjectFundsPanel canManage={canManage} canRequest={canRequest} funds={funds} advances={advances} advanceForm={advanceForm} setAdvanceForm={setAdvanceForm} selectedFundId={selectedFundId} setSelectedFundId={setSelectedFundId} selectedAdvanceId={selectedAdvanceId} onRequestAdvance={saveAdvance} onRepayAdvance={submitRepayment} onReviewAdvance={reviewAdvance} onReleaseAdvance={releaseAdvance} onRepayClick={repayAdvance} />}
    {tab === "labor" && <LaborPanel canManage={canManage} canRecord={canRecordLabor} canVerify={canVerifyLabor} funds={funds} rates={laborRates} accomplishments={accomplishments} runs={paymentRuns} rateForm={laborRateForm} setRateForm={setLaborRateForm} accomplishmentForm={accomplishmentForm} setAccomplishmentForm={setAccomplishmentForm} runForm={runForm} setRunForm={setRunForm} onCreateRate={saveLaborRate} onCreateAccomplishment={saveAccomplishment} onCreateRun={savePaymentRun} onVerify={verifyAccomplishment} onApproveRun={approveRun} onPayRun={payRun} activeRates={activeRates} pendingAccomplishments={pendingAccomplishments} />}
    {tab === "operating_costs" && <OperatingCostsPanel canManage={canManage} templates={operatingTemplates} entries={operatingEntries} templateForm={templateForm} setTemplateForm={setTemplateForm} entryForm={entryForm} setEntryForm={setEntryForm} onCreateTemplate={saveTemplate} onCreateEntry={saveOperatingEntry} />}
    {tab === "break_even" && <BreakEvenPanel canManage={canManage} snapshot={current} settings={settings} form={settingsForm} setForm={setSettingsForm} onSubmit={saveSettings} />}
  </div>;
}

type FormSetter<T> = (value: T) => void;
type WorkingForm = { entryType: string; direction: string; amount: string; date: string; reference: string; note: string };
type AdvanceForm = { amount: string; note: string };
type LaborRateForm = { fundId: string; boxMaker: string; task: string; unit: string; unitRate: string; plannedQuantity: string; totalRate: string; note: string };
type AccomplishmentForm = { rateId: string; date: string; completed: string; accepted: string; rejected: string; note: string };
type RunForm = { paymentDate: string; note: string };
type TemplateForm = { name: string; category: string; costClass: string; expected: string; dueDay: string; note: string };
type OperatingEntryForm = { date: string; name: string; category: string; costClass: string; amount: string; status: string; templateId: string; note: string };

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

function WorkingFundsPanel({ canManage, snapshot, entries, form, setForm, onSubmit }: { canManage: boolean; snapshot: Snapshot; entries: Row[]; form: WorkingForm; setForm: FormSetter<WorkingForm>; onSubmit: (event: FormEvent) => void }) {
  return <div className="space-y-4">
    <FoundationPanel title="Company Working Funds" detail="Temporary company support and daily operating funds. Record every inflow and outflow with its purpose; project advances must be repaid after the client balance is collected.">
      <div className="grid gap-3 p-4 sm:grid-cols-3"><FoundationMetric label="Available" amount={peso.format(snapshot.working_funds)} tone={snapshot.working_funds_above_threshold ? "positive" : "warning"} /><FoundationMetric label="Minimum reserve" amount={peso.format(snapshot.minimum_working_funds)} /><FoundationMetric label="Above threshold" amount={snapshot.working_funds_above_threshold ? "Yes" : "No"} tone={snapshot.working_funds_above_threshold ? "positive" : "warning"} /></div>
      {canManage ? <form className="grid gap-3 border-t border-[var(--color-border)] p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}>
        <FoundationSelect label="Entry type" value={form.entryType} onChange={(entryType) => setForm({ ...form, entryType })} required><option value="capital_in">Capital in</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="other_in">Other cash in</option><option value="other_out">Other cash out</option><option value="adjustment">Adjustment</option></FoundationSelect>
        <FoundationSelect label="Direction" value={form.direction} onChange={(direction) => setForm({ ...form, direction })} required><option value="credit">Cash in / credit</option><option value="debit">Cash out / debit</option></FoundationSelect>
        <FoundationInput label="Amount" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} type="number" min="0.01" step="0.01" required />
        <FoundationInput label="Entry date" value={form.date} onChange={(date) => setForm({ ...form, date })} type="date" required />
        <FoundationInput label="Reference no." value={form.reference} onChange={(reference) => setForm({ ...form, reference })} placeholder="Receipt, voucher, or transfer ref." />
        <FoundationInput label="Purpose / note" value={form.note} onChange={(note) => setForm({ ...form, note })} placeholder="Why was this released?" />
        <div className="sm:col-span-2 lg:col-span-3"><button className="button-primary inline-flex items-center gap-1.5" type="submit"><Plus size={14} aria-hidden="true" />Record Working Funds entry</button></div>
      </form> : <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Finance managers record Company Working Funds entries.</p>}
    </FoundationPanel>
    <FoundationPanel title="Working Funds ledger" detail="The ledger is the audit trail for capital transfers, temporary project support, repayments, and operating cash movements.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[820px]"><thead><tr><th>Date</th><th>Type</th><th>Direction</th><th>Reference</th><th>Amount</th><th>Purpose</th></tr></thead><tbody>{entries.map((entry) => <tr key={String(entry.id)}><td>{dateLabel(entry.entry_date)}</td><td className="capitalize">{value(entry, "entry_type").replaceAll("_", " ")}</td><td><FoundationStatus status={value(entry, "direction")} /></td><td>{value(entry, "reference_no", "—")}</td><td className={value(entry, "direction") === "debit" ? "font-semibold text-[var(--color-danger-text)]" : "font-semibold text-[var(--color-success-text)]"}>{peso.format(numberValue(entry, "amount"))}</td><td>{value(entry, "note", "—")}</td></tr>)}{!entries.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No Working Funds entries recorded yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function ProjectFundsPanel({ canManage, canRequest, funds, advances, advanceForm, setAdvanceForm, selectedFundId, setSelectedFundId, selectedAdvanceId, onRequestAdvance, onRepayAdvance, onReviewAdvance, onReleaseAdvance, onRepayClick }: { canManage: boolean; canRequest: boolean; funds: Row[]; advances: Row[]; advanceForm: AdvanceForm; setAdvanceForm: FormSetter<AdvanceForm>; selectedFundId: string; setSelectedFundId: (value: string) => void; selectedAdvanceId: string; onRequestAdvance: (event: FormEvent) => void; onRepayAdvance: (event: FormEvent) => void; onReviewAdvance: (row: Row, decision: "approved" | "rejected") => void; onReleaseAdvance: (row: Row) => void; onRepayClick: (row: Row) => void }) {
  return <div className="space-y-4">
    <FoundationPanel title="Automatic Project Fund creation" detail="A dedicated Project Fund is created automatically when a Price Quotation is approved.">
      <div className="space-y-2 p-4 text-[11px] leading-4 text-[var(--color-text-secondary)]">
        <p>No manual setup is required. Approved Price Quotations appear in the Project Fund balances below after the page is refreshed.</p>
        <p>Client payments, project expenses, labor payments, company advances, and repayments remain linked to the automatically created fund.</p>
      </div>
    </FoundationPanel>
    <FoundationPanel title="Company Working Fund advance" detail="Use this only when a Project Fund is insufficient. The release creates a repayable company advance; it is not project income.">
      {canRequest ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onRequestAdvance}><FoundationSelect label="Project" value={selectedFundId} onChange={setSelectedFundId} required><option value="">Choose a project fund</option>{funds.filter((fund) => value(fund, "status") === "open").map((fund) => <option key={String(fund.id)} value={String(fund.id)}>{value(fund, "project_name", "Unnamed project")} · available {peso.format(numberValue(fund, "available_balance"))}</option>)}</FoundationSelect><FoundationInput label="Requested amount" value={advanceForm.amount} onChange={(amount) => setAdvanceForm({ ...advanceForm, amount })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Reason" value={advanceForm.note} onChange={(note) => setAdvanceForm({ ...advanceForm, note })} placeholder="Why is temporary support needed?" /><div className="lg:col-span-3"><button className="button-secondary" type="submit">Request temporary support</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Authorized project users may request temporary support.</p>}
    </FoundationPanel>
    <FoundationPanel title="Project Fund balances" detail="A project's remaining balance cannot be spent by another project. Close only after all costs and company advances are settled.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Project</th><th>Status</th><th>Client cash in</th><th>Company advances</th><th>Expenses</th><th>Labor</th><th>Available</th></tr></thead><tbody>{funds.map((fund) => <tr key={String(fund.id)}><td><p className="font-semibold">{value(fund, "project_name", "Unnamed project")}</p><p className="text-[10px] text-[var(--color-text-secondary)]">{value(fund, "client_name", "No client")}</p></td><td><FoundationStatus status={value(fund, "status", "open")} /></td><td>{peso.format(numberValue(fund, "client_payments"))}</td><td>{peso.format(numberValue(fund, "company_advances"))}</td><td>{peso.format(numberValue(fund, "project_expenses"))}</td><td>{peso.format(numberValue(fund, "labor_payments"))}</td><td className={numberValue(fund, "available_balance") < 0 ? "font-semibold text-[var(--color-danger-text)]" : "font-semibold text-[var(--color-success-text)]"}>{peso.format(numberValue(fund, "available_balance"))}</td></tr>)}{!funds.length && <tr><td colSpan={7} className="text-center text-[var(--color-text-secondary)]">No Project Funds found.</td></tr>}</tbody></table></div>
    </FoundationPanel>
    <FoundationPanel title="Advance approvals and repayments" detail="Every released advance must have a repayment entry. The project cannot be closed while a company advance remains outstanding.">
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Project fund</th><th>Requested</th><th>Approved</th><th>Released</th><th>Status</th><th>Actions</th></tr></thead><tbody>{advances.map((advance) => <tr key={String(advance.id)}><td>{value(advance, "project_fund_id", "—").slice(0, 8)}…</td><td>{peso.format(numberValue(advance, "requested_amount"))}</td><td>{peso.format(numberValue(advance, "approved_amount"))}</td><td>{peso.format(numberValue(advance, "released_amount"))}</td><td><FoundationStatus status={value(advance, "status", "requested")} /></td><td><div className="flex flex-wrap gap-2">{canManage && value(advance, "status") === "requested" && <><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onReviewAdvance(advance, "approved")}><Check size={13} aria-hidden="true" />Approve</button><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onReviewAdvance(advance, "rejected")}><XCircle size={13} aria-hidden="true" />Reject</button></>}{canManage && value(advance, "status") === "approved" && <button type="button" className="button-secondary" onClick={() => onReleaseAdvance(advance)}>Release</button>}{canRequest && ["released", "partially_repaid"].includes(value(advance, "status")) && <button type="button" className="button-secondary" onClick={() => onRepayClick(advance)}>Prepare repayment</button>}</div></td></tr>)}{!advances.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No company advances requested.</td></tr>}</tbody></table></div>
      {selectedAdvanceId && <form className="grid gap-3 border-t border-[var(--color-border)] p-4 sm:grid-cols-3" onSubmit={onRepayAdvance}><FoundationInput label="Repayment amount" value={advanceForm.amount} onChange={(amount) => setAdvanceForm({ ...advanceForm, amount })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Repayment note" value={advanceForm.note} onChange={(note) => setAdvanceForm({ ...advanceForm, note })} /><div className="flex items-end"><button className="button-primary" type="submit">Record repayment</button></div></form>}
    </FoundationPanel>
  </div>;
}

function LaborPanel({ canManage, canRecord, canVerify, funds, rates, accomplishments, runs, rateForm, setRateForm, accomplishmentForm, setAccomplishmentForm, runForm, setRunForm, onCreateRate, onCreateAccomplishment, onCreateRun, onVerify, onApproveRun, onPayRun, activeRates, pendingAccomplishments }: { canManage: boolean; canRecord: boolean; canVerify: boolean; funds: Row[]; rates: Row[]; accomplishments: Row[]; runs: Row[]; rateForm: LaborRateForm; setRateForm: FormSetter<LaborRateForm>; accomplishmentForm: AccomplishmentForm; setAccomplishmentForm: FormSetter<AccomplishmentForm>; runForm: RunForm; setRunForm: FormSetter<RunForm>; onCreateRate: (event: FormEvent) => void; onCreateAccomplishment: (event: FormEvent) => void; onCreateRun: (event: FormEvent) => void; onVerify: (row: Row, decision: "verified" | "rejected") => void; onApproveRun: (row: Row) => void; onPayRun: (row: Row) => void; activeRates: Row[]; pendingAccomplishments: Row[] }) {
  return <div className="space-y-4">
    <FoundationPanel title="Individual Box Maker Labor Rates" detail="Each box maker has an agreed rate for assigned work in a specific project. Tuesday and Friday payments are generated only from verified accomplishment, not estimated percentages.">
      {canRecord ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onCreateRate}><FoundationSelect label="Project Fund" value={rateForm.fundId} onChange={(fundId) => setRateForm({ ...rateForm, fundId })} required><option value="">Choose a project</option>{funds.filter((fund) => value(fund, "status") === "open").map((fund) => <option key={String(fund.id)} value={String(fund.id)}>{value(fund, "project_name", "Unnamed project")}</option>)}</FoundationSelect><FoundationInput label="Box maker" value={rateForm.boxMaker} onChange={(boxMaker) => setRateForm({ ...rateForm, boxMaker })} placeholder="Name" required /><FoundationInput label="Assigned work" value={rateForm.task} onChange={(task) => setRateForm({ ...rateForm, task })} placeholder="e.g. Assembly" required /><FoundationInput label="Unit" value={rateForm.unit} onChange={(unit) => setRateForm({ ...rateForm, unit })} placeholder="box" required /><FoundationInput label="Agreed unit rate" value={rateForm.unitRate} onChange={(unitRate) => setRateForm({ ...rateForm, unitRate })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Planned quantity" value={rateForm.plannedQuantity} onChange={(plannedQuantity) => setRateForm({ ...rateForm, plannedQuantity })} type="number" min="0" step="0.01" /><FoundationInput label="Total agreed labor rate" value={rateForm.totalRate} onChange={(totalRate) => setRateForm({ ...rateForm, totalRate })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Note" value={rateForm.note} onChange={(note) => setRateForm({ ...rateForm, note })} placeholder="Optional scope note" /><div className="sm:col-span-2 lg:col-span-4"><button className="button-primary inline-flex items-center gap-1.5" type="submit"><Plus size={14} aria-hidden="true" />Assign labor rate</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Authorized project and Finance users maintain labor rates.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[980px]"><thead><tr><th>Project</th><th>Box maker</th><th>Work</th><th>Unit rate</th><th>Agreed total</th><th>Accepted qty.</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>{rates.map((rate) => <tr key={String(rate.id)}><td>{value(rate, "project_name", value(rate, "project_fund_id").slice(0, 8))}</td><td className="font-semibold">{value(rate, "box_maker_name")}</td><td>{value(rate, "task_name")}</td><td>{peso.format(numberValue(rate, "unit_rate"))} / {value(rate, "unit_label", "unit")}</td><td>{peso.format(numberValue(rate, "agreed_total_rate"))}</td><td>{numberValue(rate, "accepted_quantity")}</td><td>{peso.format(numberValue(rate, "paid_amount"))}</td><td className="font-semibold text-[var(--color-success-text)]">{peso.format(numberValue(rate, "remaining_amount"))}</td></tr>)}{!rates.length && <tr><td colSpan={8} className="text-center text-[var(--color-text-secondary)]">No individual project labor rates yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
    <FoundationPanel title="Verified work accomplishment" detail="Record completed and accepted quantities for a labor rate. Finance verifies the work before it enters a Tuesday or Friday payment run.">
      {canRecord ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onCreateAccomplishment}><FoundationSelect label="Labor rate" value={accomplishmentForm.rateId} onChange={(rateId) => setAccomplishmentForm({ ...accomplishmentForm, rateId })} required><option value="">Choose a labor rate</option>{activeRates.map((rate) => <option key={String(rate.id)} value={String(rate.id)}>{value(rate, "box_maker_name")} · {value(rate, "task_name")} · {value(rate, "project_name", "Project")}</option>)}</FoundationSelect><FoundationInput label="Accomplishment date" value={accomplishmentForm.date} onChange={(date) => setAccomplishmentForm({ ...accomplishmentForm, date })} type="date" required /><FoundationInput label="Completed quantity" value={accomplishmentForm.completed} onChange={(completed) => setAccomplishmentForm({ ...accomplishmentForm, completed })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Accepted quantity" value={accomplishmentForm.accepted} onChange={(accepted) => setAccomplishmentForm({ ...accomplishmentForm, accepted })} type="number" min="0.01" step="0.01" required /><FoundationInput label="Rejected quantity" value={accomplishmentForm.rejected} onChange={(rejected) => setAccomplishmentForm({ ...accomplishmentForm, rejected })} type="number" min="0" step="0.01" /><FoundationInput label="Verification note" value={accomplishmentForm.note} onChange={(note) => setAccomplishmentForm({ ...accomplishmentForm, note })} placeholder="Evidence or supervisor note" /><div className="sm:col-span-2 lg:col-span-4"><button className="button-secondary" type="submit">Submit accomplishment</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Work entries must be verified before payment.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[860px]"><thead><tr><th>Date</th><th>Labor rate</th><th>Completed</th><th>Accepted</th><th>Payable</th><th>Status</th><th>Actions</th></tr></thead><tbody>{accomplishments.map((row) => <tr key={String(row.id)}><td>{dateLabel(row.accomplishment_date)}</td><td>{value(row, "labor_rate_id").slice(0, 8)}…</td><td>{numberValue(row, "completed_quantity")}</td><td>{numberValue(row, "accepted_quantity")}</td><td>{peso.format(numberValue(row, "payable_amount"))}</td><td><FoundationStatus status={value(row, "status", "submitted")} /></td><td>{canVerify && value(row, "status") === "submitted" && <div className="flex gap-2"><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onVerify(row, "verified")}><Check size={13} aria-hidden="true" />Verify</button><button type="button" className="button-secondary inline-flex items-center gap-1" onClick={() => onVerify(row, "rejected")}><XCircle size={13} aria-hidden="true" />Reject</button></div>}</td></tr>)}{!accomplishments.length && <tr><td colSpan={7} className="text-center text-[var(--color-text-secondary)]">No work accomplishment entries yet.</td></tr>}</tbody></table></div>
      {pendingAccomplishments.length > 0 && <p className="border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-warning-text)]"><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />{pendingAccomplishments.length} accomplishment entr{pendingAccomplishments.length === 1 ? "y is" : "ies are"} waiting for verification.</p>}
    </FoundationPanel>
    <FoundationPanel title="Tuesday & Friday payment runs" detail="Choose a Tuesday or Friday date. The system includes only verified, unpaid accomplishments and checks the Project Fund balance before posting the project labor charge. Record the actual bank, cash, or e-wallet payment in the existing Finance Cash Out workflow for reconciliation.">
      {canManage ? <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={onCreateRun}><FoundationInput label="Payment date" value={runForm.paymentDate} onChange={(paymentDate) => setRunForm({ ...runForm, paymentDate })} type="date" required /><FoundationInput label="Run note" value={runForm.note} onChange={(note) => setRunForm({ ...runForm, note })} placeholder="Optional payroll note" /><div className="sm:col-span-2"><button className="button-primary" type="submit">Prepare payment run</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Finance approves and posts labor payment runs.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[780px]"><thead><tr><th>Payment date</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead><tbody>{runs.map((run) => <tr key={String(run.id)}><td>{dateLabel(run.payment_date)}</td><td><FoundationStatus status={value(run, "status", "draft")} /></td><td>{value(run, "note", "—")}</td><td><div className="flex flex-wrap gap-2">{canManage && value(run, "status") === "draft" && <button type="button" className="button-secondary" onClick={() => onApproveRun(run)}>Approve</button>}{canManage && value(run, "status") === "approved" && <button type="button" className="button-primary" onClick={() => onPayRun(run)}>Post payment</button>}</div></td></tr>)}{!runs.length && <tr><td colSpan={4} className="text-center text-[var(--color-text-secondary)]">No Tuesday or Friday payment runs yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function OperatingCostsPanel({ canManage, templates, entries, templateForm, setTemplateForm, entryForm, setEntryForm, onCreateTemplate, onCreateEntry }: { canManage: boolean; templates: Row[]; entries: Row[]; templateForm: TemplateForm; setTemplateForm: FormSetter<TemplateForm>; entryForm: OperatingEntryForm; setEntryForm: FormSetter<OperatingEntryForm>; onCreateTemplate: (event: FormEvent) => void; onCreateEntry: (event: FormEvent) => void }) {
  return <div className="space-y-4">
    <FoundationPanel title="Recurring operational cost templates" detail="Set the expected monthly cost for salary, electricity, water, rent, subscriptions, and other costs so the monthly break-even target is visible.">
      {canManage ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onCreateTemplate}><FoundationInput label="Cost name" value={templateForm.name} onChange={(name) => setTemplateForm({ ...templateForm, name })} placeholder="e.g. Monthly salary" required /><FoundationInput label="Category" value={templateForm.category} onChange={(category) => setTemplateForm({ ...templateForm, category })} placeholder="Salary, rent, utilities" required /><FoundationSelect label="Cost class" value={templateForm.costClass} onChange={(costClass) => setTemplateForm({ ...templateForm, costClass })} required><option value="fixed">Fixed</option><option value="variable">Variable</option></FoundationSelect><FoundationInput label="Expected monthly amount" value={templateForm.expected} onChange={(expected) => setTemplateForm({ ...templateForm, expected })} type="number" min="0" step="0.01" required /><FoundationInput label="Due day" value={templateForm.dueDay} onChange={(dueDay) => setTemplateForm({ ...templateForm, dueDay })} type="number" min="1" max="31" step="1" /><FoundationInput label="Note" value={templateForm.note} onChange={(note) => setTemplateForm({ ...templateForm, note })} placeholder="Optional cost policy" /><div className="sm:col-span-2 lg:col-span-4"><button className="button-primary inline-flex items-center gap-1.5" type="submit"><Plus size={14} aria-hidden="true" />Save recurring cost</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Finance managers maintain operational cost assumptions.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[760px]"><thead><tr><th>Cost</th><th>Category</th><th>Class</th><th>Expected monthly</th><th>Due day</th><th>Status</th></tr></thead><tbody>{templates.map((template) => <tr key={String(template.id)}><td className="font-semibold">{value(template, "name")}</td><td>{value(template, "category")}</td><td className="capitalize">{value(template, "cost_class")}</td><td>{peso.format(numberValue(template, "expected_monthly_amount"))}</td><td>{value(template, "due_day", "—")}</td><td><FoundationStatus status={template.is_active === false ? "closed" : "active"} /></td></tr>)}{!templates.length && <tr><td colSpan={6} className="text-center text-[var(--color-text-secondary)]">No recurring costs configured.</td></tr>}</tbody></table></div>
    </FoundationPanel>
    <FoundationPanel title="Monthly operational cost entries" detail="Record planned or paid salary, utility, rental, subscription, delivery, and other operating costs. For actual bank, cash, or e-wallet movement, also post the corresponding Finance Cash Out so account balances reconcile.">
      {canManage ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onCreateEntry}><FoundationInput label="Cost date" value={entryForm.date} onChange={(date) => setEntryForm({ ...entryForm, date })} type="date" required /><FoundationInput label="Cost name" value={entryForm.name} onChange={(name) => setEntryForm({ ...entryForm, name })} placeholder="e.g. Electricity bill" required /><FoundationInput label="Category" value={entryForm.category} onChange={(category) => setEntryForm({ ...entryForm, category })} placeholder="Salary, utilities, rent" required /><FoundationSelect label="Cost class" value={entryForm.costClass} onChange={(costClass) => setEntryForm({ ...entryForm, costClass })} required><option value="fixed">Fixed</option><option value="variable">Variable</option></FoundationSelect><FoundationInput label="Amount" value={entryForm.amount} onChange={(amount) => setEntryForm({ ...entryForm, amount })} type="number" min="0.01" step="0.01" required /><FoundationSelect label="Status" value={entryForm.status} onChange={(status) => setEntryForm({ ...entryForm, status })} required><option value="planned">Planned</option><option value="paid">Paid / cash out</option></FoundationSelect><FoundationSelect label="Template" value={entryForm.templateId} onChange={(templateId) => setEntryForm({ ...entryForm, templateId })}><option value="">No template</option>{templates.map((template) => <option key={String(template.id)} value={String(template.id)}>{value(template, "name")}</option>)}</FoundationSelect><FoundationInput label="Note" value={entryForm.note} onChange={(note) => setEntryForm({ ...entryForm, note })} placeholder="Receipt or payment note" /><div className="sm:col-span-2 lg:col-span-4"><button className="button-secondary" type="submit">Record operating cost</button></div></form> : <p className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only view. Finance managers record operational costs.</p>}
      <div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[880px]"><thead><tr><th>Date</th><th>Cost</th><th>Category</th><th>Class</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>{entries.map((entry) => <tr key={String(entry.id)}><td>{dateLabel(entry.cost_date)}</td><td className="font-semibold">{value(entry, "name")}</td><td>{value(entry, "category")}</td><td className="capitalize">{value(entry, "cost_class")}</td><td>{peso.format(numberValue(entry, "amount"))}</td><td><FoundationStatus status={value(entry, "status", "planned")} /></td><td>{value(entry, "note", "—")}</td></tr>)}{!entries.length && <tr><td colSpan={7} className="text-center text-[var(--color-text-secondary)]">No operating cost entries yet.</td></tr>}</tbody></table></div>
    </FoundationPanel>
  </div>;
}

function BreakEvenPanel({ canManage, snapshot, settings, form, setForm, onSubmit }: { canManage: boolean; snapshot: Snapshot; settings: Row | null; form: { openingCapital: string; openingWorking: string; minimumWorking: string; desiredProfit: string; vatRate: string; revenueBasis: string }; setForm: FormSetter<{ openingCapital: string; openingWorking: string; minimumWorking: string; desiredProfit: string; vatRate: string; revenueBasis: string }>; onSubmit: (event: FormEvent) => void }) {
  const margin = snapshot.contribution_margin_ratio * 100;
  return <div className="space-y-4">
    <FoundationPanel title="Break-even and sales quota" detail="Formula: Break-even Sales = Fixed Operating Costs ÷ Contribution Margin Ratio. Required Sales = (Fixed Operating Costs + Desired Monthly Profit) ÷ Contribution Margin Ratio.">
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4"><FoundationMetric label="Break-even sales" amount={peso.format(snapshot.break_even_sales)} detail="Monthly sales needed to cover fixed costs" tone="warning" /><FoundationMetric label="Required sales quota" amount={peso.format(snapshot.required_sales)} detail={`Includes desired profit of ${peso.format(snapshot.desired_monthly_profit)}`} tone="positive" /><FoundationMetric label="Contribution margin" amount={`${margin.toFixed(1)}%`} detail="After variable costs" /><FoundationMetric label="Actual profit / (loss)" amount={peso.format(snapshot.profit)} detail="Selected month" tone={snapshot.profit < 0 ? "negative" : "positive"} /></div>
      <div className="grid gap-3 border-t border-[var(--color-border)] p-4 sm:grid-cols-2"><div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Inputs used</p><dl className="mt-3 space-y-2 text-[11px]"><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Fixed operating actual</dt><dd className="font-semibold">{peso.format(snapshot.fixed_operating_actual)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Fixed operating budget</dt><dd className="font-semibold">{peso.format(snapshot.fixed_operating_budget)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Variable costs</dt><dd className="font-semibold">{peso.format(snapshot.variable_costs)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Revenue basis</dt><dd className="font-semibold capitalize">{snapshot.revenue_basis.replaceAll("_", " ")}</dd></div></dl></div><div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4"><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--color-text-secondary)]">Interpretation</p><p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">If actual sales are below the required sales quota, the month is not yet meeting the desired target. If profit is negative, Huswell Trading is operating at a loss for the selected month.</p></div></div>
    </FoundationPanel>
    <FoundationPanel title="Foundation settings" detail="Set the opening capital, Company Working Funds, minimum operating reserve, desired monthly profit, VAT assumption, and whether the target is based on net sales or collections.">
      {canManage ? <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}><FoundationInput label="Opening capital funds" value={form.openingCapital} onChange={(openingCapital) => setForm({ ...form, openingCapital })} type="number" min="0" step="0.01" /><FoundationInput label="Opening Working Funds" value={form.openingWorking} onChange={(openingWorking) => setForm({ ...form, openingWorking })} type="number" min="0" step="0.01" /><FoundationInput label="Minimum Working Funds" value={form.minimumWorking} onChange={(minimumWorking) => setForm({ ...form, minimumWorking })} type="number" min="0" step="0.01" /><FoundationInput label="Desired monthly profit" value={form.desiredProfit} onChange={(desiredProfit) => setForm({ ...form, desiredProfit })} type="number" min="0" step="0.01" /><FoundationInput label="Default VAT rate (%)" value={form.vatRate} onChange={(vatRate) => setForm({ ...form, vatRate })} type="number" min="0" max="100" step="0.01" /><FoundationSelect label="Revenue basis" value={form.revenueBasis} onChange={(revenueBasis) => setForm({ ...form, revenueBasis })} required><option value="net_sales">Net sales</option><option value="collections">Collections</option></FoundationSelect><div className="sm:col-span-2 lg:col-span-3"><button className="button-primary inline-flex items-center gap-1.5" type="submit"><Settings2 size={14} aria-hidden="true" />Save foundation settings</button></div></form> : <div className="p-4 text-[11px] text-[var(--color-text-secondary)]">Read-only settings. Current desired monthly profit: <span className="font-semibold text-[var(--color-text-primary)]">{peso.format(numberValue(settings, "desired_monthly_profit"))}</span>.</div>}
    </FoundationPanel>
  </div>;
}
