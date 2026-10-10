"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  Document as PdfDocument,
  Page as PdfPage,
  StyleSheet as PdfStyleSheet,
  Text as PdfText,
  View as PdfView,
  pdf,
} from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/client";
import { calculateCosting, DEFAULT_ADDITIONAL_COSTS, DEFAULT_FORMULA_VERSION, DEFAULT_PRINT_COSTING_DEFAULTS, normalizePrintCostingDefaults, COSTING_MATERIAL_CATEGORIES, type CostingAdditionalCostInput, type CostingCalculation, type CostingLineInput, type CostingMaterialCategory, type CostingMaterialInput, type PrintCostingDefaults } from "@/lib/costing-engine";
import type { Store } from "@/components/huswell-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FileUploadControl } from "@/components/ui/file-upload-control";
import { NumberInput } from "@/components/ui/number-input";
import { SearchableLeadSelect } from "@/components/ui/searchable-lead-select";

type AnyRow = Record<string, unknown>;
type RequestStatus = "draft" | "pending" | "needs_revision" | "approved";
type RequestTab = { key: RequestStatus; label: string };

type ItemDraft = CostingLineInput & {
  id?: string;
  extraction_confidence?: number | null;
  source_page?: number | null;
  sort_order: number;
};

type MaterialDraft = CostingMaterialInput & {
  id?: string;
  material_category: CostingMaterialCategory;
  sort_order: number;
};

type AdditionalDraft = CostingAdditionalCostInput & { id?: string; sort_order: number };

type CostingDraft = {
  id?: string;
  request_no?: string;
  revision_number: number;
  status: RequestStatus;
  lead_id: string | null;
  source_file_name: string;
  source_storage_path: string;
  source_mime_type: string;
  source_file_size: number | null;
  client_name: string;
  client_contact_name: string;
  client_phone: string;
  client_email: string;
  project_name: string;
  notes: string;
  hp_latex_rate: number;
  waste_allowance: number;
  formula_version: string;
  extraction_json: unknown;
  decision_note: string;
  prepared_by: string | null;
  production_assumptions_confirmed: boolean;
  items: ItemDraft[];
  materials: MaterialDraft[];
  additional_costs: AdditionalDraft[];
};

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const booleanValue = (value: unknown) => value === true || value === "true";

const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const sourceMimeType = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type === PDF_MIME_TYPE || name.endsWith(".pdf")) return PDF_MIME_TYPE;
  if (file.type === DOCX_MIME_TYPE || name.endsWith(".docx")) return DOCX_MIME_TYPE;
  return null;
};

const sourceDocumentLabel = (mimeType: string, fileName = "") => {
  if (!fileName.trim()) return "document";
  return mimeType === DOCX_MIME_TYPE || fileName.toLowerCase().endsWith(".docx") ? "Word" : "PDF";
};

const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const materialCategory = (value: unknown): CostingMaterialCategory =>
  COSTING_MATERIAL_CATEGORIES.includes(value as CostingMaterialCategory)
    ? (value as CostingMaterialCategory)
    : "PP White";

const leadOwnerId = (lead: AnyRow) =>
  stringValue(lead.assigned_to) || stringValue(lead.created_by);

const leadClientLabel = (lead: AnyRow) => {
  const companyName = stringValue(lead.client_name).trim();
  const contactName = stringValue(lead.contact_name).trim();
  if (companyName && contactName) return `${companyName} - ${contactName}`;
  return companyName || contactName || "Client";
};

const leadSnapshot = (lead: AnyRow): Pick<CostingDraft, "lead_id" | "client_name" | "client_contact_name" | "client_phone" | "client_email" | "project_name"> => ({
  lead_id: stringValue(lead.id) || null,
  client_name: stringValue(lead.client_name),
  client_contact_name: stringValue(lead.contact_name),
  client_phone: stringValue(lead.phone),
  client_email: stringValue(lead.email),
  project_name: stringValue(lead.project_name),
});

const statusLabel: Record<RequestStatus, string> = {
  draft: "Draft",
  pending: "Pending GM review",
  needs_revision: "Needs revision",
  approved: "Approved / locked",
};

const statusVariant = (status: RequestStatus) => {
  if (status === "approved") return "success" as const;
  if (status === "pending" || status === "needs_revision") return "warning" as const;
  return "default" as const;
};

const requestStatus = (value: unknown): RequestStatus => {
  if (value === "pending" || value === "needs_revision" || value === "approved") return value;
  if (value === "rejected") return "needs_revision";
  return "draft";
};

const dateLabel = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
};

const FINISH_OPTIONS = [
  "None",
  "Gloss lamination",
  "Matte lamination",
  "Cut to shape",
  "Eyelets / grommets",
  "Hemming",
  "Folding",
  "Mounting",
  "Other / see notes",
] as const;

type FinishOption = (typeof FINISH_OPTIONS)[number];

const finishValues = (value: unknown) => {
  const values = Array.from(new Set(
    stringValue(value)
      .split(/[,;]\s*/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
  return values.length > 1 ? values.filter((entry) => entry !== "None") : values;
};

function FinishMultiSelect({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const selected = finishValues(value);
  const options = Array.from(new Set([
    ...FINISH_OPTIONS,
    ...selected.filter((entry) => !FINISH_OPTIONS.includes(entry as FinishOption)),
  ]));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 300 });

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 240);
      const gutter = 8;
      const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, window.innerWidth - width - gutter));
      const below = Math.max(140, window.innerHeight - rect.bottom - gutter * 2);
      const above = Math.max(140, rect.top - gutter * 2);
      const openAbove = below < 260 && above > below;
      const maxHeight = Math.min(300, openAbove ? above : below);
      setMenuPosition({
        left,
        top: openAbove ? Math.max(gutter, rect.top - maxHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  const toggleOption = (option: string, checked: boolean) => {
    const next = checked
      ? option === "None"
        ? ["None"]
        : [...selected.filter((entry) => entry !== "None" && entry !== option), option]
      : selected.filter((entry) => entry !== option);
    onChange(next.join(", "));
  };

  if (disabled) {
    return <div className="input mt-0 min-h-9 whitespace-normal break-words" title={selected.join(", ") || "None"}>{selected.join(", ") || "None"}</div>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="input mt-0 flex min-h-9 w-full min-w-[220px] items-center justify-between gap-2 whitespace-normal px-3 py-2 text-left"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        title={selected.join(", ") || "Select one or more finishes"}
      >
        <span className={`min-w-0 break-words ${selected.length ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]"}`}>
          {selected.join(", ") || "Select finish"}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-[var(--color-text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Finish options"
          aria-multiselectable="true"
          className="fixed z-[120] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-lg"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
        >
          <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">Select one or more finishes</div>
          {options.map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[12px] leading-5 hover:bg-[var(--color-surface-subtle)]">
              <input
                className="mt-0 size-4 shrink-0 accent-[var(--color-accent)]"
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) => toggleOption(option, event.target.checked)}
              />
              <span className="min-w-0 whitespace-normal break-words">{option}</span>
            </label>
          ))}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2 pt-1.5">
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{selected.length ? `${selected.length} selected` : "None selected"}</span>
            <button type="button" className="rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const blankItem = (sortOrder: number): ItemDraft => ({
  material_category: "PP White",
  item_description: "",
  width_mm: 0,
  height_mm: 0,
  quantity: 0,
  finish: "",
  extraction_confidence: null,
  source_page: null,
  sort_order: sortOrder,
});

const defaultMaterials = (defaults: PrintCostingDefaults = DEFAULT_PRINT_COSTING_DEFAULTS): MaterialDraft[] =>
  COSTING_MATERIAL_CATEGORIES.map((category, index) => ({
    material_category: category,
    ...defaults.materials[category],
    required_rolls: null,
    linear_meters_used: null,
    sort_order: index + 1,
  }));

const defaultAdditionalCosts = (): AdditionalDraft[] =>
  DEFAULT_ADDITIONAL_COSTS.map((cost, index) => ({ ...cost, sort_order: index + 1 }));

const blankDraft = (defaults: PrintCostingDefaults = DEFAULT_PRINT_COSTING_DEFAULTS): CostingDraft => ({
  revision_number: 1,
  status: "draft",
  lead_id: null,
  source_file_name: "",
  source_storage_path: "",
  source_mime_type: "",
  source_file_size: null,
  client_name: "",
  client_contact_name: "",
  client_phone: "",
  client_email: "",
  project_name: "",
  notes: "",
  hp_latex_rate: defaults.hp_latex_rate,
  waste_allowance: defaults.waste_allowance,
  formula_version: defaults.formula_version || DEFAULT_FORMULA_VERSION,
  extraction_json: {},
  decision_note: "",
  prepared_by: null,
  production_assumptions_confirmed: false,
  items: [blankItem(1)],
  materials: defaultMaterials(defaults),
  additional_costs: defaultAdditionalCosts(),
});

const rowCalculation = (row: AnyRow) => {
  const value = row.calculation;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
};

function draftFromRow(
  row: AnyRow,
  store: Store,
  defaults: PrintCostingDefaults = DEFAULT_PRINT_COSTING_DEFAULTS,
): CostingDraft {
  const requestId = stringValue(row.id);
  const items = store.costing_request_items
    .filter((item) => stringValue(item.request_id) === requestId)
    .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
    .map((item, index) => ({
      id: stringValue(item.id) || undefined,
      material_category: materialCategory(item.material_category),
      item_description: stringValue(item.item_description),
      width_mm: numberValue(item.width_mm),
      height_mm: numberValue(item.height_mm),
      quantity: numberValue(item.quantity),
      finish: stringValue(item.finish),
      extraction_confidence: optionalNumber(item.extraction_confidence),
      source_page: optionalNumber(item.source_page),
      sort_order: numberValue(item.sort_order, index + 1),
    }));
  const materials = defaultMaterials(defaults).map((defaultMaterial) => {
    const saved = store.costing_request_materials.find(
      (material) =>
        stringValue(material.request_id) === requestId &&
        materialCategory(material.material_category) === defaultMaterial.material_category,
    );
    if (!saved) return defaultMaterial;
    return {
      ...defaultMaterial,
      id: stringValue(saved.id) || undefined,
      display_name: stringValue(saved.display_name, defaultMaterial.display_name ?? defaultMaterial.material_category),
      roll_width_m: numberValue(saved.roll_width_m),
      roll_length_m: numberValue(saved.roll_length_m),
      roll_cost: numberValue(saved.roll_cost),
      required_rolls: optionalNumber(saved.required_rolls),
      linear_meters_used: optionalNumber(saved.linear_meters_used),
      sort_order: numberValue(saved.sort_order, defaultMaterial.sort_order),
    };
  });
  const additional = store.costing_request_additional_costs
    .filter((cost) => stringValue(cost.request_id) === requestId)
    .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
    .map((cost, index) => ({
      id: stringValue(cost.id) || undefined,
      label: stringValue(cost.label, "Additional cost"),
      amount: numberValue(cost.amount),
      note: stringValue(cost.note),
      sort_order: numberValue(cost.sort_order, index + 1),
    }));
  return {
    id: requestId || undefined,
    request_no: stringValue(row.request_no) || undefined,
    revision_number: numberValue(row.revision_number, 1),
    status: requestStatus(row.status),
    lead_id: stringValue(row.lead_id) || null,
    source_file_name: stringValue(row.source_file_name),
    source_storage_path: stringValue(row.source_storage_path),
    source_mime_type: stringValue(row.source_mime_type, "application/pdf"),
    source_file_size: optionalNumber(row.source_file_size),
    client_name: stringValue(row.client_name),
    client_contact_name: stringValue(row.client_contact_name),
    client_phone: stringValue(row.client_phone),
    client_email: stringValue(row.client_email),
    project_name: stringValue(row.project_name),
    notes: stringValue(row.notes),
    hp_latex_rate: numberValue(row.hp_latex_rate, defaults.hp_latex_rate),
    waste_allowance: numberValue(row.waste_allowance, defaults.waste_allowance),
    formula_version: stringValue(row.formula_version, defaults.formula_version),
    extraction_json: row.extraction_json ?? {},
    decision_note: stringValue(row.decision_note),
    prepared_by: stringValue(row.prepared_by) || null,
    production_assumptions_confirmed: booleanValue(row.production_assumptions_confirmed),
    items: items.length ? items : [blankItem(1)],
    materials,
    additional_costs: additional.length ? additional : defaultAdditionalCosts(),
  };
}

type ExtractionResult = {
  client_name?: string | null;
  client_contact_name?: string | null;
  client_phone?: string | null;
  project_name?: string | null;
  notes?: string | null;
  items?: ItemDraft[];
  material_assumptions?: {
    material_category: CostingMaterialCategory;
    required_rolls: number | null;
    linear_meters_used: number | null;
    extraction_confidence: number;
    source_page: number | null;
  }[];
};

function applyExtraction(base: CostingDraft, extraction: ExtractionResult): CostingDraft {
  const assumptions = extraction.material_assumptions ?? [];
  const materials = base.materials.map((material) => {
    const assumption = assumptions.find((item) => item.material_category === material.material_category);
    return assumption
      ? {
          ...material,
          required_rolls: assumption.required_rolls,
          linear_meters_used: assumption.linear_meters_used,
        }
      : material;
  });
  const items = (extraction.items ?? []).length
    ? (extraction.items ?? []).map((item, index) => ({ ...item, sort_order: index + 1 }))
    : [blankItem(1)];
  return {
    ...base,
    notes: extraction.notes ?? base.notes,
    items,
    materials,
    extraction_json: extraction,
  };
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-text-tertiary)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

const LEGAL_PORTRAIT: [number, number] = [612, 1008];

function CostingRequestPdf({ draft, calculation }: { draft: CostingDraft; calculation: CostingCalculation }) {
  const styles = PdfStyleSheet.create({
    page: { paddingTop: 28, paddingRight: 30, paddingBottom: 28, paddingLeft: 30, fontFamily: "SF Pro Display", fontSize: 10, color: "#111" },
    header: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1.2, borderColor: "#111", paddingBottom: 10 },
    headerMain: { width: "62%", justifyContent: "center" },
    headerMeta: { width: "38%", borderLeftWidth: 1, borderColor: "#555", paddingLeft: 13 },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 5 },
    subtitle: { fontSize: 9, color: "#555" },
    metaRow: { flexDirection: "row", marginBottom: 1 },
    metaLabel: { width: 78, fontSize: 9, fontWeight: 700 },
    metaColon: { width: 8, fontSize: 9 },
    metaValue: { flex: 1, fontSize: 9 },
    assumptionGrid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" },
    assumptionCell: { width: "25%", borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", padding: 5 },
    assumptionLabel: { fontSize: 8, fontWeight: 700 },
    assumptionValue: { marginTop: 2, fontSize: 9 },
    clientGrid: { flexDirection: "row", marginTop: 14, marginBottom: 12 },
    clientColumn: { width: "50%", paddingRight: 14 },
    clientColumnRight: { width: "50%", borderLeftWidth: 1, borderColor: "#777", paddingLeft: 16 },
    clientField: { flexDirection: "row", alignItems: "flex-end", minHeight: 23, marginBottom: 3 },
    clientLabel: { width: 88, fontWeight: 700, fontSize: 10 },
    clientColon: { width: 9, fontWeight: 700, fontSize: 10 },
    clientValue: { flex: 1, borderBottomWidth: 0.7, borderColor: "#555", paddingBottom: 2, fontSize: 10 },
    section: { fontSize: 10, fontWeight: 700, marginTop: 12, marginBottom: 6 },
    table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" },
    row: { flexDirection: "row", alignItems: "stretch" },
    cell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", paddingVertical: 5, paddingHorizontal: 5, justifyContent: "center", alignSelf: "stretch", textAlign: "center", fontSize: 9, lineHeight: 1.25 },
    headerCell: { backgroundColor: "#efefef", fontWeight: 700 },
    descriptionCell: { textAlign: "left" },
    itemDescription: { width: "34%" },
    itemMaterial: { width: "18%" },
    itemNumber: { width: "12%", textAlign: "right" },
    itemFinish: { width: "12%" },
    materialName: { width: "28%" },
    materialNumber: { width: "14.4%", textAlign: "right" },
    additionalLabel: { width: "42%" },
    additionalNote: { width: "38%" },
    additionalAmount: { width: "20%", textAlign: "right" },
    total: { flexDirection: "row", marginTop: 8 },
    totalLabel: { width: "85%", textAlign: "left", fontWeight: 700 },
    totalValue: { width: "15%", textAlign: "right", fontWeight: 700 },
    totalCell: { backgroundColor: "#efefef" },
    note: { marginTop: 10, color: "#555", lineHeight: 1.35, fontSize: 8.5 },
  });
  const money = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const clientField = (label: string, value: string) => <PdfView style={styles.clientField}><PdfText style={styles.clientLabel}>{label}</PdfText><PdfText style={styles.clientColon}>:</PdfText><PdfText style={styles.clientValue}>{value || "—"}</PdfText></PdfView>;
  return (
    <PdfDocument>
      <PdfPage size={LEGAL_PORTRAIT} orientation="portrait" style={styles.page}>
        <PdfView style={styles.header}>
          <PdfView style={styles.headerMain}><PdfText style={styles.title}>PRINT COSTING</PdfText><PdfText style={styles.subtitle}>Workbook-compatible internal costing</PdfText></PdfView>
          <PdfView style={styles.headerMeta}>
            <PdfView style={styles.metaRow}><PdfText style={styles.metaLabel}>Request No.</PdfText><PdfText style={styles.metaColon}>:</PdfText><PdfText style={styles.metaValue}>{draft.request_no ?? "Draft"}</PdfText></PdfView>
            <PdfView style={styles.metaRow}><PdfText style={styles.metaLabel}>Revision</PdfText><PdfText style={styles.metaColon}>:</PdfText><PdfText style={styles.metaValue}>{draft.revision_number}</PdfText></PdfView>
            <PdfView style={styles.metaRow}><PdfText style={styles.metaLabel}>Status</PdfText><PdfText style={styles.metaColon}>:</PdfText><PdfText style={styles.metaValue}>{statusLabel[draft.status]}</PdfText></PdfView>
            <PdfView style={styles.metaRow}><PdfText style={styles.metaLabel}>Source</PdfText><PdfText style={styles.metaColon}>:</PdfText><PdfText style={styles.metaValue}>{draft.source_file_name || "Manual entry — no source document provided"}</PdfText></PdfView>
          </PdfView>
        </PdfView>
        <PdfView style={styles.clientGrid}>
          <PdfView style={styles.clientColumn}>{clientField("Client / company", draft.client_name)}{clientField("Contact person", draft.client_contact_name)}{clientField("Phone", draft.client_phone)}</PdfView>
          <PdfView style={styles.clientColumnRight}>{clientField("Email", draft.client_email)}{clientField("Project", draft.project_name)}{clientField("Lead linked", draft.lead_id ? "Yes" : "Legacy standalone")}</PdfView>
        </PdfView>

        <PdfText style={styles.section}>CALCULATION ASSUMPTIONS</PdfText>
        <PdfView style={styles.assumptionGrid}>
          <PdfView style={styles.assumptionCell}><PdfText style={styles.assumptionLabel}>HP LATEX RATE</PdfText><PdfText style={styles.assumptionValue}>{money(calculation.hp_latex_rate)} / sq. m.</PdfText></PdfView>
          <PdfView style={styles.assumptionCell}><PdfText style={styles.assumptionLabel}>WASTE ALLOWANCE</PdfText><PdfText style={styles.assumptionValue}>{(calculation.waste_allowance * 100).toFixed(2)}%</PdfText></PdfView>
          <PdfView style={styles.assumptionCell}><PdfText style={styles.assumptionLabel}>TOTAL QUANTITY</PdfText><PdfText style={styles.assumptionValue}>{calculation.total_quantity.toLocaleString()}</PdfText></PdfView>
          <PdfView style={styles.assumptionCell}><PdfText style={styles.assumptionLabel}>TOTAL PRINT AREA</PdfText><PdfText style={styles.assumptionValue}>{calculation.total_area_sqm.toFixed(4)} sq. m.</PdfText></PdfView>
        </PdfView>

        <PdfText style={styles.section}>COSTING ITEMS</PdfText>
        <PdfView style={styles.table} wrap>
          <PdfView style={styles.row} wrap={false}>
            <PdfText style={[styles.cell, styles.itemDescription, styles.headerCell]}>Description</PdfText>
            <PdfText style={[styles.cell, styles.itemMaterial, styles.headerCell]}>Material</PdfText>
            <PdfText style={[styles.cell, styles.itemNumber, styles.headerCell]}>W mm</PdfText>
            <PdfText style={[styles.cell, styles.itemNumber, styles.headerCell]}>H mm</PdfText>
            <PdfText style={[styles.cell, styles.itemNumber, styles.headerCell]}>Qty</PdfText>
            <PdfText style={[styles.cell, styles.itemFinish, styles.headerCell]}>Finish</PdfText>
          </PdfView>
          {draft.items.map((item, index) => (
            <PdfView style={styles.row} wrap={false} key={`${item.id ?? "item"}-${index}`}>
              <PdfText style={[styles.cell, styles.itemDescription]}>{item.item_description || "—"}</PdfText>
              <PdfText style={[styles.cell, styles.itemMaterial]}>{item.material_category}</PdfText>
              <PdfText style={[styles.cell, styles.itemNumber]}>{numberValue(item.width_mm).toLocaleString()}</PdfText>
              <PdfText style={[styles.cell, styles.itemNumber]}>{numberValue(item.height_mm).toLocaleString()}</PdfText>
              <PdfText style={[styles.cell, styles.itemNumber]}>{numberValue(item.quantity).toLocaleString()}</PdfText>
              <PdfText style={[styles.cell, styles.itemFinish]}>{item.finish || "—"}</PdfText>
            </PdfView>
          ))}
        </PdfView>

        <PdfText style={styles.section}>MATERIAL AND PRINTING BREAKDOWN</PdfText>
        <PdfView style={styles.table} wrap>
          <PdfView style={styles.row} wrap={false}>
            <PdfText style={[styles.cell, styles.materialName, styles.headerCell]}>Material</PdfText>
            <PdfText style={[styles.cell, styles.materialNumber, styles.headerCell]}>Area</PdfText>
            <PdfText style={[styles.cell, styles.materialNumber, styles.headerCell]}>Linear m</PdfText>
            <PdfText style={[styles.cell, styles.materialNumber, styles.headerCell]}>Rolls</PdfText>
            <PdfText style={[styles.cell, styles.materialNumber, styles.headerCell]}>Consumption</PdfText>
            <PdfText style={[styles.cell, styles.materialNumber, styles.headerCell]}>Procurement</PdfText>
          </PdfView>
          {calculation.material_rows.map((row) => (
            <PdfView style={styles.row} wrap={false} key={row.material_category}>
              <PdfText style={[styles.cell, styles.materialName]}>{row.display_name}</PdfText>
              <PdfText style={[styles.cell, styles.materialNumber]}>{row.total_area_sqm.toFixed(4)}</PdfText>
              <PdfText style={[styles.cell, styles.materialNumber]}>{row.linear_meters_used.toFixed(4)}</PdfText>
              <PdfText style={[styles.cell, styles.materialNumber]}>{row.required_rolls.toFixed(2)}</PdfText>
              <PdfText style={[styles.cell, styles.materialNumber]}>{money(row.consumption_cost)}</PdfText>
              <PdfText style={[styles.cell, styles.materialNumber]}>{money(row.procurement_cost)}</PdfText>
            </PdfView>
          ))}
        </PdfView>
        <PdfText style={styles.section}>ADDITIONAL COSTS</PdfText>
        <PdfView style={styles.table} wrap>
          <PdfView style={styles.row} wrap={false}>
            <PdfText style={[styles.cell, styles.additionalLabel, styles.headerCell]}>Cost</PdfText>
            <PdfText style={[styles.cell, styles.additionalNote, styles.headerCell]}>Note</PdfText>
            <PdfText style={[styles.cell, styles.additionalAmount, styles.headerCell]}>Amount</PdfText>
          </PdfView>
          {calculation.additional_cost_rows.map((row, index) => (
            <PdfView style={styles.row} wrap={false} key={`${row.label}-${row.note}-${index}`}>
              <PdfText style={[styles.cell, styles.additionalLabel]}>{row.label || "Additional cost"}</PdfText>
              <PdfText style={[styles.cell, styles.additionalNote]}>{row.note || "—"}</PdfText>
              <PdfText style={[styles.cell, styles.additionalAmount]}>{money(row.amount)}</PdfText>
            </PdfView>
          ))}
        </PdfView>
        <PdfView style={styles.total}><PdfText style={[styles.cell, styles.totalLabel, styles.totalCell]}>Project cost — consumption basis</PdfText><PdfText style={[styles.cell, styles.totalValue, styles.totalCell]}>{money(calculation.project_cost_consumption)}</PdfText></PdfView>
        <PdfView style={styles.total}><PdfText style={[styles.cell, styles.totalLabel, styles.totalCell]}>Project cost — procurement basis</PdfText><PdfText style={[styles.cell, styles.totalValue, styles.totalCell]}>{money(calculation.project_cost_procurement)}</PdfText></PdfView>
        <PdfText style={styles.note}>Material usage is calculated from the saved costing inputs. This PDF reflects the editable inputs and the deterministic {calculation.formula_version} calculation. Automated document extraction is not a substitute for human review. Approved records are locked; a change requires a new revision.</PdfText>
        {draft.decision_note ? <PdfText style={styles.note}>Review note: {draft.decision_note}</PdfText> : null}
      </PdfPage>
    </PdfDocument>
  );
}

export function CostingRequestWorkspace({
  store,
  orgId,
  role,
  currentUserId,
  reload,
  notice,
}: {
  store: Store;
  orgId: string;
  role: string;
  currentUserId: string | null;
  reload: () => Promise<unknown> | void;
  notice: (message: string) => void;
}) {
  const client = useMemo(() => createClient(), []);
  const printCostingDefaults = useMemo(
    () => normalizePrintCostingDefaults(store.business_settings[0]?.print_costing_defaults),
    [store.business_settings],
  );
  const [draft, setDraft] = useState<CostingDraft | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => setMessage(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);
  const management = role === "owner" || role === "admin" || role === "super_admin";
  const canPrepare = role === "sales_pricing_officer";
  const [requestSetupOpen, setRequestSetupOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const availableLeads = useMemo(
    () => store.leads
      .filter((lead) => !["won", "lost"].includes(stringValue(lead.status)))
      .filter((lead) => management || (
        canPrepare && Boolean(currentUserId) && (
          leadOwnerId(lead) === currentUserId || stringValue(lead.endorsed_to) === currentUserId
        )
      ))
      .sort((left, right) => leadClientLabel(left).localeCompare(leadClientLabel(right))),
    [canPrepare, currentUserId, management, store.leads],
  );
  const selectedLead = useMemo(
    () => availableLeads.find((lead) => stringValue(lead.id) === selectedLeadId) ?? null,
    [availableLeads, selectedLeadId],
  );
  const leadOptions = useMemo(
    () => availableLeads.map((lead) => ({
      value: stringValue(lead.id),
      label: leadClientLabel(lead),
      searchText: [
        stringValue(lead.lead_no),
        stringValue(lead.client_name),
        stringValue(lead.contact_name),
        stringValue(lead.project_name),
        stringValue(lead.phone),
        stringValue(lead.email),
      ].join(" "),
    })),
    [availableLeads],
  );
  const linkedLeadId = draft?.lead_id;
  const linkedLead = useMemo(
    () => linkedLeadId
      ? store.leads.find((lead) => stringValue(lead.id) === linkedLeadId) ?? null
      : null,
    [linkedLeadId, store.leads],
  );
  const defaultRequestTab: RequestStatus = management ? "pending" : "draft";
  const [requestTab, setRequestTab] = useState<RequestStatus>(() => defaultRequestTab);
  const requestTabs: RequestTab[] = management
    ? [
        { key: "pending", label: "Pending Review" },
        { key: "needs_revision", label: "Needs Revision" },
        { key: "approved", label: "Approved" },
      ]
    : [
        { key: "draft", label: "Draft" },
        { key: "pending", label: "Pending Review" },
        { key: "needs_revision", label: "Needs Revision" },
        { key: "approved", label: "Approved" },
      ];
  const activeRequestTab = requestTabs.some((tab) => tab.key === requestTab) ? requestTab : defaultRequestTab;
  const requests = useMemo(
    () => [...store.costing_requests]
      .filter((row) => !management || requestStatus(row.status) !== "draft")
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))),
    [management, store.costing_requests],
  );
  const visibleRequests = useMemo(
    () => requests.filter((row) => requestStatus(row.status) === activeRequestTab),
    [activeRequestTab, requests],
  );
  const calculation = useMemo(
    () => draft ? calculateCosting({
      hpLatexRate: draft.hp_latex_rate,
      wasteAllowance: draft.waste_allowance,
      items: draft.items,
      materials: draft.materials,
      additionalCosts: draft.additional_costs,
      formulaVersion: draft.formula_version,
    }) : null,
    [draft],
  );
  const assumptionIssues = useMemo(() => {
    if (!draft || !calculation) return [];
    return draft.materials.filter((material) => {
      const row = calculation.material_rows.find((item) => item.material_category === material.material_category);
      if (!row || row.total_area_sqm <= 0) return false;
      return numberValue(material.roll_width_m) <= 0
        || numberValue(material.roll_length_m) <= 0
        || numberValue(material.roll_cost) <= 0;
    });
  }, [calculation, draft]);
  const hasValidCostingItems = useMemo(
    () => Boolean(draft?.items.some((item) =>
      numberValue(item.width_mm) > 0
      && numberValue(item.height_mm) > 0
      && numberValue(item.quantity) > 0,
    )),
    [draft?.items],
  );
  const usedMaterialCategories = useMemo(
    () => COSTING_MATERIAL_CATEGORIES.filter((category) => Boolean(draft?.items.some((item) =>
      materialCategory(item.material_category) === category
      && numberValue(item.width_mm) > 0
      && numberValue(item.height_mm) > 0
      && numberValue(item.quantity) > 0,
    ))),
    [draft?.items],
  );
  const productionInputsReady = Boolean(hasValidCostingItems && assumptionIssues.length === 0);
  const locked = draft?.status === "pending" || draft?.status === "approved";
  const editable = Boolean(draft && !locked && (management || !draft.prepared_by || draft.prepared_by === currentUserId));

  const setDraftValue = (changes: Partial<CostingDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const invalidatesProductionAssumptions = ["items", "materials", "hp_latex_rate", "waste_allowance"]
        .some((key) => key in changes);
      return {
        ...current,
        ...changes,
        ...(invalidatesProductionAssumptions && !("production_assumptions_confirmed" in changes)
          ? { production_assumptions_confirmed: false }
          : {}),
      };
    });
  };

  const openExisting = (row: AnyRow) => {
    setDraft(draftFromRow(row, store, printCostingDefaults));
    setRequestSetupOpen(false);
    setSelectedLeadId("");
    setSourceFile(null);
    setReviewNote("");
    setMessage(null);
  };

  const beginRequest = () => {
    setDraft(null);
    setSourceFile(null);
    setSelectedLeadId("");
    setRequestSetupOpen(true);
    setMessage(null);
  };

  const cancelRequest = () => {
    if (analyzing) return;
    setRequestSetupOpen(false);
    setSelectedLeadId("");
    setSourceFile(null);
    setMessage(null);
  };

  const startManualEntry = () => {
    setMessage(null);
    if (!selectedLead) {
      setMessage("Select a Lead / Client before continuing with manual entry.");
      return;
    }
    setDraft({ ...blankDraft(printCostingDefaults), ...leadSnapshot(selectedLead) });
    setSourceFile(null);
    setReviewNote("");
    setRequestSetupOpen(false);
  };

  const uploadAndAnalyze = async (file: File) => {
    setMessage(null);
    if (!selectedLead) {
      setMessage("Select a Lead / Client before uploading the costing document.");
      return;
    }
    const documentMimeType = sourceMimeType(file);
    if (!documentMimeType) {
      setMessage("Only PDF or Word (.docx) files can be uploaded.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage("The PDF or Word file must be 15 MB or smaller.");
      return;
    }
    const base = {
      ...blankDraft(printCostingDefaults),
      ...leadSnapshot(selectedLead),
      source_file_name: file.name,
      source_file_size: file.size,
      source_mime_type: documentMimeType,
    };
    setSourceFile(file);
    setAnalyzing(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("organization_id", orgId);
      body.append("lead_id", selectedLead.id ? String(selectedLead.id) : "");
      const response = await fetch("/api/costing-requests/extract", { method: "POST", body });
      const result = await response.json() as { extraction?: ExtractionResult; error?: string; code?: string };
      if ((response.status === 503 && result.code === "AI_NOT_CONFIGURED") || (response.status === 422 && ["PDF_TEXT_UNAVAILABLE", "DOCUMENT_TEXT_UNAVAILABLE"].includes(result.code ?? ""))) {
        setDraft(base);
        setRequestSetupOpen(false);
        setMessage(result.error ?? "The document could not be read. The document is attached to a blank editable draft; enter the costing details manually.");
      } else if (!response.ok || !result.extraction) {
        throw new Error(result.error ?? "The document could not be analyzed.");
      } else {
        setDraft(applyExtraction(base, result.extraction));
        setRequestSetupOpen(false);
        const extractedIdentity = [result.extraction.client_name, result.extraction.client_contact_name, result.extraction.client_phone, result.extraction.project_name]
          .map((value) => stringValue(value).trim().toLowerCase())
          .filter(Boolean);
        const selectedIdentity = [selectedLead.client_name, selectedLead.contact_name, selectedLead.phone, selectedLead.project_name]
          .map((value) => stringValue(value).trim().toLowerCase())
          .filter(Boolean);
        const identityConflict = extractedIdentity.some((value) => !selectedIdentity.includes(value));
        setMessage(identityConflict
          ? "The uploaded document contains client details that differ from the selected Lead. The selected Lead remains authoritative; review the costing details before saving."
          : "Document extraction complete. Review every field before saving or submitting.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document could not be analyzed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return null;
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      let storagePath = draft.source_storage_path;
      if (sourceFile) {
        const documentMimeType = sourceMimeType(sourceFile);
        if (!documentMimeType) throw new Error("Only PDF or Word (.docx) files can be stored.");
        const extension = documentMimeType === DOCX_MIME_TYPE ? "docx" : "pdf";
        storagePath = `${orgId}/costing-requests/${currentUserId ?? "unknown"}/${crypto.randomUUID()}.${extension}`;
        const upload = await client.storage.from("costing-source-documents").upload(storagePath, sourceFile, {
          contentType: documentMimeType,
          upsert: false,
        });
        if (upload.error) throw new Error(upload.error.message);
        uploadedPath = storagePath;
      }
      const savedMaterials = draft.materials.map((material, index) => {
        const calculatedMaterial = calculation?.material_rows.find(
          (row) => row.material_category === material.material_category,
        );
        const hasArea = Boolean(calculatedMaterial && calculatedMaterial.total_area_sqm > 0);
        return {
          ...material,
          required_rolls: material.required_rolls ?? (hasArea ? calculatedMaterial?.required_rolls ?? null : null),
          linear_meters_used: material.linear_meters_used ?? (hasArea ? calculatedMaterial?.linear_meters_used ?? null : null),
          sort_order: index + 1,
        };
      });
      const payload = {
        lead_id: draft.lead_id,
        source_file_name: draft.source_file_name,
        source_storage_path: storagePath || null,
        source_mime_type: draft.source_mime_type,
        source_file_size: draft.source_file_size,
        client_name: draft.client_name,
        client_contact_name: draft.client_contact_name,
        client_phone: draft.client_phone,
        client_email: draft.client_email,
        project_name: draft.project_name,
        notes: draft.notes,
        hp_latex_rate: draft.hp_latex_rate,
        waste_allowance: draft.waste_allowance,
        formula_version: draft.formula_version,
        extraction_json: draft.extraction_json ?? {},
        production_assumptions_confirmed: productionInputsReady,
        items: draft.items.map((item, index) => ({ ...item, sort_order: index + 1 })),
        materials: savedMaterials,
        additional_costs: draft.additional_costs.map((cost, index) => ({ ...cost, sort_order: index + 1 })),
      };
      const { data, error } = await client.rpc("save_costing_request", {
        p_organization_id: orgId,
        p_request_id: draft.id ?? null,
        p_payload: payload,
      });
      if (error) throw new Error(error.message);
      const savedId = typeof data === "string" ? data : draft.id ?? null;
      setDraftValue({
        id: savedId ?? undefined,
        source_storage_path: storagePath,
        status: draft.status,
        production_assumptions_confirmed: productionInputsReady,
      });
      setSourceFile(null);
      await Promise.resolve(reload());
      notice("Costing draft saved. Review the calculated material usage and totals before submitting.");
      return savedId;
    } catch (error) {
      if (uploadedPath) await client.storage.from("costing-source-documents").remove([uploadedPath]);
      setMessage(error instanceof Error ? error.message : "The costing draft could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft) return;
    if (assumptionIssues.length > 0) {
      setMessage("Set a positive roll width, roll length, and roll cost for every material used before submitting.");
      return;
    }
    if (!hasValidCostingItems) {
      setMessage("Add at least one costing item with a positive width, height, and quantity before submitting.");
      return;
    }
    const savedId = await saveDraft();
    if (!savedId) return;
    setBusy(true);
    const { error } = await client.rpc("submit_costing_request", { p_request_id: savedId });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setDraftValue({ status: "pending" });
    await Promise.resolve(reload());
    notice("Costing submitted to the General Manager for review.");
  };

  const review = async (decision: "approved" | "needs_revision") => {
    if (!draft?.id) return;
    if (decision === "needs_revision" && !reviewNote.trim()) {
      setMessage("Add a note before returning the costing for revision.");
      return;
    }
    setBusy(true);
    const { error } = await client.rpc("review_costing_request", {
      p_request_id: draft.id,
      p_decision: decision,
      p_note: reviewNote.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setDraftValue({ status: decision, decision_note: reviewNote.trim() });
    await Promise.resolve(reload());
    notice(decision === "approved" ? "Costing approved and locked." : "Costing returned to the preparer for revision.");
  };

  const createRevision = async () => {
    if (!draft?.id) return;
    setBusy(true);
    const { data, error } = await client.rpc("create_costing_request_revision", { p_request_id: draft.id });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    const revisionId = typeof data === "string" ? data : null;
    setDraftValue({ id: revisionId ?? undefined, request_no: undefined, revision_number: draft.revision_number + 1, status: "draft", decision_note: "", production_assumptions_confirmed: false });
    await Promise.resolve(reload());
    notice("A new editable revision was created. The approved version remains locked.");
  };

  const openSource = async (row: AnyRow) => {
    const path = stringValue(row.source_storage_path);
    if (!path) {
      setMessage("No source document is attached to this costing.");
      return;
    }
    const { data, error } = await client.storage.from("costing-source-documents").createSignedUrl(path, 5 * 60);
    if (error || !data?.signedUrl) {
      setMessage(error?.message ?? "The source document could not be opened.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const openPdf = async (row?: AnyRow) => {
    const selected = row ? draftFromRow(row, store, printCostingDefaults) : draft;
    if (!selected) return;
    if (selected.status !== "approved") {
      setMessage("Costing PDFs are available only after General Manager approval.");
      return;
    }
    const selectedCalculation = calculateCosting({
      hpLatexRate: selected.hp_latex_rate,
      wasteAllowance: selected.waste_allowance,
      items: selected.items,
      materials: selected.materials,
      additionalCosts: selected.additional_costs,
      formulaVersion: selected.formula_version,
    });
    setBusy(true);
    try {
      const blob = await pdf(<CostingRequestPdf draft={selected} calculation={selectedCalculation} />).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The costing PDF could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const editor = draft && calculation ? (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[var(--color-overlay)] p-3 sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="print-costing-editor-title" className="mx-auto my-2 max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl sm:my-4 sm:max-h-[calc(100dvh-2rem)]">
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <h2 id="print-costing-editor-title" className="text-[16px] font-semibold text-[var(--color-text-primary)]">{draft.request_no ?? "New Print Costing"}</h2>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{draft.project_name || "Editable costing draft"}</p>
              </div>
              <Badge variant={statusVariant(draft.status)}>{statusLabel[draft.status]}</Badge>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {draft.source_storage_path ? <Button variant="outline" size="sm" onClick={() => void openSource(draft)}><FileText /> Source {sourceDocumentLabel(draft.source_mime_type, draft.source_file_name)}</Button> : null}
              {draft.status === "approved" ? <Button variant="outline" size="sm" onClick={() => void openPdf()} disabled={busy}><Download /> Generate PDF</Button> : null}
              <button type="button" onClick={() => setDraft(null)} disabled={busy} aria-label="Close Print Costing editor" className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"><X size={18} /></button>
            </div>
          </div>
      {message ? <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--color-warning-text)]">{message}</div> : null}
      {draft.status === "approved" ? <div className="rounded-[var(--radius-control)] border border-[var(--color-success-border)] bg-[var(--color-success-subtle)] px-3 py-2 text-[12px] text-[var(--color-success-text)]">This costing is approved and locked. Create a revision to make changes.</div> : null}
      {draft.status === "pending" ? <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--color-warning-text)]">This costing is pending GM review and is read-only until a decision is made.</div> : null}
      {draft.status === "needs_revision" && draft.decision_note ? <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--color-warning-text)]"><span className="font-semibold">GM note:</span> {draft.decision_note}</div> : null}

      <Card>
        <CardHeader><h3 className="text-[14px] font-semibold">Client and source details</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">The selected Lead is the authoritative client record. Information extracted from the document does not replace the Lead information.</p></CardHeader>
        <CardContent className="grid gap-3 border-t border-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Lead / client" hint={draft.lead_id ? "Linked from Leads" : "Select a Lead before submitting this costing."}>{draft.lead_id ? <input className="input mt-0" disabled value={linkedLead ? leadClientLabel(linkedLead) : draft.lead_id} /> : <SearchableLeadSelect options={leadOptions} value="" onChange={(value) => { const lead = availableLeads.find((candidate) => stringValue(candidate.id) === value); if (lead) setDraftValue(leadSnapshot(lead)); }} disabled={!editable} clearable={false} placeholder="Select a lead" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Lead / client" className="mt-0" />}</Field>
          <Field label="Client / company"><input className="input mt-0" disabled={!editable || Boolean(draft.lead_id)} value={draft.client_name} onChange={(event) => setDraftValue({ client_name: event.target.value })} /></Field>
          <Field label="Contact person"><input className="input mt-0" disabled={!editable || Boolean(draft.lead_id)} value={draft.client_contact_name} onChange={(event) => setDraftValue({ client_contact_name: event.target.value })} /></Field>
          <Field label="Phone"><input className="input mt-0" disabled={!editable || Boolean(draft.lead_id)} value={draft.client_phone} onChange={(event) => setDraftValue({ client_phone: event.target.value })} /></Field>
          <Field label="Email"><input className="input mt-0" disabled={!editable || Boolean(draft.lead_id)} value={draft.client_email} onChange={(event) => setDraftValue({ client_email: event.target.value })} /></Field>
          <Field label="Project name"><input className="input mt-0" disabled={!editable || Boolean(draft.lead_id)} value={draft.project_name} onChange={(event) => setDraftValue({ project_name: event.target.value })} /></Field>
          <Field label={`Source ${sourceDocumentLabel(draft.source_mime_type, draft.source_file_name)}`} hint={draft.source_file_name ? `${(numberValue(draft.source_file_size) / 1024 / 1024).toFixed(2)} MB` : "Manual entry — no source document provided."}><input className="input mt-0" disabled value={draft.source_file_name || "Manual entry — no source document provided"} /></Field>
          <Field label="Notes"><textarea className="input mt-0 min-h-9" disabled={!editable} value={draft.notes} onChange={(event) => setDraftValue({ notes: event.target.value })} /></Field>
        </CardContent>
      </Card>

      {usedMaterialCategories.length ? <Card>
        <CardHeader><h3 className="text-[14px] font-semibold">Material usage and calculation defaults</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">Only materials used by the costing items are shown. The system uses the GM-managed Excel defaults and calculates the material usage automatically.</p></CardHeader>
        <CardContent className="space-y-4 border-t border-[var(--color-border)]">
          <div className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-[11px] sm:grid-cols-3">
            <div><span className="block text-[var(--color-text-tertiary)]">HP Latex rate</span><span className="mt-1 block font-semibold text-[var(--color-text-primary)]">{currency.format(draft.hp_latex_rate)} / sq. m.</span></div>
            <div><span className="block text-[var(--color-text-tertiary)]">Waste allowance</span><span className="mt-1 block font-semibold text-[var(--color-text-primary)]">{(draft.waste_allowance * 100).toFixed(2)}%</span></div>
            <div><span className="block text-[var(--color-text-tertiary)]">Formula version</span><span className="mt-1 block font-semibold text-[var(--color-text-primary)]">{draft.formula_version}</span></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)]">
                  <th className="px-2 py-2">Material</th>
                  <th className="px-2 py-2">Roll stock</th>
                  <th className="px-2 py-2">Roll cost</th>
                  <th className="px-2 py-2">Meters used</th>
                  <th className="px-2 py-2">Required rolls</th>
                </tr>
              </thead>
              <tbody>
                {draft.materials.map((material, index) => {
                  if (!usedMaterialCategories.includes(material.material_category)) return null;
                  const estimate = calculation.material_rows.find((row) => row.material_category === material.material_category);
                  const hasArea = Boolean(estimate && estimate.total_area_sqm > 0);
                  const meters = hasArea ? material.linear_meters_used ?? estimate?.linear_meters_used ?? null : null;
                  const rolls = hasArea ? material.required_rolls ?? estimate?.required_rolls ?? null : null;
                  return (
                    <tr key={material.material_category} className="border-b border-[var(--color-border)]">
                      <td className="px-2 py-2 font-medium">{material.display_name}</td>
                      <td className="px-2 py-2 text-[var(--color-text-secondary)]">{numberValue(material.roll_width_m).toFixed(2)}m × {numberValue(material.roll_length_m).toFixed(2)}m</td>
                      <td className="px-2 py-2 text-[var(--color-text-secondary)]">{currency.format(numberValue(material.roll_cost))}</td>
                      <td className="px-2 py-2">
                        <NumberInput aria-label={`${material.display_name} meters used`} className="input mt-0 w-32" min="0" step="0.01" disabled={!editable || !hasArea} value={meters ?? ""} zeroWhenEmpty={hasArea} placeholder={hasArea ? "Calculated" : "Add items first"} onChange={(value) => setDraftValue({ materials: draft.materials.map((row, rowIndex) => rowIndex === index ? { ...row, linear_meters_used: value === "" ? null : value } : row) })} />
                        {hasArea && material.linear_meters_used === null ? <span className="mt-1 block text-[10px] text-[var(--color-text-tertiary)]">Calculated estimate</span> : null}
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput aria-label={`${material.display_name} required rolls`} className="input mt-0 w-28" min="0" step="1" disabled={!editable || !hasArea} value={rolls ?? ""} zeroWhenEmpty={hasArea} placeholder={hasArea ? "Calculated" : "Add items first"} onChange={(value) => setDraftValue({ materials: draft.materials.map((row, rowIndex) => rowIndex === index ? { ...row, required_rolls: value === "" ? null : value } : row) })} />
                        {hasArea && material.required_rolls === null ? <span className="mt-1 block text-[10px] text-[var(--color-text-tertiary)]">Calculated estimate</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div role="status" className={`rounded-[var(--radius-control)] border px-3 py-2 text-[11px] ${assumptionIssues.length || !hasValidCostingItems ? "border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] text-[var(--color-warning-text)]" : "border-[var(--color-success-border)] bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"}`}>
            {assumptionIssues.length ? "Set a positive roll width, roll length, and roll cost for every material used by this costing." : !hasValidCostingItems ? "Add costing items with a positive width, height, and quantity to calculate material usage." : "Material usage is calculated and will be validated again by the server when this costing is saved or submitted."}
          </div>
        </CardContent>
      </Card> : null}

      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[14px] font-semibold">Costing items</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">Net print area is calculated from width × height × quantity ÷ 1,000,000.</p></div>{editable ? <Button variant="outline" size="sm" onClick={() => setDraftValue({ items: [...draft.items, blankItem(draft.items.length + 1)] })}><Plus /> Add item</Button> : null}</div></CardHeader>
        <CardContent className="border-t border-[var(--color-border)]">
          <div className="overflow-x-auto pb-1">
            <table className="w-full min-w-[1120px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)]">
                  <th className="px-2 py-2">Material</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Width mm</th>
                  <th className="px-2 py-2">Height mm</th>
                  <th className="px-2 py-2">Qty</th>
                  <th className="min-w-[240px] px-2 py-2">Finish</th>
                  <th className="px-2 py-2">Area sq. m.</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {draft.items.map((item, index) => {
                  const area = numberValue(item.width_mm) * numberValue(item.height_mm) * numberValue(item.quantity) / 1_000_000;
                  return (
                    <tr key={item.id ?? index} className="border-b border-[var(--color-border)] align-top">
                      <td className="px-2 py-2">
                        <select className="input mt-0 w-40 min-w-[150px]" disabled={!editable} value={item.material_category} onChange={(event) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, material_category: materialCategory(event.target.value) } : row) })}>
                          {COSTING_MATERIAL_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2"><input className="input mt-0 w-52" disabled={!editable} value={stringValue(item.item_description)} onChange={(event) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, item_description: event.target.value } : row) })} /></td>
                      <td className="px-2 py-2"><NumberInput className="input mt-0 w-24" min="0" step="0.01" disabled={!editable} value={item.width_mm} onChange={(value) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, width_mm: value } : row) })} /></td>
                      <td className="px-2 py-2"><NumberInput className="input mt-0 w-24" min="0" step="0.01" disabled={!editable} value={item.height_mm} onChange={(value) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, height_mm: value } : row) })} /></td>
                      <td className="px-2 py-2"><NumberInput className="input mt-0 w-24" min="0" step="1" disabled={!editable} value={item.quantity} onChange={(value) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: value } : row) })} /></td>
                      <td className="min-w-[240px] px-2 py-2"><FinishMultiSelect value={stringValue(item.finish)} disabled={!editable} onChange={(value) => setDraftValue({ items: draft.items.map((row, rowIndex) => rowIndex === index ? { ...row, finish: value } : row) })} /></td>
                      <td className="px-2 py-2 pt-4 font-medium">{area.toFixed(4)}</td>
                      <td className="px-2 py-2">{editable && draft.items.length > 1 ? <Button variant="ghost" size="icon-xs" onClick={() => setDraftValue({ items: draft.items.filter((_, rowIndex) => rowIndex !== index) })} aria-label="Remove costing item"><Trash2 /></Button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[14px] font-semibold">Additional costs</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">These are added after material and printing costs, like the workbook’s optional cost rows.</p></div>{editable ? <Button variant="outline" size="sm" onClick={() => setDraftValue({ additional_costs: [...draft.additional_costs, { label: "Additional cost", amount: 0, note: "", sort_order: draft.additional_costs.length + 1 }] })}><Plus /> Add cost</Button> : null}</div></CardHeader>
        <CardContent className="border-t border-[var(--color-border)]"><div className="space-y-2">{draft.additional_costs.map((cost, index) => <div className="grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto]" key={cost.id ?? index}><input className="input mt-0" disabled={!editable} value={cost.label} onChange={(event) => setDraftValue({ additional_costs: draft.additional_costs.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) })} /><NumberInput className="input mt-0" min="0" step="0.01" disabled={!editable} value={cost.amount} onChange={(value) => setDraftValue({ additional_costs: draft.additional_costs.map((row, rowIndex) => rowIndex === index ? { ...row, amount: value } : row) })} /><input className="input mt-0" disabled={!editable} placeholder="Optional note" value={cost.note ?? ""} onChange={(event) => setDraftValue({ additional_costs: draft.additional_costs.map((row, rowIndex) => rowIndex === index ? { ...row, note: event.target.value } : row) })} />{editable && draft.additional_costs.length > 1 ? <Button variant="ghost" size="icon-sm" onClick={() => setDraftValue({ additional_costs: draft.additional_costs.filter((_, rowIndex) => rowIndex !== index) })} aria-label="Remove additional cost"><Trash2 /></Button> : null}</div>)}</div></CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-[14px] font-semibold">Live costing summary</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">The browser preview and the server snapshot use the same workbook-compatible formula version. The server recalculates on save and submit.</p></CardHeader>
        <CardContent className="border-t border-[var(--color-border)] p-3 sm:p-4">
          <dl className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)] text-[12px]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-text-tertiary)] sm:px-4">
              <dt>Cost category</dt>
              <dd>Value</dd>
            </div>
            <SummaryRow label="Total quantity" value={calculation.total_quantity.toLocaleString()} />
            <SummaryRow label="Total print area" value={`${calculation.total_area_sqm.toFixed(4)} sq. m.`} />
            <SummaryRow label="Material consumption" value={currency.format(calculation.material_consumption)} />
            <SummaryRow label="Full-roll procurement" value={currency.format(calculation.full_roll_purchase)} />
            <SummaryRow label="Printing + allowance" value={currency.format(calculation.printing_with_allowance)} />
            <SummaryRow label="Additional costs" value={currency.format(calculation.additional_costs)} />
            <SummaryRow label="Project cost / consumption" value={currency.format(calculation.project_cost_consumption)} tone="emphasis" />
            <SummaryRow label="Cost per piece" value={currency.format(calculation.cost_per_piece)} tone="success" />
          </dl>
        </CardContent>
      </Card>

      {draft.status === "pending" && management ? <Card><CardHeader><h3 className="text-[14px] font-semibold">General Manager decision</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">Approval locks this costing. Returning it for revision requires a clear note for the preparer.</p></CardHeader><CardContent className="space-y-3 border-t border-[var(--color-border)]"><textarea className="input mt-0 min-h-20" placeholder="Decision note (required when returning for revision)" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /><div className="flex flex-wrap gap-2"><Button onClick={() => void review("approved")} disabled={busy}><Check /> Approve and lock</Button><Button variant="outline" onClick={() => void review("needs_revision")} disabled={busy}><RotateCcw /> Return for revision</Button></div></CardContent></Card> : null}

          <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" onClick={() => setDraft(null)}><ArrowLeft /> Back to list</Button><div className="flex flex-wrap gap-2">{draft.status === "approved" && draft.prepared_by === currentUserId ? <Button variant="outline" onClick={() => void createRevision()} disabled={busy}><RotateCcw /> Create revision</Button> : null}{editable ? <><Button variant="outline" onClick={() => void saveDraft()} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : null} Save draft</Button><Button onClick={() => void submit()} disabled={busy || !draft.id || !productionInputsReady}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />} Submit to GM</Button></> : null}</div></div>
        </div>
      </section>
    </div>
  ) : null;

  if (editor) return editor;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Print Costing</h2><p className="mt-0.5 max-w-2xl text-[12px] text-[var(--color-text-secondary)]">{management ? "Review submitted Print Costings, return them for revision, and approve completed requests." : "Select the Lead first, then upload a client PDF or Word (.docx) file for costing."}</p></div>{canPrepare ? <Button onClick={beginRequest} disabled={analyzing}><Plus /> Request Costing</Button> : null}</div>
      {requestSetupOpen && canPrepare ? (
        <div
          className="fixed inset-0 z-[80] overflow-y-auto bg-[var(--color-overlay)] p-4 sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !analyzing) cancelRequest();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-busy={analyzing}
            aria-labelledby="request-costing-title"
            aria-describedby="request-costing-description"
            className="mx-auto my-4 w-full max-w-[560px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl sm:my-8"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id="request-costing-title" className="text-[15px] font-semibold text-[var(--color-text-primary)]">Request Costing</h2>
                <p id="request-costing-description" className="mt-1 text-[12px] leading-[1.45] text-[var(--color-text-secondary)]">Choose the Lead / Client, then upload a source document for AI costing or continue with manual entry. Lead information will be carried into the editable costing and generated PDF.</p>
              </div>
              <button
                type="button"
                onClick={cancelRequest}
                disabled={analyzing}
                aria-label="Close Request Costing"
                className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={17} />
              </button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <Field label="Lead / client" hint={availableLeads.length ? "Only Leads assigned to or endorsed to you are available." : "No eligible Leads are available for costing."}>
                <SearchableLeadSelect options={leadOptions} value={selectedLeadId} onChange={(value) => { setSelectedLeadId(value); setSourceFile(null); }} disabled={analyzing || !availableLeads.length} clearable={false} placeholder="Select a lead" searchPlaceholder="Search name, contact, project, or lead number" ariaLabel="Lead / client" className="mt-0" />
              </Field>
              {selectedLead ? <div className="grid gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-2 lg:grid-cols-4"><div><div className="text-[11px] text-[var(--color-text-tertiary)]">Client / company</div><div className="mt-1 text-[12px] font-medium">{stringValue(selectedLead.client_name, "—")}</div></div><div><div className="text-[11px] text-[var(--color-text-tertiary)]">Contact person</div><div className="mt-1 text-[12px] font-medium">{stringValue(selectedLead.contact_name, "—")}</div></div><div><div className="text-[11px] text-[var(--color-text-tertiary)]">Phone / email</div><div className="mt-1 text-[12px] font-medium">{stringValue(selectedLead.phone) || stringValue(selectedLead.email) || "—"}</div></div><div><div className="text-[11px] text-[var(--color-text-tertiary)]">Project</div><div className="mt-1 text-[12px] font-medium">{stringValue(selectedLead.project_name, "—")}</div></div></div> : null}
              <Field label="Source document (optional)" hint={analyzing ? "Scanning the selected document. Please wait." : sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(2)} MB selected. Click the field to change the file.` : "Optional: PDF or Word (.docx), maximum 15 MB. Choose Enter manually if no source document is available."}>
                <FileUploadControl
                  accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                  ariaLabel="Choose costing source document"
                  disabled={analyzing || !selectedLeadId}
                  files={sourceFile ? [sourceFile] : []}
                  emptyLabel="Choose a PDF or Word file"
                  onFilesSelected={(files) => {
                    setSourceFile(files[0] ?? null);
                    setMessage(null);
                  }}
                />
              </Field>
              {analyzing ? <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] px-3 py-3 text-[12px] text-[var(--color-accent-text)]"><LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" /><div><div className="font-semibold">AI is scanning the document</div><p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">Reading the source file and preparing editable costing fields. This may take a moment.</p></div></div> : null}
              {message ? <div role="alert" className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--color-warning-text)]">{message}</div> : null}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                <Button variant="ghost" onClick={cancelRequest} disabled={analyzing}>Cancel</Button>
                <Button variant="outline" onClick={startManualEntry} disabled={!selectedLeadId || analyzing}>Enter manually</Button>
                <Button onClick={() => { if (sourceFile) void uploadAndAnalyze(sourceFile); }} disabled={!selectedLeadId || !sourceFile || analyzing} aria-busy={analyzing}>{analyzing ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Scanning document…</> : "Costing with AI"}</Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {message && !requestSetupOpen ? <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--color-warning-text)]">{message}</div> : null}
      <nav aria-label="Print Costing workflow" className="app-tabs overflow-x-auto border-b border-[var(--color-border)]">
        {requestTabs.map((tab) => {
          const count = requests.filter((row) => requestStatus(row.status) === tab.key).length;
          return <button key={tab.key} type="button" onClick={() => { setRequestTab(tab.key); setMessage(null); }} aria-current={activeRequestTab === tab.key ? "page" : undefined} className="app-tab whitespace-nowrap">{tab.label} ({count})</button>;
        })}
      </nav>
      <Card><CardHeader><h3 className="text-[14px] font-semibold">Costing requests</h3><p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{management ? "Submitted, returned, and approved requests in your organization are shown here." : "Your prepared requests are shown here."}</p></CardHeader><CardContent className="border-t border-[var(--color-border)] p-0">{visibleRequests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[12px]"><thead><tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)]"><th className="px-4 py-3">Request</th><th className="px-4 py-3">Client / project</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Project cost</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{visibleRequests.map((row) => { const status = requestStatus(row.status); const calculationRow = rowCalculation(row); const projectCost = numberValue(calculationRow.project_cost_consumption); const editableRow = status !== "pending" && status !== "approved" && (management || stringValue(row.prepared_by) === currentUserId); return <tr key={stringValue(row.id)} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-3"><div className="font-medium text-[var(--color-text-primary)]">{stringValue(row.request_no, "Draft")}</div><div className="text-[11px] text-[var(--color-text-tertiary)]">Revision {numberValue(row.revision_number, 1)}</div></td><td className="px-4 py-3"><div className="font-medium">{stringValue(row.client_name, "No client name")}</div><div className="text-[11px] text-[var(--color-text-secondary)]">{stringValue(row.project_name, "No project name")}</div></td><td className="px-4 py-3"><Badge variant={statusVariant(status)}>{statusLabel[status] ?? status}</Badge></td><td className="px-4 py-3 font-medium">{projectCost ? currency.format(projectCost) : "—"}</td><td className="px-4 py-3 text-[var(--color-text-secondary)]">{dateLabel(row.updated_at ?? row.created_at)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" size="xs" onClick={() => openExisting(row)}>{status === "pending" && management ? "Review" : editableRow ? "Edit" : "View"}</Button>{status === "approved" && stringValue(row.prepared_by) === currentUserId ? <Button variant="ghost" size="xs" onClick={() => openExisting(row)}>Revision</Button> : null}{stringValue(row.source_storage_path) ? <Button variant="ghost" size="icon-xs" onClick={() => void openSource(row)} aria-label="Open source document"><FileText /></Button> : null}{status === "approved" ? <Button variant="ghost" size="icon-xs" onClick={() => void openPdf(row)} aria-label="Generate costing PDF"><Download /></Button> : null}</div></td></tr>; })}</tbody></table></div> : <div className="p-8 text-center text-[12px] text-[var(--color-text-secondary)]">No costings in this tab yet.{requestTab === "draft" ? " Click Request Costing to select a Lead and upload a document or start manual entry." : ""}</div>}</CardContent></Card>
    </div>
  );
}

function SummaryRow({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emphasis" | "success" }) {
  const toneClass = tone === "success"
    ? "bg-[var(--color-success-subtle)] font-semibold text-[var(--color-success-text)]"
    : tone === "emphasis"
    ? "bg-[var(--color-accent-subtle)] font-medium text-[var(--color-accent-text)]"
    : "text-[var(--color-text-primary)]";
  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--color-border)] px-3 py-2.5 last:border-b-0 sm:px-4 ${toneClass}`}><dt>{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>;
}
