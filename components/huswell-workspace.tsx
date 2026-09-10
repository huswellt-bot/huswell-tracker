"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/set-state-in-effect, @next/next/no-location-assign-relative-destination, @next/next/no-img-element */

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  Document as PdfDocument,
  Font as PdfFont,
  Image as PdfImage,
  Link as PdfLink,
  Page as PdfPage,
  StyleSheet as PdfStyleSheet,
  Text as PdfText,
  View as PdfView,
  pdf,
} from "@react-pdf/renderer";
import {
  Archive,
  Boxes,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  PhilippinePeso,
  Eye,
  EyeOff,
  FileText,
  Goal,
  ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  Paperclip,
  Pencil,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  ScrollText,
  Send,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  UserRound,
  UsersRound,
  Wallet,
  X,
  XCircle,
  TrendingUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { AccountProfileDialog } from "@/components/account-profile-dialog";
import { FixedIconTooltip } from "@/components/fixed-icon-tooltip";
import {
  quotationProjectTypeColors,
  quotationProjectTypes,
} from "@/lib/quotation-project-types";
import { workspaceAccountLabel } from "@/lib/role-labels";

PdfFont.register({
  family: "SF Pro Display",
  fonts: [
    { src: "/font/SFPRODISPLAYREGULAR.OTF", fontWeight: 400 },
    { src: "/font/SFPRODISPLAYLIGHTITALIC.OTF", fontWeight: 400, fontStyle: "italic" },
    { src: "/font/SFPRODISPLAYMEDIUM.OTF", fontWeight: 500 },
    { src: "/font/SFPRODISPLAYBOLD.OTF", fontWeight: 700 },
  ],
});

type View =
  | "Dashboard"
  | "Leads"
  | "Projects"
  | "Mockups"
  | "Quotation Costing Overview"
  | "Costing Breakdown"
  | "Price Quotations"
  | "Price Quotation Review"
  | "Materials List"
  | "Suppliers & Materials"
  | "Suppliers"
  | "Quotations"
  | "Production"
  | "Catalog"
  | "Inventory"
  | "Sales"
  | "Expenses"
  | "Finance"
  | "Payroll & Leave"
  | "Directory"
  | "Targets"
  | "Approvals"
  | "Payment Monitoring"
  | "Payment Reviews"
  | "Submissions"
  | "Policy"
  | "Settings"
  | "Commissions"
  | "Profile";

const TEMPORARILY_HIDDEN_VIEWS: ReadonlyArray<View> = [
  "Payment Monitoring",
  "Payment Reviews",
  "Commissions",
];

const isTemporarilyHiddenView = (view: View) =>
  TEMPORARILY_HIDDEN_VIEWS.includes(view);

type TableName =
  | "profiles"
  | "business_settings"
  | "customers"
  | "suppliers"
  | "employees"
  | "inventory_items"
  | "inventory_movements"
  | "quotations"
  | "quotation_items"
  | "price_quotation_illustrations"
  | "price_quotation_product_costings"
  | "price_quotation_costing_lines"
  | "price_quotation_costing_markups"
  | "price_quotation_mockups"
  | "price_quotation_endorsements"
  | "quotation_signed_proofs"
  | "quotation_payment_records"
  | "pricing_officer_project_types"
  | "announcements"
  | "policies"
  | "production_jobs"
  | "production_material_usage"
  | "production_job_activity"
  | "finished_product_stock_ins"
  | "invoices"
  | "invoice_items"
  | "payments"
  | "expenses"
  | "cash_flow_entries"
  | "payroll_periods"
  | "payroll_entries"
  | "leave_requests"
  | "target_goals"
  | "approval_requests"
  | "project_edit_requests"
  | "project_schedule_revision_requests"
  | "project_schedule_completion_requests"
  | "lead_change_requests"
  | "quotation_revision_requests"
  | "price_quotation_revision_requests"
  | "project_schedules"
  | "activity_log"
  | "leads"
  | "supplier_payables"
  | "organization_members";
type Row = { id?: string; [key: string]: unknown };
type Store = Record<TableName, Row[]>;
type ApprovalDecision = "approved" | "rejected";
type ApprovalQueueTab =
  | "quotations"
  | "mockup_quotations"
  | "price_revisions"
  | "costings"
  | "projects"
  | "leads"
  | "revisions"
  | "calendar_projects"
  | "calendar_revisions"
  | "calendar_completions"
  | "other";
type ApprovalCenterTab = "all" | ApprovalQueueTab;
type ApprovalQueueItem = {
  key: string;
  tab: ApprovalQueueTab;
  category: string;
  title: string;
  detail: string;
  requester: string;
  submittedAt: unknown;
  selectable: boolean;
  bulkDecisions?: ApprovalDecision[];
  bulkAction?: (
    decision: ApprovalDecision,
  ) => Promise<{ error?: { message?: string } | null }>;
  action: ReactNode;
};
export type QuotationPdfRow = Row;
export type QuotationPdfStore = Pick<
  Store,
  | "quotations"
  | "quotation_items"
  | "price_quotation_product_costings"
  | "price_quotation_costing_lines"
  | "price_quotation_costing_markups"
  | "customers"
  | "leads"
>;
type PendingCostLine = {
  id: string;
  inventory_item_id?: string;
  description: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  image_url?: string;
  details?: string;
};
type MarkupCalculationType = "percentage" | "fixed_amount";
const costLineCalculationOptions = [
  { value: "quantity_unit_cost", label: "Q×C" },
  { value: "fixed_amount", label: "Fixed" },
] as const;
const markupBasisOptions = [
  { value: "percentage", label: <Percent size={13} />, ariaLabel: "Percent" },
  { value: "fixed_amount", label: <PhilippinePeso size={13} />, ariaLabel: "Amount" },
] as const;

function SegmentedToggle({
  ariaLabel,
  value,
  options,
  onChange,
  size = "default",
  className = "",
}: {
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: ReactNode; ariaLabel?: string }>;
  onChange: (value: string) => void;
  size?: "compact" | "default";
  className?: string;
}) {
  const sizing = size === "compact"
    ? "min-h-6 px-1 text-[10px] font-semibold"
    : "min-h-8 px-3 text-[12px] font-medium";

  return (
    <div
      aria-label={ariaLabel}
      role="group"
      className={`inline-flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-md border border-[var(--color-border)] bg-white ${className}`}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            title={option.ariaLabel}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-w-0 flex-1 items-center justify-center ${sizing} transition-colors ${selected ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"} focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
type PricingMarkupKey =
  | "target_profit_margin"
  | "overhead_allocation"
  | "contingency_allowance"
  | "sales_commission"
  | "incentives"
  | "discounts"
  | "third_party_markup"
  | "vat"
  | (string & {});
type PricingMarkupDefault = {
  key: PricingMarkupKey;
  label: string;
  calculationType: MarkupCalculationType;
  value: string;
  visible: boolean;
  custom?: boolean;
};
const pricingMarkupDefinitions: Array<{
  key: PricingMarkupKey;
  label: string;
  fallback: string;
  legacyKeys: string[];
}> = [
  { key: "target_profit_margin", label: "Target Profit Margin", fallback: "75", legacyKeys: ["default_profit_margin"] },
  { key: "overhead_allocation", label: "Overhead Allocation", fallback: "0", legacyKeys: ["default_overhead_rate"] },
  { key: "contingency_allowance", label: "Contingency Allowance", fallback: "20", legacyKeys: ["default_buffer_margin"] },
  { key: "sales_commission", label: "Sales Commission", fallback: "0", legacyKeys: ["production_commission"] },
  { key: "incentives", label: "Incentives", fallback: "0", legacyKeys: [] },
  { key: "discounts", label: "Discounts", fallback: "0", legacyKeys: [] },
  { key: "third_party_markup", label: "Third Party Mark Up", fallback: "15", legacyKeys: ["default_additional_markup"] },
  { key: "vat", label: "VAT", fallback: "12", legacyKeys: ["vat_rate"] },
];
// Discount is set per quotation by the Sales & Pricing Officer. It is not an
// organization-wide internal pricing default.
const pricingMarkupDefaultDefinitions = pricingMarkupDefinitions.filter(
  (definition) => definition.key !== "discounts",
);
const internalPricingMarkupKeys = pricingMarkupDefaultDefinitions
  .filter((definition) => definition.key !== "vat")
  .map((definition) => definition.key);
const pricingMarkupDefinition = (key: PricingMarkupKey) =>
  pricingMarkupDefinitions.find((definition) => definition.key === key);
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const pricingMarkupKeyForLabel = (label: unknown): PricingMarkupKey | "" => {
  const normalized = String(label ?? "").trim().toLowerCase();
  // Saved costing rows use canonical database keys (for example
  // `target_profit_margin`), whereas legacy rows use display labels.
  // Recognize both before attempting label aliases.
  if (pricingMarkupDefinitions.some((definition) => definition.key === normalized)) {
    return normalized as PricingMarkupKey;
  }
  if (/^custom_[0-9a-f-]{36}$/.test(normalized)) return normalized as PricingMarkupKey;
  if (normalized === "discount") return "discounts";
  if (normalized === "profit margin" || normalized === "target profit margin") return "target_profit_margin";
  if (normalized === "overhead expense" || normalized === "overhead allocation") return "overhead_allocation";
  if (normalized === "buffer margin" || normalized === "contingency allowance") return "contingency_allowance";
  if (normalized === "commission" || normalized === "production commission" || normalized === "sales commission") return "sales_commission";
  if (normalized === "incentives" || normalized === "discounts" || normalized === "third party markup" || normalized === "third party mark up" || normalized === "additional markup") {
    return normalized === "incentives" ? "incentives" : normalized === "discounts" ? "discounts" : "third_party_markup";
  }
  return "";
};
const pricingMarkupDefaults = (
  stored: unknown,
  legacySettings?: Record<string, unknown>,
): PricingMarkupDefault[] => {
  const storedDefaults = objectValue(stored);
  const standardDefaults = pricingMarkupDefaultDefinitions.map((definition) => {
    const storedEntry = objectValue(storedDefaults[definition.key]);
    const legacyValue = definition.legacyKeys
      .map((key) => legacySettings?.[key])
      .find((value) => value !== undefined && value !== null && value !== "");
    const rawValue = storedEntry.value ?? storedEntry.rate ?? legacyValue ?? definition.fallback;
    return {
      key: definition.key,
      label: definition.label,
      calculationType: "percentage" as const,
      value: text(rawValue, definition.fallback),
      visible: storedEntry.visible !== false,
    };
  });
  const customDefaults = Object.entries(storedDefaults)
    .filter(([key, value]) => key.startsWith("custom_") && objectValue(value).label)
    .map(([key, value]) => {
      const entry = objectValue(value);
      return {
        key: key as PricingMarkupKey,
        label: text(entry.label, "Custom Markup"),
        calculationType: "percentage" as const,
        value: text(entry.value ?? entry.rate, "0"),
        visible: entry.visible !== false,
        custom: true,
      };
    });
  return [...standardDefaults, ...customDefaults];
};
const pricingMarkupDefaultPayload = (defaults: PricingMarkupDefault[]) =>
  Object.fromEntries(
    defaults.map((definition) => [
      definition.key,
      {
        label: definition.label,
        calculation_type: definition.key === "vat" ? "percentage" : definition.calculationType,
        value: n(definition.value),
        visible: definition.visible !== false,
      },
    ]),
  );
type ProductCostingDraft = {
  key: string;
  quotationItemId: string;
  pricingModel: "legacy_markup" | "target_margin";
  internalVatRate: string;
  costLines: {
    key: string;
    description: string;
    calculationType: "quantity_unit_cost" | "fixed_amount";
    quantity: string;
    unitCost: string;
    amount: string;
  }[];
  markups: {
    key: string;
    markupKey?: PricingMarkupKey | "";
    label: string;
    calculationType?: MarkupCalculationType;
    value?: string;
    rate?: string;
  }[];
};
const markupCalculationType = (markup: ProductCostingDraft["markups"][number]): MarkupCalculationType =>
  markup.calculationType ?? "percentage";
const markupValue = (markup: ProductCostingDraft["markups"][number]) =>
  markup.value ?? markup.rate ?? "0";
const newProductCostingDraft = (
  quotationItemId: string,
  defaults = pricingMarkupDefaults(null),
): ProductCostingDraft => ({
  key: `product-costing-${crypto.randomUUID()}`,
  quotationItemId,
  pricingModel: "target_margin",
  internalVatRate: "12",
  costLines: [
    {
      key: `cost-line-${crypto.randomUUID()}`,
      description: "",
      calculationType: "quantity_unit_cost",
      quantity: "1",
      unitCost: "0",
      amount: "0",
    },
  ],
  markups: defaults
    .filter((definition) => definition.key !== "vat")
    .map((definition) => ({
      key: `markup-${crypto.randomUUID()}`,
      markupKey: definition.key,
      label: definition.label,
      calculationType: definition.calculationType,
      value: definition.value,
    })),
});
const withQuotationDiscount = (costing: ProductCostingDraft): ProductCostingDraft =>
  costing.markups.some((markup) => (markup.markupKey || pricingMarkupKeyForLabel(markup.label)) === "discounts")
    ? costing
    : {
        ...costing,
        markups: [
          ...costing.markups,
          {
            key: `markup-${crypto.randomUUID()}`,
            markupKey: "discounts",
            label: "Discounts",
            calculationType: "percentage",
            value: "0",
          },
        ],
      };
const productCostingDrafts = (
  costings: Row[],
  costLines: Row[],
  markups: Row[],
  missingMarkupDefaults?: PricingMarkupDefault[],
): ProductCostingDraft[] =>
  costings.map((costing, costingIndex) => {
    const pricingModel = text(costing.pricing_model, "legacy_markup") === "target_margin" ? "target_margin" : "legacy_markup";
    const loadedMarkups = markups
      .filter((markup) => markup.product_costing_id === costing.id)
      .sort((left, right) => n(left.sort_order) - n(right.sort_order))
      .map((markup, markupIndex) => {
        const markupKey = pricingMarkupKeyForLabel(markup.markup_key ?? markup.label);
        const calculationType: MarkupCalculationType = text(markup.calculation_type) === "fixed_amount" ? "fixed_amount" : "percentage";
        return {
          key: text(markup.id, `markup-${markupIndex}`),
          markupKey,
          label: text(markup.label, pricingMarkupDefinition(markupKey as PricingMarkupKey)?.label ?? "Markup"),
          calculationType,
          value: calculationType === "fixed_amount"
            ? text(markup.amount, text(markup.rate, "0"))
            : text(markup.rate, "0"),
        };
      });
    const targetMarkups = pricingMarkupDefaultDefinitions
      .filter((definition) => definition.key !== "vat")
      .map((definition) => {
        const savedMarkup = loadedMarkups.find((markup) => markup.markupKey === definition.key);
        if (savedMarkup) return savedMarkup;
        const defaultMarkup = missingMarkupDefaults?.find((markup) => markup.key === definition.key);
        return {
          key: `markup-${crypto.randomUUID()}`,
          markupKey: definition.key,
          label: defaultMarkup?.label ?? definition.label,
        calculationType: "percentage" as const,
          value: defaultMarkup?.value ?? "0",
        };
      });
    // `targetMarkups` contains the saved standard categories (or a missing
    // placeholder for one). Compare categories here, not database row IDs;
    // otherwise every saved standard markup is appended a second time.
    const knownMarkupKeys = new Set(
      targetMarkups
        .map((markup) => markup.markupKey)
        .filter((markupKey): markupKey is PricingMarkupKey => Boolean(markupKey)),
    );
    return {
    key: text(costing.id, `product-costing-${costingIndex}`),
    quotationItemId: text(costing.quotation_item_id),
    pricingModel,
    internalVatRate: text(costing.internal_vat_rate, "12"),
    costLines: costLines
      .filter((line) => line.product_costing_id === costing.id)
      .sort((left, right) => n(left.sort_order) - n(right.sort_order))
      .map((line, lineIndex) => ({
        key: text(line.id, `cost-line-${lineIndex}`),
        description: text(line.description),
        calculationType: text(line.calculation_type) === "fixed_amount" ? "fixed_amount" : "quantity_unit_cost",
        quantity: text(line.quantity, "1"),
        unitCost: text(line.unit_cost, "0"),
        amount: text(line.unit_cost, "0"),
      })),
    markups: pricingModel === "target_margin"
      ? [...targetMarkups, ...loadedMarkups.filter((markup) => !knownMarkupKeys.has(markup.markupKey as PricingMarkupKey))]
      : loadedMarkups,
  };
  });
const productCostingsWithMissingDefaultMarkups = (
  costings: ProductCostingDraft[],
  defaults: PricingMarkupDefault[],
): ProductCostingDraft[] =>
  costings.map((costing) => {
    const savedMarkupKeys = new Set(
      costing.markups
        .map((markup) => markup.markupKey || pricingMarkupKeyForLabel(markup.label))
        .filter((key): key is PricingMarkupKey => Boolean(key)),
    );
    const missingMarkups = defaults
      .filter((definition) => definition.key !== "vat" && !savedMarkupKeys.has(definition.key))
      .map((definition) => ({
        key: `markup-${crypto.randomUUID()}`,
        markupKey: definition.key,
        label: definition.label,
        calculationType: "percentage" as const,
        value: definition.value,
      }));
    return missingMarkups.length
      ? { ...costing, markups: [...costing.markups, ...missingMarkups] }
      : costing;
  });
const quotationVatRate = (quote: Row) => {
  const storedRate = n(quote.vat_rate);
  if (text(quote.vat_calculation_type) !== "fixed_amount") return storedRate;
  const subtotal = n(quote.subtotal);
  return subtotal > 0
    ? Math.round((n(quote.vat_amount) / subtotal) * 10000) / 100
    : storedRate;
};
const productCostingTotals = (
  costing: ProductCostingDraft,
  productQuantity: number,
  vatValue = 0,
) => {
  const rounded = (value: number) => Math.round(value * 100) / 100;
  const cogs = costing.costLines.reduce(
    (sum, line) => sum + rounded(line.calculationType === "fixed_amount" ? n(line.amount) : n(line.quantity) * n(line.unitCost)),
    0,
  );
  const markupAmounts: Record<string, number> = {};
  let markupTotal = 0;
  const internalVatAmount = rounded(cogs * n(costing.internalVatRate) / 100);
  let costBase = cogs;
  let profitAmount = 0;
  let discountAmount = 0;
  let listSellingExVat = cogs;
  let sellingExVat = cogs;
  if (costing.pricingModel === "legacy_markup") {
    markupTotal = costing.markups.reduce((sum, markup) => {
      const amount = markupCalculationType(markup) === "fixed_amount"
        ? rounded(n(markupValue(markup)))
        : rounded(cogs * n(markupValue(markup)) / 100);
      markupAmounts[markup.key] = amount;
      return sum + amount;
    }, 0);
    // The Internal VAT is the seventh internal markup for every costing
    // model, including quotations created before target-margin pricing.
    markupTotal = rounded(markupTotal + internalVatAmount);
    sellingExVat = rounded(cogs + markupTotal);
    listSellingExVat = sellingExVat;
  } else {
    const discount = costing.markups.find((markup) => (markup.markupKey || pricingMarkupKeyForLabel(markup.label)) === "discounts");
    for (const markup of costing.markups) {
      const key = markup.markupKey || pricingMarkupKeyForLabel(markup.label);
      if (!key || key === "discounts" || key === "vat") continue;
      const amount = markupCalculationType(markup) === "fixed_amount"
        ? rounded(n(markupValue(markup)))
        : rounded(cogs * n(markupValue(markup)) / 100);
      markupAmounts[markup.key] = amount;
      markupTotal += amount;
      if (key === "target_profit_margin") profitAmount = amount;
    }
    markupTotal = rounded(markupTotal + internalVatAmount);
    costBase = rounded(cogs + markupTotal);
    listSellingExVat = costBase;
    if (discount) {
      const discountValue = n(markupValue(discount));
      discountAmount = markupCalculationType(discount) === "fixed_amount"
        ? rounded(discountValue)
        : rounded(listSellingExVat * discountValue / 100);
      discountAmount = Math.min(discountAmount, listSellingExVat);
      markupAmounts[discount.key] = discountAmount;
    }
    sellingExVat = rounded(listSellingExVat - discountAmount);
  }
  const vat = rounded(sellingExVat * vatValue / 100);
  const sellingIncVat = rounded(sellingExVat + vat);
  return {
    cogs,
    costBase,
    profitAmount,
    discountAmount,
    listSellingExVat,
    markupTotal,
    markupAmounts,
    internalVatAmount,
    sellingExVat,
    vat,
    sellingIncVat,
    unitExVat: productQuantity > 0 ? rounded(sellingExVat / productQuantity) : 0,
    unitIncVat: productQuantity > 0 ? rounded(sellingIncVat / productQuantity) : 0,
  };
};
type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "password"
    | "number"
    | "date"
    | "select"
    | "toggle"
    | "checkbox_group"
    | "contact_toggle"
    | "size"
    | "textarea"
    | "terms";
  required?: boolean;
  options?: string[];
  hint?: string;
  placeholder?: string;
  readOnly?: boolean;
  shortLabels?: Record<string, ReactNode>;
};
type Module = {
  table: TableName;
  title: string;
  detail: string;
  add: string;
  fields: Field[];
  columns: { label: string; value: (r: Row, s: Store) => ReactNode }[];
};

const tables: TableName[] = [
  "profiles",
  "business_settings",
  "customers",
  "suppliers",
  "employees",
  "inventory_items",
  "inventory_movements",
  "quotations",
  "quotation_items",
  "price_quotation_illustrations",
  "price_quotation_product_costings",
  "price_quotation_costing_lines",
  "price_quotation_costing_markups",
  "price_quotation_mockups",
  "price_quotation_endorsements",
  "quotation_signed_proofs",
  "quotation_payment_records",
  "pricing_officer_project_types",
  "announcements",
  "policies",
  "production_jobs",
  "production_material_usage",
  "production_job_activity",
  "finished_product_stock_ins",
  "invoices",
  "invoice_items",
  "payments",
  "expenses",
  "cash_flow_entries",
  "payroll_periods",
  "payroll_entries",
  "leave_requests",
  "target_goals",
  "approval_requests",
  "project_edit_requests",
  "project_schedule_revision_requests",
  "project_schedule_completion_requests",
  "lead_change_requests",
  "quotation_revision_requests",
  "price_quotation_revision_requests",
  "project_schedules",
  "activity_log",
  "leads",
  "supplier_payables",
  "organization_members",
];
const blank = (): Store =>
  Object.fromEntries(tables.map((t) => [t, []])) as unknown as Store;
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});
const wholePeso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const n = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const normalizeDisplayText = (value: string) =>
  value
    .replaceAll("â€”", "-")
    .replaceAll("â€“", "-")
    .replaceAll("Â·", " - ")
    .replaceAll("Â ", " ")
    .replaceAll("â€™", "'")
    .replaceAll("â€˜", "'")
    .replaceAll("â€œ", "\"")
    .replaceAll("â€", "\"")
    .replaceAll("â€¦", "...");
const text = (value: unknown, fallback = "-") =>
  normalizeDisplayText(
    value === null || value === undefined || value === ""
      ? fallback
      : String(value),
  );
const isPricingOfficerRevision = (quote: Row) =>
  text(quote.status, "") === "needs_revision" &&
  text(quote.revision_requested_to, "") === "pricing_officer";
const comparableDisplayText = (value: unknown) =>
  text(value, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const stackedCell = (
  primary: unknown,
  secondary?: unknown | unknown[],
  separator = " - ",
) => {
  const primaryText = text(primary);
  const primaryComparable = comparableDisplayText(primaryText);
  const detailText = (Array.isArray(secondary) ? secondary : [secondary])
    .map((value) => text(value, "").trim())
    .filter(Boolean)
    .filter((value, index, values) => {
      const comparable = comparableDisplayText(value);
      return comparable && comparable !== primaryComparable && values.findIndex((item) => comparableDisplayText(item) === comparable) === index;
    })
    .join(separator);

  return (
    <>
      <b>{primaryText}</b>
      {detailText && <small>{detailText}</small>}
    </>
  );
};
const policyStoragePath = (value: unknown, organizationId: string) => {
  const rawValue = text(value, "").trim();
  if (!rawValue) return "";

  let path = rawValue.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(rawValue)) {
    try {
      const marker = "/storage/v1/object/";
      const pathname = new URL(rawValue).pathname;
      const markerIndex = pathname.indexOf(marker);
      if (markerIndex < 0) return "";
      const parts = pathname.slice(markerIndex + marker.length).split("/");
      if (["public", "authenticated", "sign"].includes(parts[0])) parts.shift();
      if (parts.shift() !== "policy-documents") return "";
      path = parts.map((part) => decodeURIComponent(part)).join("/");
    } catch {
      return "";
    }
  }

  return path.startsWith(`${organizationId}/policy-documents/`) ? path : "";
};
const projectOfficerOptions = (store: Store) =>
  store.organization_members
    .filter((member) =>
      ["project_manager", "sales_pricing_officer"].includes(text(member.role, "")),
    )
    .map((member) => {
      const id = text(member.user_id, "");
      return {
        id,
        name: text(
          store.profiles.find((profile) => profile.id === id)?.full_name,
          text(member.role, "") === "project_manager"
            ? "Sales Executive"
            : "Sales & Pricing Officer",
        ),
      };
    })
    .filter((officer) => Boolean(officer.id))
    .sort((left, right) => left.name.localeCompare(right.name));
const projectOfficerIdForQuote = (store: Store, quote: Row) => {
  const sourceCosting = quote.costing_source_id
    ? store.quotations.find((item) => item.id === quote.costing_source_id)
    : quote;
  return text(
    sourceCosting?.prepared_by_user_id ??
      sourceCosting?.submitted_by ??
      sourceCosting?.created_by,
    "",
  );
};
type WorkspaceListFilterOption = { id: string; name: string };
function WorkspaceListFilters({
  query,
  onQueryChange,
  queryPlaceholder,
  month,
  onMonthChange,
  monthLabel = "Month",
  showOfficer = false,
  officerFilter = "all",
  onOfficerChange,
  officerOptions = [],
  officerLabel = "Sales staff",
  onClear,
  hasFilters,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  queryPlaceholder: string;
  month: string;
  onMonthChange: (value: string) => void;
  monthLabel?: string;
  showOfficer?: boolean;
  officerFilter?: string;
  onOfficerChange?: (value: string) => void;
  officerOptions?: WorkspaceListFilterOption[];
  officerLabel?: string;
  onClear: () => void;
  hasFilters: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#edf0f5] py-3">
      <label className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm" htmlFor={`${monthLabel.toLowerCase().replaceAll(" ", "-")}-list-search`}>
        <Search className="pointer-events-none absolute left-3 top-2.5 text-[#8b92a1]" size={15} />
        <span className="sr-only">Search records</span>
        <input
          id={`${monthLabel.toLowerCase().replaceAll(" ", "-")}-list-search`}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={queryPlaceholder}
          className="min-h-9 w-full rounded-lg border border-[#d9e0e9] bg-white py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
        />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-[#687386]">
        <span className="whitespace-nowrap">{monthLabel}</span>
        <input
          type="month"
          value={month}
          aria-label={monthLabel}
          onClick={(event) => event.currentTarget.showPicker?.()}
          onChange={(event) => onMonthChange(event.target.value)}
          className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]"
        />
      </label>
      {showOfficer && onOfficerChange && (
        <select
          aria-label={officerLabel}
          value={officerFilter}
          onChange={(event) => onOfficerChange(event.target.value)}
          className={`min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${officerFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
        >
          <option value="all">All Sales Staff</option>
          {officerOptions.map((officer) => (
            <option key={officer.id} value={officer.id}>
              {officer.name}
            </option>
          ))}
        </select>
      )}
      {!month && <span className="text-[11px] text-[#8b92a1]">All months</span>}
      {hasFilters && (
        <Button secondary onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
const titleCase = (value: string) =>
  value.replace(
    /(^|[^A-Za-z'])([a-z])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );
const titleCaseEntry = (value: string, key = "") =>
  key === "term" || /(?:email|url|phone|tin|sku|(?:^|_)no$|number|password|id)/i.test(key)
    ? value
    : titleCase(value);
const leadClientLabel = (lead: Row) => {
  const clientName = text(lead.contact_name, "").trim();
  const companyName = text(lead.client_name, "").trim();
  if (clientName && companyName) return `${clientName} - ${companyName}`;
  return clientName || companyName || "Client";
};
const quotationParty = (quote: Row, store: Store) => {
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  return {
    clientName: text(
      quote.client_contact_name,
      text(lead?.contact_name, text(customer?.contact_name, "-")),
    ),
    companyName: text(
      quote.client_name,
      text(lead?.client_name, text(customer?.company_name, "-")),
    ),
  };
};
const costingSizeUnit = (value: unknown) =>
  /\s+cm\s*$/i.test(String(value)) ? "Cm" : "Inch";
const costingDimensions = (value: unknown) =>
  String(value).replace(/\s+(?:inch|cm)\s*$/i, "").trim();
const costingSizeDetails = (dimensions: string, unit: string) => {
  const cleanDimensions = dimensions.trim();
  return cleanDimensions
    ? `${cleanDimensions} ${unit === "Cm" ? "Cm" : "Inch"}`
    : "";
};
const fieldPlaceholder = (field: Field) => {
  if (field.placeholder) return field.placeholder;
  if (field.type === "date" || field.type === "select") return undefined;
  if (field.type === "email") return "name@example.com";
  if (field.type === "password") return "Enter password";
  if (field.key.includes("phone")) return "Enter phone number";
  if (field.type === "number") return "0";
  const label = titleCase(field.label.replace(/\s*\(Optional\)$/i, ""));
  return `Enter ${label}`;
};
const normalizeSupplierName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

async function optimizeQuotationImage(file: File): Promise<File> {
  // Keep an HD edge for previews and PDFs while avoiding unnecessary camera-size uploads.
  const maxDimension = 1920;
  const preferredSize = 2 * 1024 * 1024;
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = new window.Image();
    image.src = sourceUrl;
    await image.decode();

    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, maxDimension / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let optimizedBlob: Blob | null = null;
    for (const quality of [0.88, 0.82, 0.76]) {
      const candidate = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (
        candidate &&
        (!optimizedBlob || candidate.size < optimizedBlob.size)
      ) {
        optimizedBlob = candidate;
      }
      if (optimizedBlob && optimizedBlob.size <= preferredSize) break;
    }
    if (!optimizedBlob || optimizedBlob.size >= file.size) return file;

    const extension = optimizedBlob.type === "image/webp" ? "webp" : "png";
    const filename = file.name.replace(/\.[^/.]+$/, "") || "product-image";
    return new File([optimizedBlob], `${filename}.${extension}`, {
      type: optimizedBlob.type,
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

const openNativeDatePicker = (input: HTMLInputElement) => {
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Some browsers already open the picker themselves.
  }
};
const day = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(value)))
    : "—";
const isoToday = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => isoToday().slice(0, 7);
const newestActivityFirst = (left: Row, right: Row) => {
  const timestamp = (row: Row) => text(
    row.submitted_at ?? row.requested_at ?? row.updated_at ?? row.created_at,
  );
  return timestamp(right).localeCompare(timestamp(left));
};
const ref = (prefix: string) =>
  `${prefix}-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
const DEFAULT_QUOTATION_TERMS = [
  "Production Lead Time: 2-4 weeks upon receipt of the approved artwork and downpayment.",
  "Prices: All prices quoted are VAT INCLUSIVE.",
  "Delivery: Pickup or delivery via a third-party courier. Delivery charges shall be shouldered by the client.",
  "Payment Terms: 50% downpayment is required upon approval of the quotation. The remaining 50% balance must be paid prior to release or delivery.",
  "Cancellations: Orders cannot be cancelled once production has started",
  "Artwork Revisions: Any revisions or changes requested after the artwork has been approved may result in an adjustment of the production lead time. The revised delivery schedule will be based on the scope and timing of the requested changes.",
  "Two revisions only.",
].join("\n");

type BankDetail = {
  bank_name: string;
  account_name: string;
  account_number: string;
  visible?: boolean;
};

const DEFAULT_QUOTATION_BANK_DETAILS: BankDetail[] = [
  { bank_name: "Chinabank", account_name: "Huswell Trading", account_number: "133300003109", visible: true },
  { bank_name: "Unionbank", account_name: "Huswell Trading", account_number: "002300008069", visible: true },
];

const quotationBankDetailsSnapshot = (value: unknown): BankDetail[] | null => {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map((detail) => ({
    bank_name: text((detail as Record<string, unknown>)?.bank_name, ""),
    account_name: text((detail as Record<string, unknown>)?.account_name, ""),
    account_number: text((detail as Record<string, unknown>)?.account_number, ""),
    visible: (detail as Record<string, unknown>)?.visible !== false,
  })).filter((detail) => detail.bank_name || detail.account_name || detail.account_number);
};
const quotationBankDetails = (value: unknown): BankDetail[] =>
  quotationBankDetailsSnapshot(value) ?? DEFAULT_QUOTATION_BANK_DETAILS;
const isPdfAttachment = (contentType: unknown, url?: unknown, fileName?: unknown) =>
  text(contentType).toLowerCase() === "application/pdf" ||
  /\.pdf(?:$|[?#])/i.test(text(fileName) || text(url));
const AttachmentPreview = ({
  url,
  contentType,
  fileName,
  alt,
  className = "size-full object-cover",
}: {
  url?: string;
  contentType?: string;
  fileName?: string;
  alt: string;
  className?: string;
}) => isPdfAttachment(contentType, url, fileName) ? (
  <span className={`grid ${className} place-items-center gap-1 bg-[#fff7f7] px-2 text-center text-[#ab3038]`}>
    <FileText size={24} aria-hidden="true" />
    <span className="text-[10px] font-semibold">PDF</span>
  </span>
) : (
  <img src={url} alt={alt} className={className} />
);
const statusStyle = (value: unknown) => {
  const v = text(value, "draft").toLowerCase();
  return v.includes("rejected") || v.includes("cancelled") || v.includes("void") || v.includes("overpaid")
    ? "bg-[#fef3f2] text-[#b42318]"
    : v.includes("pending") || v.includes("partial") || v.includes("review")
      ? "bg-[#fff8e9] text-[#a76605]"
      : v.includes("unpaid") || v.includes("not_earned")
        ? "bg-[#f1f4f8] text-[#626b7a]"
        : v.includes("paid") || v.includes("verified") || v.includes("approved") || v.includes("completed") || v.includes("delivered")
          ? "bg-[#edf9f2] text-[#218b55]"
          : "bg-[#f1f4f8] text-[#626b7a]";
};
const Status = ({ value }: { value: unknown }) => (
  <span
    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusStyle(value)}`}
  >
    {text(value, "draft").replaceAll("_", " ")}
  </span>
);
const leadStatuses = [
  // Keep the existing stored IDs stable: 1, 2, and 3 are already used by
  // saved leads, while 7 is reserved for the separate Done Deal workflow.
  "4|Potential client / Prospect",
  "1|New client",
  "2|Paying / Repeat client",
  "5|Loyal / Long-term client",
  "6|Inactive / Dormant client",
  "8|Referral client",
  "3|Lost client",
  "9|VIP / High-value client",
] as const;
// Done Deal remains an internal marker that keeps projects separate from leads.
const evaluationStatuses = [...leadStatuses, "7|Done Deal"] as const;
const doneDealStatuses = [
  "1|Inquiry | Details | Illustrations",
  "2|Costing Breakdown",
  "3|Price Quotation",
  "4|Purchase Order",
  "5|Mock Up / Sample Approval",
  "6|Invoicing / Down Payment",
  "7|Production / Buying Materials",
  "8|Quality Control",
  "9|Repacking",
  "10|Invoicing / Full Payment",
  "11|Delivery",
  "12|Completed / After Sales",
] as const;
const statusLabel = (options: readonly string[], value: unknown) =>
  options
    .find((option) => option.split("|")[0] === text(value, ""))
    ?.split("|")[1] ?? "—";
const evaluationLabel = (value: unknown) =>
  statusLabel(evaluationStatuses, value);
const doneDealStatusLabel = (value: unknown) =>
  statusLabel(doneDealStatuses, value);
const memberRole = (role: string) =>
  ["super_admin", "owner", "admin"].includes(role);
const isProjectOfficerRole = (role: string) =>
  ["project_manager", "sales_pricing_officer"].includes(role);
const isPricingOfficerRole = (role: string) =>
  role === "sales_pricing_officer";
const pricingProjectTypeKey = (value: unknown) => {
  const normalized = text(value, "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "mockup" ? "mock up" : normalized;
};
const assignedPaymentReviewerId = (
  quote: Row,
  payment: Row,
  assignments: Row[],
) =>
  text(
    payment.reviewer_user_id,
    text(
      quote.pricing_reviewed_by,
      text(
        assignments.find(
          (assignment) =>
            pricingProjectTypeKey(assignment.project_type) ===
            pricingProjectTypeKey(quote.project_types),
        )?.pricing_officer_user_id,
        "",
      ),
    ),
  );
const roleCapabilityRoles = (role: string) =>
  role === "sales_pricing_officer"
    ? ["project_manager", "pricing"]
    : [role];
const canReviewPriceQuotations = (role: string) =>
  memberRole(role) || isPricingOfficerRole(role);
type AccessAction = "create" | "update" | "archive" | "approve" | "request";
const rolePermissions: Record<
  string,
  Partial<Record<AccessAction, string[]>>
> = {
  project_manager: {
    create: [
      "leads",
      "customers",
      "suppliers",
      "quotations",
      "quotation_items",
      "project_schedules",
      "production_material_usage",
      "expenses",
    ],
    update: ["leads", "customers", "suppliers", "quotations"],
    archive: ["customers", "suppliers"],
    request: ["quotations"],
  },
  sales: {
    create: [
      "quotations",
      "quotation_items",
      "invoices",
      "invoice_items",
      "payments",
    ],
    update: [
      "quotations",
      "invoices",
      "invoice_items",
      "payments",
      "customers",
    ],
    request: ["quotations", "invoices", "payments"],
  },
  warehouse: {
    create: [
      "inventory_items",
      "inventory_movements",
      "finished_product_stock_ins",
      "production_material_usage",
    ],
    update: [
      "inventory_items",
      "production_jobs",
      "finished_product_stock_ins",
    ],
  },
  accountant: {
    create: [
      "expenses",
      "cash_flow_entries",
      "supplier_payables",
      "invoices",
      "invoice_items",
      "payments",
    ],
    update: [
      "expenses",
      "cash_flow_entries",
      "invoices",
      "invoice_items",
      "payments",
      "suppliers",
      "supplier_payables",
    ],
    archive: ["expenses"],
    request: ["expenses", "cash_flow_entries", "invoices", "payments"],
  },
  payroll: {
    create: ["payroll_periods", "payroll_entries", "leave_requests"],
    update: ["payroll_periods", "payroll_entries", "leave_requests"],
  },
  production: {
    create: [
      "production_material_usage",
      "finished_product_stock_ins",
      "inventory_movements",
    ],
    update: ["production_jobs", "finished_product_stock_ins"],
  },
  pricing: {
    update: [
      "leads",
      "customers",
      "quotations",
      "quotation_items",
      "price_quotation_illustrations",
    ],
    approve: ["quotations", "price_quotation_product_costings"],
    request: ["quotations"],
  },
};
const canAccess = (role: string, resource: string, action: AccessAction) =>
  memberRole(role) ||
  roleCapabilityRoles(role).some((capability) =>
    (rolePermissions[capability]?.[action] ?? []).includes(resource),
  );
const roleReadableTables: Record<string, TableName[]> = {
  project_manager: [
    "profiles",
    "organization_members",
    "leads",
    "customers",
    "suppliers",
    "inventory_items",
    "quotations",
    "quotation_items",
    "price_quotation_illustrations",
    "project_edit_requests",
    "project_schedule_revision_requests",
    "project_schedule_completion_requests",
    "lead_change_requests",
    "quotation_revision_requests",
    "price_quotation_revision_requests",
    "price_quotation_mockups",
    "price_quotation_endorsements",
    "quotation_signed_proofs",
    "quotation_payment_records",
    "pricing_officer_project_types",
    "announcements",
    "policies",
    "project_schedules",
  ],
  pricing: [
    "profiles",
    "organization_members",
    "business_settings",
    "leads",
    "customers",
    "quotations",
    "quotation_items",
    "price_quotation_illustrations",
    "price_quotation_product_costings",
    "price_quotation_costing_lines",
    "price_quotation_costing_markups",
    "price_quotation_mockups",
    "quotation_signed_proofs",
    "quotation_payment_records",
    "announcements",
    "policies",
    "price_quotation_revision_requests",
    "pricing_officer_project_types",
  ],
  sales: [
    "business_settings",
    "customers",
    "suppliers",
    "employees",
    "inventory_items",
    "quotations",
    "quotation_items",
    "invoices",
    "invoice_items",
    "payments",
    "quotation_payment_records",
    "announcements",
    "policies",
  ],
  warehouse: [
    "customers",
    "employees",
    "inventory_items",
    "inventory_movements",
    "production_jobs",
    "quotation_signed_proofs",
    "quotation_payment_records",
    "production_material_usage",
    "production_job_activity",
    "finished_product_stock_ins",
    "announcements",
    "policies",
  ],
  accountant: [
    "customers",
    "suppliers",
    "employees",
    "inventory_items",
    "invoices",
    "invoice_items",
    "payments",
    "quotation_payment_records",
    "expenses",
    "cash_flow_entries",
    "supplier_payables",
    "announcements",
    "policies",
  ],
  payroll: [
    "employees",
    "payroll_periods",
    "payroll_entries",
    "leave_requests",
    "announcements",
    "policies",
  ],
  production: [
    "customers",
    "employees",
    "inventory_items",
    "inventory_movements",
    "production_jobs",
    "quotation_signed_proofs",
    "quotation_payment_records",
    "production_material_usage",
    "production_job_activity",
    "finished_product_stock_ins",
    "announcements",
    "policies",
  ],
  viewer: [
    "customers",
    "suppliers",
    "employees",
    "inventory_items",
    "inventory_movements",
    "quotations",
    "quotation_items",
    "production_jobs",
    "production_material_usage",
    "production_job_activity",
    "finished_product_stock_ins",
    "invoices",
    "invoice_items",
    "payments",
    "expenses",
    "target_goals",
    "announcements",
    "policies",
  ],
};
const canReadTable = (role: string, table: TableName) =>
  memberRole(role) ||
  roleCapabilityRoles(role).some((capability) =>
    (roleReadableTables[capability] ?? roleReadableTables.viewer).includes(table),
  );
const workspaceViewTables = (
  view: View,
  leadMode: LeadWorkspaceMode,
  role: string,
): TableName[] => {
  if (view === "Dashboard")
    return isProjectOfficerRole(role)
      ? ["leads", "quotations", "project_schedules"]
      : ["invoices", "payments", "target_goals", "quotations", "leads"];
  if (
    view === "Leads" &&
    (leadMode === "leads" || leadMode === "lead_change_requests")
  )
    return ["leads", "profiles", "organization_members", "lead_change_requests"];
  if (view === "Projects")
    return [
      "project_schedules",
      "quotations",
      "leads",
      "profiles",
      "quotation_signed_proofs",
      "quotation_payment_records",
      "project_edit_requests",
      "project_schedule_revision_requests",
      "project_schedule_completion_requests",
    ];
  if (view === "Mockups")
    return ["quotations", "quotation_items", "price_quotation_illustrations", "price_quotation_product_costings", "price_quotation_costing_lines", "price_quotation_costing_markups", "quotation_signed_proofs", "quotation_payment_records", "leads", "profiles", "organization_members", "pricing_officer_project_types"];
  if (view === "Quotation Costing Overview")
    return ["quotations", "quotation_items", "price_quotation_product_costings", "price_quotation_costing_lines", "price_quotation_costing_markups", "price_quotation_illustrations", "quotation_signed_proofs", "quotation_payment_records", "leads", "customers", "business_settings", "profiles", "organization_members", "pricing_officer_project_types"];
  if (
    view === "Price Quotations" ||
    view === "Price Quotation Review" ||
    (view === "Leads" && leadMode === "quotation")
  )
    return [
      "quotations",
      "quotation_items",
      "price_quotation_illustrations",
      "price_quotation_product_costings",
      "price_quotation_costing_lines",
      "price_quotation_costing_markups",
      "leads",
      "customers",
      "inventory_items",
      "business_settings",
      "profiles",
      "price_quotation_revision_requests",
      "price_quotation_endorsements",
      "quotation_signed_proofs",
      "quotation_payment_records",
      "pricing_officer_project_types",
    ];
  if (view === "Suppliers & Materials")
    return [
      "suppliers",
      "inventory_items",
      "inventory_movements",
      "production_material_usage",
      "finished_product_stock_ins",
      "quotation_items",
      "invoice_items",
      "expenses",
      "supplier_payables",
    ];
  if (view === "Production")
    return [
      "production_jobs",
      "production_material_usage",
      "production_job_activity",
      "quotation_signed_proofs",
      "quotation_payment_records",
      "inventory_items",
      "inventory_movements",
      "finished_product_stock_ins",
      "customers",
    ];
  if (view === "Catalog") return ["inventory_items"];
  if (view === "Inventory")
    return [
      "inventory_items",
      "inventory_movements",
      "production_material_usage",
      "production_jobs",
      "finished_product_stock_ins",
    ];
  if (view === "Sales")
    return ["invoices", "invoice_items", "payments", "quotation_payment_records", "customers", "inventory_items"];
  if (view === "Expenses") return ["expenses", "suppliers"];
  if (view === "Finance")
    return [
      "invoices",
      "payments",
      "quotation_payment_records",
      "expenses",
      "cash_flow_entries",
      "customers",
      "suppliers",
      "supplier_payables",
    ];
  if (view === "Payroll & Leave")
    return ["employees", "payroll_periods", "payroll_entries", "leave_requests"];
  if (view === "Directory") return ["customers", "suppliers", "employees"];
  if (view === "Targets") return ["target_goals"];
  if (view === "Payment Monitoring" || view === "Payment Reviews")
    return [
      "quotations",
      "quotation_items",
      "profiles",
      "leads",
      "customers",
      "quotation_payment_records",
      "quotation_signed_proofs",
      "business_settings",
      "organization_members",
      "pricing_officer_project_types",
    ];
  if (view === "Commissions") return ["quotations", "profiles", "organization_members"];
  if (view === "Approvals" || view === "Submissions")
    return [
      "quotations",
      "quotation_items",
      "price_quotation_illustrations",
      "price_quotation_product_costings",
      "price_quotation_costing_lines",
      "price_quotation_costing_markups",
      "price_quotation_mockups",
      "profiles",
      "organization_members",
      "customers",
      "leads",
      "business_settings",
      "pricing_officer_project_types",
      "quotation_signed_proofs",
      "quotation_payment_records",
      "approval_requests",
      "project_edit_requests",
      "lead_change_requests",
      "quotation_revision_requests",
      "price_quotation_revision_requests",
      "project_schedules",
      "project_schedule_revision_requests",
      "project_schedule_completion_requests",
    ];
  if (view === "Settings")
    return ["business_settings", "organization_members", "profiles"];
  if (view === "Policy") return ["announcements", "policies"];
  return [];
};

const directory: Module = {
  table: "customers",
  title: "Directory",
  detail: "Customer, supplier, and employee details for your projects.",
  add: "Add customer",
  fields: [
    { key: "company_name", label: "Company name", required: true },
    { key: "contact_name", label: "Contact person" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "billing_address", label: "Billing address", type: "textarea" },
    { key: "tin", label: "TIN" },
  ],
  columns: [
    {
      label: "Customer",
      value: (r) => stackedCell(r.company_name, r.contact_name),
    },
    { label: "Contact", value: (r) => text(r.phone) },
    { label: "Email", value: (r) => text(r.email) },
    {
      label: "Quotations",
      value: (r, s) =>
        s.quotations.filter((q) => q.customer_id === r.id).length,
    },
    {
      label: "Invoices",
      value: (r, s) => s.invoices.filter((i) => i.customer_id === r.id).length,
    },
    {
      label: "Payments",
      value: (r, s) =>
        peso.format(
          s.payments
            .filter((p) => p.customer_id === r.id)
            .reduce((sum, p) => sum + n(p.amount), 0),
        ),
    },
  ],
};
const leadRecordedDateLabel = "Date recorded";
const leads: Module = {
  table: "leads",
  title: "Leads",
  detail:
    "Register outbound client contacts using the same fields as the outbound tracker.",
  add: "Add lead",
  fields: [
    { key: "date_sent", label: leadRecordedDateLabel, type: "date" },
    { key: "contact_name", label: "Client's Name", required: true },
    { key: "client_name", label: "Company Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Viber / WhatsApp / Instagram / Messenger" },
    { key: "date_contacted", label: "Date contacted", type: "date" },
    {
      key: "contact_method",
      label: "Outbound method",
      type: "select",
      options: ["Viber", "WhatsApp", "Messenger", "Phone Call", "Email"],
    },
    {
      key: "evaluation_number",
      label: "Lead status",
      type: "select",
      options: [...leadStatuses],
    },
    {
      key: "done_deal_status",
      label: "Done Deal Status",
      type: "select",
      options: [...doneDealStatuses],
    },
  ],
  columns: [
    {
      label: "Lead / project",
      value: (r) => stackedCell(r.project_name, r.client_name),
    },
    { label: "Client's Name", value: (r) => text(r.contact_name, "—") },
    { label: "Company name", value: (r) => text(r.client_name, "—") },
    { label: "Email", value: (r) => text(r.email, "—") },
    { label: "Phone Number", value: (r) => text(r.phone, "—") },
    {
      label: "Outbound caller",
      value: (r, s) => {
        if (r.outbound_caller) return text(r.outbound_caller);
        const name = text(
          s.profiles.find(
            (profile) => profile.id === (r.assigned_to ?? r.created_by),
          )?.full_name,
          "—",
        );
        return name.includes("@") ? name.split("@")[0] : name;
      },
    },
    { label: "Date contacted", value: (r) => day(r.date_contacted) },
    { label: "Outbound method", value: (r) => text(r.contact_method, "—") },
    { label: leadRecordedDateLabel, value: (r) => day(r.date_sent) },
    {
      label: "Lead status",
      value: (r) => evaluationLabel(r.evaluation_number),
    },
  ],
};
const supplierDirectory: Module = {
  table: "suppliers",
  title: "Suppliers",
  detail: "Maintain the vendors used for materials and Price Quotations.",
  add: "Add supplier",
  fields: [
    { key: "company_name", label: "Company name", required: true },
    { key: "contact_name", label: "Contact person" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address", type: "textarea" },
  ],
  columns: [
    {
      label: "Supplier",
      value: (r) => stackedCell(r.company_name, r.contact_name),
    },
    { label: "Address", value: (r) => text(r.address) },
    { label: "Email", value: (r) => text(r.email) },
    { label: "Phone", value: (r) => text(r.phone) },
    {
      label: "Status",
      value: (r) => (
        <Status value={r.is_active === false ? "archived" : "active"} />
      ),
    },
  ],
};
const supplierPayables: Module = {
  table: "supplier_payables",
  title: "Supplier payables",
  detail: "Track supplier balances, due dates, and payments still owed.",
  add: "Add supplier payable",
  fields: [
    { key: "payable_no", label: "Payable reference", required: true },
    { key: "supplier_id", label: "Supplier", type: "select", required: true },
    { key: "description", label: "Description", required: true },
    { key: "amount", label: "Amount due", type: "number", required: true },
    { key: "amount_paid", label: "Amount paid", type: "number" },
    { key: "due_date", label: "Due date", type: "date" },
    {
      key: "status",
      label: "Status",
      type: "select",
      required: true,
      options: ["open", "partial", "paid", "overdue", "cancelled"],
    },
  ],
  columns: [
    {
      label: "Payable",
      value: (r, s) =>
        stackedCell(
          r.payable_no,
          s.suppliers.find((supplier) => supplier.id === r.supplier_id)
            ?.company_name,
        ),
    },
    { label: "Due date", value: (r) => day(r.due_date) },
    {
      label: "Balance",
      value: (r) => peso.format(Math.max(n(r.amount) - n(r.amount_paid), 0)),
    },
    { label: "Status", value: (r) => <Status value={r.status} /> },
  ],
};
const projects: Module = {
  ...leads,
  title: "Projects",
  detail:
    "Done deals move here automatically so their delivery and production progress can be tracked.",
  fields: [
    { key: "project_name", label: "Project name", required: true },
    ...leads.fields,
  ],
};
const catalog: Module = {
  table: "inventory_items",
  title: "Catalog",
  detail:
    "Products, services, finished goods, and raw supplies in one catalog.",
  add: "Add catalog item",
  fields: [
    { key: "name", label: "Product / service name", required: true },
    { key: "sku", label: "SKU" },
    {
      key: "item_type",
      label: "Type",
      type: "select",
      required: true,
      options: ["product", "service", "material"],
    },
    { key: "category", label: "Category / additional type" },
    { key: "supplier_id", label: "Supplier / brand", type: "select" },
    { key: "unit", label: "Unit", required: true },
    { key: "standard_cost", label: "Item cost", type: "number" },
    { key: "tax_amount", label: "Tax amount", type: "number" },
    { key: "other_costs", label: "Other costs", type: "number" },
    { key: "selling_price", label: "Selling price", type: "number" },
    { key: "reorder_level", label: "Low-stock alert", type: "number" },
  ],
  columns: [
    {
      label: "Item",
      value: (r) => stackedCell(r.name, r.sku),
    },
    { label: "Type", value: (r) => <Status value={r.item_type} /> },
    {
      label: "Total cost",
      value: (r) =>
        peso.format(n(r.standard_cost) + n(r.tax_amount) + n(r.other_costs)),
    },
    { label: "Selling price", value: (r) => peso.format(n(r.selling_price)) },
    {
      label: "Profit",
      value: (r) =>
        peso.format(
          n(r.selling_price) -
            n(r.standard_cost) -
            n(r.tax_amount) -
            n(r.other_costs),
        ),
    },
    {
      label: "Items sold",
      value: (r, s) =>
        s.invoice_items
          .filter(
            (line) =>
              line.inventory_item_id === r.id &&
              s.invoices.find(
                (invoice) =>
                  invoice.id === line.invoice_id && invoice.status !== "void",
              ),
          )
          .reduce((sum, line) => sum + n(line.quantity), 0),
    },
    {
      label: "All-time sales",
      value: (r, s) =>
        peso.format(
          s.invoice_items
            .filter(
              (line) =>
                line.inventory_item_id === r.id &&
                s.invoices.find(
                  (invoice) =>
                    invoice.id === line.invoice_id && invoice.status !== "void",
                ),
            )
            .reduce(
              (sum, line) => sum + n(line.line_total) - n(line.discount_amount),
              0,
            ),
        ),
    },
  ],
};
const inventory: Module = {
  table: "inventory_items",
  title: "Raw materials",
  detail: "Review stock movements, adjustments, and quantities on hand.",
  add: "Add raw supply",
  fields: [
    { key: "name", label: "Item description", required: true },
    { key: "sku", label: "SKU" },
    { key: "unit", label: "Unit symbol", required: true },
    { key: "units_per_piece", label: "Units per piece", type: "number" },
    { key: "quantity_on_hand", label: "Opening stock", type: "number" },
    { key: "standard_cost", label: "Item cost", type: "number" },
    { key: "reorder_level", label: "Low-stock alert", type: "number" },
  ],
  columns: [
    {
      label: "Supply",
      value: (r) => stackedCell(r.name, r.sku),
    },
    {
      label: "Available",
      value: (r) => `${n(r.quantity_on_hand)} ${text(r.unit)}`,
    },
    { label: "Unit cost", value: (r) => peso.format(n(r.standard_cost)) },
    {
      label: "Value",
      value: (r) => peso.format(n(r.quantity_on_hand) * n(r.standard_cost)),
    },
    {
      label: "Status",
      value: (r) => (
        <Status
          value={
            n(r.quantity_on_hand) <= 0
              ? "out of stock"
              : n(r.quantity_on_hand) <= n(r.reorder_level)
                ? "low stock"
                : "in stock"
          }
        />
      ),
    },
  ],
};
const sales: Module = {
  table: "invoices",
  title: "Sales & invoices",
  detail: "Create invoices, record payments, and print receipts.",
  add: "New invoice",
  fields: [
    { key: "issue_date", label: "Billing date", type: "date", required: true },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "sales_channel", label: "Sales channel" },
    { key: "receipt_no", label: "Receipt number" },
  ],
  columns: [
    {
      label: "Invoice",
      value: (r) => <b className="text-[#1769e8]">{text(r.invoice_no)}</b>,
    },
    { label: "Billing date", value: (r) => day(r.issue_date) },
    { label: "Status", value: (r) => <Status value={r.status} /> },
    { label: "Receipt", value: (r) => text(r.receipt_no) },
    { label: "Total", value: (r) => peso.format(n(r.total_amount)) },
  ],
};
const expenses: Module = {
  table: "expenses",
  title: "Expenses",
  detail:
    "Record purchases and operating expenses by supplier, category, and status.",
  add: "Record expense",
  fields: [
    {
      key: "expense_date",
      label: "Purchase date",
      type: "date",
      required: true,
    },
    {
      key: "category",
      label: "Category",
      type: "select",
      required: true,
      options: [
        "payroll",
        "salary",
        "bills",
        "transportation",
        "cash_advance",
        "SSS",
        "PhilHealth",
        "Pag-IBIG",
        "commission",
        "supplies",
        "other_business_expense",
      ],
    },
    { key: "description", label: "Item description", required: true },
    { key: "amount", label: "Total cost", type: "number", required: true },
    { key: "receipt_no", label: "Receipt number" },
    { key: "tin", label: "TIN" },
    { key: "business_address", label: "Business address", type: "textarea" },
  ],
  columns: [
    { label: "Date", value: (r) => day(r.expense_date) },
    { label: "Category", value: (r) => <b>{text(r.category)}</b> },
    { label: "Description", value: (r) => text(r.description) },
    { label: "Amount", value: (r) => peso.format(n(r.amount)) },
    { label: "Status", value: (r) => <Status value={r.status} /> },
  ],
};
const finance: Module = {
  table: "cash_flow_entries",
  title: "Cash flow",
  detail:
    "Record capital, loans, withdrawals, reimbursements, and other cash movements.",
  add: "Add cash flow",
  fields: [
    { key: "occurred_on", label: "Date", type: "date", required: true },
    {
      key: "entry_type",
      label: "Cash movement",
      type: "select",
      required: true,
      options: [
        "starting_capital",
        "additional_capital",
        "loan_received",
        "loan_payment",
        "owner_withdrawal",
        "reimbursement",
        "payment_received",
        "expense_paid",
        "adjustment",
      ],
    },
    { key: "description", label: "Description", required: true },
    { key: "amount", label: "Amount", type: "number", required: true },
    {
      key: "finance_category",
      label: "Finance category",
      type: "select",
      required: true,
      options: [
        "general",
        "loan",
        "credit_card",
        "tax",
        "income_tax_reserve",
        "owner_withdrawal",
        "dividend",
        "cash_advance",
        "benefits",
        "payroll",
        "salary",
        "bills",
        "transportation",
        "commission",
      ],
    },
  ],
  columns: [
    { label: "Date", value: (r) => day(r.occurred_on) },
    {
      label: "Description",
      value: (r) => stackedCell(r.description, text(r.entry_type).replaceAll("_", " ")),
    },
    {
      label: "Cash in",
      value: (r) =>
        [
          "starting_capital",
          "additional_capital",
          "loan_received",
          "reimbursement",
          "payment_received",
        ].includes(text(r.entry_type))
          ? peso.format(n(r.amount))
          : "—",
    },
    {
      label: "Cash out",
      value: (r) =>
        ["loan_payment", "owner_withdrawal", "expense_paid"].includes(
          text(r.entry_type),
        )
          ? peso.format(n(r.amount))
          : "—",
    },
    { label: "Approval", value: (r) => <Status value={r.status} /> },
  ],
};
const payroll: Module = {
  table: "payroll_periods",
  title: "Payroll & leave",
  detail:
    "Manage payroll periods, leave deductions, allowances, and payment approval.",
  add: "Start payroll period",
  fields: [
    { key: "start_date", label: "Start date", type: "date", required: true },
    { key: "end_date", label: "End date", type: "date", required: true },
  ],
  columns: [
    {
      label: "Period",
      value: (r) => (
        <b>
          {day(r.start_date)} – {day(r.end_date)}
        </b>
      ),
    },
    { label: "Status", value: (r) => <Status value={r.status} /> },
  ],
};
const targets: Module = {
  table: "target_goals",
  title: "Targets",
  detail: "Set sales and operational targets by day, week, month, or year.",
  add: "Add goal",
  fields: [
    { key: "title", label: "Goal", required: true },
    {
      key: "goal_type",
      label: "Goal type",
      type: "select",
      required: true,
      options: [
        "monthly_item",
        "monthly_sales",
        "quarterly_sales",
        "annual_sales",
        "daily_task",
        "weekly_task",
        "monthly_task",
        "annual_task",
      ],
    },
    { key: "target_value", label: "Target", type: "number" },
    { key: "current_value", label: "Current", type: "number" },
    { key: "period_start", label: "Starts", type: "date" },
    { key: "period_end", label: "Ends", type: "date" },
  ],
  columns: [
    { label: "Goal", value: (r) => <b>{text(r.title)}</b> },
    { label: "Type", value: (r) => text(r.goal_type).replaceAll("_", " ") },
    {
      label: "Progress",
      value: (r) => (
        <Progress value={n(r.current_value)} total={n(r.target_value)} />
      ),
    },
    {
      label: "Remaining",
      value: (r) =>
        n(r.target_value)
          ? Math.max(n(r.target_value) - n(r.current_value), 0).toLocaleString()
          : "—",
    },
    {
      label: "State",
      value: (r) => (
        <Status value={Boolean(r.is_completed) ? "completed" : "active"} />
      ),
    },
  ],
};

function Button({
  children,
  onClick,
  secondary = false,
  tone = "blue",
  compact = false,
  disabled = false,
  loading = false,
  confirm = false,
  confirmationText,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  tone?: "blue" | "green";
  compact?: boolean;
  disabled?: boolean;
  loading?: boolean;
  confirm?: boolean;
  confirmationText?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const trigger = () => {
    if (!onClick) return;
    if (confirm) {
      setConfirmOpen(true);
      return;
    }
    onClick();
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={trigger}
        style={{ fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-body)" }}
        className={`${secondary ? "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]" : tone === "green" ? "bg-[var(--color-success)] text-white hover:bg-[color-mix(in_srgb,var(--color-success)_85%,black)]" : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"} inline-flex ${compact ? "min-h-7 py-0.5" : "min-h-8"} items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]`}
      >
        {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
      {confirm && (
        <ConfirmationDialog
          open={confirmOpen}
          description={confirmationText}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onClick?.();
          }}
        />
      )}
    </>
  );
}

function ConfirmationDialog({
  open,
  title = "Confirm action",
  description = "Are you sure you want to continue?",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  description?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)] p-4"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        className="w-full max-w-sm min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-none"
      >
        <h2
          id="confirmation-title"
          className="min-w-0 break-words text-[16px] font-semibold text-[var(--color-text-primary)]"
        >
          {title}
        </h2>
        <p className="mt-1.5 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
          {description}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button secondary onClick={onCancel}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-8 items-center rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 text-[13px] font-medium text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            Confirm
          </button>
        </div>
      </section>
    </div>
  );
}

function ActionIcon({
  label,
  children,
  onClick,
  disabled = false,
  loading = false,
  tone = "primary",
  confirm = true,
  confirmationDescription,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "green" | "amber" | "red";
  confirm?: boolean;
  confirmationDescription?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const colors = {
    primary: "table-action",
    green: "table-action table-action--success",
    amber: "table-action table-action--warning",
    red: "table-action table-action--danger",
  };
  return (
    <>
      <FixedIconTooltip label={label}>
        <button
          type="button"
          onClick={() => (confirm ? setConfirmOpen(true) : onClick())}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          aria-label={label}
          className={`disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]}`}
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : children}
        </button>
      </FixedIconTooltip>
      {confirm && <ConfirmationDialog
        open={confirmOpen}
        title="Confirm action"
        description={confirmationDescription ?? `Are you sure you want to ${label.charAt(0).toLowerCase()}${label.slice(1)}?`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onClick();
        }}
      />}
    </>
  );
}

function NoteAction({
  label = "View note",
  onClick,
  tone = "primary",
}: {
  label?: string;
  onClick: () => void;
  tone?: "primary" | "green" | "amber" | "red";
}) {
  return (
    <ActionIcon label={label} tone={tone} confirm={false} onClick={onClick}>
      <MessageSquareText size={15} />
    </ActionIcon>
  );
}

function NoteDialog({
  open,
  title,
  context,
  note,
  emptyText = "No note was provided.",
  titleId,
  onClose,
}: {
  open: boolean;
  title: string;
  context?: string;
  note: string;
  emptyText?: string;
  titleId: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)] p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              {title}
            </h2>
            {context && <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{context}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[13px] leading-5 text-[var(--color-text-primary)]">
          {note.trim() || emptyText}
        </div>
        <div className="mt-5 flex justify-end">
          <Button secondary onClick={onClose}>
            Close
          </Button>
        </div>
      </section>
    </div>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      className="size-4 accent-[var(--color-accent)] disabled:cursor-not-allowed"
    />
  );
}

const generatedPdfStyles = PdfStyleSheet.create({
  page: { paddingTop: 34.5, paddingRight: 30, paddingBottom: 43, paddingLeft: 30, fontFamily: "SF Pro Display", fontSize: 9, color: "#111" },
  header: { width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 24 },
  quotationHeader: { width: 235, marginRight: 0 },
  quotationTitle: { color: "#c43b43", fontSize: 18, fontWeight: 700, textAlign: "right", marginBottom: 7, marginTop: 20 },
  quotationDetails: { width: "100%", alignItems: "flex-end" },
  quotationDetail: { width: "100%", fontWeight: 400, textAlign: "right", marginBottom: 1 },
  logo: { width: 140, height: 44, objectFit: "contain" },
  title: { color: "#c43b43", fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 7, marginTop: 20 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" },
  row: { flexDirection: "row", alignItems: "stretch" },
  headCell: { color: "#000", fontWeight: 700 },
  cell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", padding: 5, textAlign: "center", justifyContent: "center", alignSelf: "stretch" },
  description: { textAlign: "left" },
  total: { backgroundColor: "#f7f7f7", fontWeight: 700 },
  terms: { fontSize: 8, lineHeight: 1.7 },
  bankTable: { width: "100%", alignSelf: "center", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111", marginTop: 5, marginBottom: 5 },
  bankRow: { flexDirection: "row" },
  bankCell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", paddingVertical: 3, paddingHorizontal: 5, justifyContent: "center" },
  signatureRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 38 },
  signatureBlock: { width: 180 },
  signatureLabel: { width: 180, textAlign: "left", fontWeight: 400 },
  preparedSignatureSpace: { height: 28 },
  approvalSignatureImage: { width: 78, height: 38, objectFit: "contain", alignSelf: "center", marginTop: -4, marginBottom: -8 },
  signature: { width: 180, textAlign: "center", borderBottomWidth: 1, borderColor: "#111", paddingBottom: 1 },
  signatureRole: { width: 180, textAlign: "center", marginTop: 2 },
  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoLabel: { width: 115, fontWeight: 400 },
  infoValue: { flex: 1, borderBottomWidth: 1, borderColor: "#777", paddingBottom: 2 },
});

function PdfCell({ children, width, header = false, description = false, total = false }: {
  children: ReactNode;
  width: string;
  header?: boolean;
  description?: boolean;
  total?: boolean;
}) {
  const plainText = typeof children === "string" || typeof children === "number";
  return <PdfView style={[generatedPdfStyles.cell, { width }, header ? generatedPdfStyles.headCell : undefined, description ? generatedPdfStyles.description : undefined, total ? generatedPdfStyles.total : undefined]}>{plainText ? <PdfText style={{ textAlign: description ? "left" : "center" }}>{children}</PdfText> : children}</PdfView>;
}

function PdfSignatureBlock({ label, name, role, signatureSource }: { label: string; name: string; role: string; signatureSource?: string }) {
  return <PdfView style={generatedPdfStyles.signatureBlock}><PdfText style={generatedPdfStyles.signatureLabel}>{label}</PdfText>{signatureSource ? <PdfImage src={signatureSource} style={generatedPdfStyles.approvalSignatureImage} /> : <PdfView style={generatedPdfStyles.preparedSignatureSpace} />}<PdfText style={generatedPdfStyles.signature}>{name}</PdfText><PdfText style={generatedPdfStyles.signatureRole}>{role}</PdfText></PdfView>;
}

function PdfBankDetails({ details }: { details: BankDetail[] }) {
  if (!details.length) return null;
  return <PdfView style={generatedPdfStyles.bankTable}>{details.map((detail, index) => <PdfView key={`${detail.bank_name}-${detail.account_number}-${index}`} style={generatedPdfStyles.bankRow}><PdfView style={[generatedPdfStyles.bankCell, { width: "35%" }]}><PdfText>{detail.bank_name}</PdfText></PdfView><PdfView style={[generatedPdfStyles.bankCell, { width: "65%" }]}><PdfText>{[detail.account_name, detail.account_number].filter(Boolean).join(" - ")}</PdfText></PdfView></PdfView>)}</PdfView>;
}

const LEGAL_PORTRAIT: [number, number] = [612, 1008];
type SalesQuotationPageDensity = "standard" | "compact" | "super-compact" | "overflow";

function quotationTextUnits(value: unknown, charactersPerLine: number) {
  const content = text(value).replace(/\s+/g, " ").trim();
  return Math.max(1, Math.ceil(content.length / charactersPerLine));
}

function salesQuotationPageDensity(
  quote: Row,
  store: Pick<Store, "quotation_items">,
): SalesQuotationPageDensity {
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const terms = text(quote.terms_conditions, DEFAULT_QUOTATION_TERMS)
    .split(/\r?\n+/)
    .map((item) => item.trim().replace(/^\d+[.)]\s*/, ""))
    .filter((item) => item && !item.toLowerCase().startsWith("validity:"));
  const bankDetails = quotationBankDetails(quote.bank_details);
  const lineUnits = lines.reduce(
    (total, line) => total + quotationTextUnits(line.description, 48),
    0,
  );
  const termUnits = terms.reduce((total, term) => {
    const [heading, ...description] = term.split(":");
    return total + Math.max(
      quotationTextUnits(heading, 38),
      quotationTextUnits(description.join(":") || heading, 68),
    );
  }, 0);
  const bankUnits = bankDetails.reduce(
    (total, bank) => total + Math.max(
      quotationTextUnits(bank.bank_name, 36),
      quotationTextUnits([bank.account_name, bank.account_number].filter(Boolean).join(" - "), 64),
    ),
    0,
  );
  const contentUnits = 27 + lineUnits + 1 + termUnits + (bankDetails.length ? 1 + bankUnits : 0) + (n(quote.shipping_handling) > 0 ? 4 : 3);
  if (contentUnits <= 48) return "standard";
  if (contentUnits <= 62) return "compact";
  if (contentUnits <= 80) return "super-compact";
  return "overflow";
}

const priceQuotationPdfStyles = PdfStyleSheet.create({
  // 8.5 × 14 in (Legal paper) at React PDF's 72 points per inch.
  page: { paddingTop: 28, paddingRight: 30, paddingBottom: 28, paddingLeft: 30, fontFamily: "SF Pro Display", fontSize: 11, color: "#111" },
  topHeader: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1.2, borderColor: "#111", paddingBottom: 10 },
  logoColumn: { width: "27%", justifyContent: "center", paddingRight: 8 }, logo: { width: 130, height: 44, objectFit: "contain" },
  businessColumn: { width: "38%", justifyContent: "center", paddingHorizontal: 8 }, businessDetail: { fontSize: 9.5, lineHeight: 1.2, marginBottom: 1 },
  quoteColumn: { width: "35%", borderLeftWidth: 1, borderColor: "#555", paddingLeft: 13 }, title: { color: "#c92f35", fontSize: 17, fontWeight: 700, marginBottom: 5 },
  quoteMetaRow: { flexDirection: "row", marginBottom: 1 }, quoteMetaLabel: { width: 76, fontSize: 10 }, quoteMetaColon: { width: 8, fontSize: 10 }, quoteMetaValue: { flex: 1, fontSize: 10 },
  clientGrid: { flexDirection: "row", marginTop: 14, marginBottom: 12 }, clientColumn: { width: "50%", paddingRight: 14 }, clientColumnRight: { width: "50%", borderLeftWidth: 1, borderColor: "#777", paddingLeft: 16 },
  clientField: { flexDirection: "row", alignItems: "flex-end", minHeight: 23, marginBottom: 3 }, clientLabel: { width: 88, fontWeight: 700, fontSize: 11 }, clientColon: { width: 9, fontWeight: 700, fontSize: 11 }, clientValue: { flex: 1, borderBottomWidth: 0.7, borderColor: "#555", paddingBottom: 2, fontSize: 11 },
  salutation: { fontSize: 11, fontStyle: "italic", lineHeight: 1.35, marginBottom: 12 }, table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" }, row: { flexDirection: "row", alignItems: "stretch" },
  cell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", paddingVertical: 5, paddingHorizontal: 5, justifyContent: "center", alignSelf: "stretch", textAlign: "center", fontSize: 11, lineHeight: 1.25 }, tableHeader: { backgroundColor: "#efefef", fontWeight: 700 }, descriptionCell: { textAlign: "left" },
  termsHeader: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#111", backgroundColor: "#efefef", paddingVertical: 6, paddingHorizontal: 7, fontSize: 11, fontWeight: 700 }, termsTable: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111", marginTop: 12 }, termNumber: { textAlign: "center" }, termTitle: { fontWeight: 700, textAlign: "left" }, termDescription: { textAlign: "left", lineHeight: 1.25 },
  lowerSection: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 12 }, bankTable: { width: "100%", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" }, totalTable: { width: "43%", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" }, bankHeader: { fontWeight: 700, textAlign: "center" }, totalLabel: { fontSize: 11, fontWeight: 700, textAlign: "left" }, totalValue: { fontSize: 11, textAlign: "right" }, totalRow: { backgroundColor: "#efefef" }, totalLabelStrong: { fontSize: 11, fontWeight: 700, textAlign: "left" }, totalValueStrong: { fontSize: 11, fontWeight: 700, textAlign: "right" },
  signatures: { flexDirection: "row", marginTop: 16 }, signatureColumn: { width: "50%", minHeight: 62, paddingRight: 14 }, signatureColumnRight: { width: "50%", minHeight: 62, borderLeftWidth: 1, borderColor: "#777", paddingLeft: 16 }, signatureLine: { flexDirection: "row", alignItems: "flex-end", minHeight: 23 }, signatureLabel: { width: 76, fontWeight: 700, fontSize: 11 }, signatureSignatory: { flex: 1, minHeight: 28, justifyContent: "flex-end" }, signatureImage: { width: 70, height: 26, objectFit: "contain", alignSelf: "center", marginBottom: -4 }, signatureName: { width: "100%", textAlign: "center", borderBottomWidth: 0.8, borderColor: "#111", paddingBottom: 2, fontSize: 11 }, signatureRole: { marginTop: 4, marginLeft: 76, fontSize: 11, textAlign: "center" },
  footer: { borderTopWidth: 1, borderColor: "#111", marginTop: 12, paddingTop: 5 }, footerItalic: { textAlign: "center", fontSize: 9.5, fontStyle: "italic", lineHeight: 1.3 }, footerAddress: { textAlign: "center", fontSize: 9.5, marginTop: 4 },
  internalTitle: { color: "#9d1f25", fontSize: 16, fontWeight: 700, marginBottom: 4 }, internalNote: { color: "#555", fontSize: 10.5, marginBottom: 12 }, internalProductTitle: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 6 }, internalSummary: { marginTop: 6, marginLeft: "42%", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111" },
});

const priceQuotationPdfCompactStyles = PdfStyleSheet.create({
  page: { paddingTop: 12, paddingRight: 17, paddingBottom: 11, paddingLeft: 17, fontSize: 6.3 },
  topHeader: { paddingBottom: 5 }, logo: { width: 108, height: 36 }, businessDetail: { fontSize: 5.9, lineHeight: 1.1, marginBottom: 0 }, quoteColumn: { paddingLeft: 10 }, title: { fontSize: 13, marginBottom: 3 },
  quoteMetaLabel: { width: 60, fontSize: 6.2 }, quoteMetaColon: { width: 6, fontSize: 6.2 }, quoteMetaValue: { fontSize: 6.2 },
  clientGrid: { marginTop: 5, marginBottom: 4 }, clientColumn: { paddingRight: 8 }, clientColumnRight: { paddingLeft: 10 }, clientField: { minHeight: 12, marginBottom: 1 }, clientLabel: { width: 63, fontSize: 6.3 }, clientColon: { width: 6, fontSize: 6.3 }, clientValue: { fontSize: 6.2, paddingBottom: 0 },
  salutation: { fontSize: 6.4, marginBottom: 4 }, cell: { paddingVertical: 2, paddingHorizontal: 3, fontSize: 6.2, lineHeight: 1.05 }, termsHeader: { paddingVertical: 2, paddingHorizontal: 4, fontSize: 6.5 }, termsTable: { marginTop: 5 }, bankTable: { marginTop: 5 },
  signatures: { marginTop: 6 }, signatureColumn: { minHeight: 36, paddingRight: 9 }, signatureColumnRight: { minHeight: 36, paddingLeft: 10 }, signatureLine: { minHeight: 13 }, signatureLabel: { width: 53, fontSize: 6.3 }, signatureSignatory: { minHeight: 16 }, signatureImage: { width: 50, height: 18 }, signatureName: { fontSize: 6.3 }, signatureRole: { marginTop: 2, marginLeft: 53, fontSize: 6.1 },
  footer: { marginTop: 4, paddingTop: 3 }, footerItalic: { fontSize: 6.1 }, footerAddress: { fontSize: 5.8, marginTop: 2 },
});

const priceQuotationPdfSuperCompactStyles = PdfStyleSheet.create({
  page: { paddingTop: 8, paddingRight: 14, paddingBottom: 7, paddingLeft: 14, fontSize: 5.6 },
  topHeader: { paddingBottom: 3 }, logo: { width: 96, height: 32 }, businessDetail: { fontSize: 5.2, lineHeight: 1.05, marginBottom: 0 }, quoteColumn: { paddingLeft: 8 }, title: { fontSize: 11, marginBottom: 2 },
  quoteMetaLabel: { width: 52, fontSize: 5.5 }, quoteMetaColon: { width: 5, fontSize: 5.5 }, quoteMetaValue: { fontSize: 5.5 },
  clientGrid: { marginTop: 3, marginBottom: 2 }, clientColumn: { paddingRight: 6 }, clientColumnRight: { paddingLeft: 8 }, clientField: { minHeight: 10, marginBottom: 0.5 }, clientLabel: { width: 55, fontSize: 5.6 }, clientColon: { width: 5, fontSize: 5.6 }, clientValue: { fontSize: 5.5, paddingBottom: 0 },
  salutation: { fontSize: 5.7, marginBottom: 2 }, cell: { paddingVertical: 1.5, paddingHorizontal: 2, fontSize: 5.5, lineHeight: 1 }, termsHeader: { paddingVertical: 1.5, paddingHorizontal: 3, fontSize: 5.7 }, termsTable: { marginTop: 3 }, bankTable: { marginTop: 3 },
  signatures: { marginTop: 3 }, signatureColumn: { minHeight: 28, paddingRight: 7 }, signatureColumnRight: { minHeight: 28, paddingLeft: 8 }, signatureLine: { minHeight: 11 }, signatureLabel: { width: 45, fontSize: 5.5 }, signatureSignatory: { minHeight: 13 }, signatureImage: { width: 42, height: 15 }, signatureName: { fontSize: 5.5 }, signatureRole: { marginTop: 1, marginLeft: 45, fontSize: 5.3 },
  footer: { marginTop: 2, paddingTop: 2 }, footerItalic: { fontSize: 5.3 }, footerAddress: { fontSize: 5, marginTop: 1 },
});

function PriceQuotationPdfCell({ children, width, header = false, description = false, compact = false, superCompact = false, style }: { children: ReactNode; width: string; header?: boolean; description?: boolean; compact?: boolean; superCompact?: boolean; style?: React.ComponentProps<typeof PdfView>["style"] }) {
  const plainText = typeof children === "string" || typeof children === "number";
  return <PdfView style={[priceQuotationPdfStyles.cell, { width }, header ? priceQuotationPdfStyles.tableHeader : undefined, description ? priceQuotationPdfStyles.descriptionCell : undefined, style, compact ? priceQuotationPdfCompactStyles.cell : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.cell : undefined]}>{plainText ? <PdfText style={{ textAlign: description ? "left" : "center" }}>{children}</PdfText> : children}</PdfView>;
}

function PriceQuotationTermCell({ children, width, heading = false, compact = false, superCompact = false }: { children: string; width: string; heading?: boolean; compact?: boolean; superCompact?: boolean }) {
  return <PdfView style={[priceQuotationPdfStyles.cell, { width, justifyContent: "center" }, compact ? priceQuotationPdfCompactStyles.cell : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.cell : undefined]}><PdfText style={{ fontSize: 11, lineHeight: 1.25, textAlign: "left", fontWeight: heading ? 700 : 400 }}>{children}</PdfText></PdfView>;
}

function PriceQuotationSignature({ label, name, signatureSource, compact = false, superCompact = false }: { label: string; name: string; signatureSource?: string; compact?: boolean; superCompact?: boolean }) {
  return <PdfView style={[priceQuotationPdfStyles.signatureLine, compact ? priceQuotationPdfCompactStyles.signatureLine : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLine : undefined]}><PdfText style={[priceQuotationPdfStyles.signatureLabel, compact ? priceQuotationPdfCompactStyles.signatureLabel : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLabel : undefined]}>{label}</PdfText><PdfView style={[priceQuotationPdfStyles.signatureSignatory, compact ? priceQuotationPdfCompactStyles.signatureSignatory : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureSignatory : undefined]}>{signatureSource && <PdfImage src={signatureSource} style={[priceQuotationPdfStyles.signatureImage, compact ? priceQuotationPdfCompactStyles.signatureImage : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureImage : undefined]} />}<PdfText style={[priceQuotationPdfStyles.signatureName, compact ? priceQuotationPdfCompactStyles.signatureName : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureName : undefined]}>{name}</PdfText></PdfView></PdfView>;
}

export function PriceQuotationPdf({ quote, store, origin, showInternalCosting = false }: { quote: QuotationPdfRow; store: QuotationPdfStore; origin: string; showInternalCosting?: boolean }) {
  const isMockupQuotation = text(quote.document_type) === "mockup_quotation";
  const documentLabel = isMockupQuotation ? "Mockup Quotation" : "Price Quotation";
  const documentTitle = documentLabel.toUpperCase();
  const sourceQuotation = isMockupQuotation
    ? store.quotations.find((item) => item.id === quote.source_price_quotation_id)
    : null;
  const sourceQuotationUrl = sourceQuotation?.id
    ? `${origin.replace(/\/$/, "")}/quotation-viewer?quotationId=${encodeURIComponent(text(sourceQuotation.id))}`
    : undefined;
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const formatDate = (value: unknown) => {
    if (!value) return "-";
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? "-" : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
  };
  const issueDate = formatDate(quote.issue_date);
  const leadDate = formatDate(lead?.date_sent ?? lead?.created_at ?? quote.issue_date);
  const terms = text(quote.terms_conditions, DEFAULT_QUOTATION_TERMS).split(/\r?\n+/).map((item) => item.trim().replace(/^\d+[.)]\s*/, "")).filter((item) => item && !item.toLowerCase().startsWith("validity:"));
  const termRows = terms.map((term) => {
    const [heading, ...description] = term.split(":");
    return { heading: heading.trim(), description: description.join(":").trim() || heading.trim() };
  });
  const bankDetails = quotationBankDetails(quote.bank_details);
  const currency = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  const approvedByName = text(quote.approved_by_name, "Marvin S. Tavarez");
  const approvedByRole = quote.approved_by_name ? "General Manager" : "Proprietor";
  const preparedBySignature = text(quote.prepared_by_signature_url, "") || undefined;
  const approvedBySignature = text(quote.approved_by_signature_url, "") || (approvedByName === "Marvin S. Tavarez" ? `${origin}/marvin-tavarez-signature.png` : undefined);
  // Direct Price Quotations are based on a Lead. The saved quotation values
  // remain as a fallback for historical records where lead fields are absent.
  const clientName = text(lead?.client_name ?? customer?.company_name ?? quote.client_name, "-");
  const contactName = text(lead?.contact_name ?? customer?.contact_name ?? quote.client_contact_name, "-");
  const contactNumber = text(lead?.phone ?? customer?.phone ?? quote.client_phone, "-");
  const clientEmail = text(lead?.email ?? customer?.email, "-");
  const subtotal = n(quote.subtotal);
  const tax = n(quote.vat_amount);
  const shipping = n(quote.shipping_handling);
  // Keep the customer document readable; React-PDF creates another Legal page for longer content.
  const compact = false;
  const superCompact = false;
  const productCostings = showInternalCosting
    ? store.price_quotation_product_costings.filter((costing) => costing.quotation_id === quote.id)
    : [];
  const internalCostingDrafts = productCostings
    .map((costing) => productCostingDrafts(
      [costing],
      store.price_quotation_costing_lines,
      store.price_quotation_costing_markups,
    )[0])
    .filter((costing): costing is ProductCostingDraft => Boolean(costing));
  const quotationVatRateValue = quotationVatRate(quote);
  const hasReviewVat = quotationVatRateValue > 0 && tax > 0;
  const taxLabel = `VAT (${quotationVatRateValue}%)`;
  const pageStyle = priceQuotationPdfStyles.page;
  const clientField = (label: string, value: string) => <PdfView key={label} style={[priceQuotationPdfStyles.clientField, compact ? priceQuotationPdfCompactStyles.clientField : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientField : undefined]}><PdfText style={[priceQuotationPdfStyles.clientLabel, compact ? priceQuotationPdfCompactStyles.clientLabel : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientLabel : undefined]}>{label}</PdfText><PdfText style={[priceQuotationPdfStyles.clientColon, compact ? priceQuotationPdfCompactStyles.clientColon : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientColon : undefined]}>:</PdfText><PdfText style={[priceQuotationPdfStyles.clientValue, compact ? priceQuotationPdfCompactStyles.clientValue : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientValue : undefined]}>{value}</PdfText></PdfView>;
  const headerSection = (
    <PdfView style={[priceQuotationPdfStyles.topHeader, compact ? priceQuotationPdfCompactStyles.topHeader : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.topHeader : undefined]}>
      <PdfView style={priceQuotationPdfStyles.logoColumn}><PdfImage src={`${origin}/huswell-quotation-logo.png`} style={[priceQuotationPdfStyles.logo, compact ? priceQuotationPdfCompactStyles.logo : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.logo : undefined]} /></PdfView>
      <PdfView style={priceQuotationPdfStyles.businessColumn}>
        <PdfText style={[priceQuotationPdfStyles.businessDetail, compact ? priceQuotationPdfCompactStyles.businessDetail : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.businessDetail : undefined]}>72 Adrian St., North Fairview Park Subd.,{`\n`}Brgy. North Fairview, Quezon City, Metro Manila</PdfText>
        <PdfText style={[priceQuotationPdfStyles.businessDetail, compact ? priceQuotationPdfCompactStyles.businessDetail : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.businessDetail : undefined]}>(02) 456-7890</PdfText>
        <PdfText style={[priceQuotationPdfStyles.businessDetail, compact ? priceQuotationPdfCompactStyles.businessDetail : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.businessDetail : undefined]}>info@huswelltrading.com</PdfText>
        <PdfText style={[priceQuotationPdfStyles.businessDetail, compact ? priceQuotationPdfCompactStyles.businessDetail : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.businessDetail : undefined]}>www.huswelltrading.com</PdfText>
      </PdfView>
      <PdfView style={[priceQuotationPdfStyles.quoteColumn, compact ? priceQuotationPdfCompactStyles.quoteColumn : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.quoteColumn : undefined]}>
        <PdfText style={[priceQuotationPdfStyles.title, compact ? priceQuotationPdfCompactStyles.title : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.title : undefined]}>{documentTitle}</PdfText>
        {[
          ["Quotation No.", text(quote.quotation_no)],
          ...(sourceQuotation ? [["Source Price Quotation", text(sourceQuotation.quotation_no)]] : []),
          ["Quotation Date", issueDate],
          ["Prepared By", text(quote.representative, "Sales Executive")],
        ].map(([label, value]) => <PdfView key={label} style={priceQuotationPdfStyles.quoteMetaRow}><PdfText style={[priceQuotationPdfStyles.quoteMetaLabel, compact ? priceQuotationPdfCompactStyles.quoteMetaLabel : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.quoteMetaLabel : undefined]}>{label}</PdfText><PdfText style={[priceQuotationPdfStyles.quoteMetaColon, compact ? priceQuotationPdfCompactStyles.quoteMetaColon : undefined, superCompact ? priceQuotationPdfCompactStyles.quoteMetaColon : undefined]}>:</PdfText>{label === "Source Price Quotation" && sourceQuotationUrl ? <PdfLink src={sourceQuotationUrl} style={[priceQuotationPdfStyles.quoteMetaValue, compact ? priceQuotationPdfCompactStyles.quoteMetaValue : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.quoteMetaValue : undefined, { color: "#1769e8", textDecoration: "underline" }]}>{value}</PdfLink> : <PdfText style={[priceQuotationPdfStyles.quoteMetaValue, compact ? priceQuotationPdfCompactStyles.quoteMetaValue : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.quoteMetaValue : undefined]}>{value}</PdfText>}</PdfView>)}
      </PdfView>
    </PdfView>
  );
  const clientSection = (
    <PdfView style={[priceQuotationPdfStyles.clientGrid, compact ? priceQuotationPdfCompactStyles.clientGrid : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientGrid : undefined]}>
      <PdfView style={[priceQuotationPdfStyles.clientColumn, compact ? priceQuotationPdfCompactStyles.clientColumn : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientColumn : undefined]}>{clientField("Company Name", clientName)}{clientField("Contact Person", contactName)}{clientField("Contact Number", contactNumber)}</PdfView>
      <PdfView style={[priceQuotationPdfStyles.clientColumnRight, compact ? priceQuotationPdfCompactStyles.clientColumnRight : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.clientColumnRight : undefined]}>{clientField("Date", leadDate)}{clientField("Email", clientEmail)}{clientField("Project Type", text(quote.project_types, "-"))}</PdfView>
    </PdfView>
  );
  const salutationSection = <PdfText style={[priceQuotationPdfStyles.salutation, compact ? priceQuotationPdfCompactStyles.salutation : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.salutation : undefined]}>Dear Sir/Madam, Thank you for the opportunity to serve your requirements.</PdfText>;
  const tableSection = (
    <PdfView style={priceQuotationPdfStyles.table} wrap>
      <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="11%" header>ITEM</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="37%" header>DESCRIPTION</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="16%" header>QUANTITY</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="21%" header>{hasReviewVat ? "SELLING PRICE / UNIT (VAT INC.)" : "SELLING PRICE / UNIT"}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="15%" header>{hasReviewVat ? "AMOUNT (VAT INC.)" : "AMOUNT"}</PriceQuotationPdfCell></PdfView>
      {lines.map((line, index) => { const quantity = n(line.quantity); return <PdfView key={text(line.id, String(index))} style={priceQuotationPdfStyles.row} wrap={false}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="11%">{index + 1}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="37%" description>{text(line.description)}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="16%">{`${quantity} ${quantity === 1 ? "pc" : "pcs"}`}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="21%">{currency(n(line.unit_cost))}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="15%">{currency(n(line.line_total))}</PriceQuotationPdfCell></PdfView>; })}
      {[["SUBTOTAL", currency(subtotal)], ...(hasReviewVat ? [[taxLabel, currency(tax)]] : []), ...(shipping > 0 ? [["SHIPPING / HANDLING", currency(shipping)]] : [])].map(([label, value]) => <PdfView key={label} style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="85%" description style={priceQuotationPdfStyles.totalLabel}>{label}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="15%" style={priceQuotationPdfStyles.totalValue}>{value}</PriceQuotationPdfCell></PdfView>)}
      <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="85%" description style={[priceQuotationPdfStyles.totalRow, priceQuotationPdfStyles.totalLabelStrong]}>{hasReviewVat ? "GRAND TOTAL (VAT INCLUDED)" : "GRAND TOTAL"}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="15%" style={[priceQuotationPdfStyles.totalRow, priceQuotationPdfStyles.totalValueStrong]}>{currency(n(quote.total_amount))}</PriceQuotationPdfCell></PdfView>
    </PdfView>
  );
  const termsSection = (
    <PdfView style={[priceQuotationPdfStyles.termsTable, compact ? priceQuotationPdfCompactStyles.termsTable : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.termsTable : undefined]} wrap>
      <PdfView style={[priceQuotationPdfStyles.termsHeader, compact ? priceQuotationPdfCompactStyles.termsHeader : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.termsHeader : undefined]}><PdfText>TERMS AND CONDITIONS</PdfText></PdfView>
      {termRows.map((term, index) => <PdfView key={`${term.heading}-${index}`} style={priceQuotationPdfStyles.row} wrap={false}><PriceQuotationTermCell superCompact={superCompact} compact={compact} width="32%" heading>{term.heading}</PriceQuotationTermCell><PriceQuotationTermCell superCompact={superCompact} compact={compact} width="68%">{term.description}</PriceQuotationTermCell></PdfView>)}
    </PdfView>
  );
  const bankSection = (
    <PdfView style={[priceQuotationPdfStyles.bankTable, compact ? priceQuotationPdfCompactStyles.bankTable : { marginTop: 8 }, superCompact ? priceQuotationPdfSuperCompactStyles.bankTable : undefined]}>
        <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="35%" header style={priceQuotationPdfStyles.bankHeader}>BANK</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="65%" header style={priceQuotationPdfStyles.bankHeader}>ACCOUNT NAME / NUMBER</PriceQuotationPdfCell></PdfView>
        {bankDetails.map((detail, index) => <PdfView key={`${detail.bank_name}-${detail.account_number}-${index}`} style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="35%" description>{detail.bank_name}</PriceQuotationPdfCell><PriceQuotationPdfCell superCompact={superCompact} compact={compact} width="65%" description>{[detail.account_name, detail.account_number].filter(Boolean).join(" - ")}</PriceQuotationPdfCell></PdfView>)}
    </PdfView>
  );
  const signatureSection = (
    <PdfView style={[priceQuotationPdfStyles.signatures, compact ? priceQuotationPdfCompactStyles.signatures : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatures : undefined]}>
      <PdfView style={[priceQuotationPdfStyles.signatureColumn, compact ? priceQuotationPdfCompactStyles.signatureColumn : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureColumn : undefined]}><PriceQuotationSignature superCompact={superCompact} compact={compact} label="Prepared by:" name={text(quote.representative, "Sales Executive")} signatureSource={preparedBySignature} /><PdfText style={[priceQuotationPdfStyles.signatureRole, compact ? priceQuotationPdfCompactStyles.signatureRole : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureRole : undefined]}>Sales Executive</PdfText></PdfView>
      <PdfView style={[priceQuotationPdfStyles.signatureColumnRight, compact ? priceQuotationPdfCompactStyles.signatureColumnRight : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureColumnRight : undefined]}><PriceQuotationSignature superCompact={superCompact} compact={compact} label="Approved by:" name={approvedByName} signatureSource={approvedBySignature} /><PdfText style={[priceQuotationPdfStyles.signatureRole, compact ? priceQuotationPdfCompactStyles.signatureRole : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureRole : undefined]}>{approvedByRole}</PdfText><PdfView style={[priceQuotationPdfStyles.signatureLine, { marginTop: compact ? 3 : 5 }, compact ? priceQuotationPdfCompactStyles.signatureLine : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLine : undefined]}><PdfText style={[priceQuotationPdfStyles.signatureLabel, compact ? priceQuotationPdfCompactStyles.signatureLabel : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLabel : undefined]}>Conforme:</PdfText><PdfView style={[priceQuotationPdfStyles.signatureSignatory, compact ? priceQuotationPdfCompactStyles.signatureSignatory : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureSignatory : undefined]}><PdfText style={[priceQuotationPdfStyles.signatureName, compact ? priceQuotationPdfCompactStyles.signatureName : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureName : undefined]}> </PdfText></PdfView></PdfView><PdfView style={[priceQuotationPdfStyles.signatureLine, { marginTop: compact ? 3 : 5 }, compact ? priceQuotationPdfCompactStyles.signatureLine : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLine : undefined]}><PdfText style={[priceQuotationPdfStyles.signatureLabel, compact ? priceQuotationPdfCompactStyles.signatureLabel : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureLabel : undefined]}>Date:</PdfText><PdfView style={[priceQuotationPdfStyles.signatureSignatory, compact ? priceQuotationPdfCompactStyles.signatureSignatory : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureSignatory : undefined]}><PdfText style={[priceQuotationPdfStyles.signatureName, compact ? priceQuotationPdfCompactStyles.signatureName : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.signatureName : undefined]}> </PdfText></PdfView></PdfView></PdfView>
    </PdfView>
  );
  const footerSection = (
    <PdfView style={[priceQuotationPdfStyles.footer, compact ? priceQuotationPdfCompactStyles.footer : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.footer : undefined]}><PdfText style={[priceQuotationPdfStyles.footerItalic, compact ? priceQuotationPdfCompactStyles.footerItalic : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.footerItalic : undefined]}>Thank you for the opportunity to provide this quotation.{`\n`}We look forward to working with you.</PdfText><PdfText style={[priceQuotationPdfStyles.footerAddress, compact ? priceQuotationPdfCompactStyles.footerAddress : undefined, superCompact ? priceQuotationPdfSuperCompactStyles.footerAddress : undefined]}>Business Address: 72 Adrian St., North Fairview Park Subd., Brgy. North Fairview, Quezon City, Metro Manila</PdfText></PdfView>
  );
  return <PdfDocument title={`${documentLabel} ${text(quote.quotation_no)}`}>
    {/* React-PDF collapses a fixed page height when PdfPage has wrap={false}. */}
    <PdfPage size={LEGAL_PORTRAIT} orientation="portrait" style={pageStyle}>
      {headerSection}{clientSection}{salutationSection}{tableSection}{termsSection}{bankSection}{signatureSection}{footerSection}
    </PdfPage>
    {showInternalCosting && productCostings.length > 0 && <PdfPage size={LEGAL_PORTRAIT} orientation="portrait" style={priceQuotationPdfStyles.page}>
      <PdfText style={priceQuotationPdfStyles.internalTitle}>INTERNAL PRODUCT COSTINGS</PdfText>
      <PdfText style={priceQuotationPdfStyles.internalNote}>General Manager confidential — do not share with the client or Sales Executive.</PdfText>
      {productCostings.map((costing, costingIndex) => {
        const product = lines.find((line) => line.id === costing.quotation_item_id);
        const costLines = store.price_quotation_costing_lines.filter((line) => line.product_costing_id === costing.id).sort((a, b) => n(a.sort_order) - n(b.sort_order));
        const rounded = (value: number) => Math.round(value * 100) / 100;
        const cogs = costLines.reduce((sum, line) => sum + rounded(text(line.calculation_type) === "fixed_amount" ? n(line.unit_cost) : n(line.quantity) * n(line.unit_cost)), 0);
        const quantity = n(product?.quantity);
        const costingDraft = internalCostingDrafts.find((item) => item.key === text(costing.id));
        if (!costingDraft) return null;
        const totals = productCostingTotals(costingDraft, quantity, quotationVatRateValue);
        return <PdfView key={text(costing.id, String(costingIndex))} wrap>
          <PdfText style={priceQuotationPdfStyles.internalProductTitle}>{`${costingIndex + 1}. ${text(product?.description, "Quotation product")} — ${quantity} ${quantity === 1 ? "pc" : "pcs"}`}</PdfText>
          <PdfView style={priceQuotationPdfStyles.table}>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="49%" header description>INTERNAL COST</PriceQuotationPdfCell><PriceQuotationPdfCell width="15%" header>QTY</PriceQuotationPdfCell><PriceQuotationPdfCell width="18%" header>UNIT COST</PriceQuotationPdfCell><PriceQuotationPdfCell width="18%" header>AMOUNT</PriceQuotationPdfCell></PdfView>
            {costLines.map((line, index) => { const isFixedAmount = text(line.calculation_type) === "fixed_amount"; const amount = isFixedAmount ? n(line.unit_cost) : rounded(n(line.quantity) * n(line.unit_cost)); return <PdfView key={text(line.id, String(index))} style={priceQuotationPdfStyles.row} wrap={false}><PriceQuotationPdfCell width="49%" description>{text(line.description)}</PriceQuotationPdfCell><PriceQuotationPdfCell width="15%">{isFixedAmount ? "—" : n(line.quantity)}</PriceQuotationPdfCell><PriceQuotationPdfCell width="18%">{isFixedAmount ? "—" : currency(n(line.unit_cost))}</PriceQuotationPdfCell><PriceQuotationPdfCell width="18%">{currency(amount)}</PriceQuotationPdfCell></PdfView>; })}
          </PdfView>
          <PdfView style={priceQuotationPdfStyles.internalSummary}>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>TOTAL DIRECT COST</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(cogs)}</PriceQuotationPdfCell></PdfView>
            {costingDraft.markups.map((markup, index) => { const key = markup.markupKey || pricingMarkupKeyForLabel(markup.label); const type = markupCalculationType(markup); const value = n(markupValue(markup)); const label = pricingMarkupDefinition(key as PricingMarkupKey)?.label ?? markup.label; return <PdfView key={text(markup.key, String(index))} style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>{`${label} (${type === "fixed_amount" ? currency(value) : `${value}%`})`}</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.markupAmounts[markup.key] ?? 0)}</PriceQuotationPdfCell></PdfView>; })}
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>{`INTERNAL VAT (${n(costingDraft.internalVatRate)}%)`}</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.internalVatAmount)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>TOTAL BEFORE DISCOUNT</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.listSellingExVat)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>LIST PRICE VAT EX (TOTAL)</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.listSellingExVat)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>NET SELLING PRICE VAT EX (TOTAL)</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.sellingExVat)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>{`VAT (${quotationVatRateValue}%)`}</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.vat)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={priceQuotationPdfStyles.totalLabel}>SELLING PRICE VAT EX / PIECE</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={priceQuotationPdfStyles.totalValue}>{currency(totals.unitExVat)}</PriceQuotationPdfCell></PdfView>
            <PdfView style={priceQuotationPdfStyles.row}><PriceQuotationPdfCell width="58%" description style={[priceQuotationPdfStyles.totalRow, priceQuotationPdfStyles.totalLabelStrong]}>SELLING PRICE VAT INC / PIECE</PriceQuotationPdfCell><PriceQuotationPdfCell width="42%" style={[priceQuotationPdfStyles.totalRow, priceQuotationPdfStyles.totalValueStrong]}>{currency(totals.unitIncVat)}</PriceQuotationPdfCell></PdfView>
          </PdfView>
        </PdfView>;
      })}
    </PdfPage>}
  </PdfDocument>;
}

function PriceQuotationPdfLegacy({ quote, store, origin }: { quote: Row; store: Store; origin: string }) {
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const issueDate = quote.issue_date ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${quote.issue_date}T00:00:00`)) : "—";
  const terms = text(quote.terms_conditions, DEFAULT_QUOTATION_TERMS).split(/\r?\n+/).map((item) => item.trim().replace(/^\d+[.)]\s*/, "")).filter((item) => item && !item.toLowerCase().startsWith("validity:"));
  const bankDetails = quotationBankDetails(quote.bank_details);
  const currency = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
  const approvedByName = text(quote.approved_by_name, "Marvin S. Tavarez");
  const approvedBySignature = text(quote.approved_by_signature_url, "") || (quote.approved_by_name ? undefined : `${origin}/marvin-tavarez-signature.png`);
  const approvedByRole = quote.approved_by_name ? "General Manager" : "Proprietor";
  const clientName = text(customer?.company_name ?? lead?.client_name ?? quote.client_name, "—");
  const contactName = text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name, "—");
  const contactNumber = text(customer?.phone ?? lead?.phone ?? quote.client_phone, "—");
  const clientAddress = text(customer?.billing_address ?? lead?.address ?? quote.client_address, "—");
  const clientEmail = text(customer?.email ?? lead?.email, "—");
  const subtotal = n(quote.subtotal);
  const tax = n(quote.vat_amount);
  const vatRate = quotationVatRate(quote);
  const shipping = n(quote.shipping_handling);
  return <PdfDocument title={`Price Quotation ${text(quote.quotation_no)}`}>
    <PdfPage size={LEGAL_PORTRAIT} orientation="portrait" style={generatedPdfStyles.page}>
      <PdfView style={generatedPdfStyles.header}>
        <PdfView><PdfImage src={`${origin}/huswell-quotation-logo.png`} style={generatedPdfStyles.logo} /><PdfText>72 Adrian St. North Fairview Park Subd.</PdfText><PdfText>Brgy. North Fairview, Quezon City</PdfText><PdfText>09171697153</PdfText><PdfText>saleshuswell@gmail.com</PdfText></PdfView>
        <PdfView style={generatedPdfStyles.quotationHeader}><PdfText style={generatedPdfStyles.quotationTitle}>PRICE QUOTATION</PdfText><PdfView style={generatedPdfStyles.quotationDetails}><PdfText style={generatedPdfStyles.quotationDetail}>Quotation No.: {text(quote.quotation_no)}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Quotation Date: {issueDate}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Prepared For: {text(customer?.company_name ?? lead?.client_name ?? quote.client_name, "—")}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Attention: {text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name, "—")}</PdfText></PdfView></PdfView>
      </PdfView>
      <PdfView style={{ marginTop: 14 }}>
        <PdfText>Company Name: {clientName}</PdfText>
        <PdfText>Contact Person: {contactName}</PdfText>
        <PdfText>Contact Number: {contactNumber}</PdfText>
        <PdfText>Address: {clientAddress}</PdfText>
        <PdfText>Email: {clientEmail}</PdfText>
      </PdfView>
      <PdfText style={[generatedPdfStyles.terms, { marginTop: 12, fontStyle: "italic" }]}>Dear Sir/Madam, Thank you for the opportunity to serve your requirements.</PdfText>
      <PdfView style={generatedPdfStyles.table} wrap>
        <PdfView style={generatedPdfStyles.row}><PdfCell width="11%" header>ITEM</PdfCell><PdfCell width="37%" header>DESCRIPTION</PdfCell><PdfCell width="16%" header>QUANTITY</PdfCell><PdfCell width="21%" header>SELLING PRICE / UNIT</PdfCell><PdfCell width="15%" header>AMOUNT</PdfCell></PdfView>
        {lines.map((line, index) => { const quantity = n(line.quantity); return <PdfView key={text(line.id, String(index))} style={generatedPdfStyles.row} wrap={false}><PdfCell width="11%">{index + 1}</PdfCell><PdfCell width="37%" description>{text(line.description)}</PdfCell><PdfCell width="16%">{`${quantity} ${quantity === 1 ? "pc" : "pcs"}`}</PdfCell><PdfCell width="21%">{currency(n(line.unit_cost))}</PdfCell><PdfCell width="15%">{currency(n(line.line_total))}</PdfCell></PdfView>; })}
        <PdfView style={generatedPdfStyles.row}><PdfCell width="85%" total>SUBTOTAL</PdfCell><PdfCell width="15%" total>{currency(subtotal)}</PdfCell></PdfView>
        <PdfView style={generatedPdfStyles.row}><PdfCell width="85%" total>{`TAX (${vatRate}%)`}</PdfCell><PdfCell width="15%" total>{currency(tax)}</PdfCell></PdfView>
        {shipping > 0 && <PdfView style={generatedPdfStyles.row}><PdfCell width="85%" total>SHIPPING / HANDLING</PdfCell><PdfCell width="15%" total>{currency(shipping)}</PdfCell></PdfView>}
        <PdfView style={generatedPdfStyles.row}><PdfCell width="85%" total>TOTAL</PdfCell><PdfCell width="15%" total>{currency(n(quote.total_amount))}</PdfCell></PdfView>
      </PdfView>
      <PdfText style={generatedPdfStyles.sectionTitle}>TERMS AND CONDITIONS</PdfText>
      <PdfText style={generatedPdfStyles.terms}>{terms.map((term, index) => `${index + 1}. ${term}`).join("\n")}</PdfText>
      <PdfBankDetails details={bankDetails} />
      <PdfView style={generatedPdfStyles.signatureRow}><PdfSignatureBlock label="Prepared by:" name={text(quote.representative)} role="Sales Executive" signatureSource={text(quote.prepared_by_signature_url, "") || undefined} /><PdfSignatureBlock label="Approved by:" name={approvedByName} role={approvedByRole} signatureSource={approvedBySignature} /></PdfView>
      <PdfText style={[generatedPdfStyles.terms, { marginTop: 10 }]}>Conforme: ______________________________</PdfText>
      <PdfText style={[generatedPdfStyles.terms, { marginTop: 14, textAlign: "center", fontStyle: "italic" }]}>Thank you for the opportunity to provide this quotation.</PdfText>
      <PdfText style={[generatedPdfStyles.terms, { textAlign: "center" }]}>We look forward to working with you.</PdfText>
      <PdfText style={[generatedPdfStyles.terms, { marginTop: 8, textAlign: "center" }]}>Business Address: 72 Adrian St., North Fairview Park Subd., Brgy. North Fairview, Quezon City, Metro Manila</PdfText>
    </PdfPage>
  </PdfDocument>;
}

function CostingBreakdownPdf({ quote, store, origin }: { quote: Row; store: Store; origin: string }) {
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const cogs = n(quote.total_cost); const sellingExVat = n(quote.subtotal); const currency = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
  const approvedByName = text(quote.approved_by_name, "Marvin S. Tavarez");
  const approvedBySignature = text(quote.approved_by_signature_url, "") || (quote.approved_by_name ? undefined : `${origin}/marvin-tavarez-signature.png`);
  const approvedByRole = quote.approved_by_name ? "General Manager" : "Proprietor";
  return <PdfDocument title={`Costing Breakdown ${text(quote.quotation_no)}`}><PdfPage size={LEGAL_PORTRAIT} orientation="portrait" style={generatedPdfStyles.page}>
    <PdfView style={{ alignItems: "center" }}><PdfImage src={`${origin}/huswell-quotation-logo.png`} style={generatedPdfStyles.logo} /><PdfText style={generatedPdfStyles.title}>COSTING BREAKDOWN / PRICE QUOTE</PdfText></PdfView>
    <PdfText style={generatedPdfStyles.sectionTitle}>CLIENT INFORMATION</PdfText>
    {[["Company Name", text(customer?.company_name ?? lead?.client_name ?? quote.client_name)], ["Client Name", text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name)], ["Phone / Email", text(quote.client_phone)], ["Date", day(quote.issue_date)]].map(([label, value]) => <PdfView key={label} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{label}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{value}</PdfText></PdfView>)}
    <PdfText style={generatedPdfStyles.sectionTitle}>DETAILS</PdfText>
    {[["Size", text(quote.size_details)], ["Quantity", text(quote.project_quantity)], ["Project Type", text(quote.project_types)], ["Delivery Date", day(quote.delivery_date)]].map(([label, value]) => <PdfView key={label} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{label}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{value}</PdfText></PdfView>)}
    <PdfView style={[generatedPdfStyles.table, { marginTop: 15 }]}><PdfView style={generatedPdfStyles.row}><PdfCell width="52%" header>Materials and Production</PdfCell><PdfCell width="14%" header>Quantity</PdfCell><PdfCell width="17%" header>Unit Cost</PdfCell><PdfCell width="17%" header>Subtotal</PdfCell></PdfView>{lines.map((line, index) => <PdfView key={text(line.id, String(index))} style={generatedPdfStyles.row} wrap={false}><PdfCell width="52%">{text(line.description)}</PdfCell><PdfCell width="14%">{n(line.quantity)}</PdfCell><PdfCell width="17%">{currency(n(line.unit_cost))}</PdfCell><PdfCell width="17%">{currency(n(line.line_total))}</PdfCell></PdfView>)}<PdfView style={generatedPdfStyles.row}><PdfCell width="83%" total>TOTAL ESTIMATED COGS</PdfCell><PdfCell width="17%" total>{currency(cogs)}</PdfCell></PdfView></PdfView>
    <PdfText style={generatedPdfStyles.sectionTitle}>MARKUP, VAT, EXPENSES</PdfText>
    {[["Declared Markup", cogs * n(quote.profit_margin_rate) / 100], ["Overhead Allocation", cogs * n(quote.overhead_rate) / 100], ["Buffer Margin", cogs * n(quote.buffer_margin_rate) / 100], ["Production Commission", cogs * n(quote.commission_rate) / 100], ["VAT", n(quote.vat_amount)], ["SELLING PRICE VAT EX.", sellingExVat], ["SELLING PRICE VAT INC.", n(quote.total_amount)]].map(([label, value]) => <PdfView key={String(label)} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{String(label)}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{currency(Number(value))}</PdfText></PdfView>)}
    <PdfView style={generatedPdfStyles.signatureRow}><PdfSignatureBlock label="Prepared by:" name={text(quote.representative)} role="Sales Executive" signatureSource={text(quote.prepared_by_signature_url, "") || undefined} /><PdfSignatureBlock label="Approved by:" name={approvedByName} role={approvedByRole} signatureSource={approvedBySignature} /></PdfView>
  </PdfPage></PdfDocument>;
}

function showPdfDocumentWindow(
  preview: Window | null,
  pdfUrl: string,
  printAfterOpen = false,
) {
  if (!preview) {
    const generatedWindow = window.open(pdfUrl, "_blank");
    if (!generatedWindow) {
      window.alert("Allow pop-ups to open the generated PDF.");
    }
    return;
  }
  preview.location.assign(pdfUrl);
  if (printAfterOpen) {
    window.setTimeout(() => {
      if (!preview.closed) {
        preview.focus();
        preview.print();
      }
    }, 900);
  }
}

function showGeneratedPdfWindow(
  preview: Window | null,
  pdf: Blob,
  printAfterOpen = false,
) {
  const pdfUrl = URL.createObjectURL(pdf);
  showPdfDocumentWindow(preview, pdfUrl, printAfterOpen);
  window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60 * 1_000);
}

function Panel({
  title,
  detail,
  action,
  children,
  variant = "card",
  hideHeading = false,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  children: ReactNode;
  variant?: "card" | "page";
  hideHeading?: boolean;
}) {
  return (
    <section
      className={
        variant === "page"
          ? "min-h-full overflow-hidden bg-[var(--color-surface)]"
          : "overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-none"
      }
    >
      {!hideHeading && (
        <header
          className={`flex flex-wrap items-start justify-between gap-3 ${variant === "page" ? "border-b border-[var(--color-border)] px-3 py-2 sm:px-4 lg:px-5" : "p-3 sm:p-4"}`}
        >
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <p
              className={`${variant === "page" ? "mt-0.5" : "mt-1"} text-[12px] text-[var(--color-text-secondary)]`}
            >
              {detail}
            </p>
          </div>
          {action}
        </header>
      )}
      {hideHeading && action && (
        <div className="workspace-floating-action fixed left-16 top-3 z-40 flex gap-2 sm:top-4 lg:left-[17rem]">
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
type LeadWorkspaceMode =
  | "leads"
  | "projects"
  | "lead_change_requests"
  | "quotation";
function LeadWorkspaceTabs({
  active,
  onChange,
  className = "",
  showLeadChangeRequests = false,
}: {
  active: LeadWorkspaceMode;
  onChange: (mode: LeadWorkspaceMode) => void;
  className?: string;
  showLeadChangeRequests?: boolean;
}) {
  const tabs: { mode: LeadWorkspaceMode; label: string }[] = [
    { mode: "leads", label: "Leads" },
    ...(showLeadChangeRequests
      ? [{ mode: "lead_change_requests" as const, label: "My Lead Change Requests" }]
      : []),
  ];
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label="Lead workspace sections"
      className={`${className} app-tabs pt-2`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          onClick={() => onChange(tab.mode)}
          aria-current={active === tab.mode ? "page" : undefined}
          className="app-tab"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-[var(--color-border)] px-4 py-8 text-center text-[12px] text-[var(--color-text-secondary)]">
      {children}
    </div>
  );
}
function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return (
    <div className="min-w-28">
      <div className="mb-1 flex justify-between text-[11px] text-[var(--color-text-secondary)]">
        <span>{value.toLocaleString()}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[var(--radius-control)] bg-[var(--color-surface-subtle)]">
        <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
type MonthlyPerformancePoint = {
  label: string;
  revenue: number;
  expense: number;
};

function MonthlyPerformanceChart({
  data,
  primaryLabel = "Invoiced revenue",
  secondaryLabel = "Recorded expenses",
  primaryColor = "#1769e8",
  secondaryColor = "#159957",
}: {
  data: MonthlyPerformancePoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  const compact = new Intl.NumberFormat("en-PH", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <div className="px-4 pb-4 pt-1 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#626b7a]">
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-full" style={{ backgroundColor: primaryColor }} /> {primaryLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-full" style={{ backgroundColor: secondaryColor }} /> {secondaryLabel}
        </span>
      </div>
      <div className="h-60" role="img" aria-label={`Monthly ${primaryLabel.toLowerCase()} and ${secondaryLabel.toLowerCase()}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="dashboard-primary-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={primaryColor} stopOpacity={0.28} />
                <stop offset="95%" stopColor={primaryColor} stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="dashboard-secondary-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.14} />
                <stop offset="95%" stopColor={secondaryColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 5" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#8b92a1", fontSize: 10 }} dy={8} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8b92a1", fontSize: 10 }} tickFormatter={(value) => compact.format(value)} width={42} />
            <Tooltip
              cursor={{ stroke: "#cfd7e3", strokeDasharray: "3 3" }}
              contentStyle={{ borderRadius: 10, border: "1px solid #e4e8ef", boxShadow: "0 10px 24px rgb(16 24 40 / 12%)", padding: "9px 11px" }}
              labelStyle={{ color: "#151922", fontSize: 12, fontWeight: 600, marginBottom: 5 }}
              itemStyle={{ color: "#626b7a", fontSize: 11, padding: 0 }}
              formatter={(value, name) => [peso.format(Number(value)), name === "revenue" ? primaryLabel : secondaryLabel]}
            />
            <Area type="monotone" dataKey="expense" name="expense" stroke={secondaryColor} strokeWidth={2.25} fill="url(#dashboard-secondary-area)" activeDot={{ r: 4, fill: secondaryColor, stroke: "#fff", strokeWidth: 2 }} />
            <Area type="monotone" dataKey="revenue" name="revenue" stroke={primaryColor} strokeWidth={2.75} fill="url(#dashboard-primary-area)" activeDot={{ r: 4, fill: primaryColor, stroke: "#fff", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function CumulativePerformanceChart({
  data,
}: {
  data: MonthlyPerformancePoint[];
}) {
  const values = data.reduce<number[]>(
    (totals, point) => [
      ...totals,
      (totals.at(-1) ?? 0) + point.revenue - point.expense,
    ],
    [],
  );
  const runningTotal = values.at(-1) ?? 0;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const left = 24;
  const plotWidth = 670;
  const chartHeight = 132;
  const top = 16;
  const toY = (value: number) => top + ((max - value) / range) * chartHeight;
  const lineColor = runningTotal >= 0 ? "#218b55" : "#b42318";
  const points = values
    .map((value, index) => {
      const x = left + (plotWidth / (data.length - 1)) * index;
      return `${x},${toY(value)}`;
    })
    .join(" ");
  const zeroY = toY(0);

  return (
    <div className="px-5 pb-5">
      <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-[#626b7a]">
        <span>Running income less expenses</span>
        <b className={runningTotal >= 0 ? "text-[#218b55]" : "text-[#b42318]"}>
          {peso.format(runningTotal)}
        </b>
      </div>
      <svg
        viewBox="0 0 720 188"
        className="h-auto w-full"
        role="img"
        aria-label="Cumulative operating result by month"
      >
        <line x1={left} x2="704" y1={zeroY} y2={zeroY} stroke="#d9e0e9" />
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((value, index) => {
          const x = left + (plotWidth / (data.length - 1)) * index;
          return (
            <g key={data[index].label}>
              <title>{`${data[index].label}: ${peso.format(value)} cumulative net operating result`}</title>
              <circle cx={x} cy={toY(value)} r="3.5" fill={lineColor} />
              <text
                x={x}
                y="174"
                textAnchor="middle"
                fill="#8b92a1"
                fontSize="10"
              >
                {data[index].label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function QuotationStatusPie({ data }: { data: [string, number][] }) {
  const total = data.reduce((sum, [, count]) => sum + count, 0);
  const colors = [
    "#1769e8",
    "#36c779",
    "#f0a348",
    "#8b92a1",
    "#b42318",
    "#7c6ee6",
  ];
  const segments = data.map(([, count], index) => {
    const completed = data
      .slice(0, index)
      .reduce((sum, [, previousCount]) => sum + previousCount, 0);
    const start = (completed / total) * 100;
    const end = ((completed + count) / total) * 100;
    return `${colors[index % colors.length]} ${start}% ${end}%`;
  });

  return (
    <div className="flex flex-col gap-5 px-5 pb-5 sm:flex-row sm:items-center">
      <div
        className="relative mx-auto grid size-36 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${segments.join(", ")})` }}
        role="img"
        aria-label={`Quotation status distribution, ${total} quotations`}
      >
        <div className="grid size-20 place-items-center rounded-full bg-white text-center">
          <b className="text-[22px] leading-none">{total}</b>
          <span className="text-[11px] text-[#8b92a1]">quotes</span>
        </div>
      </div>
      <div className="grid flex-1 gap-2">
        {data.map(([status, count], index) => (
          <div
            key={status}
            className="flex items-center justify-between gap-3 text-[13px]"
          >
            <span className="inline-flex items-center gap-2 capitalize text-[#626b7a]">
              <i
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              {status.replaceAll("_", " ")}
            </span>
            <b>{count}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
function Table({
  labels,
  children,
  minWidth = 680,
  className,
  scrollable = true,
  compact = false,
  columnWidths,
  alignRightLabels = [],
}: {
  labels: string[];
  children: ReactNode;
  minWidth?: number;
  className?: string;
  scrollable?: boolean;
  compact?: boolean;
  columnWidths?: string[];
  alignRightLabels?: string[];
}) {
  return (
    <div
      className="max-w-full overflow-hidden rounded-lg border border-[#d6dee8] bg-white"
    >
      <div
        className={scrollable ? "max-h-[656px] overflow-x-auto overflow-y-auto overscroll-x-contain" : "overflow-x-hidden"}
      >
        <table
          className={`app-table w-full text-left text-[12px] ${className ?? ""}`}
          style={{ minWidth }}
        >
          <thead
            className={`border-y border-[#1F4E79] bg-[#1F4E79] text-[12px] font-bold text-white ${scrollable ? "sticky top-0 z-10" : ""}`}
          >
            <tr>
              {labels.map((l, index) => (
                <th
                  key={l}
                  scope="col"
                  className={`${compact ? "px-2 py-2 text-[11px]" : "px-5 py-3"} whitespace-nowrap ${l.toLowerCase() === "actions" ? "text-center" : ["amount", "total", ...alignRightLabels.map((label) => label.toLowerCase())].includes(l.toLowerCase()) ? "text-right" : ""}`}
                  style={columnWidths?.[index] ? { width: columnWidths[index] } : undefined}
                >
                  {titleCase(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0f5]">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Dialog({
  title,
  fields,
  values,
  setValues,
  save,
  close,
  saving,
  children,
  saveLabel = "Save record",
  className = "max-w-xl",
  compact = false,
  onFieldChange,
}: {
  title: string;
  fields: Field[];
  values: Record<string, string>;
  setValues: (next: Record<string, string>) => void;
  save: () => void;
  close: () => void;
  saving: boolean;
  children?: ReactNode;
  saveLabel?: string;
  className?: string;
  compact?: boolean;
  onFieldChange?: (
    key: string,
    value: string,
    current: Record<string, string>,
  ) => Record<string, string>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<
    Record<string, boolean>
  >({});
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/30 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmOpen(true);
        }}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-[14px] border border-[#d9e0e9] bg-white ${compact ? "p-3" : "p-3 sm:p-4"} ${className}`}
      >
        <div className={`${compact ? "mb-3" : "mb-4"} flex items-center justify-between`}>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]">
            <X size={18} />
          </button>
        </div>
        <div className={`grid ${compact ? "gap-2" : "gap-3"} sm:grid-cols-2`}>
          {fields.map((f) => (
            <label
              key={f.key}
              className={`block ${compact ? "text-[11px]" : "text-[12px]"} font-medium ${f.type === "textarea" || f.type === "terms" ? "sm:col-span-2" : ""}`}
            >
              {titleCase(f.label)}
              {f.type === "contact_toggle" ? (
                <div className="relative mt-1">
                  <input
                    readOnly
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder ?? "Select a client first"}
                    className="input mt-0 pr-[116px] bg-[#f6f8fb] text-[#687386]"
                  />
                  <span className="absolute right-1 top-1/2 inline-flex -translate-y-1/2 overflow-hidden rounded-md border border-[#d9e0e9] bg-white text-[11px] shadow-sm">
                    {(["phone", "email"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          setValues(
                            onFieldChange
                              ? onFieldChange("contact_display", type, values)
                              : { ...values, contact_display: type },
                          )
                        }
                        className={`px-2 py-1 font-medium ${values.contact_display === type ? "bg-[#c43b43] text-white" : "text-[#687386] hover:bg-[#f6f8fb]"}`}
                      >
                        {type === "phone" ? "Phone" : "Email"}
                      </button>
                    ))}
                  </span>
                </div>
              ) : f.type === "size" ? (
                <div className="mt-1 flex gap-2">
                  <input
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.key]: titleCaseEntry(e.target.value, f.key),
                      })
                    }
                    className="input mt-0 min-w-0"
                    style={{ flex: "1 1 0%", width: "auto" }}
                    placeholder="e.g. 2 X 5 X 6"
                  />
                  <select
                    aria-label="Size unit"
                    value={values.size_unit || "Inch"}
                    onChange={(e) =>
                      setValues({ ...values, size_unit: e.target.value })
                    }
                    className="input mt-0"
                    style={{ flex: "0 0 84px", width: "84px" }}
                  >
                    <option value="Inch">Inch</option>
                    <option value="Cm">Cm</option>
                  </select>
                </div>
              ) : f.type === "select" ? (
                <select
                  required={f.required}
                  value={
                    f.options?.find(
                      (option) =>
                        option.split("|")[0] ===
                        (values[f.key] ?? "").split("|")[0],
                    ) ??
                    values[f.key] ??
                    ""
                  }
                  onChange={(e) =>
                    setValues(
                      onFieldChange
                        ? onFieldChange(f.key, e.target.value, values)
                        : { ...values, [f.key]: e.target.value },
                    )
                  }
                  className={`input ${values[f.key] ? "text-[#151922]" : "text-[#8b92a1]"}`}
                >
                  <option value="" className="text-[#8b92a1]">
                    Select {titleCase(f.label)}
                  </option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o.includes("|")
                        ? o.slice(o.indexOf("|") + 1)
                        : o.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              ) : f.type === "toggle" ? (
                <SegmentedToggle
                  ariaLabel={f.label}
                  value={(values[f.key] ?? "").split("|")[0]}
                  options={(f.options ?? []).map((option) => {
                    const separator = option.indexOf("|");
                    const optionValue = separator >= 0 ? option.slice(0, separator) : option;
                    const fullLabel = separator >= 0 ? option.slice(separator + 1) : option.replaceAll("_", " ");
                    return {
                      value: optionValue,
                      label: compact ? f.shortLabels?.[optionValue] ?? fullLabel : fullLabel,
                      ariaLabel: f.shortLabels?.[optionValue] ? fullLabel : undefined,
                    };
                  })}
                  onChange={(value) =>
                    setValues(
                      onFieldChange
                        ? onFieldChange(f.key, value, values)
                        : { ...values, [f.key]: value },
                    )
                  }
                  size={compact ? "compact" : "default"}
                  className={`${compact ? "mt-1" : "mt-2"} w-full`}
                />
              ) : f.type === "checkbox_group" ? (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-[#d9e0e9] bg-[#fafbfe] p-3">
                  {f.options?.map((option) => {
                    const selected = (values[f.key] ?? "")
                      .split("\n")
                      .filter(Boolean);
                    const checked = selected.includes(option);
                    return (
                      <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 text-[12px] font-normal text-[#344054]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((value) => value !== option)
                              : [...selected, option];
                            setValues({ ...values, [f.key]: next.join("\n") });
                          }}
                          className="size-4 accent-[#c43b43]"
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
              ) : f.type === "terms" ? (
                <div className="mt-2 space-y-2">
                  {Array.from({ length: 7 }, (_, index) => {
                    const terms = (values[f.key] ?? "").split(/\r?\n/);
                    return (
                      <div
                        key={index}
                        className="grid grid-cols-[28px_1fr] items-center gap-2"
                      >
                        <span className="grid size-7 place-items-center rounded-full bg-[#eef4ff] text-[11px] font-semibold text-[#2168d6]">
                          {index + 1}
                        </span>
                        <input
                          required={f.required}
                          value={terms[index] ?? ""}
                          onChange={(e) => {
                            const nextTerms = [...terms];
                            while (nextTerms.length < 7) nextTerms.push("");
                            nextTerms[index] = titleCaseEntry(
                              e.target.value,
                              f.key,
                            );
                            setValues({
                              ...values,
                              [f.key]: nextTerms.join("\n"),
                            });
                          }}
                          className="input mt-0"
                          placeholder={f.placeholder ?? `Enter term ${index + 1}`}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : f.type === "textarea" ? (
                <textarea
                  required={f.required}
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [f.key]: titleCaseEntry(e.target.value, f.key),
                    })
                  }
                  className="input min-h-20"
                  placeholder={fieldPlaceholder(f)}
                />
              ) : f.type === "password" ? (
                <div className="relative mt-1">
                  <input
                    required={f.required}
                    type={visiblePasswords[f.key] ? "text" : "password"}
                    autoComplete="new-password"
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    className="input mt-0 pr-10"
                    placeholder={fieldPlaceholder(f)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setVisiblePasswords((current) => ({
                        ...current,
                        [f.key]: !current[f.key],
                      }))
                    }
                    aria-label={visiblePasswords[f.key] ? "Hide password" : "Show password"}
                    title={visiblePasswords[f.key] ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#7d8797] hover:text-[#151922]"
                  >
                    {visiblePasswords[f.key] ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              ) : (
                <input
                  required={f.required}
                  readOnly={f.readOnly}
                  aria-readonly={f.readOnly || undefined}
                  type={f.type ?? "text"}
                  min={f.type === "number" ? "0" : undefined}
                  step={f.type === "number" ? "any" : undefined}
                  value={values[f.key] ?? ""}
                  onClick={(e) => {
                    if (f.type === "date")
                      openNativeDatePicker(e.currentTarget);
                  }}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [f.key]:
                        (!f.type || f.type === "text")
                          ? titleCaseEntry(e.target.value, f.key)
                          : e.target.value,
                    })
                  }
                  className={`input ${compact ? "min-h-7 px-2 py-1 text-[12px]" : ""} ${f.readOnly ? "bg-[#f6f8fb] text-[#687386]" : ""}`}
                  placeholder={fieldPlaceholder(f)}
                />
              )}
              {f.hint && (
                <span className="mt-1 block text-[10px] font-normal text-[#8b92a1]">
                  {f.hint}
                </span>
              )}
            </label>
          ))}
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <Button secondary onClick={close}>
            Cancel
          </Button>
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving || undefined}
            style={{ fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-body)" }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#c43b43] px-2.5 text-[12px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-50"
          >
            {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </form>
      <ConfirmationDialog
        open={confirmOpen}
        title="Confirm save"
        description={`Are you sure you want to ${saveLabel.toLowerCase()}?`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          save();
        }}
      />
    </div>
  );
}

function Records({
  module,
  store,
  orgId,
  reload,
  notice,
  role,
  onPrint,
  leadMode = "leads",
  onLeadModeChange,
}: {
  module: Module;
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
  onPrint?: (r: Row) => void;
  leadMode?: LeadWorkspaceMode;
  onLeadModeChange?: (mode: LeadWorkspaceMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [evaluationFilter, setEvaluationFilter] = useState("all");
  const [doneDealStatusFilter, setDoneDealStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(currentMonth);
  const [projectOfficerFilter, setProjectOfficerFilter] = useState("all");
  const [leadDistributionOpen, setLeadDistributionOpen] = useState(false);
  const [deletionRequestLead, setDeletionRequestLead] = useState<Row | null>(null);
  const [recordNote, setRecordNote] = useState<{
    title: string;
    context: string;
    note: string;
  } | null>(null);
  const [deletionRequestValues, setDeletionRequestValues] = useState<Record<string, string>>({
    request_note: "",
  });
  const isProjectsPage = module.table === "leads" && leadMode === "projects";
  const isLeadChangeRequestsPage =
    module.table === "leads" && leadMode === "lead_change_requests";
  const isGeneralManager = memberRole(role);
  const canFilterByProjectOfficer = isGeneralManager && !isProjectsPage;
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  const canCreate =
    !isProjectsPage &&
    !isLeadChangeRequestsPage &&
    canAccess(role, module.table, "create");
  const canUpdate = canAccess(role, module.table, "update");
  const canArchive = canAccess(role, module.table, "archive");
  const ownProjectEditRequests =
    isProjectsPage && isProjectOfficerRole(role)
      ? store.project_edit_requests.filter(
          (request) => text(request.submitted_by, "") === currentUserId,
        )
      : [];
  const ownLeadChangeRequests =
    isLeadChangeRequestsPage && isProjectOfficerRole(role)
      ? store.lead_change_requests.filter(
          (request) => text(request.submitted_by, "") === currentUserId,
        )
      : [];
  const renderRecordNote = (title: string, context: string, value: unknown) => {
    const note = text(value, "").trim();
    return note ? (
      <NoteAction
        label={`View ${title.toLowerCase()}`}
        tone="amber"
        onClick={() => setRecordNote({ title, context, note })}
      />
    ) : (
      <span className="text-[11px] text-[#8b92a1]">—</span>
    );
  };
  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setCurrentUserId(data.user?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, []);
  const rows = useMemo(
    () =>
      store[module.table]
        .filter((r) =>
          JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
        )
        .filter(
          (r) =>
            !["expenses", "quotations"].includes(module.table) ||
            !r.archived_at,
        )
        .filter(
          (r) =>
            module.table !== "leads" ||
            isGeneralManager ||
            text(r.assigned_to ?? r.created_by, "") === currentUserId,
        )
        .filter(
          (r) =>
            module.table !== "leads" ||
            !canFilterByProjectOfficer ||
            projectOfficerFilter === "all" ||
            (projectOfficerFilter === "unassigned"
              ? !text(r.assigned_to, "")
              : text(r.assigned_to ?? r.created_by, "") === projectOfficerFilter),
        )
        .filter(
          (r) =>
            module.table !== "leads" ||
            (isProjectsPage
              ? n(r.evaluation_number) === 7
              : n(r.evaluation_number) !== 7),
        )
        .filter(
          (r) =>
            module.table !== "leads" ||
            isProjectsPage ||
            evaluationFilter === "all" ||
            (evaluationFilter === "unassigned"
              ? !text(r.assigned_to, "")
              : text(r.evaluation_number, "") === evaluationFilter),
        )
        .filter(
          (r) =>
            module.table !== "leads" ||
            !isProjectsPage ||
            doneDealStatusFilter === "all" ||
            text(r.done_deal_status, "") === doneDealStatusFilter,
        )
        .filter((r) => {
          if (module.table !== "leads" || !monthFilter) return true;
          const rawDate = text(r.date_sent, "") || text(r.created_at, "");
          return rawDate.slice(0, 7) === monthFilter;
        }),
    [
      store,
      module.table,
      query,
      currentUserId,
      isProjectsPage,
      isGeneralManager,
      canFilterByProjectOfficer,
      projectOfficerFilter,
      evaluationFilter,
      doneDealStatusFilter,
      monthFilter,
    ],
  );
  const shown =
    module.table === "leads" ? rows : rows.slice(page * 10, page * 10 + 10);
  const totalLeadCount = rows.length;
  const leadOfficerDistribution = useMemo(() => {
    if (!canFilterByProjectOfficer || projectOfficerFilter !== "all") return [];
    const totals = new Map(
      projectOfficers.map((officer) => [
        officer.id,
        { id: officer.id, name: officer.name, count: 0 },
      ]),
    );
    let unassignedCount = 0;
    rows.forEach((lead) => {
      const assignedTo = text(lead.assigned_to, "");
      if (!assignedTo) {
        unassignedCount += 1;
        return;
      }
      const existing = totals.get(assignedTo);
      if (existing) {
        existing.count += 1;
        return;
      }
      const profile = store.profiles.find((item) => item.id === assignedTo);
      totals.set(assignedTo, {
        id: assignedTo,
        name: text(profile?.full_name, "Sales Executive"),
        count: 1,
      });
    });
    return [
      ...Array.from(totals.values()).sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name),
      ),
      { id: "unassigned", name: "Unassigned", count: unassignedCount },
    ];
  }, [
    canFilterByProjectOfficer,
    projectOfficerFilter,
    projectOfficers,
    rows,
    store.profiles,
  ]);
  const fields = module.fields.map((field) => {
    if (field.key === "supplier_id")
      return {
        ...field,
        options: store.suppliers
          .filter((supplier) => supplier.is_active !== false)
          .map((supplier) => `${supplier.id}|${text(supplier.company_name)}`),
      };
    return field;
  });
  const leadColumns =
    module.table === "leads"
      ? module.columns.filter(
          (column) =>
            column.label !== "Outbound caller" &&
            (isProjectsPage || column.label !== "Lead / project"),
        )
      : module.columns;
  const assignmentColumn = {
    label: "Sales Officer",
    value: (row: Row) =>
      text(
        store.profiles.find((profile) => profile.id === row.assigned_to)
          ?.full_name,
        "Unassigned",
      ),
  };
  const leadRecordedDateColumns = leadColumns.filter(
    (column) => column.label === leadRecordedDateLabel,
  );
  const remainingLeadColumns = leadColumns.filter(
    (column) => column.label !== leadRecordedDateLabel,
  );
  const leadColumnsDateFirst = [
    ...leadRecordedDateColumns,
    ...remainingLeadColumns,
  ];
  const columns =
    module.table === "leads" && isProjectsPage
      ? leadColumnsDateFirst.map((column) =>
          column.label === "Lead status"
            ? {
                label: "Done Deal Status",
                value: (row: Row) => doneDealStatusLabel(row.done_deal_status),
              }
            : column,
        )
      : module.table === "leads" && isGeneralManager
        ? [
            ...leadRecordedDateColumns,
            assignmentColumn,
            ...remainingLeadColumns,
          ]
        : leadColumnsDateFirst;
  const visibleFields =
    module.table === "leads" && isProjectsPage
      ? fields.filter((field) => field.key !== "evaluation_number")
      : module.table === "leads" &&
          text(values.evaluation_number, "").split("|")[0] !== "7"
        ? fields.filter((field) => field.key !== "done_deal_status")
        : fields;
  const dialogVisibleFields = visibleFields.filter(
    (field) =>
      !(module.table === "leads" && isProjectsPage && !editing && field.key === "date_sent"),
  );
  const isOfficerSettingLostClient =
    module.table === "leads" &&
    !isProjectsPage &&
    isProjectOfficerRole(role) &&
    Boolean(editing?.id) &&
    text(values.evaluation_number, "").split("|")[0] === "3" &&
    n(editing?.evaluation_number) !== 3;
  const dialogFields =
    module.table === "leads" && isGeneralManager && !isProjectsPage
      ? [
          ...dialogVisibleFields,
          {
            key: "assigned_to",
            label: "Sales Executive",
            type: "select" as const,
            options: projectOfficers.map(
              (officer) => `${officer.id}|${officer.name}`,
            ),
            hint: "Select an officer, or leave this lead unassigned until it is ready to allocate.",
          },
        ]
      : [
          ...dialogVisibleFields,
          ...(isOfficerSettingLostClient
            ? [
                {
                  key: "request_note",
                  label: "Reason for marking this client lost",
                  type: "textarea" as const,
                  required: true,
                  placeholder: "Explain why this client was lost",
                },
              ]
            : []),
        ];
  const initial = (row?: Row) =>
    Object.fromEntries(
      module.fields.map((f) => [
        f.key,
        row
          ? text(row[f.key], "")
          : f.key === "date_sent" && module.table === "leads"
            ? ""
            : f.type === "date"
              ? isoToday()
              : "",
      ]),
    );
  const save = async () => {
    setSaving(true);
    const client = createClient();
    const requestNote = text(values.request_note, "").trim();
    const payload: Record<string, unknown> = { ...values };
    delete payload.request_note;
    module.fields
      .filter((f) => f.type === "number")
      .forEach((f) => (payload[f.key] = n(payload[f.key])));
    module.fields
      .filter((f) => f.type === "date")
      .forEach((f) => {
        const value = payload[f.key];
        if (typeof value === "string" && !value.trim()) payload[f.key] = null;
      });
    if (typeof payload.customer_id === "string")
      payload.customer_id = String(payload.customer_id).split("|")[0] || null;
    if (typeof payload.supplier_id === "string")
      payload.supplier_id = String(payload.supplier_id).split("|")[0] || null;
    if (typeof payload.assigned_to === "string")
      payload.assigned_to = String(payload.assigned_to).split("|")[0] || null;
    if (typeof payload.evaluation_number === "string")
      payload.evaluation_number = Number(
        String(payload.evaluation_number).split("|")[0],
      );
    if (typeof payload.done_deal_status === "string")
      payload.done_deal_status =
        Number(String(payload.done_deal_status).split("|")[0]) || null;
    if (module.table === "leads" && n(payload.evaluation_number) !== 7)
      payload.done_deal_status = null;
    if (module.table === "leads" && typeof payload.client_name === "string")
      payload.client_name = payload.client_name.trim() || null;
    if (!editing) {
      Object.assign(payload, { organization_id: orgId });
      if (
        [
          "invoices",
          "expenses",
          "cash_flow_entries",
          "leads",
          "supplier_payables",
          "payroll_periods",
          "target_goals",
        ].includes(module.table)
      )
        payload.created_by =
          (await client.auth.getUser()).data.user?.id ?? null;
    if (
      module.table === "leads" &&
      !payload.assigned_to &&
      isProjectOfficerRole(role)
    )
      payload.assigned_to = payload.created_by;
    if (module.table === "leads" && !payload.project_name)
        payload.project_name = payload.client_name || payload.contact_name || null;
    }
    if (module.table === "invoices" && !editing)
      Object.assign(payload, {
        invoice_no: ref("INV"),
        status: "draft",
        vat_rate: n(store.business_settings[0]?.vat_rate) || 12,
      });
    if (module.table === "cash_flow_entries" && !editing)
      payload.status = "draft";
    if (module.table === "target_goals" && !editing)
      payload.is_completed = false;
    if (module.table === "inventory_items" && !editing)
      payload.item_type =
        module === inventory ? "material" : payload.item_type || "product";
    if (
      editing?.id &&
      module.table === "leads" &&
      !isProjectsPage &&
      isProjectOfficerRole(role)
    ) {
      if (isOfficerSettingLostClient && !requestNote) {
        setSaving(false);
        return notice("Enter a reason for marking this client lost.");
      }
      const { error } = await client.rpc("request_lead_change", {
        p_lead_id: editing.id,
        p_change_type: "update",
        p_proposed_changes: payload,
        p_request_note: requestNote,
      });
      setSaving(false);
      if (error) return notice(error.message);
      setOpen(false);
      setEditing(null);
      notice("Lead edit submitted for General Manager approval.");
      await reload();
      return;
    }
    if (
      editing?.id &&
      isProjectsPage &&
      isProjectOfficerRole(role)
    ) {
      const { error } = await client.rpc("request_project_edit", {
        p_project_id: editing.id,
        p_proposed_changes: payload,
      });
      setSaving(false);
      if (error) return notice(error.message);
      setOpen(false);
      setEditing(null);
      notice("Project edit submitted for General Manager approval.");
      await reload();
      return;
    }
    const request = editing?.id
      ? client
          .from(module.table)
          .update(payload)
          .eq("id", editing.id)
          .eq("organization_id", orgId)
      : client.from(module.table).insert(payload);
    const { error } = await request;
    setSaving(false);
    if (error) return notice(error.message);
    setOpen(false);
    setEditing(null);
    notice("Record saved.");
    await reload();
  };
  const archive = async (row: Row) => {
    if (!row.id) return;
    const patch = ["expenses", "quotations"].includes(module.table)
      ? { archived_at: new Date().toISOString() }
      : { is_active: false };
    const { error } = await createClient()
      .from(module.table)
      .update(patch)
      .eq("id", row.id)
      .eq("organization_id", orgId);
    if (error) notice(error.message);
    else {
      notice("Record archived.");
      await reload();
    }
  };
  const deleteLead = async (row: Row) => {
    if (!row.id) return;
    setSaving(true);
    const { error } = await createClient().rpc(
      "delete_lead_as_general_manager",
      { p_lead_id: row.id },
    );
    setSaving(false);
    if (error) return notice(error.message);
    notice("Lead / project deleted.");
    await reload();
  };
  const requestLeadDeletion = async (row: Row, requestNote: string) => {
    if (!row.id) return;
    setSaving(true);
    const { error } = await createClient().rpc("request_lead_change", {
      p_lead_id: row.id,
      p_change_type: "delete",
      p_proposed_changes: {},
      p_request_note: requestNote.trim(),
    });
    setSaving(false);
    if (error) return notice(error.message);
    setDeletionRequestLead(null);
    setDeletionRequestValues({ request_note: "" });
    notice("Lead deletion submitted for General Manager approval.");
    await reload();
  };
  const unsubmitRequest = async (
    request: Row,
    rpc: "unsubmit_lead_change" | "unsubmit_project_edit",
    label: string,
  ) => {
    if (!request.id) return;
    setSaving(true);
    const { error } = await createClient().rpc(rpc, {
      p_request_id: request.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice(`${label} unsubmitted. You can edit and submit it again.`);
    await reload();
  };
  const canDeleteLead = (row: Row) =>
    module.table === "leads" &&
    memberRole(role);
  const canRequestLeadDeletion = (row: Row) =>
    module.table === "leads" &&
    !isProjectsPage &&
    isProjectOfficerRole(role) &&
    text(row.assigned_to ?? row.created_by, "") === currentUserId;
  const canEditRow = (row: Row) =>
    canUpdate &&
    (module.table !== "leads" ||
      memberRole(role) ||
      text(row.assigned_to ?? row.created_by, "") === currentUserId);
  const isPageLayout = module.table === "leads";
  const contentPadding = isPageLayout ? "px-4 sm:px-6 lg:px-7" : "px-4 sm:px-5";
  const rowActions = (row: Row) => (
    <td className="whitespace-nowrap px-5 py-3">
      <div className="flex gap-2">
        {canEditRow(row) && (
          <ActionIcon
            onClick={() => {
              setEditing(row);
              setValues({
                ...initial(row),
                ...(module.table === "leads"
                  ? { assigned_to: text(row.assigned_to, "") }
                  : {}),
              });
              setOpen(true);
            }}
            label="Edit record"
          >
            <Pencil size={15} />
          </ActionIcon>
        )}
        {onPrint && (
          <ActionIcon
            onClick={() => onPrint(row)}
            label="View record PDF"
          >
            <Printer size={15} />
          </ActionIcon>
        )}
        {(canDeleteLead(row) || canRequestLeadDeletion(row)) && (
          <ActionIcon
            disabled={saving}
            onClick={() => {
              if (canDeleteLead(row)) {
                void deleteLead(row);
                return;
              }
              setDeletionRequestLead(row);
              setDeletionRequestValues({ request_note: "" });
            }}
            label={
              canDeleteLead(row)
                ? "Delete lead / project"
                : "Request lead deletion"
            }
            tone="red"
            confirm={canDeleteLead(row)}
            confirmationDescription={
              canDeleteLead(row)
                ? "This permanently deletes the Lead and every linked quotation, invoice, payment, production record, stock-in, project schedule, and related request. This cannot be undone."
                : undefined
            }
          >
            <Trash2 size={15} />
          </ActionIcon>
        )}
        {(
          [
            "customers",
            "suppliers",
            "employees",
            "inventory_items",
            "expenses",
            "quotations",
          ] as TableName[]
        ).includes(module.table) &&
          canArchive && (
            <ActionIcon
              onClick={() => archive(row)}
              label="Archive record"
              tone="red"
            >
              <Archive size={15} />
            </ActionIcon>
          )}
      </div>
    </td>
  );
  if (isLeadChangeRequestsPage && onLeadModeChange) {
    return (
      <div className="-m-3 min-h-[calc(100vh-76px)] bg-white sm:-m-4 sm:min-h-[calc(100vh-84px)] lg:-m-5">
        <Panel
          title={module.title}
          detail={module.detail}
          variant="page"
          hideHeading
        >
          <LeadWorkspaceTabs
            active={leadMode}
            onChange={onLeadModeChange}
            className={contentPadding}
            showLeadChangeRequests={isProjectOfficerRole(role)}
          />
          <header className={`${contentPadding} border-t border-[#edf0f5] py-4`}>
            <h2 className="text-[15px] font-semibold text-[#202938]">My Lead Change Requests</h2>
            <p className="mt-1 text-[12px] text-[#8b92a1]">
              Track submitted changes and use Edit from the Leads tab to revise and resubmit returned requests.
            </p>
          </header>
          {ownLeadChangeRequests.length ? (
            <div className="lead-change-request-shell">
              <Table
                labels={["Lead", "Requested changes", "Review", "Note", "Actions"]}
                minWidth={820}
                scrollable
                columnWidths={["25%", "28%", "20%", "15%", "12%"]}
                className="lead-change-request-table modern-page-table"
              >
                {ownLeadChangeRequests.map((request) => {
                  const lead = store.leads.find((item) => item.id === request.lead_id);
                  const changes = request.proposed_changes && typeof request.proposed_changes === "object"
                    ? Object.keys(request.proposed_changes as Record<string, unknown>)
                    : [];
                  const labels = changes.map((change) => change.replaceAll("_", " "));
                  const changeSummary = text(request.change_type, "") === "delete"
                    ? "Deletion request"
                    : labels.length <= 2
                      ? labels.join(", ")
                      : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
                  return (
                    <tr key={text(request.id)} className="hover:bg-[#fbfcff]">
                      <td className="px-5 py-3">{stackedCell(lead?.project_name, [lead?.client_name, lead?.contact_name])}</td>
                      <td className="px-5 py-3"><span>{changeSummary || "-"}</span><small>Submitted {day(request.submitted_at)}</small></td>
                      <td className="px-5 py-3"><Status value={request.status} /></td>
                      <td className="px-5 py-3">{renderRecordNote("General Manager note", text(lead?.project_name, "Lead change"), request.decision_note)}</td>
                      <td className="px-5 py-3">
                        {text(request.status) === "pending" && (
                          <ActionIcon
                            label="Unsubmit lead change"
                            tone="amber"
                            loading={saving}
                            disabled={saving}
                            confirm
                            onClick={() => void unsubmitRequest(request, "unsubmit_lead_change", "Lead change")}
                          >
                            <RotateCcw size={15} />
                          </ActionIcon>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          ) : (
            <Empty>No lead change requests yet.</Empty>
          )}
          <NoteDialog
            open={Boolean(recordNote)}
            title={recordNote?.title ?? "Note"}
            context={recordNote?.context}
            note={recordNote?.note ?? ""}
            titleId="lead-change-request-note-title"
            onClose={() => setRecordNote(null)}
          />
        </Panel>
      </div>
    );
  }
  return (
    <div
      className={
        isPageLayout
          ? "-m-3 min-h-[calc(100vh-76px)] bg-white sm:-m-4 sm:min-h-[calc(100vh-84px)] lg:-m-5"
          : "space-y-5"
      }
    >
      {isProjectsPage && isProjectOfficerRole(role) && ownProjectEditRequests.length > 0 && (
        <Panel title="My Project Edit Requests" detail="Edit the project, submit it for review, and use Edit again if the General Manager returns it for revision.">
          <Table labels={["Project", "Submitted", "Status", "Note", "Actions"]} minWidth={720}>
            {ownProjectEditRequests.map((request) => {
              const project = store.leads.find((lead) => lead.id === request.project_id);
              return (
                <tr key={text(request.id)}>
                  <td className="px-4 py-3">{text(project?.project_name)}</td>
                  <td className="px-4 py-3">{day(request.submitted_at)}</td>
                  <td className="px-4 py-3"><Status value={request.status} /></td>
                  <td className="px-4 py-3">{renderRecordNote("General Manager note", text(project?.project_name, "Project edit"), request.decision_note)}</td>
                  <td className="px-4 py-3">
                    {text(request.status) === "pending" && (
                      <ActionIcon
                        label="Unsubmit project edit"
                        tone="amber"
                        loading={saving}
                        disabled={saving}
                        confirm
                        onClick={() => void unsubmitRequest(request, "unsubmit_project_edit", "Project edit")}
                      >
                        <RotateCcw size={15} />
                      </ActionIcon>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      )}
      {!isProjectsPage && isProjectOfficerRole(role) && ownLeadChangeRequests.length > 0 && (
        <Panel title="My Lead Change Requests" detail="Edit the lead, submit it for review, and use Edit again if the General Manager returns it for revision.">
          <Table labels={["Lead", "Requested", "Change", "Status", "Note"]} minWidth={720}>
            {ownLeadChangeRequests.map((request) => {
              const lead = store.leads.find((item) => item.id === request.lead_id);
              const changes = request.proposed_changes && typeof request.proposed_changes === "object" ? Object.keys(request.proposed_changes as Record<string, unknown>) : [];
              return (
                <tr key={text(request.id)}>
                  <td className="px-4 py-3">{stackedCell(lead?.project_name, [lead?.client_name, lead?.contact_name], " · ")}</td>
                  <td className="px-4 py-3">{day(request.submitted_at)}</td>
                  <td className="px-4 py-3">{text(request.change_type, "") === "delete" ? "Deletion request" : changes.map((change) => change.replaceAll("_", " ")).join(", ")}</td>
                  <td className="px-4 py-3"><Status value={request.status} /></td>
                  <td className="px-4 py-3">{renderRecordNote("General Manager note", text(lead?.project_name, "Lead change"), request.decision_note)}</td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      )}
      <Panel
        title={module.title}
        detail={module.detail}
        variant={isPageLayout ? "page" : "card"}
        hideHeading={isPageLayout}
        action={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(null);
                setValues({
                  ...initial(),
                  ...(module.table === "leads" &&
                  isProjectOfficerRole(role) &&
                  currentUserId
                    ? { assigned_to: currentUserId }
                    : {}),
                  ...(isProjectsPage
                    ? { evaluation_number: "7", done_deal_status: "1" }
                    : {}),
                });
                setOpen(true);
              }}
            >
              <Plus size={15} />
              {module.add}
            </Button>
          ) : undefined
        }
      >
        {module.table === "leads" && onLeadModeChange && !isProjectsPage && (
          <LeadWorkspaceTabs
            active={leadMode}
            onChange={onLeadModeChange}
            className={contentPadding}
            showLeadChangeRequests={isProjectOfficerRole(role)}
          />
        )}
        {module.table === "leads" && isGeneralManager && !isProjectsPage && (
          <div className={`${contentPadding} border-t border-[#edf0f5] py-3`}>
            <p className="text-[12px] text-[#687386]">
              Manage all leads, add new opportunities, and assign each lead to a Sales Officer. Officer changes are reviewed from the Approval Center.
            </p>
          </div>
        )}
        {!isProjectsPage && module.table === "leads" && (
          <div className={`${contentPadding} border-t border-[#edf0f5] py-2.5`}>
            <span className="inline-flex items-center gap-2 rounded-md border border-[#d9e0e9] bg-[#f8faff] px-3 py-1.5 text-[12px] font-medium text-[#344054]">
              Total Leads
              <b className="text-[15px] text-[#151922]">{totalLeadCount}</b>
            </span>
          </div>
        )}
        <div
          className={`flex flex-wrap gap-2 border-t border-[#edf0f5] ${contentPadding} py-2`}
        >
          <label className="relative min-w-0 flex-1 sm:min-w-56">
            <Search
              className="absolute left-3 top-2.5 text-[#8b92a1]"
              size={15}
            />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
              placeholder="Search saved records"
            />
          </label>
          {module.table === "leads" ? (
            <>
              {canFilterByProjectOfficer && (
                <select
                  aria-label="Filter by sales officer"
                  value={projectOfficerFilter}
                  onChange={(event) => {
                    setProjectOfficerFilter(event.target.value);
                    setPage(0);
                  }}
                  className={`lead-filter-select min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${projectOfficerFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
                >
                  <option value="all">All Sales Officers</option>
                  <option value="unassigned">Unassigned</option>
                  {projectOfficers.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.name}
                    </option>
                  ))}
                </select>
              )}
              {!isProjectsPage ? (
                <select
                  aria-label="Filter lead status"
                  value={evaluationFilter}
                  onChange={(event) => {
                    setEvaluationFilter(event.target.value);
                    setPage(0);
                  }}
                  className={`lead-filter-select min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${evaluationFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
                >
                  <option value="all">Filter By Lead Status</option>
                  {isGeneralManager && (
                    <option value="unassigned">Unassigned</option>
                  )}
                  {evaluationStatuses
                    .filter((status) => !status.startsWith("7|"))
                    .map((status) => (
                      <option key={status} value={status.split("|")[0]}>
                        {status.split("|")[1]}
                      </option>
                    ))}
                </select>
              ) : (
                <select
                  aria-label="Filter done deal status"
                  value={doneDealStatusFilter}
                  onChange={(event) => {
                    setDoneDealStatusFilter(event.target.value);
                    setPage(0);
                  }}
                  className={`lead-filter-select min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${doneDealStatusFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
                >
                  <option value="all">Filter By Done Deal Status</option>
                  {doneDealStatuses.map((status) => (
                    <option key={status} value={status.split("|")[0]}>
                      {status.split("|")[1]}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-[12px] text-[#687386]">
                <span className="whitespace-nowrap">Month</span>
                <input
                  type="month"
                  value={monthFilter}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  onChange={(event) => {
                    setMonthFilter(event.target.value);
                    setPage(0);
                  }}
                  className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]"
                />
              </label>
              <Button
                secondary
                onClick={() => {
                  setMonthFilter("");
                  setPage(0);
                }}
              >
                All months
              </Button>
              {leadOfficerDistribution.length > 0 && (
                <Button
                  secondary
                  onClick={() => setLeadDistributionOpen(true)}
                >
                  <UsersRound size={14} />
                  Lead distribution
                </Button>
              )}
            </>
          ) : (
            <Button secondary onClick={() => setPage(0)}>
              <SlidersHorizontal size={14} />
              All records
            </Button>
          )}
        </div>
        {leadDistributionOpen && (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)]"
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              onClick={() => setLeadDistributionOpen(false)}
              aria-label="Close lead distribution"
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="lead-distribution-title"
              className="relative flex h-dvh w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-none sm:max-w-[420px]"
            >
              <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
                <div className="min-w-0">
                  <h3
                    id="lead-distribution-title"
                    className="text-[14px] font-semibold text-[var(--color-text-primary)]"
                  >
                    Lead distribution by Sales Officers
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                    Matching current filters
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLeadDistributionOpen(false)}
                  aria-label="Close lead distribution"
                  className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-1">
                  {leadOfficerDistribution.map((officer) => (
                    <button
                      key={officer.id}
                      type="button"
                      onClick={() => {
                        setProjectOfficerFilter(officer.id);
                        setPage(0);
                        setLeadDistributionOpen(false);
                      }}
                      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-transparent px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
                      aria-label={`Show ${officer.name}'s ${officer.count} matching leads`}
                    >
                      <span className="min-w-0 flex-1 truncate">{officer.name}</span>
                      <span className="inline-flex min-w-9 justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text-primary)]">
                        {officer.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
        {shown.length ? (
          <>
            <div className={isPageLayout ? "modern-table-shell" : undefined}>
              <Table
                labels={module.table === "leads" ? ["Actions", ...columns.map((c) => c.label)] : [...columns.map((c) => c.label), "Actions"]}
                minWidth={module.table === "leads" ? 1650 : 680}
                scrollable={isPageLayout}
                columnWidths={
                  module.table === "leads"
                    ? [
                        "112px",
                        ...columns.map((column) =>
                          column.label === "Email"
                            ? "250px"
                            : column.label === "Date contacted"
                              ? "135px"
                              : column.label === "Outbound method"
                                ? "145px"
                                : "auto",
                        ),
                      ]
                    : undefined
                }
                className={
                  module.table === "leads"
                    ? "leads-table modern-page-table"
                    : undefined
                }
              >
                {shown.map((row) => (
                  <tr key={text(row.id)} className="hover:bg-[#fbfcff]">
                    {module.table === "leads" && rowActions(row)}
                    {columns.map((c) => {
                      const value = c.value(row, store);
                      const plainValue =
                        typeof value === "string" || typeof value === "number"
                          ? String(value)
                          : undefined;
                      return (
                        <td key={c.label} className="px-5 py-3 align-middle">
                          <span className="lead-cell-value" title={plainValue}>
                            {value}
                          </span>
                        </td>
                      );
                    })}
                    {module.table !== "leads" && rowActions(row)}
                  </tr>
                ))}
              </Table>
            </div>
            <div
              className={`flex items-center justify-between border-t border-[#edf0f5] ${isPageLayout ? "modern-table-footer" : contentPadding} py-3 text-[12px] text-[#626b7a]`}
            >
              <span>
                {rows.length} record{rows.length === 1 ? "" : "s"}
              </span>
              {!isPageLayout && (
                <div className="flex gap-2">
                  <Button
                    secondary
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={14} />
                    Previous
                  </Button>
                  <Button
                    secondary
                    disabled={(page + 1) * 10 >= rows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                    <ChevronRight size={14} />
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Empty>No records match this view.</Empty>
        )}
      </Panel>
      {open && (
        <Dialog
          title={editing ? `Edit ${module.title}` : module.add}
          fields={dialogFields}
          values={values}
          setValues={setValues}
          save={() => void save()}
          close={() => {
            setOpen(false);
            setEditing(null);
          }}
          saving={saving}
          saveLabel={
            editing && module.table === "leads" && isProjectOfficerRole(role)
              ? "Submit for review"
              : undefined
          }
        />
      )}
      {deletionRequestLead && (
        <Dialog
          title="Request Lead Deletion"
          fields={[
            {
              key: "request_note",
              label: "Reason for deletion",
              type: "textarea",
              required: true,
              placeholder: "Explain why this lead should be deleted",
            },
          ]}
          values={deletionRequestValues}
          setValues={setDeletionRequestValues}
          save={() =>
            void requestLeadDeletion(
              deletionRequestLead,
              deletionRequestValues.request_note ?? "",
            )
          }
          close={() => {
            setDeletionRequestLead(null);
            setDeletionRequestValues({ request_note: "" });
          }}
          saving={saving}
          saveLabel="Submit deletion request"
        >
          <p className="rounded-lg border border-[#fed7d7] bg-[#fff5f5] p-3 text-[12px] leading-5 text-[#9b1c1c]">
            The General Manager must approve this request before the lead and its linked workflow records are permanently deleted.
          </p>
        </Dialog>
      )}
      <NoteDialog
        open={Boolean(recordNote)}
        title={recordNote?.title ?? "Note"}
        context={recordNote?.context}
        note={recordNote?.note ?? ""}
        titleId="records-note-title"
        onClose={() => setRecordNote(null)}
      />
    </div>
  );
}

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthStartFromValue = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
};
const monthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const mockupStatusStyle = (value: string) => {
  if (value === "completed") return "bg-[#eff7f1] text-[#176b40]";
  if (value === "cancelled") return "bg-[#fff1f1] text-[#b42318]";
  return "bg-[#fff6e8] text-[#a76605]";
};
const MockupStatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${mockupStatusStyle(value)}`}>
    {value || "ongoing"}
  </span>
);

function PolicyView({
  store,
  orgId,
  reload,
  notice,
  role,
  policyAction,
  onPolicyActionHandled,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
  policyAction: "announcement" | "policy" | null;
  onPolicyActionHandled: () => void;
}) {
  const canManage = role === "admin";
  const [addOpen, setAddOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ title: "" });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingPolicyId, setOpeningPolicyId] = useState<string | null>(null);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Row | null>(null);
  const [announcementValues, setAnnouncementValues] = useState<Record<string, string>>({
    title: "",
    message: "",
  });

  const policies = [...store.policies].sort((left, right) =>
    text(right.created_at).localeCompare(text(left.created_at)),
  );
  const announcements = [...store.announcements].sort((left, right) =>
    text(right.created_at).localeCompare(text(left.created_at)),
  );

  const resetForm = () => {
    setValues({ title: "" });
    setPdfFile(null);
    setAddOpen(false);
  };

  const closeAnnouncement = () => {
    setAnnouncementOpen(false);
    setEditingAnnouncement(null);
    setAnnouncementValues({ title: "", message: "" });
  };

  const openAnnouncement = (announcement?: Row) => {
    setAddOpen(false);
    setEditingAnnouncement(announcement ?? null);
    setAnnouncementValues({
      title: text(announcement?.title),
      message: text(announcement?.message),
    });
    setAnnouncementOpen(true);
  };

  useEffect(() => {
    if (policyAction === "announcement") {
      setAddOpen(false);
      setEditingAnnouncement(null);
      setAnnouncementValues({ title: "", message: "" });
      setAnnouncementOpen(true);
    }
    if (policyAction === "policy") {
      setAnnouncementOpen(false);
      setAddOpen(true);
    }
    if (policyAction) onPolicyActionHandled();
  }, [policyAction, onPolicyActionHandled]);

  const addPolicy = async () => {
    if (!(values.title ?? "").trim()) return notice("Enter a policy title.");
    if (!pdfFile) return notice("Choose a policy PDF to upload.");
    if (pdfFile.type !== "application/pdf")
      return notice("Only PDF documents can be uploaded.");
    setSaving(true);
    const client = createClient();
    try {
      const path = `${orgId}/policy-documents/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await client.storage
        .from("policy-documents")
        .upload(path, pdfFile, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const fileUrl = client.storage
        .from("policy-documents")
        .getPublicUrl(path).data.publicUrl;
      const { error } = await client.rpc("insert_policy", {
        p_title: (values.title ?? "").trim(),
        p_file_url: fileUrl,
      });
      if (error) throw error;
      notice("Policy uploaded successfully.");
      resetForm();
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to upload policy.");
    }
    setSaving(false);
  };

  const removePolicy = async (policy: Row) => {
    const client = createClient();
    try {
      const { error } = await client.rpc("delete_policy", {
        p_policy_id: policy.id,
      });
      if (error) throw error;
      try {
        const path = policyStoragePath(policy.file_url, orgId);
        if (path) await client.storage.from("policy-documents").remove([path]);
      } catch {
        // Best-effort cleanup of the storage object; the record is already gone.
      }
      notice("Policy deleted.");
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to delete policy.");
    }
  };

  const saveAnnouncement = async () => {
    const title = text(announcementValues.title).trim();
    const message = text(announcementValues.message).trim();
    if (!title) return notice("Enter an announcement title.");
    if (!message) return notice("Enter the announcement message.");

    setSaving(true);
    const client = createClient();
    try {
      let error: Error | null = null;
      if (editingAnnouncement) {
        const result = await client
          .from("announcements")
          .update({ title, message })
          .eq("id", editingAnnouncement.id)
          .eq("organization_id", orgId);
        error = result.error;
      } else {
        const {
          data: { user },
          error: userError,
        } = await client.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("You must be signed in to post an announcement.");
        const result = await client.from("announcements").insert({
          organization_id: orgId,
          title,
          message,
          created_by: user.id,
        });
        error = result.error;
      }
      if (error) throw error;
      notice(editingAnnouncement ? "Announcement updated." : "Announcement posted.");
      closeAnnouncement();
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to save announcement.");
    }
    setSaving(false);
  };

  const removeAnnouncement = async (announcement: Row) => {
    try {
      const { error } = await createClient()
        .from("announcements")
        .delete()
        .eq("id", announcement.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      notice("Announcement deleted.");
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to delete announcement.");
    }
  };

  const viewPolicy = async (policy: Row) => {
    const path = policyStoragePath(policy.file_url, orgId);
    if (!path) return notice("This policy file is unavailable.");

    const policyWindow = window.open("", "_blank");
    if (!policyWindow) return notice("Allow pop-ups to view policy documents.");
    policyWindow.opener = null;

    const policyId = text(policy.id, "");
    setOpeningPolicyId(policyId);
    try {
      const { data, error } = await createClient()
        .storage
        .from("policy-documents")
        .createSignedUrl(path, 5 * 60);
      if (data?.signedUrl) {
        policyWindow.location.href = data.signedUrl;
        return;
      }

      // Keeps the new client compatible until the accompanying private-bucket
      // migration is applied. The migration disables these legacy public URLs.
      const legacyUrl = text(policy.file_url, "").trim();
      if (/^https?:\/\//i.test(legacyUrl)) {
        policyWindow.location.href = legacyUrl;
        return;
      }
      throw error ?? new Error("Unable to create a secure policy link.");
    } catch (error) {
      policyWindow.close();
      notice(error instanceof Error ? error.message : "Failed to open policy.");
    } finally {
      setOpeningPolicyId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#edf0f5] px-4 py-4 sm:px-5">
        <div>
          <h1 className="text-[15px] font-semibold text-[#202938]">Announcements & Policy</h1>
          <p className="mt-1 text-[12px] text-[#687386]">Read General Manager announcements and company policy documents.</p>
        </div>
      </header>
      <section>
        {announcements.length ? (
          <div className="space-y-2 p-3 sm:p-4">
            {announcements.map((announcement) => (
              <article key={text(announcement.id)} className="flex flex-wrap items-start justify-between gap-3 border-l-[3px] border-[#c43b43] bg-[#fffafa] px-3 py-3 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#ab3038]">Company announcement</span>
                    <span className="text-[11px] text-[#8b92a1]">Posted {day(announcement.created_at)}</span>
                  </div>
                  <p className="text-[13px] font-semibold text-[#202938]">{text(announcement.title)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#475467]">{text(announcement.message)}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <ActionIcon label="Edit announcement" confirm={false} onClick={() => openAnnouncement(announcement)}>
                      <Pencil size={15} />
                    </ActionIcon>
                    <ActionIcon label="Delete announcement" tone="red" confirmationDescription={`Delete "${text(announcement.title)}"?`} onClick={() => void removeAnnouncement(announcement)}>
                      <Trash2 size={15} />
                    </ActionIcon>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <span className="grid size-9 place-items-center rounded-md bg-[#fceced] text-[#ab3038]">
              <MessageSquareText size={18} />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-[#202938]">No announcements yet</p>
            <p className="mt-1 text-[12px] text-[#8b92a1]">New General Manager updates will appear here.</p>
          </div>
        )}
      </section>

      <section className="border-t border-[#edf0f5]">
        <div className="border-b border-[#edf0f5] px-4 py-3 sm:px-5">
          <p className="text-[13px] font-semibold text-[#202938]">Policy Documents</p>
          <p className="mt-0.5 text-[11px] text-[#8b92a1]">Company policy PDFs available to view.</p>
        </div>
      {policies.length ? (
        <div className="divide-y divide-[#edf0f5]">
          <div className="hidden grid-cols-[minmax(0,1fr)_auto] gap-3 bg-[#fafbfc] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#687386] sm:grid sm:px-5">
            <span>Policy title</span>
            <span>PDF document</span>
          </div>
          {policies.map((policy) => (
            <div
              key={text(policy.id)}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#fceced] text-[#ab3038]">
                  <FileText size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-[#202938]">
                      {text(policy.title)}
                    </p>
                    <span className="shrink-0 rounded border border-[#f2c7cb] bg-[#fff5f5] px-1.5 py-0.5 text-[10px] font-semibold text-[#ab3038]">PDF</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#8b92a1]">
                    Uploaded {day(policy.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void viewPolicy(policy)}
                  disabled={openingPolicyId === text(policy.id, "")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054] transition-colors hover:bg-[#f5f7fa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openingPolicyId === text(policy.id, "") ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : (
                    <FileText size={13} />
                  )}
                  {openingPolicyId === text(policy.id, "") ? "Opening PDF..." : "View PDF"}
                </button>
                {canManage && (
                  <ActionIcon
                    label="Delete policy"
                    tone="red"
                    confirmationDescription={`Delete "${text(policy.title)}"?`}
                    onClick={() => void removePolicy(policy)}
                  >
                    <Trash2 size={15} />
                  </ActionIcon>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center">
          <Empty>No company policies have been uploaded yet.</Empty>
        </div>
      )}
      </section>

      {announcementOpen && (
        <Dialog
          title={editingAnnouncement ? "Edit Announcement" : "New Announcement"}
          fields={[
            { key: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Office schedule update" },
            { key: "message", label: "Message", type: "textarea", required: true, placeholder: "Write the announcement for your team." },
          ]}
          values={announcementValues}
          setValues={setAnnouncementValues}
          save={() => void saveAnnouncement()}
          close={closeAnnouncement}
          saving={saving}
          saveLabel={editingAnnouncement ? "Update Announcement" : "Post Announcement"}
          className="max-w-xl"
        />
      )}

      {addOpen && (
        <Dialog
          title="Add Policy"
          fields={[
            {
              key: "title",
              label: "Title",
              type: "text",
              required: true,
              placeholder: "e.g. Company credit terms",
            },
          ]}
          values={values}
          setValues={setValues}
          save={() => void addPolicy()}
          close={resetForm}
          saving={saving}
          saveLabel="Upload Policy"
          className="max-w-xl"
        >
          <div className="mt-4 rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4">
            <p className="text-[12px] font-medium text-[#202938]">
              Policy Document
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex h-8 cursor-pointer items-center rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054] hover:bg-[#f5f7fa]">
                <Plus size={13} className="mr-1" /> Choose PDF
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) =>
                    setPdfFile(event.target.files?.[0] ?? null)
                  }
                />
              </label>
              {pdfFile ? (
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-[#d9e0e9] bg-white px-2.5 py-1 text-[12px] text-[#344054]">
                  <FileText size={13} className="shrink-0" />
                  <span className="min-w-0 truncate">{pdfFile.name}</span>
                </span>
              ) : (
                <span className="text-[12px] text-[#8b92a1]">
                  No PDF selected.
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-[#8b92a1]">
              Upload a PDF document up to 10 MB.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PriceQuotationMockups({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
}) {
  const canEdit = canReviewPriceQuotations(role);
  const approvedQuotations = store.quotations
    .filter(
      (quote) =>
        text(quote.document_type) === "price_quotation" &&
        !quote.costing_source_id &&
        text(quote.status) === "approved",
    )
    .sort((left, right) => text(right.approved_at ?? right.created_at).localeCompare(text(left.approved_at ?? left.created_at)));

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [viewQuoteId, setViewQuoteId] = useState<string | null>(null);
  const [mockupStatus, setMockupStatus] = useState("ongoing");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<{ id: string; image_url: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const editorQuote = approvedQuotations.find((q) => q.id === editingQuoteId) ?? null;
  const mockupsFor = (quoteId: string) =>
    store.price_quotation_mockups
      .filter((m) => m.quotation_id === quoteId)
      .sort((left, right) => text(left.created_at).localeCompare(text(right.created_at)));
  const mockupImagesFor = (quoteId: string) => mockupsFor(quoteId).map((m) => text(m.image_url));
  const mockupStatusFor = (quoteId: string) => {
    const list = mockupsFor(quoteId);
    return list.length ? text(list[0].status, "ongoing") : "ongoing";
  };

  const openAdd = () => {
    if (approvedQuotations.length === 0) {
      notice("No approved Price Quotations yet. Approve a Price Quotation to add a mockup.");
      return;
    }
    setEditingQuoteId(null);
    setMockupStatus("ongoing");
    setExistingImages([]);
    setImageFiles([]);
    setImagePreviews([]);
    setEditorOpen(true);
  };

  const openEdit = (quoteId: string) => {
    const list = mockupsFor(quoteId);
    setEditingQuoteId(quoteId);
    setMockupStatus(mockupStatusFor(quoteId));
    setExistingImages(list.map((m) => ({ id: text(m.id), image_url: text(m.image_url) })));
    setImageFiles([]);
    setImagePreviews([]);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingQuoteId(null);
    imagePreviews.forEach((preview) => URL.revokeObjectURL(preview));
    setImagePreviews([]);
    setImageFiles([]);
  };

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const remaining = 20 - existingImages.length - imageFiles.length;
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxSize = 10 * 1024 * 1024;
    const valid: File[] = [];
    for (let i = 0; i < files.length && valid.length < remaining; i++) {
      const file = files[i];
      if (!validTypes.includes(file.type)) {
        notice(`Skipped ${file.name}: only JPEG, PNG, or WebP files are accepted.`);
        continue;
      }
      if (file.size > maxSize) {
        notice(`Skipped ${file.name}: file exceeds 10 MB limit.`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length < files.length && remaining <= 0) notice("Maximum 20 images allowed per quotation.");
    setImageFiles((prev) => [...prev, ...valid]);
    setImagePreviews((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))]);
  };

  const removeExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index: number) => {
    URL.revokeObjectURL(imagePreviews[index]);
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!editorQuote) return notice("Select an approved Price Quotation first.");
    const totalImageCount = existingImages.length + imageFiles.length;
    if (totalImageCount === 0) return notice("Upload at least one mockup image.");
    setSaving(true);
    const client = createClient();
    try {
      const allImageUrls: { image_url: string }[] = existingImages.map((img) => ({ image_url: img.image_url }));
      for (const file of imageFiles) {
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${orgId}/price-quotation-mockups/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage
          .from("quotation-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        allImageUrls.push({ image_url: client.storage.from("quotation-images").getPublicUrl(path).data.publicUrl });
      }
      const { error } = await client.rpc("save_price_quotation_mockups", {
        p_quotation_id: editorQuote.id,
        p_images: allImageUrls,
        p_status: mockupStatus,
      });
      if (error) throw error;
      notice("Mockup images saved successfully.");
      closeEditor();
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to save mockups.");
    }
    setSaving(false);
  };

  const editorTotal = existingImages.length + imageFiles.length;
  const editorLead = editorQuote ? store.leads.find((l) => l.id === editorQuote.lead_id) : null;
  const editorItems = editorQuote
    ? store.quotation_items.filter((item) => item.quotation_id === editorQuote.id).sort((left, right) => n(left.sort_order) - n(right.sort_order))
    : [];
  const viewQuote = approvedQuotations.find((q) => q.id === viewQuoteId) ?? null;
  const viewImages = viewQuote ? mockupImagesFor(text(viewQuote.id)) : [];

  return (
    <Panel
      title={canEdit ? "Price Quotation Mockups" : "Price Quotation Mockups (View Only)"}
      detail={canEdit ? "Upload production mockup images for approved price quotations and track their status." : "View mockup images and status for your approved price quotations."}
      variant="page"
      hideHeading
      action={canEdit ? (
        <Button onClick={openAdd}>
          <Plus size={14} /> Add Mockup
        </Button>
      ) : undefined}
    >
      {approvedQuotations.length ? (
        <div className="px-4 py-4 sm:px-5 lg:px-6">
          <Table labels={["Price Quotation", "Client's Name", "Company Name", "Approved", "Mockup Status", "Actions"]} minWidth={860} className="!w-full">
            {approvedQuotations.map((quote) => {
              const lead = store.leads.find((item) => item.id === quote.lead_id);
              const party = quotationParty(quote, store);
              const mockupStatus = mockupStatusFor(text(quote.id));
              return (
                <tr key={text(quote.id)}>
                  <td className="px-5 py-3">{stackedCell(quote.quotation_no, text(quote.project_name, text(lead?.project_name)))}</td>
                  <td className="px-5 py-3 font-medium">{party.clientName}</td>
                  <td className="px-5 py-3">{party.companyName}</td>
                  <td className="px-5 py-3">{day(quote.approved_at ?? quote.issue_date)}</td>
                  <td className="px-5 py-3"><MockupStatusBadge value={mockupStatus} /></td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1">
                      <ActionIcon label="View mockup images" confirm={false} onClick={() => setViewQuoteId(text(quote.id))}><ImageIcon size={15} /></ActionIcon>
                      {canEdit && <ActionIcon label="Edit mockup" onClick={() => openEdit(text(quote.id))}><Pencil size={15} /></ActionIcon>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      ) : (
        <div className="px-4 py-10 text-center">
          <Empty>No approved Price Quotations yet. {canEdit ? "Approve a Price Quotation to add a mockup." : "Mockups appear here once approvals are made."}</Empty>
        </div>
      )}

      {canEdit && editorOpen && (
        <Dialog
          title={editingQuoteId ? "Edit Mockup" : "Add Mockup"}
          fields={[]}
          values={{}}
          setValues={() => undefined}
          save={() => void save()}
          close={closeEditor}
          saving={saving}
          saveLabel="Save Mockup"
          className="max-w-3xl"
        >
          <div>
            <label className="block text-[12px] font-medium text-[#202938]">Price Quotation</label>
            {editingQuoteId ? (
              <p className="mt-1 text-[13px] font-medium text-[#202938]">{text(editorQuote?.quotation_no)} — {text(editorQuote?.client_name)}</p>
            ) : (
              <select
                value={editingQuoteId ?? ""}
                onChange={(event) => setEditingQuoteId(event.target.value || null)}
                className="input mt-1"
              >
                <option value="">Select an approved Price Quotation</option>
                {approvedQuotations.map((quote) => (
                  <option key={text(quote.id)} value={text(quote.id)}>{text(quote.quotation_no)} — {text(quote.client_name, "Client")}</option>
                ))}
              </select>
            )}
          </div>

          {editorQuote && (
            <div className="mt-4 grid gap-4 rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4 sm:grid-cols-2">
              <div><p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Client</p><p className="mt-1 text-[13px] font-medium text-[#202938]">{text(editorQuote.client_name, "—")}</p></div>
              <div><p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Project Type</p><p className="mt-1 text-[13px] font-medium text-[#202938]">{text(editorLead?.project_type, "—")}</p></div>
              {editorItems.length > 0 && (
                <div className="sm:col-span-2 overflow-x-auto">
                  <Table labels={["#", "Description", "Qty"]} minWidth={0} compact className="table-fixed" columnWidths={["8%", "74%", "18%"]}>
                    {editorItems.map((item, index) => (
                      <tr key={text(item.id)}>
                        <td className="px-3 py-2 text-center">{index + 1}</td>
                        <td className="material-description-cell min-w-0 px-3 py-2 text-[12px]">{text(item.description)}</td>
                        <td className="px-3 py-2 text-center">{n(item.quantity).toLocaleString()}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </div>
          )}

          {editorQuote && (
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#202938]">Mockup Images ({editorTotal}/20)</h3>
                  <p className="mt-0.5 text-[11px] text-[#687386]">Upload JPEG, PNG, or WebP images up to 10 MB each.</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex h-8 cursor-pointer items-center rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054] hover:bg-[#f5f7fa]">
                    <Plus size={13} className="mr-1" /> Add Images
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => { addImages(event.target.files); event.target.value = ""; }} />
                  </label>
                  <label className="flex h-8 items-center gap-2 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054]">
                    Status
                    <select value={mockupStatus} onChange={(event) => setMockupStatus(event.target.value)} className="border-0 bg-transparent text-[12px] outline-none">
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                </div>
              </div>

              {(existingImages.length > 0 || imagePreviews.length > 0) && (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {existingImages.map((img) => (
                    <div key={img.id} className="group relative overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc]">
                      <img src={img.image_url} alt="Mockup" className="aspect-square w-full object-cover" />
                      <button type="button" onClick={() => removeExistingImage(existingImages.indexOf(img))} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-[#151922]/60 text-white opacity-0 transition-opacity hover:bg-[#151922]/80 group-hover:opacity-100" aria-label="Remove saved image"><X size={12} /></button>
                    </div>
                  ))}
                  {imagePreviews.map((preview, index) => (
                    <div key={preview} className="group relative overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc]">
                      <img src={preview} alt={`Upload ${index + 1}`} className="aspect-square w-full object-cover" />
                      <button type="button" onClick={() => removeNewImage(index)} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-[#151922]/60 text-white opacity-0 transition-opacity hover:bg-[#151922]/80 group-hover:opacity-100" aria-label="Remove new image"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {editorTotal === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-[#ccd5e0] bg-white py-8 text-center">
                  <ImageIcon className="mx-auto text-[#c4ccd8]" size={28} />
                  <p className="mt-2 text-[12px] text-[#687386]">No mockup images uploaded yet.</p>
                  <p className="mt-1 text-[11px] text-[#8b92a1]">Click &quot;Add Images&quot; to upload production mockups.</p>
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}

      {viewQuote && viewImages.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-[#151922]/35 p-4">
          <section className="mx-auto my-4 w-full max-w-3xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
              <div>
                <h2 className="text-[17px] font-semibold text-[#202938]">{text(viewQuote.quotation_no)} — Mockups</h2>
                <p className="mt-1 text-[12px] text-[#687386]">{text(viewQuote.client_name)} · <MockupStatusBadge value={mockupStatusFor(text(viewQuote.id))} /></p>
              </div>
              <button type="button" onClick={() => setViewQuoteId(null)} aria-label="Close" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {viewImages.map((url, index) => (
                <div key={`${url}-${index}`} className="overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc]">
                  <img src={url} alt={`Mockup ${index + 1}`} className="aspect-square w-full object-cover" />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Panel>
  );
}

function MockupQuotationWorkspace({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
  }) {
  type RequestItem = {
    id: string;
    description: string;
    quantity: string;
  };
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const defaultStatusTab = memberRole(role)
    ? "approved"
    : isPricingOfficerRole(role)
      ? "pending"
      : "draft";
  const [statusTab, setStatusTab] = useState<"draft" | "pending" | "needs_revision" | "pending_gm_approval" | "approved">(defaultStatusTab);
  const [mockupQuery, setMockupQuery] = useState("");
  const [mockupMonth, setMockupMonth] = useState("");
  const [mockupOfficerFilter, setMockupOfficerFilter] = useState("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Row | null>(null);
  const [sourceQuotationId, setSourceQuotationId] = useState("");
  const [requestItems, setRequestItems] = useState<RequestItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const [revisionNoteQuote, setRevisionNoteQuote] = useState<Row | null>(null);
  const [pdfQuote, setPdfQuote] = useState<Row | null>(null);
  const [pdfWindow, setPdfWindow] = useState<Window | null>(null);
  const [printAfterOpen, setPrintAfterOpen] = useState(false);
  const [proofQuote, setProofQuote] = useState<Row | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<Row | null>(null);
  const canPrepare = isProjectOfficerRole(role);
  const canReview = isPricingOfficerRole(role);
  const isGeneralManager = memberRole(role);

  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const mockupQuotations = store.quotations
    .filter((quote) => text(quote.document_type) === "mockup_quotation")
    .sort(newestActivityFirst);
  const sourceQuotations = store.quotations
    .filter(
      (quote) =>
        text(quote.document_type) === "price_quotation" &&
        !quote.costing_source_id &&
        text(quote.status) === "approved" &&
        [quote.created_by, quote.prepared_by_user_id].some(
          (userId) => text(userId, "") === currentUserId,
        ),
    )
    .sort(newestActivityFirst);
  const activeSourceIds = new Set(
    mockupQuotations
      .filter((quote) =>
        ["draft", "pending", "needs_revision", "pending_gm_approval", "approved"].includes(
          text(quote.status),
        ),
      )
      .map((quote) => text(quote.source_price_quotation_id, "")),
  );
  const availableSourceQuotations = sourceQuotations.filter(
    (quote) => !activeSourceIds.has(text(quote.id, "")),
  );
  const sourceFor = (quote: Row) =>
    store.quotations.find((source) => source.id === quote.source_price_quotation_id);
  const itemRowsFor = (quotationId: string) =>
    store.quotation_items
      .filter((item) => item.quotation_id === quotationId)
      .sort((left, right) => n(left.sort_order) - n(right.sort_order));
  const isOwner = (quote: Row) =>
    [quote.created_by, quote.prepared_by_user_id].some(
      (userId) => text(userId, "") === currentUserId,
    );
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  const mockupOfficerId = (quote: Row) => {
    const source = sourceFor(quote);
    return text(
      source?.prepared_by_user_id ??
        source?.created_by ??
        quote.prepared_by_user_id ??
        quote.created_by ??
        quote.submitted_by,
      "",
    );
  };
  const pendingPricing = mockupQuotations.filter(
    (quote) => text(quote.status) === "pending" && !isOwner(quote),
  );
  const filteredQuotations = mockupQuotations.filter((quote) => {
    if (text(quote.status) !== statusTab) return false;
    const source = sourceFor(quote);
    const party = quotationParty(quote, store);
    const date = text(quote.submitted_at ?? quote.created_at, "");
    if (mockupMonth && date.slice(0, 7) !== mockupMonth) return false;
    if (mockupOfficerFilter !== "all" && mockupOfficerId(quote) !== mockupOfficerFilter) return false;
    const normalizedQuery = mockupQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [
      quote.quotation_no,
      source?.quotation_no,
      party.clientName,
      party.companyName,
      quote.project_name,
      quote.project_types,
      store.profiles.find((profile) => profile.id === mockupOfficerId(quote))?.full_name,
    ].some((value) => text(value, "").toLowerCase().includes(normalizedQuery));
  });
  const resetRequest = () => {
    setRequestOpen(false);
    setEditingQuote(null);
    setSourceQuotationId("");
    setRequestItems([]);
  };
  const selectSource = (sourceId: string) => {
    setSourceQuotationId(sourceId);
    setRequestItems(sourceId ? [newRequestItem()] : []);
  };
  const newRequestItem = (): RequestItem => ({
    id: `mockup-item-${crypto.randomUUID()}`,
    description: "",
    quantity: "",
  });
  const openRequest = () => {
    if (!availableSourceQuotations.length) {
      return notice(
        "No approved Price Quotations are available for a new Mockup Quotation. Each source can have one active Mockup Quotation.",
      );
    }
    setEditingQuote(null);
    setSourceQuotationId("");
    setRequestItems([]);
    setRequestOpen(true);
  };
  const openEdit = (quote: Row) => {
    const source = sourceFor(quote);
    if (!source?.id) return notice("The approved source Price Quotation could not be found.");
    const quoteItems = itemRowsFor(text(quote.id));
    setEditingQuote(quote);
    setSourceQuotationId(text(source.id));
    setRequestItems(
      quoteItems.length
        ? quoteItems.map((item) => ({
            id: text(item.id, `mockup-item-${crypto.randomUUID()}`),
            description: text(item.description, ""),
            quantity: text(item.quantity, ""),
          }))
        : [newRequestItem()],
    );
    setRequestOpen(true);
  };
  const openPdf = (quote: Row, shouldPrint = false) => {
    if (text(quote.status) !== "approved") {
      return notice("Only approved quotations can be opened as PDFs.");
    }
    const nextWindow = window.open("about:blank", "_blank");
    if (!nextWindow) return notice("Allow pop-ups to open the quotation PDF.");
    nextWindow.opener = null;
    setPrintAfterOpen(shouldPrint);
    setPdfWindow(nextWindow);
    setPdfQuote(quote);
  };
  const saveDraft = async () => {
    const source = store.quotations.find((quote) => quote.id === sourceQuotationId);
    if (!source) return notice("Select an approved Price Quotation first.");
    if (
      requestItems.length === 0 ||
      requestItems.some((item) => !item.description.trim() || n(item.quantity) <= 0)
    ) {
      return notice("Each Mockup Quotation item needs a description and quantity greater than zero.");
    }
    setSaving(true);
    const client = createClient();
    try {
      const wasEditing = Boolean(editingQuote);
      const { error } = await client.rpc("save_mockup_quotation_draft", {
        p_mockup_quotation_id: editingQuote?.id ?? null,
        p_source_price_quotation_id: source.id,
        p_items: requestItems.map((item) => ({
          description: item.description,
          quantity: n(item.quantity),
        })),
      });
      if (error) throw error;
      resetRequest();
      setStatusTab("draft");
      notice(wasEditing ? "Mockup Quotation updated." : "Mockup Quotation draft created.");
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Mockup Quotation could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const submit = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("submit_mockup_quotation", {
      p_mockup_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Mockup Quotation submitted to the assigned Sales & Pricing Officer.");
    await reload();
  };
  const unsubmit = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("unsubmit_mockup_quotation", {
      p_mockup_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    setStatusTab("draft");
    notice("Mockup Quotation returned to draft.");
    await reload();
  };
  const beginRevision = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("begin_mockup_quotation_revision", {
      p_mockup_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    await reload();
    setStatusTab("needs_revision");
    openEdit({ ...quote, status: "needs_revision" });
    notice("Update the Mockup Quotation, then submit it to the assigned Sales & Pricing Officer.");
  };
  const documentName = (quote: Row) =>
    text(quote.document_type) === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation";
  return (
    <Panel
      title="Mockup Quotation"
      detail={
        canReview
          ? "Review Mockup Quotation requests assigned to your project types, add independent costing, and submit them to the General Manager."
          : canPrepare
            ? "Select an approved Price Quotation, enter separate mockup requirements, and submit an independent Mockup Quotation request."
            : "Review Mockup Quotation statuses and approved documents."
      }
      variant="page"
      hideHeading
      action={
        canPrepare ? (
          <Button onClick={openRequest}>
            <Plus size={14} /> Request Mockup Quotation
          </Button>
        ) : undefined
      }
    >
      <div className="px-4 py-4 sm:px-5 lg:px-6">
        <div className="mb-4">
          <nav aria-label="Mockup quotation statuses" className="app-tabs">
            {([
              ["draft", "Draft"],
              ["pending", "Pending Review"],
              ["needs_revision", "Needs Revision"],
              ["pending_gm_approval", "GM Review"],
              ["approved", "Approved"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusTab(value)}
                aria-current={statusTab === value ? "page" : undefined}
                className="app-tab"
              >
                {label} ({mockupQuotations.filter((quote) => text(quote.status) === value).length})
              </button>
            ))}
          </nav>
          <WorkspaceListFilters
            query={mockupQuery}
            onQueryChange={setMockupQuery}
            queryPlaceholder="Search quotation, client, project, or staff"
            month={mockupMonth}
            onMonthChange={setMockupMonth}
            monthLabel="Submission month"
            showOfficer={isGeneralManager}
            officerFilter={mockupOfficerFilter}
            onOfficerChange={setMockupOfficerFilter}
            officerOptions={projectOfficers}
            onClear={() => {
              setMockupQuery("");
              setMockupMonth("");
              setMockupOfficerFilter("all");
            }}
            hasFilters={Boolean(mockupQuery || mockupMonth || mockupOfficerFilter !== "all")}
          />
          {canReview && (
            <p className="border-b border-[#edf0f5] py-3 text-[12px] text-[#687386]">
              {pendingPricing.length
                ? pendingPricing.length + " Mockup Quotation request" + (pendingPricing.length === 1 ? "" : "s") + " are waiting in your assigned project-type queue."
                : "Pending Mockup Quotation requests for your assigned project types will appear here."}
            </p>
          )}
        </div>
        {filteredQuotations.length ? (
          <div className="modern-table-shell">
          <Table
            labels={["Mockup Quotation", "Source Price Quotation", "Client", "Project Type", "Payment", "Status", "Date", "Actions"]}
            minWidth={1220}
            className="!w-full"
          >
            {filteredQuotations.map((quote) => {
              const source = sourceFor(quote);
              const party = quotationParty(quote, store);
              const owner = isOwner(quote);
              const status = text(quote.status);
              const pricingOfficerRevision = isPricingOfficerRevision(quote);
              const proofCount = store.quotation_signed_proofs.filter(
                (proof) => proof.quotation_id === quote.id,
              ).length;
              const paymentSummary = quotationPaymentSummary(
                quote,
                store.quotation_payment_records.filter((record) => record.quotation_id === quote.id),
              );
              return (
                <tr key={text(quote.id)}>
                  <td className="px-5 py-3">{stackedCell(quote.quotation_no, quote.project_name)}</td>
                  <td className="px-5 py-3">
                    {source?.id ? (
                      <button type="button" onClick={() => openPdf(source)} className="font-medium text-[#1769e8] underline decoration-[#b9d2fb] underline-offset-2 hover:text-[#1256bf]">
                        {text(source.quotation_no)}
                      </button>
                    ) : (
                      text(quote.source_price_quotation_id)
                    )}
                  </td>
                  <td className="px-5 py-3">{stackedCell(party.clientName, party.companyName)}</td>
                  <td className="px-5 py-3">{text(quote.project_types)}</td>
                  <td className="px-5 py-3">{paymentSummary ? <div><PaymentStatusBadge status={paymentSummary.status} /><small>{peso.format(paymentSummary.verified)} / {peso.format(paymentSummary.total)}</small></div> : "-"}</td>
                  <td className="px-5 py-3"><div className="flex items-center gap-1.5"><Status value={status} />{status === "needs_revision" && <NoteAction label="View revision note" tone="amber" onClick={() => setRevisionNoteQuote(quote)} />}</div></td>
                  <td className="px-5 py-3">{day(status === "approved" ? quote.approved_at : quote.submitted_at ?? quote.created_at)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {canReview && status === "pending" && (
                        <ActionIcon label="Review Mockup Quotation" confirm={false} onClick={() => setReviewing(quote)}><FileText size={15} /></ActionIcon>
                      )}
                      {canPrepare && owner && !pricingOfficerRevision && ["draft", "needs_revision"].includes(status) && (
                        <ActionIcon label="Edit Mockup Quotation" confirm={false} onClick={() => openEdit(quote)}><Pencil size={15} /></ActionIcon>
                      )}
                      {canPrepare && owner && !pricingOfficerRevision && ["draft", "needs_revision"].includes(status) && (
                        <ActionIcon label="Submit to Sales & Pricing Officer" tone="green" loading={saving} disabled={saving} onClick={() => void submit(quote)}><Send size={15} /></ActionIcon>
                      )}
                      {canPrepare && owner && status === "pending" && (
                        <ActionIcon label="Unsubmit and return to draft" tone="amber" loading={saving} disabled={saving} onClick={() => void unsubmit(quote)}><RotateCcw size={15} /></ActionIcon>
                      )}
                      {canPrepare && owner && status === "approved" && (
                        <ActionIcon label="Edit and resubmit Mockup Quotation" tone="amber" loading={saving} disabled={saving} onClick={() => void beginRevision(quote)}><RotateCcw size={15} /></ActionIcon>
                      )}
                      {status === "approved" && (
                        <ActionIcon label={"View " + documentName(quote) + " PDF"} confirm={false} onClick={() => openPdf(quote)}><FileText size={15} /></ActionIcon>
                      )}
                      {status === "approved" && (
                        <ActionIcon label={"Print " + documentName(quote)} confirm={false} onClick={() => openPdf(quote, true)}><Printer size={15} /></ActionIcon>
                      )}
                      {status === "approved" && (
                        <ActionIcon label={"View signed client proof" + (proofCount ? " (" + proofCount + "/5)" : "")} confirm={false} onClick={() => setProofQuote(quote)}><Paperclip size={15} /></ActionIcon>
                      )}
                      {status === "approved" && (
                        <ActionIcon label="View Mockup Quotation payments" confirm={false} onClick={() => setPaymentQuote(quote)}><ReceiptText size={15} /></ActionIcon>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
          </div>
        ) : (
          <Empty>
            {mockupQuotations.length
              ? "No Mockup Quotations match the selected filters."
              : canPrepare
                ? "No Mockup Quotations yet. Request one from an approved Price Quotation."
                : "No Mockup Quotations are visible for this account."}
          </Empty>
        )}
      </div>
      {requestOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/30 p-4">
          <section className="mx-auto my-4 w-full max-w-3xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
              <div>
                <h2 className="text-[17px] font-semibold text-[#202938]">{editingQuote ? "Edit Mockup Quotation" : "Request Mockup Quotation"}</h2>
                <p className="mt-1 text-[12px] text-[#687386]">Choose one approved Price Quotation. The project type is inherited and the costing is calculated independently.</p>
              </div>
              <button type="button" onClick={resetRequest} aria-label="Close Mockup Quotation request" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button>
            </div>
            <label className="mt-5 block text-[12px] font-medium text-[#202938]">
              Approved Price Quotation
              <select
                value={sourceQuotationId}
                disabled={Boolean(editingQuote)}
                onChange={(event) => selectSource(event.target.value)}
                className="input mt-1"
              >
                <option value="">Select an approved Price Quotation</option>
                {(editingQuote ? [sourceFor(editingQuote)].filter(Boolean) : availableSourceQuotations).map((source) => (
                  <option key={text(source?.id)} value={text(source?.id)}>{text(source?.quotation_no)} - {text(source?.client_name, "Client")}</option>
                ))}
              </select>
            </label>
            {sourceQuotationId && (
              <div className="mt-4 grid gap-3 rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4 sm:grid-cols-3">
                <div><p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Client</p><p className="mt-1 text-[13px] font-medium text-[#202938]">{text(store.quotations.find((quote) => quote.id === sourceQuotationId)?.client_name, "—")}</p></div>
                <div><p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Project Type</p><p className="mt-1 text-[13px] font-medium text-[#202938]">{text(store.quotations.find((quote) => quote.id === sourceQuotationId)?.project_types, "—")}</p></div>
                <div><p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Source ID</p><p className="mt-1 text-[13px] font-medium text-[#202938]">{text(store.quotations.find((quote) => quote.id === sourceQuotationId)?.quotation_no, "—")}</p></div>
              </div>
            )}
            {sourceQuotationId && requestItems.length > 0 && (
              <section className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <div><h3 className="text-[14px] font-semibold text-[#202938]">Mockup requirements</h3><p className="mt-1 text-[12px] text-[#687386]">Enter descriptions and quantities separately for this Mockup Quotation. The source Price Quotation remains unchanged.</p></div>
                  <Button secondary onClick={() => setRequestItems((current) => [...current, newRequestItem()])}><Plus size={13} /> Add item</Button>
                </div>
                <Table labels={["#", "Description", "Quantity", "Actions"]} minWidth={0} className="mt-3 table-fixed" columnWidths={["8%", "62%", "20%", "10%"]}>
                  {requestItems.map((item, index) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-center">{index + 1}</td>
                      <td className="px-3 py-2"><textarea rows={2} aria-label={"Mockup item " + (index + 1) + " description"} value={item.description} onChange={(event) => setRequestItems((current) => current.map((value) => value.id === item.id ? { ...value, description: titleCase(event.target.value) } : value))} className="input mt-0 min-h-[58px] resize-y" /></td>
                      <td className="px-3 py-2"><input aria-label={"Mockup item " + (index + 1) + " quantity"} type="number" min="0.001" step="any" value={item.quantity} onChange={(event) => setRequestItems((current) => current.map((value) => value.id === item.id ? { ...value, quantity: event.target.value } : value))} className="input mt-0 text-center" /></td>
                      <td className="px-3 py-2 text-center"><ActionIcon label={"Remove mockup item " + (index + 1)} confirm={false} disabled={requestItems.length === 1} onClick={() => setRequestItems((current) => current.length === 1 ? current : current.filter((value) => value.id !== item.id))}><Trash2 size={15} /></ActionIcon></td>
                    </tr>
                  ))}
                </Table>
              </section>
            )}
            <div className="mt-6 flex justify-end gap-2 border-t border-[#edf0f5] pt-4">
              <Button secondary disabled={saving} onClick={resetRequest}>Cancel</Button>
              <Button loading={saving} disabled={saving || !sourceQuotationId || requestItems.length === 0} onClick={() => void saveDraft()}>
                {editingQuote ? "Save Mockup Quotation" : "Save Mockup Quotation Draft"}
              </Button>
            </div>
          </section>
        </div>
      )}
      <NoteDialog
        open={Boolean(revisionNoteQuote)}
        title="Revision note"
        context={revisionNoteQuote ? text(revisionNoteQuote.quotation_no, "Mockup Quotation") : undefined}
        note={text(revisionNoteQuote?.revision_note, "")}
        titleId="mockup-quotation-revision-note-title"
        onClose={() => setRevisionNoteQuote(null)}
      />
      {reviewing && (
        <PriceQuotationReview
          quotation={reviewing}
          quotationKind="mockup_quotation"
          store={store}
          saving={false}
          finalApproval={isGeneralManager}
          close={() => setReviewing(null)}
          notice={notice}
          reload={reload}
        />
      )}
      {pdfQuote && <QuotationDocument quote={pdfQuote} store={store} close={() => { setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); }} onPdfError={(message) => { if (pdfWindow && !pdfWindow.closed) pdfWindow.close(); setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); notice(message); }} autoExportPdf pdfWindow={pdfWindow} printAfterOpen={printAfterOpen} hidden showInternalCosting={isGeneralManager} />}
      {proofQuote && <SignedProofDialog quote={proofQuote} store={store} canUpload={isProjectOfficerRole(role) && isOwner(proofQuote)} close={() => setProofQuote(null)} notice={notice} reload={reload} />}
      {paymentQuote && <QuotationPaymentDialog quote={paymentQuote} store={store} orgId={orgId} role={role} close={() => setPaymentQuote(null)} reload={reload} />}
    </Panel>
  );
}

type SignedProofUploadStatus = "queued" | "uploading" | "complete" | "failed";
type SignedProofUpload = {
  id: string;
  fileName: string;
  status: SignedProofUploadStatus;
};

function SignedProofDialog({
  quote,
  store,
  canUpload,
  close,
  notice,
  reload,
}: {
  quote: Row;
  store: Store;
  canUpload: boolean;
  close: () => void;
  notice: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<SignedProofUpload[]>([]);
  const proofs = useMemo(
    () =>
      store.quotation_signed_proofs
        .filter((proof) => proof.quotation_id === quote.id)
        .sort((left, right) => n(left.sort_order) - n(right.sort_order)),
    [quote.id, store.quotation_signed_proofs],
  );
  const proofKey = proofs
    .map((proof) => `${text(proof.id)}:${text(proof.storage_path)}`)
    .join("|");
  useEffect(() => {
    let active = true;
    const loadUrls = async () => {
      const client = createClient();
      const results = await Promise.all(
        proofs.map(async (proof) => {
          const { data, error } = await client.storage
            .from("quotation-signed-proofs")
            .createSignedUrl(text(proof.storage_path), 5 * 60);
          return error || !data?.signedUrl
            ? null
            : [text(proof.id), data.signedUrl] as const;
        }),
      );
      if (active) setSignedUrls(Object.fromEntries(results.filter(Boolean) as [string, string][]));
    };
    void loadUrls();
    return () => {
      active = false;
    };
  }, [proofKey, proofs, quote.id]);
  const addFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const selected = Array.from(fileList).map((file) => ({
      file,
      id: crypto.randomUUID(),
    }));
    if (!selected.length) return;
    const remaining = 5 - proofs.length;
    if (selected.length > remaining) {
      return notice("You can upload up to five signed proof files. " + remaining + " slot" + (remaining === 1 ? "" : "s") + " remaining.");
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const invalid = selected.find(({ file }) => !validTypes.includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) return notice("Signed proofs must be JPEG, PNG, WebP, or PDF files no larger than 10 MB each.");
    setPendingUploads(selected.map(({ file, id }) => ({ id, fileName: file.name, status: "queued" })));
    setUploading(true);
    const client = createClient();
    let activeUploadId: string | null = null;
    try {
      for (const { file, id } of selected) {
        activeUploadId = id;
        setPendingUploads((current) => current.map((upload) => upload.id === id ? { ...upload, status: "uploading" } : upload));
        const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = text(quote.organization_id) + "/" + text(quote.id) + "/" + id + "." + extension;
        const { error: uploadError } = await client.storage.from("quotation-signed-proofs").upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: registerError } = await client.rpc("register_quotation_signed_proof", {
          p_quotation_id: quote.id,
          p_storage_path: path,
          p_file_name: file.name,
          p_content_type: file.type,
          p_file_size: file.size,
        });
        if (registerError) {
          await client.storage.from("quotation-signed-proofs").remove([path]);
          throw registerError;
        }
        setPendingUploads((current) => current.map((upload) => upload.id === id ? { ...upload, status: "complete" } : upload));
      }
      activeUploadId = null;
      notice("Signed client proof file uploaded privately.");
      await reload();
      setPendingUploads([]);
    } catch (error) {
      if (activeUploadId) {
        setPendingUploads((current) => current.map((upload) => upload.status === "complete" ? upload : { ...upload, status: "failed" }));
      }
      notice(error instanceof Error ? error.message : "The signed proof could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };
  const removeProof = async (proof: Row) => {
    setUploading(true);
    const client = createClient();
    try {
      const { error } = await client.rpc("delete_quotation_signed_proof", { p_proof_id: proof.id });
      if (error) throw error;
      const { error: storageError } = await client.storage.from("quotation-signed-proofs").remove([text(proof.storage_path)]);
      if (storageError) throw storageError;
      notice("Signed client proof removed.");
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "The signed proof could not be removed.");
    } finally {
      setUploading(false);
    }
  };
  const label = text(quote.document_type) === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation";
  const uploadInProgress = pendingUploads.some((upload) => upload.status === "queued" || upload.status === "uploading");
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="signed-proof-title" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="signed-proof-title" className="text-[16px] font-semibold text-[#202938]">Signed client proof</h2><p className="mt-1 text-[12px] text-[#687386]">{label} {text(quote.quotation_no)} · Private attachment, separate from quotation illustrations.</p></div>
          <button type="button" onClick={close} aria-label="Close signed client proof" className="rounded-md p-1 text-[#687386] hover:bg-[#f0f3f7]"><X size={18} /></button>
        </div>
        {canUpload && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3"><div><p className="text-[12px] font-medium text-[#202938]">Upload proof files ({proofs.length}/5)</p><p className="mt-0.5 text-[11px] text-[#687386]">JPEG, PNG, WebP, or PDF · up to 10 MB each</p></div><label aria-busy={uploadInProgress} className={"inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-semibold text-[#344054] hover:bg-[#f5f7fa] " + (proofs.length >= 5 || uploading ? "pointer-events-none opacity-50" : "")}>{uploadInProgress ? <LoaderCircle size={13} className="mr-1 animate-spin" aria-hidden="true" /> : <Paperclip size={13} className="mr-1" />} {uploadInProgress ? "Uploading..." : "Add files"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" disabled={proofs.length >= 5 || uploading} onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} /></label></div>}
        {proofs.length || pendingUploads.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5" aria-live="polite" aria-busy={uploadInProgress}>{proofs.map((proof, index) => <div key={text(proof.id)} className="group relative overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-2"><a href={signedUrls[text(proof.id)]} target="_blank" rel="noreferrer" className="block aspect-square">{signedUrls[text(proof.id)] ? <AttachmentPreview url={signedUrls[text(proof.id)]} contentType={text(proof.content_type)} fileName={text(proof.file_name)} alt={text(proof.file_name, "Signed proof " + (index + 1))} className="size-full rounded-md object-cover" /> : <span className="grid size-full place-items-center text-[11px] text-[#8b92a1]">Loading…</span>}</a><p className="mt-2 truncate text-[11px] text-[#344054]" title={text(proof.file_name)}>{text(proof.file_name)}</p>{canUpload && <button type="button" onClick={() => void removeProof(proof)} disabled={uploading} aria-label={"Remove " + text(proof.file_name, "signed proof " + (index + 1))} className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-white/90 text-[#8b92a1] shadow-sm hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={14} /></button>}</div>)}{pendingUploads.map((upload) => <div key={upload.id} className="overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-2"><div className="grid aspect-square place-items-center rounded-md bg-[#f3f4f6] px-2 text-center" role="status"><div className="flex flex-col items-center gap-2 text-[11px] text-[#687386]">{upload.status === "queued" || upload.status === "uploading" ? <LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> : upload.status === "complete" ? <Check size={20} aria-hidden="true" /> : <XCircle size={20} aria-hidden="true" />}<span>{upload.status === "queued" ? "Waiting..." : upload.status === "uploading" ? "Uploading..." : upload.status === "complete" ? "Uploaded" : "Upload failed"}</span></div></div><p className="mt-2 truncate text-[11px] text-[#344054]" title={upload.fileName}>{upload.fileName}</p></div>)}</div> : <div className="mt-5 rounded-lg border border-dashed border-[#ccd5e0] px-4 py-8 text-center text-[12px] text-[#8b92a1]">{canUpload ? "No signed client proof files uploaded yet." : "No signed client proof is available yet."}</div>}
        <div className="mt-5 flex justify-end"><Button secondary onClick={close}>Close</Button></div>
      </section>
    </div>
  );
}

function SignedProofViewer({
  priceProofs,
  mockupProofs,
  close,
}: {
  priceProofs: Row[];
  mockupProofs: Row[];
  close: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-[#151922]/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="signed-proof-viewer-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="signed-proof-viewer-title" className="text-[16px] font-semibold text-[#202938]">Signed proofs</h2>
            <p className="mt-1 text-[12px] text-[#687386]">Price Quotation and Mockup Quotation proof files.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close signed proofs" className="rounded-md p-1 text-[#687386] hover:bg-[#f0f3f7]"><X size={18} /></button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <SignedProofThumbnails label="Price Quotation proof" proofs={priceProofs} />
          <SignedProofThumbnails label="Mockup Quotation proof" proofs={mockupProofs} />
        </div>
        <div className="mt-5 flex justify-end"><Button secondary onClick={close}>Close</Button></div>
      </section>
    </div>
  );
}

function SignedProofThumbnails({
  label,
  proofs,
  action,
  compact = false,
  priceProofs,
  mockupProofs,
}: {
  label: string;
  proofs: Row[];
  action?: ReactNode;
  compact?: boolean;
  priceProofs?: Row[];
  mockupProofs?: Row[];
}) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const proofKey = proofs
    .map((proof) => `${text(proof.id)}:${text(proof.storage_path)}`)
    .join("|");
  // Keep thumbnail data stable while parent tables re-render around it.
  const proofEntries = useMemo(
    () => proofs.map((proof) => ({
      id: text(proof.id, ""),
      storagePath: text(proof.storage_path, ""),
      fileName: text(proof.file_name, ""),
      contentType: text(proof.content_type, ""),
    })),
    // The serialized proof key is the stable dependency for this derived list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proofKey],
  );

  useEffect(() => {
    let active = true;
    if (compact) {
      return () => {
        active = false;
      };
    }
    if (!proofEntries.length) {
      setSignedUrls({});
      return () => {
        active = false;
      };
    }
    const loadUrls = async () => {
      const client = createClient();
      const entries = await Promise.all(
        proofEntries.map(async (proof) => {
          const proofId = proof.id;
          const storagePath = proof.storagePath;
          if (!proofId || !storagePath) return [proofId, ""] as const;
          const { data, error } = await client.storage
            .from("quotation-signed-proofs")
            .createSignedUrl(storagePath, 300);
          return [proofId, error ? "" : text(data?.signedUrl, "")] as const;
        }),
      );
      if (active) {
        setSignedUrls(
          Object.fromEntries(entries.filter(([id, url]) => id && url)),
        );
      }
    };
    void loadUrls();
    return () => {
      active = false;
    };
  }, [compact, proofEntries]);

  if (compact) {
    return (
      <>
        <ActionIcon
          label={`View ${label}`}
          confirm={false}
          disabled={!proofEntries.length}
          onClick={() => setViewerOpen(true)}
        >
          <Paperclip size={15} />
        </ActionIcon>
        {viewerOpen && (
          <SignedProofViewer
            priceProofs={priceProofs ?? []}
            mockupProofs={mockupProofs ?? []}
            close={() => setViewerOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <section className={compact ? "min-w-24" : "rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3"}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[#344054]">{label}</p>
        {action}
      </div>
      {proofEntries.length ? (
        <div className={`mt-2 flex flex-wrap gap-2 ${compact ? "" : "grid grid-cols-2 sm:grid-cols-3"}`}>
          {proofEntries.map((proof, index) => {
            const proofId = proof.id;
            const signedUrl = signedUrls[proofId];
            return (
              <a
                key={proofId || String(index)}
                href={signedUrl || undefined}
                target={signedUrl ? "_blank" : undefined}
                rel={signedUrl ? "noreferrer" : undefined}
                aria-label={`${label} ${index + 1}`}
                className={`${compact ? "size-10" : "aspect-square min-h-20"} block overflow-hidden rounded-md border border-[#d9e0e9] bg-white`}
              >
                {signedUrl ? (
                  <AttachmentPreview
                    url={signedUrl}
                    contentType={proof.contentType}
                    fileName={proof.fileName}
                    alt={proof.fileName || `${label} ${index + 1}`}
                  />
                ) : (
                  <span className="grid size-full place-items-center text-[10px] text-[#8b92a1]">Loading...</span>
                )}
              </a>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-[#8b92a1]">No signed proof selected.</p>
      )}
    </section>
  );
}

const quotationPaymentKinds = [
  ["downpayment", "Downpayment"],
  ["partial_payment", "Partial payment"],
  ["full_payment", "Full payment"],
] as const;
const quotationPaymentMethods = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
  ["gcash", "GCash"],
  ["card", "Card"],
  ["check", "Check"],
  ["other", "Other"],
] as const;
const quotationPaymentRequirementLabel = (quote: Row) => {
  const requirement = text(quote.payment_requirement, "downpayment");
  if (requirement === "none") return "No payment requirement";
  if (requirement === "full_payment") return "Full payment";
  return `${n(quote.downpayment_rate) || 50}% downpayment`;
};
const quotationPaymentKindLabel = (value: unknown) =>
  quotationPaymentKinds.find(([key]) => key === text(value))?.[1] ?? text(value).replaceAll("_", " ");
const quotationPaymentMethodLabel = (value: unknown) =>
  quotationPaymentMethods.find(([key]) => key === text(value))?.[1] ?? text(value).replaceAll("_", " ");
const roundQuotationPayment = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const quotationPaymentDefaultKind = (
  quote: Row,
  summary?: Pick<QuotationPaymentSummary, "downpaymentRemaining" | "available">,
) => {
  const requirement = text(quote.payment_requirement, "downpayment");
  if (requirement === "full_payment") return "full_payment";
  if (requirement === "downpayment" && (!summary || summary.downpaymentRemaining > 0)) return "downpayment";
  return "partial_payment";
};
const quotationPaymentSuggestedAmount = (
  kind: string,
  summary: Pick<QuotationPaymentSummary, "downpaymentRemaining" | "available">,
) => {
  const amount = kind === "downpayment" ? summary.downpaymentRemaining : kind === "full_payment" ? summary.available : 0;
  return amount > 0 ? roundQuotationPayment(amount).toFixed(2) : "";
};
const quotationPaymentAmountsMatch = (left: number, right: number) =>
  Math.abs(roundQuotationPayment(left) - roundQuotationPayment(right)) < 0.005;
type QuotationPaymentSummary = {
  total: number;
  pending: number;
  verified: number;
  balance: number;
  available: number;
  downpaymentTarget: number;
  downpaymentRemaining: number;
  status: "unpaid" | "pending" | "partial" | "paid" | "overpaid";
};
const quotationPaymentSummary = (quote: Row, records: Row[]): QuotationPaymentSummary => {
  const total = roundQuotationPayment(Math.max(0, n(quote.total_amount)));
  const related = records.filter((record) => record.quotation_id === quote.id);
  const pending = roundQuotationPayment(related
    .filter((record) => text(record.status) === "pending")
    .reduce((sum, record) => sum + n(record.amount), 0));
  const verified = roundQuotationPayment(related
    .filter((record) => text(record.status) === "verified")
    .reduce((sum, record) => sum + n(record.amount), 0));
  const requirement = text(quote.payment_requirement, "downpayment");
  const downpaymentTarget = roundQuotationPayment(requirement === "none"
    ? 0
    : requirement === "full_payment"
      ? total
      : total * (n(quote.downpayment_rate) || 50) / 100);
  const balance = roundQuotationPayment(Math.max(0, total - verified));
  const available = roundQuotationPayment(Math.max(0, total - verified - pending));
  const downpaymentRemaining = roundQuotationPayment(Math.max(0, downpaymentTarget - verified - pending));
  const status = verified > total && total > 0
    ? "overpaid"
    : total > 0 && verified >= total
      ? "paid"
      : pending > 0 && verified <= 0
        ? "pending"
        : verified > 0
          ? "partial"
          : "unpaid";
  return {
    total,
    pending,
    verified,
    balance,
    available,
    downpaymentTarget,
    downpaymentRemaining,
    status,
  };
};
const quotationPaymentStatusLabel = (value: QuotationPaymentSummary["status"]) => ({
  unpaid: "Unpaid",
  pending: "Pending review",
  partial: "Partially paid",
  paid: "Paid",
  overpaid: "Overpaid",
}[value]);
const PaymentStatusBadge = ({ status }: { status: QuotationPaymentSummary["status"] }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle(status === "pending" ? "pending" : status)}`}>
    {quotationPaymentStatusLabel(status)}
  </span>
);

function QuotationPaymentDialog({
  quote,
  store,
  orgId,
  role,
  close,
  reload,
}: {
  quote: Row;
  store: Store;
  orgId: string;
  role: string;
  close: () => void;
  reload: () => Promise<void>;
}) {
  const liveQuote = store.quotations.find((item) => item.id === quote.id) ?? quote;
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const records = useMemo(
    () => store.quotation_payment_records
      .filter((record) => record.quotation_id === liveQuote.id)
      .sort((left, right) => text(right.paid_at ?? right.created_at).localeCompare(text(left.paid_at ?? left.created_at))),
    [liveQuote.id, store.quotation_payment_records],
  );
  const summary = quotationPaymentSummary(liveQuote, records);
  const quotationLabel = text(liveQuote.document_type) === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation";
  const canSubmit = isProjectOfficerRole(role) && text(liveQuote.status) === "approved";
  const canReviewAsManager = memberRole(role);
  const paymentRequirement = text(liveQuote.payment_requirement, "downpayment");
  const initialPaymentKind = quotationPaymentDefaultKind(liveQuote, summary);
  const reviewerForPayment = (payment: Row) =>
    assignedPaymentReviewerId(
      liveQuote,
      payment,
      store.pricing_officer_project_types,
    );
  const canReviewPayment = (payment: Row) =>
    canReviewAsManager ||
    (isPricingOfficerRole(role) &&
      reviewerForPayment(payment) === currentUserId &&
      text(payment.submitted_by, "") !== currentUserId);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [paymentValues, setPaymentValues] = useState({
    payment_kind: initialPaymentKind,
    amount: "",
    paid_at: isoToday(),
    method: "cash",
    reference_no: "",
    notes: "",
  });
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [termsValues, setTermsValues] = useState({
    requirement: text(liveQuote.payment_requirement, "downpayment"),
    rate: text(liveQuote.downpayment_rate, "50"),
  });
  const [workingPaymentId, setWorkingPaymentId] = useState<string | null>(null);
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [noteRequest, setNoteRequest] = useState<{
    payment: Row;
    action: "reject" | "reverse";
  } | null>(null);
  const [notePayment, setNotePayment] = useState<Row | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const paymentKey = records
    .map((record) => `${text(record.id)}:${text(record.receipt_storage_path)}`)
    .join("|");

  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!records.length) {
      setReceiptUrls({});
      return () => {
        active = false;
      };
    }
    const loadReceiptUrls = async () => {
      const client = createClient();
      const entries = await Promise.all(records.map(async (record) => {
        const { data, error } = await client.storage
          .from("quotation-payment-receipts")
          .createSignedUrl(text(record.receipt_storage_path), 5 * 60);
        return [text(record.id), error || !data?.signedUrl ? "" : data.signedUrl] as const;
      }));
      if (active) setReceiptUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    };
    void loadReceiptUrls();
    return () => {
      active = false;
    };
  }, [paymentKey, records]);

  const resetPaymentForm = () => {
    setFormOpen(false);
    setPaymentFile(null);
    setFeedback(null);
    setPaymentValues({
      payment_kind: initialPaymentKind,
      amount: "",
      paid_at: isoToday(),
      method: "cash",
      reference_no: "",
      notes: "",
    });
  };
  const openPaymentForm = () => {
    const kind = quotationPaymentDefaultKind(liveQuote, summary);
    setFeedback(null);
    setPaymentValues({
      payment_kind: kind,
      amount: quotationPaymentSuggestedAmount(kind, summary),
      paid_at: isoToday(),
      method: "cash",
      reference_no: "",
      notes: "",
    });
    setFormOpen(true);
  };
  const changePaymentKind = (kind: string) => {
    setPaymentValues((current) => ({
      ...current,
      payment_kind: kind,
      amount: quotationPaymentSuggestedAmount(kind, summary),
    }));
    setFeedback(null);
  };
  const setError = (message: string) => setFeedback({ tone: "error", message });
  const setSuccess = (message: string) => setFeedback({ tone: "success", message });
  const openNoteRequest = (payment: Row, action: "reject" | "reverse") => {
    setFeedback(null);
    setNoteValue("");
    setNoteRequest({ payment, action });
  };
  const closeNoteRequest = () => {
    if (workingPaymentId) return;
    setNoteRequest(null);
    setNoteValue("");
    setFeedback(null);
  };
  const paymentNotes = (payment: Row) => {
    return [
      { label: "Payment note", value: text(payment.notes, "") },
      { label: "Verification note", value: text(payment.verification_note, "") },
      { label: "Reversal note", value: text(payment.reversal_note, "") },
    ].filter((entry) => entry.value);
  };
  const savePayment = async () => {
    if (!paymentFile) return setError("Upload the client's payment receipt image.");
    const amount = roundQuotationPayment(n(paymentValues.amount));
    if (!paymentValues.amount || amount <= 0) return setError("Enter a payment amount greater than zero.");
    if (!paymentValues.paid_at) return setError("Choose the date the client paid.");
    if (summary.available <= 0) return setError("No unallocated quotation balance remains. Review the pending receipts first.");
    if (paymentValues.payment_kind === "downpayment") {
      if (paymentRequirement !== "downpayment") return setError("Set a downpayment term before recording a downpayment receipt.");
      if (summary.downpaymentRemaining <= 0) return setError("The downpayment target is already covered by verified or pending payments.");
      if (!quotationPaymentAmountsMatch(amount, summary.downpaymentRemaining)) {
        return setError(`Downpayment must be ${peso.format(summary.downpaymentRemaining)} to reach the required target.`);
      }
    } else if (paymentValues.payment_kind === "full_payment") {
      if (!quotationPaymentAmountsMatch(amount, summary.available)) {
        return setError(`Full payment must equal the available balance of ${peso.format(summary.available)} after pending receipts.`);
      }
    } else if (amount >= summary.available) {
      return setError(`Use Full payment for the entire available balance of ${peso.format(summary.available)}.`);
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(paymentFile.type) || paymentFile.size > 10 * 1024 * 1024) {
      return setError("Payment receipts must be JPEG, PNG, or WebP files no larger than 10 MB.");
    }
    setSaving(true);
    const client = createClient();
    const paymentId = crypto.randomUUID();
    const extension = paymentFile.type === "image/png" ? "png" : paymentFile.type === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/${liveQuote.id}/${paymentId}.${extension}`;
    try {
      const { error: uploadError } = await client.storage
        .from("quotation-payment-receipts")
        .upload(path, paymentFile, { contentType: paymentFile.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: registerError } = await client.rpc("register_quotation_payment", {
        p_payment_id: paymentId,
        p_quotation_id: liveQuote.id,
        p_payment_kind: paymentValues.payment_kind,
        p_amount: amount,
        p_paid_at: paymentValues.paid_at,
        p_method: paymentValues.method,
        p_reference_no: paymentValues.reference_no.trim() || null,
        p_notes: paymentValues.notes.trim() || null,
        p_receipt_storage_path: path,
        p_receipt_file_name: paymentFile.name,
        p_receipt_content_type: paymentFile.type,
        p_receipt_file_size: paymentFile.size,
      });
      if (registerError) throw registerError;
      resetPaymentForm();
      setSuccess("Payment receipt submitted for review.");
      await reload();
    } catch (error) {
      await client.storage.from("quotation-payment-receipts").remove([path]);
      setError(error instanceof Error ? error.message : "Payment receipt could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const saveTerms = async () => {
    const requirement = termsValues.requirement;
    const rate = n(termsValues.rate);
    if (requirement === "downpayment" && (rate <= 0 || rate >= 100)) {
      return setError("Downpayment percentage must be greater than 0 and less than 100.");
    }
    setTermsSaving(true);
    try {
      const { error } = await createClient().rpc("set_quotation_payment_terms", {
        p_quotation_id: liveQuote.id,
        p_payment_requirement: requirement,
        p_downpayment_rate: rate,
      });
      if (error) throw error;
      setEditingTerms(false);
      setSuccess("Payment terms saved.");
      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Payment terms could not be saved.");
    } finally {
      setTermsSaving(false);
    }
  };
  const reviewPayment = async (payment: Row, decision: "verified" | "rejected", decisionNote = "") => {
    const note = decisionNote.trim();
    if (decision === "rejected" && !note) {
      setError("Enter a reason before rejecting the payment.");
      return false;
    }
    setWorkingPaymentId(`${text(payment.id)}:${decision}`);
    try {
      const { error } = await createClient().rpc("review_quotation_payment", {
        p_payment_id: payment.id,
        p_decision: decision,
        p_decision_note: note || null,
      });
      if (error) throw error;
      setSuccess(decision === "verified" ? "Payment marked as verified." : "Payment receipt rejected.");
      await reload();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Payment review could not be saved.");
      return false;
    } finally {
      setWorkingPaymentId(null);
    }
  };
  const reversePayment = async (payment: Row, reversalNote = "") => {
    const note = reversalNote.trim();
    if (!note) {
      setError("Enter a reason before undoing the verification.");
      return false;
    }
    setWorkingPaymentId(`${text(payment.id)}:reversed`);
    try {
      const { error } = await createClient().rpc("reverse_quotation_payment", {
        p_payment_id: payment.id,
        p_reversal_note: note,
      });
      if (error) throw error;
      setSuccess("Payment verification was undone.");
      await reload();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Payment verification could not be undone.");
      return false;
    } finally {
      setWorkingPaymentId(null);
    }
  };
  const submitNoteRequest = async () => {
    if (!noteRequest) return;
    const note = noteValue.trim();
    if (!note) {
      setError(noteRequest.action === "reject" ? "Enter a reason before rejecting the payment." : "Enter a reason before undoing the verification.");
      return;
    }
    const saved = noteRequest.action === "reject"
      ? await reviewPayment(noteRequest.payment, "rejected", note)
      : await reversePayment(noteRequest.payment, note);
    if (saved) {
      setNoteRequest(null);
      setNoteValue("");
    }
  };
  const noteDialogBusy = noteRequest
    ? workingPaymentId === `${text(noteRequest.payment.id)}:${noteRequest.action === "reject" ? "rejected" : "reversed"}`
    : false;
  const paymentAmountHint = paymentValues.payment_kind === "downpayment"
    ? `Required remaining downpayment: ${peso.format(summary.downpaymentRemaining)}`
    : paymentValues.payment_kind === "full_payment"
      ? `Must equal available balance: ${peso.format(summary.available)}`
      : summary.available > 0
        ? `Enter an installment below ${peso.format(summary.available)}`
        : "No unallocated balance is available while pending receipts are under review";
  const paymentAmountReadOnly = paymentValues.payment_kind !== "partial_payment";
  const partialPaymentMax = summary.available > 0
    ? roundQuotationPayment(summary.available - 0.01).toFixed(2)
    : undefined;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[#151922]/40 px-3 py-4 sm:px-5 sm:py-7"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving && !termsSaving && !workingPaymentId) close();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotation-payment-title"
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[8px] border border-[#d9e0e9] bg-white shadow-none sm:max-h-[calc(100dvh-3.5rem)]"
        >
          <header className="flex items-start justify-between gap-4 border-b border-[#e1e6ee] px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Payment review</p>
              <h2 id="quotation-payment-title" className="mt-1 truncate text-[16px] font-semibold text-[#202938]">{quotationLabel} payments</h2>
              <p className="mt-1 truncate text-[12px] text-[#687386]">{text(liveQuote.quotation_no)} <span className="px-1 text-[#b7bfca]">·</span> {text(liveQuote.client_name, "Client")}</p>
            </div>
            <div className="flex shrink-0 items-start gap-3">
              <PaymentStatusBadge status={summary.status} />
              <button type="button" onClick={close} disabled={saving || termsSaving || Boolean(workingPaymentId)} aria-label="Close quotation payments" className="grid size-8 place-items-center rounded-[6px] text-[#687386] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938] disabled:cursor-not-allowed disabled:opacity-50"><X size={18} /></button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            {feedback && !noteRequest && (
              <div role="alert" className={`mb-4 flex items-start gap-2 rounded-[6px] border px-3 py-2.5 text-[12px] ${feedback.tone === "error" ? "border-[#f2b8b5] bg-[#fff5f4] text-[#b42318]" : "border-[#b7dfc5] bg-[#f1fbf4] text-[#176b40]"}`}>
                {feedback.tone === "error" ? <XCircle size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
                <span>{feedback.message}</span>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-[8px] border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Payment status</p><div className="mt-1"><PaymentStatusBadge status={summary.status} /></div></div>
              <div className="rounded-[8px] border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Quotation total</p><p className="mt-1 text-[14px] font-semibold text-[#202938]">{peso.format(summary.total)}</p></div>
              <div className="rounded-[8px] border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Verified paid</p><p className="mt-1 text-[14px] font-semibold text-[#218b55]">{peso.format(summary.verified)}</p></div>
              <div className="rounded-[8px] border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Remaining balance</p><p className="mt-1 text-[14px] font-semibold text-[#202938]">{peso.format(summary.balance)}</p></div>
            </div>

            <section className="mt-4 rounded-[8px] border border-[#e1e6ee]">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#202938]">Payment terms</h3>
                  {!editingTerms ? <p className="mt-1 text-[12px] text-[#687386]">{quotationPaymentRequirementLabel(liveQuote)}{summary.downpaymentTarget > 0 ? ` · target ${peso.format(summary.downpaymentTarget)}` : ""}</p> : <div className="mt-2 flex flex-wrap items-center gap-2"><select value={termsValues.requirement} onChange={(event) => setTermsValues((current) => ({ ...current, requirement: event.target.value }))} className="input mt-0 w-auto"><option value="none">No payment requirement</option><option value="downpayment">Downpayment</option><option value="full_payment">Full payment</option></select>{termsValues.requirement === "downpayment" && <label className="flex items-center gap-2 text-[12px] text-[#687386]"><span>Rate</span><input type="number" min="1" max="99" step="1" value={termsValues.rate} onChange={(event) => setTermsValues((current) => ({ ...current, rate: event.target.value }))} className="input mt-0 w-20" /><span>%</span></label>}</div>}
                </div>
                {(canSubmit || canReviewAsManager) && <div className="flex gap-2">{editingTerms ? <><Button secondary disabled={termsSaving} onClick={() => setEditingTerms(false)}>Cancel</Button><Button loading={termsSaving} disabled={termsSaving} onClick={() => void saveTerms()}><Save size={13} /> Save terms</Button></> : <Button secondary onClick={() => { setFeedback(null); setTermsValues({ requirement: text(liveQuote.payment_requirement, "downpayment"), rate: text(liveQuote.downpayment_rate, "50") }); setEditingTerms(true); }}><Pencil size={13} /> Edit terms</Button>}</div>}
              </div>
            </section>

            {canSubmit && <section className="mt-4 rounded-[8px] border border-[#e1e6ee]">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-[#202938]">Client payment receipt</h3>
                  <p className="mt-1 max-w-3xl text-[12px] leading-[1.45] text-[#687386]">Record each client payment separately. The assigned Sales &amp; Pricing Officer verifies the receipt before it counts as paid; the General Manager can override exceptions.</p>
                </div>
                {!formOpen && <Button disabled={summary.available <= 0} onClick={openPaymentForm}><ReceiptText size={14} /> Add payment</Button>}
              </div>
              {formOpen && <div className="grid gap-3 border-t border-[#edf0f5] px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[12px] font-medium text-[#202938]">Payment type<select value={paymentValues.payment_kind} onChange={(event) => changePaymentKind(event.target.value)} className="input mt-1">{quotationPaymentKinds.map(([key, label]) => <option key={key} value={key} disabled={key === "downpayment" && paymentRequirement !== "downpayment"}>{label}{key === "downpayment" && paymentRequirement !== "downpayment" ? " (set terms first)" : ""}</option>)}</select></label>
                <label className="text-[12px] font-medium text-[#202938]">Amount<input type="number" min="0.01" max={paymentValues.payment_kind === "partial_payment" ? partialPaymentMax : undefined} step="0.01" readOnly={paymentAmountReadOnly} value={paymentValues.amount} onChange={(event) => setPaymentValues((current) => ({ ...current, amount: event.target.value }))} className={`input mt-1 ${paymentAmountReadOnly ? "bg-[#f6f8fb] text-[#687386]" : ""}`} placeholder="0.00" /><span className="mt-1 block text-[10px] font-normal text-[#8b92a1]">{paymentAmountHint}</span></label>
                <label className="text-[12px] font-medium text-[#202938]">Paid date<input type="date" value={paymentValues.paid_at} onChange={(event) => setPaymentValues((current) => ({ ...current, paid_at: event.target.value }))} className="input mt-1" /></label>
                <label className="text-[12px] font-medium text-[#202938]">Method<select value={paymentValues.method} onChange={(event) => setPaymentValues((current) => ({ ...current, method: event.target.value }))} className="input mt-1">{quotationPaymentMethods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="text-[12px] font-medium text-[#202938] sm:col-span-2">Reference number (optional)<input value={paymentValues.reference_no} onChange={(event) => setPaymentValues((current) => ({ ...current, reference_no: event.target.value }))} className="input mt-1" placeholder="Receipt or transaction reference" /></label>
                <label className="text-[12px] font-medium text-[#202938] sm:col-span-2">Receipt image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)} className="input mt-1 py-1.5" />{paymentFile && <span className="mt-1 block truncate text-[11px] font-normal text-[#687386]">{paymentFile.name}</span>}</label>
                <div className="flex justify-end gap-2 border-t border-[#edf0f5] pt-3 sm:col-span-2 lg:col-span-4"><Button secondary disabled={saving} onClick={resetPaymentForm}>Cancel</Button><Button loading={saving} disabled={saving} onClick={() => void savePayment()}><Send size={13} /> Submit receipt</Button></div>
              </div>}
            </section>}

            <section className="mt-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#202938]">Payment history</h3>
                  <p className="mt-1 text-[12px] text-[#687386]">Pending receipts do not increase the verified paid amount.</p>
                </div>
                {summary.pending > 0 && <span className="text-[11px] font-medium text-[#a76605]">{peso.format(summary.pending)} pending review</span>}
              </div>
              {records.length ? <div className="overflow-x-auto rounded-[8px] border border-[#e1e6ee]">
                <Table labels={["Paid date", "Type", "Amount", "Method", "Receipt", "Status", "Notes", "Review"]} minWidth={1020}>
                  {records.map((payment) => {
                    const paymentId = text(payment.id);
                    const status = text(payment.status);
                    const working = workingPaymentId?.startsWith(`${paymentId}:`) ?? false;
                    const reviewerId = reviewerForPayment(payment);
                    return <tr key={paymentId}>
                      <td className="px-3 py-2.5">{day(payment.paid_at)}</td>
                      <td className="px-3 py-2.5">{quotationPaymentKindLabel(payment.payment_kind)}</td>
                      <td className="px-3 py-2.5 font-semibold">{peso.format(n(payment.amount))}</td>
                      <td className="px-3 py-2.5">{quotationPaymentMethodLabel(payment.method)}<small>{text(payment.reference_no)}</small></td>
                      <td className="px-3 py-2.5">{receiptUrls[paymentId] ? <a href={receiptUrls[paymentId]} target="_blank" rel="noreferrer" className="inline-flex size-11 overflow-hidden rounded-[6px] border border-[#d9e0e9] bg-[#fafbfc]"><img src={receiptUrls[paymentId]} alt={text(payment.receipt_file_name, "Payment receipt")} className="size-full object-cover" /></a> : <span className="inline-flex items-center gap-1 text-[11px] text-[#8b92a1]"><ReceiptText size={14} /> Loading</span>}</td>
                      <td className="px-3 py-2.5"><Status value={status} /></td>
                      <td className="px-3 py-2.5">
                        {paymentNotes(payment).length ? (
                          <NoteAction label="View payment notes" onClick={() => setNotePayment(payment)} />
                        ) : (
                          <span className="text-[11px] text-[#8b92a1]">-</span>
                        )}
                      </td>
                      <td className="min-w-44 px-3 py-2.5">
                        {canReviewPayment(payment) && status === "pending" ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button type="button" disabled={working} onClick={() => void reviewPayment(payment, "verified")} className="inline-flex min-h-7 items-center gap-1 rounded-[6px] bg-[#218b55] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#176b40] disabled:cursor-not-allowed disabled:opacity-50"><Check size={13} /> Verify</button>
                            <button type="button" disabled={working} onClick={() => openNoteRequest(payment, "reject")} className="inline-flex min-h-7 items-center gap-1 rounded-[6px] border border-[#e3a7a2] bg-white px-2.5 text-[11px] font-semibold text-[#b42318] transition-colors hover:bg-[#fff5f4] disabled:cursor-not-allowed disabled:opacity-50"><XCircle size={13} /> Reject</button>
                          </div>
                        ) : canReviewAsManager && status === "verified" ? (
                          <button type="button" disabled={working} onClick={() => openNoteRequest(payment, "reverse")} className="inline-flex min-h-7 items-center gap-1 rounded-[6px] border border-[#e3a7a2] bg-white px-2.5 text-[11px] font-semibold text-[#b42318] transition-colors hover:bg-[#fff5f4] disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={13} /> Undo verification</button>
                        ) : (
                          <span className="text-[11px] text-[#8b92a1]">{status === "pending" ? (reviewerId ? (reviewerId === text(payment.submitted_by, "") ? "Awaiting General Manager exception review" : "Awaiting Sales & Pricing Officer") : "Awaiting General Manager") : text(payment.verified_at ?? payment.reversed_at, "-")}</span>
                        )}
                      </td>
                    </tr>;
                  })}
                </Table>
              </div> : <div className="rounded-[8px] border border-dashed border-[#ccd5e0] px-4 py-8 text-center text-[12px] text-[#8b92a1]">No payment receipts recorded yet.</div>}
            </section>
          </div>
          <footer className="flex justify-end border-t border-[#e1e6ee] px-4 py-3 sm:px-5">
            <Button secondary disabled={saving || termsSaving || Boolean(workingPaymentId)} onClick={close}>Close</Button>
          </footer>
        </section>
      </div>

      {noteRequest && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-[#151922]/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNoteRequest();
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="payment-note-title" className="w-full max-w-md rounded-[8px] border border-[#d9e0e9] bg-white p-4 shadow-none sm:p-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#e1e6ee] pb-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Payment review note</p>
                <h2 id="payment-note-title" className="mt-1 text-[16px] font-semibold text-[#202938]">{noteRequest.action === "reject" ? "Reject receipt" : "Undo verification"}</h2>
              </div>
              <button type="button" onClick={closeNoteRequest} disabled={noteDialogBusy} aria-label="Close payment review note" className="grid size-8 place-items-center rounded-[6px] text-[#687386] hover:bg-[#f0f3f7] disabled:cursor-not-allowed disabled:opacity-50"><X size={18} /></button>
            </div>
            <p className="mt-4 text-[12px] leading-[1.45] text-[#687386]">{noteRequest.action === "reject" ? "Explain why this client receipt cannot be accepted. The payment will remain unverified." : "Use this only when a previously verified receipt was invalidated, refunded, or entered incorrectly. Its amount will stop counting toward Verified Paid."}</p>
            {feedback && <div role="alert" className={`mt-4 flex items-start gap-2 rounded-[6px] border px-3 py-2.5 text-[12px] ${feedback.tone === "error" ? "border-[#f2b8b5] bg-[#fff5f4] text-[#b42318]" : "border-[#b7dfc5] bg-[#f1fbf4] text-[#176b40]"}`}><XCircle size={15} className="mt-0.5 shrink-0" /><span>{feedback.message}</span></div>}
            <label className="mt-4 block text-[12px] font-medium text-[#202938]">Reason<textarea autoFocus rows={4} value={noteValue} onChange={(event) => { setNoteValue(event.target.value); if (feedback?.tone === "error") setFeedback(null); }} className="input mt-1 min-h-[96px] resize-y" placeholder={noteRequest.action === "reject" ? "Reason for rejecting this receipt" : "Reason for undoing the verification"} /></label>
            <div className="mt-5 flex justify-end gap-2 border-t border-[#e1e6ee] pt-3">
              <Button secondary disabled={noteDialogBusy} onClick={closeNoteRequest}>Cancel</Button>
              <button type="button" disabled={noteDialogBusy} onClick={() => void submitNoteRequest()} className="inline-flex min-h-8 items-center gap-1.5 rounded-[6px] bg-[#b42318] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#8f1d14] disabled:cursor-not-allowed disabled:opacity-50">{noteDialogBusy && <LoaderCircle size={14} className="animate-spin" />}{noteRequest.action === "reject" ? <><XCircle size={14} /> Reject receipt</> : <><RotateCcw size={14} /> Undo verification</>}</button>
            </div>
          </section>
        </div>
      )}
      {notePayment && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-[#151922]/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNotePayment(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="payment-notes-title" className="w-full max-w-md rounded-[8px] border border-[#d9e0e9] bg-white p-4 shadow-none sm:p-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#e1e6ee] pb-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">Payment record</p>
                <h2 id="payment-notes-title" className="mt-1 text-[16px] font-semibold text-[#202938]">Payment notes</h2>
                <p className="mt-1 text-[12px] text-[#687386]">{quotationPaymentKindLabel(notePayment.payment_kind)} · {peso.format(n(notePayment.amount))}</p>
              </div>
              <button type="button" onClick={() => setNotePayment(null)} aria-label="Close payment notes" className="grid size-8 place-items-center rounded-[6px] text-[#687386] hover:bg-[#f0f3f7] hover:text-[#202938]"><X size={18} /></button>
            </div>
            <div className="mt-4 space-y-3">
              {paymentNotes(notePayment).map((entry) => (
                <div key={entry.label} className="rounded-[6px] border border-[#e1e6ee] bg-[#fafbfc] p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#7b8494]">{entry.label}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#303949]">{entry.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end border-t border-[#e1e6ee] pt-3">
              <Button secondary onClick={() => setNotePayment(null)}>Close</Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function PaymentMonitoring({
  store,
  orgId,
  reload,
  role,
  assignedOnly = false,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  role: string;
  assignedOnly?: boolean;
}) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<Row | null>(null);
  const [scope, setScope] = useState<"pending" | "all">("all");
  const [paymentQuery, setPaymentQuery] = useState("");
  const [paymentMonth, setPaymentMonth] = useState("");
  const [paymentOfficerFilter, setPaymentOfficerFilter] = useState("all");
  const isGeneralManager = memberRole(role);
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  const approvedQuotes = store.quotations
    .filter(
      (quote) =>
        ["price_quotation", "mockup_quotation"].includes(text(quote.document_type)) &&
        !quote.costing_source_id &&
        text(quote.status) === "approved",
    )
    .map((quote) => {
      const allRecords = store.quotation_payment_records
        .filter((record) => record.quotation_id === quote.id)
        .sort((left, right) => text(right.paid_at ?? right.submitted_at ?? right.created_at).localeCompare(text(left.paid_at ?? left.submitted_at ?? left.created_at)));
      const matchingRecords = allRecords.filter((record) => {
        const receiptDate = text(record.paid_at ?? record.submitted_at ?? record.created_at, "");
        return !paymentMonth || receiptDate.slice(0, 7) === paymentMonth;
      });
      const party = quotationParty(quote, store);
      const preparedById = projectOfficerIdForQuote(store, quote);
      const preparedByName = text(
        store.profiles.find((profile) => profile.id === preparedById)?.full_name,
        text(quote.representative, "Sales Executive"),
      );
      const normalizedQuery = paymentQuery.trim().toLowerCase();
      const matchesSearch = !normalizedQuery || [
        quote.quotation_no,
        quote.project_name,
        party.clientName,
        party.companyName,
        preparedByName,
        ...allRecords.flatMap((record) => [
          record.reference_no,
          record.method,
          record.payment_kind,
          record.receipt_file_name,
        ]),
      ].some((value) => text(value, "").toLowerCase().includes(normalizedQuery));
      const matchesOfficer = paymentOfficerFilter === "all" || preparedById === paymentOfficerFilter;
      const pendingForReview = (paymentMonth ? matchingRecords : allRecords).filter(
        (record) =>
          text(record.status) === "pending" &&
          assignedPaymentReviewerId(
            quote,
            record,
            store.pricing_officer_project_types,
          ) === currentUserId &&
          text(record.submitted_by, "") !== currentUserId,
      );
      return {
        quote,
        allRecords,
        matchingRecords,
        pendingForReview,
        summary: quotationPaymentSummary(quote, allRecords),
        matchesSearch,
        matchesOfficer,
      };
    })
    .filter(({ matchesSearch, matchesOfficer, matchingRecords }) => matchesSearch && matchesOfficer && (!paymentMonth || matchingRecords.length > 0));
  const rows = approvedQuotes.filter(({ summary, pendingForReview }) => assignedOnly ? pendingForReview.length > 0 : scope === "all" || summary.pending > 0);
  const pendingCount = assignedOnly
    ? approvedQuotes.reduce((count, { pendingForReview }) => count + pendingForReview.length, 0)
    : approvedQuotes.filter(({ summary }) => summary.pending > 0).length;
  const pendingAmount = assignedOnly
    ? approvedQuotes.reduce((sum, { pendingForReview }) => sum + pendingForReview.reduce((total, payment) => total + n(payment.amount), 0), 0)
    : approvedQuotes.reduce((sum, { summary }) => sum + summary.pending, 0);
  const verifiedAmount = approvedQuotes.reduce((sum, { summary }) => sum + summary.verified, 0);
  return (
    <Panel
      title={assignedOnly ? "Payment Reviews" : "Payment Monitoring"}
      detail={assignedOnly ? "Verify client payment receipts assigned to you. Rejected or self-submitted receipts require General Manager review." : "Monitor client receipt submissions separately from quotation and production approvals. Assigned Sales & Pricing Officers review normal receipts; General Managers can override exceptions."}
      variant="page"
      hideHeading
    >
      <div className="px-4 py-4 sm:px-5 lg:px-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">{assignedOnly ? "Receipts assigned to me" : "Pending receipts"}</p><p className="mt-1 text-[16px] font-semibold text-[#a76605]">{pendingCount}</p><p className="mt-1 text-[11px] text-[#687386]">{peso.format(pendingAmount)} awaiting review</p></div>
          <div className="rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Verified paid</p><p className="mt-1 text-[16px] font-semibold text-[#218b55]">{peso.format(verifiedAmount)}</p><p className="mt-1 text-[11px] text-[#687386]">Approved receipt total</p></div>
          <div className="rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3"><p className="text-[11px] uppercase tracking-wide text-[#7b8494]">Approved quotations</p><p className="mt-1 text-[16px] font-semibold text-[#202938]">{approvedQuotes.length}</p><p className="mt-1 text-[11px] text-[#687386]">Price and Mockup Quotations in the current filters</p></div>
        </div>
        <WorkspaceListFilters
          query={paymentQuery}
          onQueryChange={setPaymentQuery}
          queryPlaceholder="Search quotation, client, project, or receipt"
          month={paymentMonth}
          onMonthChange={setPaymentMonth}
          monthLabel="Receipt month"
          showOfficer={isGeneralManager}
          officerFilter={paymentOfficerFilter}
          onOfficerChange={setPaymentOfficerFilter}
          officerOptions={projectOfficers}
          onClear={() => {
            setPaymentQuery("");
            setPaymentMonth("");
            setPaymentOfficerFilter("all");
          }}
          hasFilters={Boolean(paymentQuery || paymentMonth || paymentOfficerFilter !== "all")}
        />
        {!assignedOnly && <nav aria-label="Payment monitoring scope" className="app-tabs mt-4">
          <button type="button" onClick={() => setScope("pending")} aria-current={scope === "pending" ? "page" : undefined} className="app-tab">Pending review ({pendingCount})</button>
          <button type="button" onClick={() => setScope("all")} aria-current={scope === "all" ? "page" : undefined} className="app-tab">All approved ({approvedQuotes.length})</button>
        </nav>}
        {paymentMonth && <p className="mt-2 text-[11px] text-[var(--muted)]">The month filter selects quotations with receipts in that month. Payment status and totals include the complete quotation history.</p>}
        {rows.length ? (
          <div className="modern-table-shell">
          <Table labels={["Quotation", "Client", "Prepared by", "Payment status", "Pending", "Verified / Total", "Last receipt", "Review"]} minWidth={1120}>
            {rows.map(({ quote, allRecords, pendingForReview, summary }) => {
              const party = quotationParty(quote, store);
              const quotationType = text(quote.document_type) === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation";
              const preparedBy = text(store.profiles.find((profile) => profile.id === (quote.prepared_by_user_id ?? quote.created_by))?.full_name, text(quote.representative, "Sales Executive"));
              const pendingAmountForRow = assignedOnly
                ? pendingForReview.reduce((sum, payment) => sum + n(payment.amount), 0)
                : summary.pending;
              return <tr key={text(quote.id)}>
                <td className="px-5 py-3">{stackedCell(quote.quotation_no, [quotationType, quote.project_name])}</td>
                <td className="px-5 py-3">{stackedCell(party.clientName, party.companyName)}</td>
                <td className="px-5 py-3">{preparedBy}</td>
                <td className="px-5 py-3"><PaymentStatusBadge status={summary.status} /></td>
                <td className="px-5 py-3 font-medium text-[#a76605]">{peso.format(pendingAmountForRow)}</td>
                <td className="px-5 py-3">{peso.format(summary.verified)} / {peso.format(summary.total)}</td>
                <td className="px-5 py-3">{allRecords[0] ? day(allRecords[0].paid_at ?? allRecords[0].submitted_at ?? allRecords[0].created_at) : "-"}</td>
                <td className="px-5 py-3"><ActionIcon label="Review quotation payments" confirm={false} onClick={() => setPaymentQuote(quote)}><ReceiptText size={15} /></ActionIcon></td>
              </tr>;
            })}
          </Table>
          </div>
        ) : (
          <Empty>{assignedOnly ? "No payment receipts are currently assigned to you." : scope === "pending" ? "No quotation payment receipts are awaiting review." : "No approved Price or Mockup Quotations match the current filters."}</Empty>
        )}
      </div>
      {paymentQuote && <QuotationPaymentDialog quote={paymentQuote} store={store} orgId={orgId} role={role} close={() => setPaymentQuote(null)} reload={reload} />}
    </Panel>
  );
}

function QuotationCostingOverview({
  store,
  reload,
  notice,
  role,
}: {
  store: Store;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
}) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"price_quotation" | "mockup_quotation">("price_quotation");
  const [costedQuery, setCostedQuery] = useState("");
  const [costedMonth, setCostedMonth] = useState(currentMonth);
  const [costedStatus, setCostedStatus] = useState("all");
  const [costedOfficerFilter, setCostedOfficerFilter] = useState("all");
  const [pdfQuote, setPdfQuote] = useState<Row | null>(null);
  const [pdfWindow, setPdfWindow] = useState<Window | null>(null);
  const [printAfterOpen, setPrintAfterOpen] = useState(false);
  const isGeneralManager = memberRole(role);
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  const costedQuotationIds = new Set(
    store.price_quotation_product_costings
      .filter((costing) => text(costing.created_by, "") === currentUserId)
      .map((costing) => text(costing.quotation_id, "")),
  );
  const allCostedQuotationIds = new Set(
    store.price_quotation_product_costings.map((costing) => text(costing.quotation_id, "")),
  );
  const sourceFor = (quote: Row) =>
    store.quotations.find((source) => source.id === quote.source_price_quotation_id);
  const isCostedQuote = (quote: Row) =>
    isGeneralManager
      ? Boolean(text(quote.pricing_reviewed_by, "")) || allCostedQuotationIds.has(text(quote.id, ""))
      : text(quote.pricing_reviewed_by, "") === currentUserId || costedQuotationIds.has(text(quote.id, ""));
  const costedQuotations = store.quotations
    .filter(
      (quote) =>
        text(quote.document_type) === tab &&
        isCostedQuote(quote),
    )
    .sort(newestActivityFirst);
  const costedOfficerId = (quote: Row) =>
    projectOfficerIdForQuote(store, sourceFor(quote) ?? quote);
  const costedOfficerName = (quote: Row) =>
    text(
      store.profiles.find((profile) => profile.id === costedOfficerId(quote))?.full_name,
      text(quote.representative, "Sales Executive"),
    );
  const normalizedCostedQuery = costedQuery.trim().toLowerCase();
  const filteredCostedQuotations = costedQuotations.filter((quote) => {
    const source = sourceFor(quote);
    const party = quotationParty(quote, store);
    const costedDate = text(quote.pricing_reviewed_at ?? quote.updated_at);
    if (costedMonth && costedDate.slice(0, 7) !== costedMonth) return false;
    if (costedStatus !== "all" && text(quote.status) !== costedStatus) return false;
    if (costedOfficerFilter !== "all" && costedOfficerId(quote) !== costedOfficerFilter) return false;
    if (!normalizedCostedQuery) return true;
    return [
      quote.quotation_no,
      source?.quotation_no,
      party.clientName,
      party.companyName,
      quote.project_name,
      quote.project_types,
      quote.status,
      costedOfficerName(quote),
    ].some((value) => text(value).toLowerCase().includes(normalizedCostedQuery));
  });
  const openPdf = (quote: Row, shouldPrint = false) => {
    if (text(quote.status) !== "approved") return notice("Only approved quotations can be opened as PDFs.");
    const nextWindow = window.open("about:blank", "_blank");
    if (!nextWindow) return notice("Allow pop-ups to open the quotation PDF.");
    nextWindow.opener = null;
    setPrintAfterOpen(shouldPrint);
    setPdfWindow(nextWindow);
    setPdfQuote(quote);
  };
  return (
    <Panel
      title="Quotation Costing Overview"
      detail={isGeneralManager ? "Review all costed Price Quotations and Mockup Quotations with their current approval status." : "Review Price Quotations and Mockup Quotations that you have costed, including their current approval status."}
      variant="page"
      hideHeading
    >
      <div className="px-4 py-4 sm:px-5 lg:px-6">
        <nav aria-label="Costed quotation types" className="app-tabs">
          {([
            ["price_quotation", "Price Quotations"],
            ["mockup_quotation", "Mockup Quotations"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-current={tab === value ? "page" : undefined}
              className="app-tab"
            >
              {label} ({store.quotations.filter((quote) => text(quote.document_type) === value && isCostedQuote(quote)).length})
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#edf0f5] py-3">
          <label className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm" htmlFor="costed-quotation-search">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-[#8b92a1]" size={15} />
            <span className="sr-only">Search costed quotations</span>
            <input
              id="costed-quotation-search"
              type="search"
              value={costedQuery}
              onChange={(event) => setCostedQuery(event.target.value)}
              placeholder="Search quotation, client, or project"
              className="min-h-9 w-full rounded-lg border border-[#d9e0e9] bg-white py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#687386]">
            <span className="whitespace-nowrap">Month</span>
            <input
              type="month"
              value={costedMonth}
              onClick={(event) => event.currentTarget.showPicker?.()}
              onChange={(event) => setCostedMonth(event.target.value)}
              className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]"
            />
          </label>
          {isGeneralManager && (
            <select
              aria-label="Filter by sales staff"
              value={costedOfficerFilter}
              onChange={(event) => setCostedOfficerFilter(event.target.value)}
              className={`min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${costedOfficerFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
            >
              <option value="all">All Sales Staff</option>
              {projectOfficers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Filter by quotation status"
            value={costedStatus}
            onChange={(event) => setCostedStatus(event.target.value)}
            className={`min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${costedStatus === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending GM Approval</option>
            <option value="needs_revision">Needs Revision</option>
            <option value="approved">Approved</option>
          </select>
          {(costedQuery || costedMonth !== currentMonth() || costedStatus !== "all" || costedOfficerFilter !== "all") && (
            <Button secondary onClick={() => { setCostedQuery(""); setCostedMonth(currentMonth()); setCostedStatus("all"); setCostedOfficerFilter("all"); }}>
              Clear filters
            </Button>
          )}
        </div>
        {filteredCostedQuotations.length ? (
          <div className="modern-table-shell">
          <Table labels={tab === "mockup_quotation" ? ["Mockup Quotation", "Source Price Quotation", "Client", "Project Type", "Status", "Costed", "PDF"] : ["Price Quotation", "Client", "Project Type", "Status", "Costed", "PDF"]} minWidth={tab === "mockup_quotation" ? 1000 : 850} className="!w-full">
            {filteredCostedQuotations.map((quote) => {
              const source = sourceFor(quote);
              const party = quotationParty(quote, store);
              return (
                <tr key={text(quote.id)}>
                  <td className="px-5 py-3">{stackedCell(quote.quotation_no, quote.project_name)}</td>
                  {tab === "mockup_quotation" && <td className="px-5 py-3">{source?.id ? <button type="button" onClick={() => openPdf(source)} className="font-medium text-[#1769e8] underline decoration-[#b9d2fb] underline-offset-2 hover:text-[#1256bf]">{text(source.quotation_no)}</button> : text(quote.source_price_quotation_id)}</td>}
                  <td className="px-5 py-3">{stackedCell(party.clientName, party.companyName)}</td>
                  <td className="px-5 py-3">{text(quote.project_types)}</td>
                  <td className="px-5 py-3"><Status value={quote.status} /></td>
                  <td className="px-5 py-3">{day(quote.pricing_reviewed_at ?? quote.updated_at)}</td>
                  <td className="px-5 py-3">{text(quote.status) === "approved" ? <span className="flex items-center gap-1"><ActionIcon label={"View " + (tab === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation") + " PDF"} confirm={false} onClick={() => openPdf(quote)}><FileText size={15} /></ActionIcon><ActionIcon label={"Print " + (tab === "mockup_quotation" ? "Mockup Quotation" : "Price Quotation")} confirm={false} onClick={() => openPdf(quote, true)}><Printer size={15} /></ActionIcon></span> : <span className="text-[11px] text-[#8b92a1]">Available after approval</span>}</td>
                </tr>
              );
            })}
          </Table>
          </div>
        ) : (
          <Empty>{costedQuotations.length ? "No Quotations match the selected filters." : tab === "mockup_quotation" ? "No Mockup Quotations costed by this account yet." : "No Price Quotations costed by this account yet."}</Empty>
        )}
      </div>
      {pdfQuote && <QuotationDocument quote={pdfQuote} store={store} close={() => { setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); }} onPdfError={(message) => { if (pdfWindow && !pdfWindow.closed) pdfWindow.close(); setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); notice(message); }} autoExportPdf pdfWindow={pdfWindow} printAfterOpen={printAfterOpen} hidden />}
    </Panel>
  );
}

function ProjectCalendar({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [projectStatusTab, setProjectStatusTab] = useState<
    "active" | "completed"
  >("active");
  const [activeMonthFilter, setActiveMonthFilter] = useState(currentMonth);
  const [completedMonthFilter, setCompletedMonthFilter] =
    useState(currentMonth);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSchedule, setEditingSchedule] = useState<Row | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectOfficerFilter, setProjectOfficerFilter] = useState("all");
  const [progressDrafts, setProgressDrafts] = useState<Record<string, { percentage: string; remark: string }>>({});
  const [savingProgressId, setSavingProgressId] = useState<string | null>(null);
  const [remarkSchedule, setRemarkSchedule] = useState<Row | null>(null);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [calendarDecisionNote, setCalendarDecisionNote] = useState<{
    title: string;
    context: string;
    note: string;
  } | null>(null);
  const [proofQuote, setProofQuote] = useState<Row | null>(null);
  const schedules = store.project_schedules.slice().sort((a, b) =>
    text(a.start_date, "").localeCompare(text(b.start_date, "")),
  );
  const renderCalendarDecisionNote = (context: string, value: unknown) => {
    const note = text(value, "").trim();
    return note ? (
      <NoteAction
        label="View General Manager note"
        tone="amber"
        onClick={() => setCalendarDecisionNote({ title: "General Manager note", context, note })}
      />
    ) : null;
  };
  const approvedSchedules = schedules.filter(
    (schedule) => text(schedule.status, "approved") === "approved",
  );
  const activeSchedules = approvedSchedules.filter(
    (schedule) => !schedule.completed_at,
  );
  const completedSchedules = approvedSchedules.filter(
    (schedule) => Boolean(schedule.completed_at),
  );
  const selectedMonthFilter =
    projectStatusTab === "active" ? activeMonthFilter : completedMonthFilter;
  const tableSchedules =
    projectStatusTab === "active" ? activeSchedules : completedSchedules;
  const projectOfficerOptions = Array.from(
    new Map(
      tableSchedules.map((schedule) => [
        text(schedule.assigned_to),
        text(store.profiles.find((profile) => text(profile.id) === text(schedule.assigned_to))?.full_name, "Unassigned"),
      ]),
    ).entries(),
  ).filter(([id]) => id);
  const filteredTableSchedules = tableSchedules.filter((schedule) => {
    const date =
      projectStatusTab === "active"
        ? text(schedule.due_date, "")
        : text(schedule.completed_at, "");
    if (selectedMonthFilter && date.slice(0, 7) !== selectedMonthFilter) return false;
    if (!isProjectOfficerRole(role) && projectOfficerFilter !== "all" && text(schedule.assigned_to) !== projectOfficerFilter) return false;
    const quotation = store.quotations.find((quote) => quote.id === schedule.quotation_id);
    const lead = store.leads.find((leadItem) => leadItem.id === quotation?.lead_id);
    const query = [
      quotation?.quotation_no,
      quotation?.client_name,
      quotation?.project_name,
      lead?.client_name,
      lead?.contact_name,
      schedule.project_name,
      schedule.product_name,
      schedule.progress_remark,
    ].map((value) => text(value).toLowerCase()).join(" ");
    return query.includes(projectQuery.trim().toLowerCase());
  });
  const myScheduleRequests = schedules.filter(
    (schedule) =>
      isProjectOfficerRole(role) &&
      text(schedule.assigned_to, "") === text(schedule.created_by, ""),
  );
  const myScheduleRevisionRequests = store.project_schedule_revision_requests.filter(
    (request) =>
      isProjectOfficerRole(role) &&
      text(request.submitted_by, "") === currentUserId,
  );
  const myScheduleCompletionRequests = store.project_schedule_completion_requests.filter(
    (request) =>
      isProjectOfficerRole(role) &&
      text(request.submitted_by, "") === currentUserId,
  );
  const scheduledQuoteIds = new Set(
    schedules
      .filter((schedule) => text(schedule.status, "approved") !== "rejected")
      .map((schedule) => text(schedule.quotation_id, "")),
  );
  const approvedMockupsFor = (priceQuotationId: string) =>
    store.quotations
      .filter(
        (quote) =>
          text(quote.document_type, "") === "mockup_quotation" &&
          text(quote.status, "") === "approved" &&
          text(quote.source_price_quotation_id, "") === priceQuotationId,
      )
      .sort((left, right) =>
        text(right.approved_at ?? right.created_at, "").localeCompare(
          text(left.approved_at ?? left.created_at, ""),
        ),
      );
  const approvedQuotes = store.quotations.filter(
    (quote) =>
      text(quote.document_type, "") === "price_quotation" &&
      text(quote.status, "") === "approved" &&
      approvedMockupsFor(text(quote.id, "")).length > 0 &&
      !scheduledQuoteIds.has(text(quote.id, "")),
  );
  const canCreateSchedule = isProjectOfficerRole(role);
  const isGeneralManager = memberRole(role);
  const scheduleLifecycleStatus = (schedule: Row) =>
    schedule.completed_at ? "completed" : "active";
  const canDeleteSchedule = (schedule: Row) =>
    isGeneralManager &&
    text(schedule.status, "") === "approved" &&
    ["active", "completed"].includes(scheduleLifecycleStatus(schedule));
  const scheduleProjectType = (schedule: Row) =>
    text(
      store.quotations.find((quote) => quote.id === schedule.quotation_id)
        ?.project_types,
      text(schedule.product_name, "Unspecified"),
    );
  const calendarColorForProjectType = (projectType: string) =>
    quotationProjectTypeColors[projectType] ?? "#64748b";
  const isDueDateReserved = (
    dueDate: string,
    projectType: string,
    excludeScheduleId?: unknown,
  ) =>
    Boolean(dueDate) &&
    schedules.some(
      (schedule) =>
        text(schedule.due_date, "") === dueDate &&
        scheduleProjectType(schedule) === projectType &&
        text(schedule.id, "") !== text(excludeScheduleId, "") &&
        text(schedule.status, "pending") !== "rejected",
    );
  const selectedPriceQuotationId = (values.quotation_id ?? "").split("|")[0];
  const selectedMockupQuotationId = (values.mockup_quotation_id ?? "").split("|")[0];
  const selectedPriceQuotation = store.quotations.find(
    (quote) => text(quote.id, "") === selectedPriceQuotationId,
  );
  const selectedMockupQuotation = store.quotations.find(
    (quote) => text(quote.id, "") === selectedMockupQuotationId,
  );
  const priceProofs = store.quotation_signed_proofs.filter(
    (proof) => text(proof.quotation_id, "") === selectedPriceQuotationId,
  );
  const mockupProofs = store.quotation_signed_proofs.filter(
    (proof) => text(proof.quotation_id, "") === selectedMockupQuotationId,
  );
  const selectedPriceProof = priceProofs.filter(
    (proof) => text(proof.id, "") === (values.price_signed_proof_id ?? "").split("|")[0],
  );
  const selectedMockupProof = mockupProofs.filter(
    (proof) => text(proof.id, "") === (values.mockup_signed_proof_id ?? "").split("|")[0],
  );
  const scheduleFields: Field[] = [
    {
      key: "quotation_id",
      label: "Approved price quotation",
      type: "select",
      required: true,
      options: approvedQuotes.map(
        (quote) =>
          `${text(quote.id)}|${text(quote.quotation_no)} - ${text(quote.client_name, "Client")}`,
      ),
    },
    {
      key: "mockup_quotation_id",
      label: "Approved Mockup Quotation",
      type: "select",
      required: true,
      options: approvedMockupsFor(selectedPriceQuotationId).map(
        (quote) =>
          `${text(quote.id)}|${text(quote.quotation_no)} - ${text(quote.client_name, "Client")}`,
      ),
      hint: selectedPriceQuotationId
        ? "Only the approved Mockup Quotation linked to this Price Quotation is available."
        : "Select an approved Price Quotation first.",
    },
    {
      key: "price_signed_proof_id",
      label: "Price Quotation signed proof",
      type: "select",
      required: true,
      options: priceProofs.map(
        (proof) => `${text(proof.id)}|${text(proof.file_name, "Signed proof file")}`,
      ),
      hint: "Choose one uploaded signed proof file.",
    },
    {
      key: "mockup_signed_proof_id",
      label: "Mockup Quotation signed proof",
      type: "select",
      required: true,
      options: mockupProofs.map(
        (proof) => `${text(proof.id)}|${text(proof.file_name, "Signed proof file")}`,
      ),
      hint: "Choose one uploaded signed proof file.",
    },
    { key: "start_date", label: "Start date", type: "date", required: true },
    { key: "due_date", label: "Due Date", type: "date", required: true, hint: "Each Project Type can use a due date once." },
  ];
  const revisionFields: Field[] = [
    { key: "start_date", label: "Start date", type: "date", required: true },
    { key: "due_date", label: "Due Date", type: "date", required: true, hint: "Each Project Type can use a due date once." },
  ];
  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setCurrentUserId(data.user?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, []);
  const shiftMonth = (offset: number) => {
    const start = monthStartFromValue(month);
    start.setMonth(start.getMonth() + offset);
    setMonth(monthValue(start));
  };
  const save = async () => {
    if (editingSchedule?.id) {
      if (!values.start_date || !values.due_date)
        return notice("Enter the revised start and due dates.");
      if (values.due_date < values.start_date)
        return notice("The deadline cannot be before the start date.");
      if (isDueDateReserved(values.due_date, scheduleProjectType(editingSchedule), editingSchedule.id))
        return notice("This due date is already assigned to another project.");
      setSaving(true);
      try {
        const { error } = await createClient().rpc(
          "request_project_schedule_revision",
          {
            p_schedule_id: editingSchedule.id,
            p_start_date: values.start_date,
            p_due_date: values.due_date,
          },
        );
        if (error) throw error;
        setOpen(false);
        setEditingSchedule(null);
        await reload();
        notice("Project schedule revision submitted for General Manager approval.");
      } catch (error) {
        notice(
          error instanceof Error
            ? error.message
            : "Project schedule revision could not be submitted.",
        );
      } finally {
        setSaving(false);
      }
      return;
    }
    const quotationId = (values.quotation_id ?? "").split("|")[0];
    const mockupQuotationId = (values.mockup_quotation_id ?? "").split("|")[0];
    const priceSignedProofId = (values.price_signed_proof_id ?? "").split("|")[0];
    const mockupSignedProofId = (values.mockup_signed_proof_id ?? "").split("|")[0];
    if (!quotationId || !mockupQuotationId || !priceSignedProofId || !mockupSignedProofId || !values.start_date || !values.due_date)
      return notice("Select both approved quotations, one signed proof for each, and the production dates.");
    if (values.due_date < values.start_date)
      return notice("The deadline cannot be before the start date.");
    const quotation = approvedQuotes.find((quote) => text(quote.id, "") === quotationId);
    if (!quotation)
      return notice("Select an approved Price Quotation with an approved Mockup Quotation before requesting production.");
    const mockupQuotation = approvedMockupsFor(quotationId).find(
      (quote) => text(quote.id, "") === mockupQuotationId,
    );
    if (!mockupQuotation)
      return notice("Select the approved Mockup Quotation linked to the Price Quotation.");
    if (!priceProofs.some((proof) => text(proof.id, "") === priceSignedProofId))
      return notice("Select an uploaded signed proof for the Price Quotation.");
    if (!mockupProofs.some((proof) => text(proof.id, "") === mockupSignedProofId))
      return notice("Select an uploaded signed proof for the Mockup Quotation.");
    const lead = store.leads.find((item) => item.id === quotation.lead_id);
    const firstItem = store.quotation_items.find((item) => item.quotation_id === quotation.id);
    const projectName = text(quotation.project_name ?? lead?.project_name ?? quotation.quotation_no, "Untitled project");
    const clientName = text(quotation.client_name ?? lead?.client_name ?? lead?.contact_name, "Client");
    const productName = text(quotation.project_types, text(firstItem?.description, projectName));
    if (isDueDateReserved(values.due_date, productName))
      return notice("This Project Type already has a project due on that date.");
    const quantity = n(firstItem?.quantity) > 0 ? n(firstItem?.quantity) : 1;
    setSaving(true);
    try {
      const client = createClient();
      const { data } = await client.auth.getUser();
      if (!data.user) throw new Error("Please sign in again before scheduling a project.");
      const rejectedSchedule = schedules.find(
        (schedule) =>
          text(schedule.quotation_id, "") === quotationId &&
          text(schedule.status, "") === "rejected",
      );
      const payload = {
        project_name: projectName,
        client_name: clientName,
        product_name: productName,
        quantity,
        start_date: values.start_date,
        due_date: values.due_date,
        mockup_quotation_id: mockupQuotationId,
        price_signed_proof_id: priceSignedProofId,
        mockup_signed_proof_id: mockupSignedProofId,
      };
      const { error } = rejectedSchedule?.id
        ? await client.rpc("resubmit_project_schedule", {
            p_schedule_id: rejectedSchedule.id,
            p_project_name: payload.project_name,
            p_client_name: payload.client_name,
            p_product_name: payload.product_name,
            p_quantity: payload.quantity,
            p_start_date: payload.start_date,
            p_due_date: payload.due_date,
            p_mockup_quotation_id: payload.mockup_quotation_id,
            p_price_signed_proof_id: payload.price_signed_proof_id,
            p_mockup_signed_proof_id: payload.mockup_signed_proof_id,
          })
        : await client.from("project_schedules").insert({
            organization_id: orgId,
            quotation_id: quotationId,
            ...payload,
            status: "pending",
            assigned_to: data.user.id,
            created_by: data.user.id,
            mockup_quotation_id: mockupQuotationId,
            price_signed_proof_id: priceSignedProofId,
            mockup_signed_proof_id: mockupSignedProofId,
          });
      if (error) throw error;
      setOpen(false);
      await reload();
      notice(rejectedSchedule ? "Production request resubmitted for General Manager approval." : "Production request submitted for General Manager approval.");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Project scheduling could not be saved.";
      notice(message);
    } finally {
      setSaving(false);
    }
  };
  const requestCompletion = async (schedule: Row) => {
    if (!schedule.id) return;
    setSaving(true);
    try {
      const { error } = await createClient().rpc(
        "request_project_schedule_completion",
        { p_schedule_id: schedule.id },
      );
      if (error) throw error;
      await reload();
      notice("Project completion submitted for General Manager approval.");
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Project completion could not be submitted.",
      );
    } finally {
      setSaving(false);
    }
  };
  const unsubmitScheduleRequest = async (
    request: Row,
    rpc:
      | "unsubmit_project_schedule_revision"
      | "unsubmit_project_schedule_completion",
    label: string,
  ) => {
    if (!request.id) return;
    setSaving(true);
    try {
      const { error } = await createClient().rpc(rpc, {
        p_request_id: request.id,
      });
      if (error) throw error;
      await reload();
      notice(`${label} unsubmitted. You can submit it again when ready.`);
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : `${label} could not be unsubmitted.`,
      );
    } finally {
      setSaving(false);
    }
  };
  const schedulesDueOnDay = (key: string) =>
    approvedSchedules.filter(
      (schedule) =>
        !schedule.completed_at && key === text(schedule.due_date, ""),
    );
  const calendarMonths = Array.from({ length: 3 }, (_, index) => {
    const start = monthStartFromValue(month);
    start.setMonth(start.getMonth() + index);
    return start;
  });
  const officerName = (schedule: Row) => {
    const profile = store.profiles.find(
      (item) => text(item.id, "") === text(schedule.assigned_to, ""),
    );
    return text(profile?.full_name, "Unassigned");
  };
  const canRequestScheduleRevision = (schedule: Row) =>
    !schedule.completed_at &&
    !hasPendingScheduleCompletion(schedule) &&
    isProjectOfficerRole(role) &&
    text(schedule.assigned_to, "") === currentUserId &&
    text(schedule.created_by, "") === currentUserId;
  const hasPendingScheduleRevision = (schedule: Row) =>
    store.project_schedule_revision_requests.some(
      (request) =>
        text(request.schedule_id, "") === text(schedule.id, "") &&
        text(request.status, "") === "pending",
    );
  const showScheduleRevisionActions = isProjectOfficerRole(role);
  const showProjectActions =
    (showScheduleRevisionActions && projectStatusTab === "active") ||
    isGeneralManager;
  const canRequestScheduleCompletion = (schedule: Row) =>
    !schedule.completed_at &&
    !hasPendingScheduleRevision(schedule) &&
    isProjectOfficerRole(role) &&
    text(schedule.assigned_to, "") === currentUserId &&
    text(schedule.created_by, "") === currentUserId;
  const hasPendingScheduleCompletion = (schedule: Row) =>
    store.project_schedule_completion_requests.some(
      (request) =>
        text(request.schedule_id, "") === text(schedule.id, "") &&
        text(request.status, "") === "pending",
    );
  const totalLeadTime = (schedule: Row) => {
    const start = text(schedule.start_date);
    const due = text(schedule.due_date);
    if (!start || !due) return "—";
    const days = Math.max(0, Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000));
    return `${days} ${days === 1 ? "day" : "days"}`;
  };
  const projectProgress = (schedule: Row) =>
    progressDrafts[text(schedule.id)] ?? {
      percentage: text(schedule.progress_percentage, "0"),
      remark: text(schedule.progress_remark),
    };
  const openRemark = (schedule: Row) => {
    setRemarkDraft(projectProgress(schedule).remark);
    setRemarkSchedule(schedule);
  };
  const saveProgress = async (
    schedule: Row,
    progressOverride?: { percentage: string; remark: string },
  ) => {
    const progress = progressOverride ?? projectProgress(schedule);
    const percentage = n(progress.percentage);
    if (percentage < 0 || percentage > 100) {
      notice("Progress percentage must be between 0 and 100.");
      return false;
    }
    setSavingProgressId(text(schedule.id));
    const { error } = await createClient().rpc("update_project_schedule_progress", {
      p_schedule_id: schedule.id,
      p_progress_percentage: percentage,
      p_progress_remark: progress.remark,
    });
    setSavingProgressId(null);
    if (error) {
      notice(error.message);
      return false;
    }
    setProgressDrafts((current) => {
      const next = { ...current };
      delete next[text(schedule.id)];
      return next;
    });
    notice("Project progress updated.");
    await reload();
    return true;
  };
  const saveRemark = async () => {
    if (!remarkSchedule) return;
    const saved = await saveProgress(remarkSchedule, {
      ...projectProgress(remarkSchedule),
      remark: remarkDraft,
    });
    if (saved) setRemarkSchedule(null);
  };
  const deleteSchedule = async (schedule: Row) => {
    const scheduleId = text(schedule.id, "");
    if (!scheduleId || !canDeleteSchedule(schedule)) return;
    setSaving(true);
    const { data, error } = await createClient()
      .from("project_schedules")
      .delete()
      .eq("id", scheduleId)
      .eq("organization_id", orgId)
      .eq("status", "approved")
      .select("id");
    setSaving(false);
    if (error) return notice(error.message);
    if (!data?.length) return notice("This production could not be deleted. Refresh and try again.");
    notice("Production deleted.");
    await reload();
  };
  return (
    <Panel
      title={isGeneralManager ? "Project oversight" : "Project calendar"}
      detail={
        isGeneralManager
          ? "Monitor all scheduled projects. Review new schedules, revisions, and completion requests from the Approval Center."
          : "Select approved Price and Mockup Quotations, attach signed proof files, and request production."
      }
      variant="page"
      hideHeading
      action={
        canCreateSchedule ? (
          <Button
            disabled={!approvedQuotes.length}
            onClick={() => {
              setEditingSchedule(null);
              setValues({ quotation_id: "", mockup_quotation_id: "", price_signed_proof_id: "", mockup_signed_proof_id: "", start_date: isoToday(), due_date: "" });
              setOpen(true);
            }}
          >
            <Plus size={14} /> Request production
          </Button>
        ) : undefined
      }
    >
      <section className="border-b border-[#e4e8ef] px-4 py-4 sm:px-5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button secondary onClick={() => shiftMonth(-1)} aria-label="Show previous three months">
              <ChevronLeft size={15} />
            </Button>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054]">
              <CalendarDays size={15} className="text-[#c43b43]" />
              <span className="sr-only">Starting month</span>
              <input
                type="month"
                value={month}
                onClick={(event) => event.currentTarget.showPicker?.()}
                onChange={(event) => setMonth(event.target.value)}
                className="border-0 bg-transparent p-0 text-[12px] font-medium outline-none"
              />
            </label>
            <Button secondary onClick={() => shiftMonth(1)} aria-label="Show next three months">
              <ChevronRight size={15} />
            </Button>
          </div>
          <p className="text-[12px] text-[#687386]">
            Colored circles show approved project due dates by Project Type.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[#687386]">
          {quotationProjectTypes.map((projectType) => <span key={projectType} className="inline-flex items-center gap-1.5"><span className="size-[13px] rounded-full" style={{ backgroundColor: calendarColorForProjectType(projectType) }} aria-hidden="true" />{projectType}</span>)}
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {calendarMonths.map((calendarMonth) => {
            const year = calendarMonth.getFullYear();
            const monthIndex = calendarMonth.getMonth();
            const firstWeekday = calendarMonth.getDay();
            const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
            return (
              <section key={monthValue(calendarMonth)} className="overflow-hidden rounded-xl border border-[#d9e0e9] bg-white">
                <h2 className="border-b border-[#e4e8ef] bg-white px-3 py-2 text-center text-[13px] font-semibold uppercase tracking-[.06em] text-[#344054]">
                  {new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(calendarMonth)}
                </h2>
                <div className="grid grid-cols-7 bg-[#f2f4f7] text-center text-[10px] font-semibold uppercase text-[#667085]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
                    <span key={weekday} className="border-r border-[#dfe5ec] py-1.5 last:border-r-0">{weekday}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: 42 }, (_, index) => {
                    const dayNumber = index - firstWeekday + 1;
                    if (dayNumber < 1 || dayNumber > daysInMonth)
                      return <div key={index} className="min-h-12 border-b border-r border-[#e7ebf0] bg-[#fafbfc] last:border-r-0" />;
                    const date = new Date(year, monthIndex, dayNumber);
                    const key = localDateKey(date);
                    const activeSchedules = schedulesDueOnDay(key);
                    const dueProjectTypes = Array.from(
                      new Map(
                        activeSchedules.map((schedule) => [
                          scheduleProjectType(schedule),
                          schedule,
                        ]),
                      ).entries(),
                    );
                    return (
                      <div
                        key={key}
                        title={activeSchedules.map((schedule) => text(schedule.project_name, text(schedule.quotation_no))).join(" · ") || undefined}
                        className="min-h-12 border-b border-r border-[#e7ebf0] p-1.5 text-right text-[11px] text-[#475467] last:border-r-0"
                      >
                        <span>{dayNumber}</span>
                        {dueProjectTypes.length > 0 && <span className="mt-1 flex flex-wrap justify-end gap-1">{dueProjectTypes.map(([projectType, schedule]) => <span key={`${text(schedule.id)}-${projectType}`} className="size-[13px] rounded-full ring-1 ring-black/10" style={{ backgroundColor: calendarColorForProjectType(projectType) }} title={`${text(schedule.project_name, text(schedule.quotation_no))} — ${projectType}`} aria-label={`${projectType} due`} />)}</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
      <section className="px-4 py-4 sm:px-5 lg:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Project status"
            className="app-tabs"
          >
            {[
              { value: "active", label: "Active", count: activeSchedules.length },
              {
                value: "completed",
                label: "Completed",
                count: completedSchedules.length,
              },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setProjectStatusTab(tab.value as "active" | "completed")}
                aria-current={projectStatusTab === tab.value ? "page" : undefined}
                className="app-tab"
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 sm:w-56" htmlFor="project-search"><Search className="pointer-events-none absolute left-3 top-2.5 text-[#8b92a1]" size={15} /><span className="sr-only">Search projects</span><input id="project-search" type="search" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects" className="min-h-9 w-full rounded-lg border border-[#d9e0e9] bg-white py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]" /></label>
            <label className="flex items-center gap-2 text-[12px] text-[#687386]">
              <span className="whitespace-nowrap">Month</span>
              <input
                type="month"
                aria-label={
                  projectStatusTab === "active"
                    ? "Filter active projects by due month"
                    : "Filter completed projects by completion month"
                }
                value={selectedMonthFilter}
                onClick={(event) => event.currentTarget.showPicker?.()}
                onChange={(event) => {
                  if (projectStatusTab === "active") {
                    setActiveMonthFilter(event.target.value);
                  } else {
                    setCompletedMonthFilter(event.target.value);
                  }
                }}
                className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]"
              />
            </label>
            {!isProjectOfficerRole(role) && <><label className="sr-only" htmlFor="project-officer-filter">Sales Officer</label><select id="project-officer-filter" value={projectOfficerFilter} onChange={(event) => setProjectOfficerFilter(event.target.value)} className={`min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${projectOfficerFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}><option value="all">All Sales Officers</option>{projectOfficerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></>}
          </div>
        </div>
        <div className="modern-table-shell">
        <Table
          labels={[
            "Quotation No.",
            "Mockup Quotation",
            "Signed proofs",
            "Client's Name",
            "Company Name",
            "Start Date",
            "Due Date",
            "Total Lead Time",
            "Project Status",
            "Project Type",
            "Percentage",
            "Remark",
            ...(!isProjectOfficerRole(role) ? ["Sales Executive"] : []),
            "Actions",
          ]}
          minWidth={isProjectOfficerRole(role) ? 1510 : 1690}
          className="modern-page-table"
        >
          {filteredTableSchedules.map((schedule) => {
            const quotation = store.quotations.find((quote) => quote.id === schedule.quotation_id);
            const mockupQuotation = store.quotations.find((quote) => quote.id === schedule.mockup_quotation_id);
            const schedulePriceProofs = store.quotation_signed_proofs.filter(
              (proof) => text(proof.quotation_id, "") === text(schedule.quotation_id, ""),
            );
            const scheduleMockupProofs = store.quotation_signed_proofs.filter(
              (proof) => text(proof.quotation_id, "") === text(schedule.mockup_quotation_id, ""),
            );
            const scheduleProofs = [...schedulePriceProofs, ...scheduleMockupProofs];
            const lead = store.leads.find((item) => item.id === quotation?.lead_id);
            return <tr key={text(schedule.id)} className="hover:bg-[#fbfcff]">
              <td className="px-4 py-2">{text(quotation?.quotation_no ?? schedule.quotation_no, "—")}</td>
              <td className="px-4 py-2">{text(mockupQuotation?.quotation_no, "—")}</td>
              <td className="px-4 py-2"><SignedProofThumbnails label="Signed proofs" proofs={scheduleProofs} priceProofs={schedulePriceProofs} mockupProofs={scheduleMockupProofs} compact /></td>
              <td className="px-4 py-2">{text(lead?.contact_name ?? quotation?.client_contact_name ?? schedule.client_name, "—")}</td>
              <td className="px-4 py-2">{text(lead?.client_name ?? quotation?.client_name ?? schedule.client_name, "—")}</td>
              <td className="px-4 py-2">{day(schedule.start_date)}</td>
              <td className="px-4 py-2">{day(schedule.due_date)}</td>
              <td className="px-4 py-2 whitespace-nowrap">{totalLeadTime(schedule)}</td>
              <td className="px-4 py-2"><Status value={schedule.completed_at ? "completed" : hasPendingScheduleCompletion(schedule) ? "completion pending" : "active"} /></td>
              <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: calendarColorForProjectType(scheduleProjectType(schedule)) }} aria-hidden="true" />{scheduleProjectType(schedule)}</span></td>
              <td className="px-4 py-2">{isProjectOfficerRole(role) && !schedule.completed_at ? <input aria-label={`Progress percentage for ${text(schedule.project_name, text(schedule.quotation_no))}`} type="number" min="0" max="100" step="0.01" value={projectProgress(schedule).percentage} onChange={(event) => setProgressDrafts((current) => ({ ...current, [text(schedule.id)]: { ...projectProgress(schedule), percentage: event.target.value } }))} className="input mt-0 w-20 text-center" /> : `${n(schedule.progress_percentage)}%`}</td>
              <td className="px-4 py-2 text-center"><NoteAction label={isProjectOfficerRole(role) && !schedule.completed_at ? "Edit project remark" : "View project remark"} onClick={() => openRemark(schedule)} /></td>
              {!isProjectOfficerRole(role) && <td className="px-4 py-2">{officerName(schedule)}</td>}
              <td className="px-4 py-2">
                {showProjectActions ? <div className="flex items-center gap-1">
                  {isProjectOfficerRole(role) && !schedule.completed_at && <ActionIcon label="Save project progress" tone="green" loading={savingProgressId === text(schedule.id)} disabled={savingProgressId === text(schedule.id)} onClick={() => void saveProgress(schedule)}><Save size={15} /></ActionIcon>}
                  {canRequestScheduleCompletion(schedule) && (
                    <ActionIcon
                      label={
                        hasPendingScheduleCompletion(schedule)
                          ? "Project completion is awaiting General Manager approval"
                          : "Request project completion"
                      }
                      tone="green"
                      loading={saving}
                      disabled={saving || hasPendingScheduleCompletion(schedule)}
                      onClick={() => void requestCompletion(schedule)}
                    >
                      <Check size={15} />
                    </ActionIcon>
                  )}
                  {canRequestScheduleRevision(schedule) && (
                    <ActionIcon
                      label={
                        hasPendingScheduleRevision(schedule)
                          ? "A schedule revision is awaiting General Manager approval"
                          : "Request project schedule revision"
                      }
                      disabled={saving || hasPendingScheduleRevision(schedule)}
                      confirm={false}
                      onClick={() => {
                        setEditingSchedule(schedule);
                        setValues({
                          start_date: text(schedule.start_date, ""),
                          due_date: text(schedule.due_date, ""),
                        });
                        setOpen(true);
                      }}
                    >
                      <RotateCcw size={15} />
                    </ActionIcon>
                  )}
                  {canDeleteSchedule(schedule) && (
                    <ActionIcon
                      label="Delete production"
                      tone="red"
                      loading={saving}
                      disabled={saving}
                      confirmationDescription="This permanently deletes the production schedule and its related scheduling requests. Linked quotations, signed proofs, and the production job are kept. This cannot be undone."
                      onClick={() => void deleteSchedule(schedule)}
                    >
                      <Trash2 size={15} />
                    </ActionIcon>
                  )}
                </div> : <span className="text-[#8b92a1]">—</span>}
              </td>
            </tr>;
          })}
        </Table>
        </div>
        {!filteredTableSchedules.length && (
          <Empty>
            {projectStatusTab === "active"
              ? "No active projects are due in the selected month."
              : "No completed projects match the selected month."}
          </Empty>
        )}
        {remarkSchedule && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-remark-title"
              className="w-full max-w-lg rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
                <div>
                  <h2 id="project-remark-title" className="text-[17px] font-semibold text-[#202938]">Project remark</h2>
                  <p className="mt-1 text-[12px] text-[#687386]">{text(remarkSchedule.project_name, text(remarkSchedule.quotation_no, "Project"))}</p>
                </div>
                <button type="button" onClick={() => setRemarkSchedule(null)} aria-label="Close project remark" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]"><X size={18} /></button>
              </div>
              {isProjectOfficerRole(role) && !remarkSchedule.completed_at ? (
                <label className="mt-5 block text-[12px] font-medium text-[#202938]">
                  Remark
                  <textarea
                    aria-label={`Project remark for ${text(remarkSchedule.project_name, text(remarkSchedule.quotation_no))}`}
                    rows={5}
                    value={remarkDraft}
                    onChange={(event) => setRemarkDraft(event.target.value)}
                    placeholder="Add project note"
                    maxLength={1000}
                    className="input mt-1 min-h-28 resize-y"
                  />
                </label>
              ) : (
                <p className="mt-5 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#303949]">{text(remarkSchedule.progress_remark, "No project remark was added.")}</p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button secondary onClick={() => setRemarkSchedule(null)}>Close</Button>
                {isProjectOfficerRole(role) && !remarkSchedule.completed_at && (
                  <Button tone="green" loading={savingProgressId === text(remarkSchedule.id)} disabled={savingProgressId === text(remarkSchedule.id)} onClick={() => void saveRemark()}>
                    <Save size={14} />
                    Save remark
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}
        <NoteDialog
          open={Boolean(calendarDecisionNote)}
          title={calendarDecisionNote?.title ?? "General Manager note"}
          context={calendarDecisionNote?.context}
          note={calendarDecisionNote?.note ?? ""}
          titleId="project-calendar-decision-note-title"
          onClose={() => setCalendarDecisionNote(null)}
        />
        {isProjectOfficerRole(role) && myScheduleRequests.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#e4e8ef] bg-[#fafbfe] p-4">
            <h2 className="text-[13px] font-semibold text-[#202938]">My project submissions</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {myScheduleRequests.map((schedule) => (
                <div key={text(schedule.id)} className="rounded-lg border border-[#e4e8ef] bg-white px-3 py-2 text-[12px]">
                  <p className="font-medium text-[#202938]">{text(schedule.project_name, text(schedule.quotation_no))}</p>
                  <p className="mt-0.5 text-[#687386]">{day(schedule.start_date)} – {day(schedule.due_date)}</p>
                  <div className="mt-1 flex items-center gap-1.5"><Status value={text(schedule.status, "pending")} />{renderCalendarDecisionNote(text(schedule.project_name, text(schedule.quotation_no, "Project schedule")), schedule.decision_note)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {isProjectOfficerRole(role) && myScheduleRevisionRequests.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#e4e8ef] bg-[#fafbfe] p-4">
            <h2 className="text-[13px] font-semibold text-[#202938]">My project schedule revision requests</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {myScheduleRevisionRequests.map((request) => {
                const schedule = schedules.find((item) => item.id === request.schedule_id);
                return (
                  <div key={text(request.id)} className="rounded-lg border border-[#e4e8ef] bg-white px-3 py-2 text-[12px]">
                    <p className="font-medium text-[#202938]">{text(schedule?.project_name, text(schedule?.quotation_no))}</p>
                    <p className="mt-0.5 text-[#687386]">{day(request.proposed_start_date)} – {day(request.proposed_due_date)}</p>
                    <div className="mt-1 flex items-center gap-1.5"><Status value={text(request.status, "pending")} />{renderCalendarDecisionNote(text(schedule?.project_name, text(schedule?.quotation_no, "Project schedule revision")), request.decision_note)}</div>
                    {text(request.status) === "pending" && (
                      <div className="mt-2">
                        <Button
                          secondary
                          confirm
                          confirmationText="Unsubmit this schedule revision? The General Manager will no longer be able to review it."
                          loading={saving}
                          disabled={saving}
                          onClick={() => void unsubmitScheduleRequest(request, "unsubmit_project_schedule_revision", "Schedule revision")}
                        >
                          <RotateCcw size={14} />
                          Unsubmit
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {isProjectOfficerRole(role) && myScheduleCompletionRequests.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#e4e8ef] bg-[#fafbfe] p-4">
            <h2 className="text-[13px] font-semibold text-[#202938]">My project completion requests</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {myScheduleCompletionRequests.map((request) => {
                const schedule = schedules.find((item) => item.id === request.schedule_id);
                return (
                  <div key={text(request.id)} className="rounded-lg border border-[#e4e8ef] bg-white px-3 py-2 text-[12px]">
                    <p className="font-medium text-[#202938]">{text(schedule?.project_name, text(schedule?.quotation_no))}</p>
                    <p className="mt-0.5 text-[#687386]">Requested {day(request.submitted_at)}</p>
                    <div className="mt-1 flex items-center gap-1.5"><Status value={text(request.status, "pending")} />{renderCalendarDecisionNote(text(schedule?.project_name, text(schedule?.quotation_no, "Project completion")), request.decision_note)}</div>
                    {text(request.status) === "pending" && (
                      <div className="mt-2">
                        <Button
                          secondary
                          confirm
                          confirmationText="Unsubmit this project completion request? The General Manager will no longer be able to review it."
                          loading={saving}
                          disabled={saving}
                          onClick={() => void unsubmitScheduleRequest(request, "unsubmit_project_schedule_completion", "Project completion")}
                        >
                          <RotateCcw size={14} />
                          Unsubmit
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {open && (
        <Dialog
          title={editingSchedule ? "Request project schedule revision" : "Request production"}
          fields={editingSchedule ? revisionFields : scheduleFields}
          values={values}
          setValues={setValues}
          save={() => void save()}
          close={() => {
            setOpen(false);
            setEditingSchedule(null);
          }}
          saving={saving}
          saveLabel={editingSchedule ? "Submit revision" : "Submit production request"}
          className="max-w-2xl"
          onFieldChange={(key, value, current) => {
            if (editingSchedule) return { ...current, [key]: value };
            if (key === "quotation_id") {
              const priceQuotationId = value.split("|")[0];
              const firstProof = store.quotation_signed_proofs.find(
                (proof) => text(proof.quotation_id, "") === priceQuotationId,
              );
              return {
                ...current,
                quotation_id: value,
                mockup_quotation_id: "",
                price_signed_proof_id: firstProof ? text(firstProof.id, "") : "",
                mockup_signed_proof_id: "",
              };
            }
            if (key === "mockup_quotation_id") {
              const mockupQuotationId = value.split("|")[0];
              const firstProof = store.quotation_signed_proofs.find(
                (proof) => text(proof.quotation_id, "") === mockupQuotationId,
              );
              return {
                ...current,
                mockup_quotation_id: value,
                mockup_signed_proof_id: firstProof ? text(firstProof.id, "") : "",
              };
            }
            return {
              ...current,
              [key]: value,
            };
          }}
        >
          {!editingSchedule && (
            <div className="mt-4 grid gap-3 border-t border-[#edf0f5] pt-4">
              <div>
        <h3 className="text-[12px] font-semibold text-[#202938]">Signed client proof files</h3>
        <p className="mt-1 text-[11px] text-[#687386]">Choose one proof file for each approved quotation. Add proof files from the quotation record when needed.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SignedProofThumbnails
                  label="Price Quotation proof"
                  proofs={selectedPriceProof.length ? selectedPriceProof : priceProofs}
                  action={selectedPriceQuotation ? <Button secondary onClick={() => setProofQuote(selectedPriceQuotation)}><Paperclip size={13} /> View / add</Button> : undefined}
                />
                <SignedProofThumbnails
                  label="Mockup Quotation proof"
                  proofs={selectedMockupProof.length ? selectedMockupProof : mockupProofs}
                  action={selectedMockupQuotation ? <Button secondary onClick={() => setProofQuote(selectedMockupQuotation)}><Paperclip size={13} /> View / add</Button> : undefined}
                />
              </div>
            </div>
          )}
        </Dialog>
      )}
      {proofQuote && (
        <SignedProofDialog
          quote={proofQuote}
          store={store}
          canUpload={
            isProjectOfficerRole(role) &&
            [proofQuote.created_by, proofQuote.prepared_by_user_id].some(
              (userId) => text(userId, "") === currentUserId,
            )
          }
          close={() => setProofQuote(null)}
          notice={notice}
          reload={reload}
        />
      )}
    </Panel>
  );
}

type MaterialDraft = {
  name: string;
  description: string;
  standard_cost: string;
  quantity_on_hand: string;
  unit: string;
  supplier_id: string;
  image_url: string;
};

function MaterialsList({
  store,
  orgId,
  reload,
  notice,
  role,
  supplierIdToAdd,
  onSupplierIdHandled,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
  supplierIdToAdd: string | null;
  onSupplierIdHandled: () => void;
}) {
  const [newMaterial, setNewMaterial] = useState<MaterialDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [optimizingImage, setOptimizingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const imageOptimizationRun = useRef(0);
  const materials = store.inventory_items
    .filter((item) => item.item_type === "material")
    .filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => text(a.name, "").localeCompare(text(b.name, "")));
  const canManage = memberRole(role);
  const activeSuppliers = store.suppliers.filter(
    (supplier) => supplier.is_active !== false,
  );
  const emptyMaterialDraft = (supplierId = ""): MaterialDraft => ({
    name: "",
    description: "",
    standard_cost: "",
    quantity_on_hand: "0",
    unit: "piece",
    supplier_id: supplierId,
    image_url: "",
  });

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);

  useEffect(() => {
    if (!supplierIdToAdd) return;
    setEditingId(null);
    setDraft(null);
    setImageFile(null);
    setImageInputKey((key) => key + 1);
    setNewMaterial(emptyMaterialDraft(supplierIdToAdd));
    onSupplierIdHandled();
  }, [onSupplierIdHandled, supplierIdToAdd]);

  const clearEditor = () => {
    imageOptimizationRun.current += 1;
    setNewMaterial(null);
    setEditingId(null);
    setDraft(null);
    setImageFile(null);
    setImageInputKey((key) => key + 1);
    setOptimizingImage(false);
  };
  const startNewMaterial = (supplierId: string) => {
    setEditingId(null);
    setDraft(null);
    setImageFile(null);
    setImageInputKey((key) => key + 1);
    setNewMaterial(emptyMaterialDraft(supplierId));
    setSupplierPickerOpen(false);
  };
  const selectImage = async (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notice('Choose a PNG, JPG, or WebP material image.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notice('Choose an image that is 20 MB or smaller.');
      return;
    }
    const run = ++imageOptimizationRun.current;
    setOptimizingImage(true);
    try {
      const optimizedImage = await optimizeQuotationImage(file);
      if (run === imageOptimizationRun.current) setImageFile(optimizedImage);
    } catch {
      if (run === imageOptimizationRun.current) {
        setImageFile(file);
        notice('The image could not be optimized, so the original was kept.');
      }
    } finally {
      if (run === imageOptimizationRun.current) setOptimizingImage(false);
    }
  };
  const uploadImage = async (file: File) => {
    if (file.size > 5 * 1024 * 1024)
      throw new Error('The material image must be 5 MB or smaller after optimization.');
    const extension =
      file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
    const path = `${orgId}/materials/${crypto.randomUUID()}.${extension}`;
    const client = createClient();
    const { error } = await client.storage.from('material-images').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return client.storage.from('material-images').getPublicUrl(path).data.publicUrl;
  };
  const saveMaterial = async (materialDraft: MaterialDraft, isNew: boolean) => {
    const name = materialDraft.name.trim();
    const cost = Number(materialDraft.standard_cost);
    if (!name) return notice('Enter a material name.');
    const supplier = store.suppliers.find(
      (item) => text(item.id, '') === materialDraft.supplier_id,
    );
    if (!supplier) return notice('Select a supplier before adding a material.');
    if (isNew && supplier.is_active === false)
      return notice('Select an active supplier before adding a material.');
    if (!Number.isFinite(cost) || cost < 0)
      return notice('Enter a valid unit cost.');
    if (optimizingImage) return notice('Please wait while the image is optimized.');

    setSaving(true);
    try {
      const imageUrl = imageFile
        ? await uploadImage(imageFile)
        : materialDraft.image_url || null;
      const payload = {
        name: titleCase(name),
        description: materialDraft.description.trim()
          ? titleCase(materialDraft.description.trim())
          : null,
        standard_cost: cost,
        quantity_on_hand: n(materialDraft.quantity_on_hand),
        unit: materialDraft.unit.trim() || "piece",
        supplier_id: materialDraft.supplier_id,
        image_url: imageUrl,
      };
      const client = createClient();
      const { error } = isNew
        ? await client.from('inventory_items').insert({
            ...payload,
            organization_id: orgId,
            item_type: 'material',
            is_active: true,
          })
        : await client
            .from('inventory_items')
            .update(payload)
            .eq('id', editingId)
            .eq('organization_id', orgId);
      if (error) return notice(error.message);
      clearEditor();
      await reload();
      notice(isNew ? 'Material added.' : 'Material updated.');
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Unable to upload the material image.');
    } finally {
      setSaving(false);
    }
  };
  const toggleAvailability = async (material: Row) => {
    const next = material.is_active === false;
    setSaving(true);
    const { error } = await createClient()
      .from('inventory_items')
      .update({ is_active: next })
      .eq('id', material.id)
      .eq('organization_id', orgId);
    setSaving(false);
    if (error) return notice(error.message);
    await reload();
  };
  const deleteMaterial = async (material: Row) => {
    const materialId = text(material.id, "");
    if (!materialId) return;
    const hasDependencies = [
      store.inventory_movements.some((movement) => text(movement.item_id, "") === materialId),
      store.production_material_usage.some((usage) => text(usage.item_id, "") === materialId),
      store.finished_product_stock_ins.some((stockIn) => text(stockIn.item_id, "") === materialId),
      store.quotation_items.some((line) => text(line.inventory_item_id, "") === materialId),
      store.invoice_items.some((line) => text(line.inventory_item_id, "") === materialId),
    ].some(Boolean);
    if (hasDependencies) {
      notice("This material has linked business records and cannot be deleted. Mark it unavailable instead.");
      return;
    }
    setSaving(true);
    const { error } = await createClient()
      .from("inventory_items")
      .delete()
      .eq("id", materialId)
      .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    notice("Material deleted.");
    await reload();
  };
  const startEdit = (material: Row) => {
    imageOptimizationRun.current += 1;
    setNewMaterial(null);
    setEditingId(text(material.id, ''));
    setDraft({
      name: titleCase(text(material.name, '')),
      description: titleCase(text(material.description, '')),
      standard_cost: text(material.standard_cost, ''),
      quantity_on_hand: text(material.quantity_on_hand, '0'),
      unit: text(material.unit, 'piece'),
      supplier_id: text(material.supplier_id, ''),
      image_url: text(material.image_url, ''),
    });
    setImageFile(null);
    setImageInputKey((key) => key + 1);
    setOptimizingImage(false);
  };
  const renderEditorRow = (
    materialDraft: MaterialDraft,
    isNew: boolean,
    key: string,
  ) => {
    const update = (patch: Partial<MaterialDraft>) => {
      if (isNew) setNewMaterial((current) => (current ? { ...current, ...patch } : current));
      else setDraft((current) => (current ? { ...current, ...patch } : current));
    };
    const currentImage = imagePreview || materialDraft.image_url;
    return (
      <tr key={key} className="bg-[#fffafb]">
        <td className="px-4 py-3 align-middle">
          <label className="group relative flex size-12 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-[#c7d0de] bg-white transition hover:border-[#c43b43]">
            {currentImage ? (
              <img src={currentImage} alt="Material preview" className="size-full object-contain" />
            ) : (
              <ImageIcon size={17} className="text-[#8b92a1]" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-[#151922]/55 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
              Upload
            </span>
            <input
              key={imageInputKey}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void selectImage(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
        </td>
        <td className="px-3 py-3 align-middle">
          <input
            autoFocus={isNew}
            value={materialDraft.name}
            onChange={(event) => update({ name: titleCase(event.target.value) })}
            placeholder="Material name"
            className="input mt-0 min-w-[160px]"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <input type="number" min="0" step="any" value={materialDraft.quantity_on_hand} onChange={(event) => update({ quantity_on_hand: event.target.value })} placeholder="0" className="input mt-0 min-w-[92px]" />
        </td>
        <td className="px-3 py-3 align-middle">
          <input value={materialDraft.unit} onChange={(event) => update({ unit: titleCaseEntry(event.target.value, "unit") })} placeholder="piece" className="input mt-0 min-w-[92px]" />
        </td>
        <td className="px-3 py-3 align-middle">
          <select
            required
            aria-label="Supplier"
            value={materialDraft.supplier_id}
            onChange={(event) => update({ supplier_id: event.target.value })}
            className="input mt-0 min-w-[150px]"
          >
            <option value="" disabled>Select supplier</option>
            {store.suppliers
              .filter(
                (supplier) =>
                  supplier.is_active !== false ||
                  text(supplier.id, "") === materialDraft.supplier_id,
              )
              .map((supplier) => (
                <option
                  key={text(supplier.id)}
                  value={text(supplier.id, "")}
                  disabled={supplier.is_active === false}
                >
                  {text(supplier.company_name)}
                  {supplier.is_active === false ? " (inactive)" : ""}
                </option>
              ))}
          </select>
        </td>
        <td className="px-3 py-3 align-middle">
          <textarea
            rows={2}
            value={materialDraft.description}
            onChange={(event) =>
              update({ description: titleCase(event.target.value) })
            }
            placeholder="Description for price quotation"
            className="input mt-0 min-h-[64px] min-w-[230px] resize-y"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <input
            type="number"
            min="0"
            step="any"
            value={materialDraft.standard_cost}
            onChange={(event) => update({ standard_cost: event.target.value })}
            placeholder="0.00"
            className="input mt-0 min-w-[120px]"
          />
        </td>
        <td className="px-4 py-3 text-center text-[12px] text-[#8b92a1]">Available after save</td>
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center justify-center gap-2">
            <ActionIcon
              label="Save material"
              tone="green"
              loading={saving || optimizingImage}
              disabled={saving || optimizingImage}
              onClick={() => void saveMaterial(materialDraft, isNew)}
            >
              <Check size={15} />
            </ActionIcon>
            <ActionIcon label="Cancel material edit" confirm={false} disabled={saving} onClick={clearEditor}>
              <X size={15} />
            </ActionIcon>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <Panel
      title="Materials List"
      detail="Maintain the available material choices used in Price Quotations. Click Edit to change a row."
      action={canManage ? (
        <Button
          disabled={
            Boolean(newMaterial) ||
            Boolean(editingId) ||
            activeSuppliers.length === 0
          }
          onClick={() => setSupplierPickerOpen(true)}
        >
          <Plus size={14} /> Add Material
        </Button>
      ) : undefined}
    >
      <div className="border-t border-[#edf0f5] px-5 py-2.5">
        <label className="relative block max-w-md"><Search className="absolute left-3 top-2.5 text-[#8b92a1]" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]" placeholder="Search materials" /></label>
        {canManage && activeSuppliers.length === 0 && (
          <p className="mt-2 text-[12px] text-[#8b92a1]">
            Add an active supplier before adding materials.
          </p>
        )}
      </div>
      <Table labels={['Image', 'Material', 'Quantity', 'Unit', 'Supplier', 'Description', 'Unit Cost', 'Available', 'Actions']} minWidth={1180}>
        {newMaterial && renderEditorRow(newMaterial, true, "new-material")}
        {materials.map((material) =>
          editingId === material.id && draft ? (
            renderEditorRow(draft, false, text(material.id))
          ) : (
            <tr key={text(material.id)} className="hover:bg-[#fbfcff]">
              <td className="px-4 py-3 align-middle">
                {text(material.image_url, '') ? (
                  <img src={text(material.image_url)} alt={titleCase(text(material.name))} className="size-12 rounded-md border border-[#e1e6ed] bg-white object-contain" />
                ) : (
                  <span className="grid size-12 place-items-center rounded-md border border-dashed border-[#d7deea] bg-[#fafbfe] text-[#9aa5b5]" title="No image"><ImageIcon size={17} /></span>
                )}
              </td>
              <td className="px-4 py-3 font-semibold text-[#202938]">{titleCase(text(material.name))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{n(material.quantity_on_hand)}</td>
              <td className="px-4 py-3">{text(material.unit, 'piece')}</td>
              <td className="px-4 py-3">{text(store.suppliers.find((supplier) => supplier.id === material.supplier_id)?.company_name, '—')}</td>
              <td className="material-description-cell max-w-[360px] whitespace-pre-line px-4 py-3 text-[#626b7a]">{titleCase(text(material.description))}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{peso.format(n(material.standard_cost))}</td>
              <td className="px-4 py-3 text-center">
                {canManage ? <button
                  type="button"
                  role="switch"
                  aria-checked={material.is_active !== false}
                  aria-label={`${material.is_active !== false ? 'Mark unavailable' : 'Mark available'}: ${text(material.name)}`}
                  disabled={saving}
                  onClick={() => void toggleAvailability(material)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${material.is_active !== false ? 'bg-[#218b55]' : 'bg-[#c7ced8]'} disabled:opacity-50`}
                >
                  <span className={`inline-block size-3.5 rounded-full bg-white shadow transition ${material.is_active !== false ? 'translate-x-[18px]' : 'translate-x-1'}`} />
                </button> : null}
                <span className={`${canManage ? "ml-2" : ""} text-[11px] text-[#687386]`}>{material.is_active !== false ? 'Available' : 'Unavailable'}</span>
              </td>
              <td className="px-4 py-3 text-center">
                {canManage && (
                  <div className="flex justify-center gap-2">
                    <ActionIcon
                      label={`Edit ${titleCase(text(material.name))}`}
                      confirm={false}
                      disabled={saving || Boolean(newMaterial) || Boolean(editingId)}
                      onClick={() => startEdit(material)}
                    >
                      <Pencil size={15} />
                    </ActionIcon>
                    <ActionIcon
                      label={`Delete ${titleCase(text(material.name))}`}
                      tone="red"
                      loading={saving}
                      disabled={saving || Boolean(newMaterial) || Boolean(editingId)}
                      onClick={() => void deleteMaterial(material)}
                    >
                      <Trash2 size={15} />
                    </ActionIcon>
                  </div>
                )}
              </td>
            </tr>
          ),
        )}
        {!materials.length && !newMaterial && <tr><td colSpan={9}><Empty>No materials match this view.</Empty></td></tr>}
      </Table>
      {supplierPickerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/30 p-4">
          <section
            aria-labelledby="material-supplier-title"
            aria-modal="true"
            className="w-full max-w-md rounded-[14px] border border-[#e1e6ed] bg-white p-5 shadow-xl"
            role="dialog"
          >
            <h2 id="material-supplier-title" className="text-[16px] font-semibold text-[#202938]">
              Select supplier
            </h2>
            <p className="mt-1 text-[13px] text-[#687386]">
              Choose the supplier before adding a material.
            </p>
            <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
              {activeSuppliers.map((supplier) => (
                <button
                  key={text(supplier.id)}
                  type="button"
                  onClick={() => startNewMaterial(text(supplier.id))}
                  className="w-full rounded-lg border border-[#d9e0e9] px-3 py-2.5 text-left transition hover:border-[#c43b43] hover:bg-[#fff7f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
                >
                  <span className="block text-[13px] font-medium text-[#202938]">
                    {text(supplier.company_name)}
                  </span>
                  {text(supplier.contact_name, "") && (
                    <span className="mt-0.5 block text-[12px] text-[#687386]">
                      {text(supplier.contact_name)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button secondary onClick={() => setSupplierPickerOpen(false)}>
                Cancel
              </Button>
            </div>
          </section>
        </div>
      )}
      {optimizingImage && <p className="px-5 pb-4 text-[12px] text-[#687386]">Optimizing selected material image…</p>}
    </Panel>
  );
}

type SupplierDraft = {
  company_name: string;
  contact_name: string;
  address: string;
  email: string;
  phone: string;
};

function SuppliersList({
  store,
  orgId,
  reload,
  notice,
  role,
  onAddMaterial,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
  onAddMaterial: (supplier: Row) => void;
}) {
  const [newSupplier, setNewSupplier] = useState<SupplierDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const canManage = memberRole(role);
  const suppliers = store.suppliers
    .filter((supplier) =>
      JSON.stringify(supplier).toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      text(a.company_name, "").localeCompare(text(b.company_name, "")),
    );

  const emptyDraft = (): SupplierDraft => ({
    company_name: "",
    contact_name: "",
    address: "",
    email: "",
    phone: "",
  });
  const toDraft = (supplier: Row): SupplierDraft => ({
    company_name: text(supplier.company_name),
    contact_name: text(supplier.contact_name),
    address: text(supplier.address),
    email: text(supplier.email),
    phone: text(supplier.phone),
  });
  const clearEditor = () => {
    setNewSupplier(null);
    setEditingId(null);
    setDraft(null);
  };
  const saveSupplier = async (supplierDraft: SupplierDraft, isNew: boolean) => {
    const companyName = supplierDraft.company_name.trim();
    if (!companyName) return notice("Enter a supplier name.");
    const duplicate = store.suppliers.find(
      (supplier) =>
        text(supplier.id, "") !== (editingId ?? "") &&
        normalizeSupplierName(text(supplier.company_name, "")) ===
          normalizeSupplierName(companyName),
    );
    if (duplicate)
      return notice(
        `A supplier named “${text(duplicate.company_name)}” already exists.`,
      );
    setSaving(true);
    const payload = {
      company_name: companyName,
      contact_name: supplierDraft.contact_name.trim(),
      address: supplierDraft.address.trim(),
      email: supplierDraft.email.trim(),
      phone: supplierDraft.phone.trim(),
    };
    const client = createClient();
    const { data, error } = isNew
      ? await client
          .from("suppliers")
          .insert({ ...payload, organization_id: orgId })
          .select()
          .single()
      : await client
          .from("suppliers")
          .update(payload)
          .eq("id", editingId)
          .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    clearEditor();
    await reload();
    if (isNew && data) {
      notice("Supplier added. Add its materials next.");
      onAddMaterial(data as Row);
    }
  };
  const toggleAvailability = async (supplier: Row) => {
    setSaving(true);
    const { error } = await createClient()
      .from("suppliers")
      .update({ is_active: supplier.is_active === false })
      .eq("id", supplier.id)
      .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    await reload();
  };
  const deleteSupplier = async (supplier: Row) => {
    const supplierId = text(supplier.id, "");
    if (!supplierId) return;
    const hasDependencies = [
      store.inventory_items.some((item) => text(item.supplier_id, "") === supplierId),
      store.expenses.some((expense) => text(expense.supplier_id, "") === supplierId),
      store.supplier_payables.some((payable) => text(payable.supplier_id, "") === supplierId),
    ].some(Boolean);
    if (hasDependencies) {
      notice("This supplier has linked business records and cannot be deleted. Mark it unavailable instead.");
      return;
    }
    setSaving(true);
    const { error } = await createClient()
      .from("suppliers")
      .delete()
      .eq("id", supplierId)
      .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    notice("Supplier deleted.");
    await reload();
  };
  const renderEditorRow = (
    supplierDraft: SupplierDraft,
    isNew: boolean,
    key: string,
  ) => {
    const update = (patch: Partial<SupplierDraft>) => {
      if (isNew)
        setNewSupplier((current) =>
          current ? { ...current, ...patch } : current,
        );
      else
        setDraft((current) => (current ? { ...current, ...patch } : current));
    };
    return (
      <tr key={key} className="bg-[#fffafb]">
        <td className="px-3 py-3 align-middle">
          <input
            autoFocus={isNew}
            value={supplierDraft.company_name}
            onChange={(event) =>
              update({ company_name: titleCase(event.target.value) })
            }
            placeholder="Supplier name"
            className="input mt-0 min-w-[170px]"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <input
            value={supplierDraft.contact_name}
            onChange={(event) =>
              update({ contact_name: titleCase(event.target.value) })
            }
            placeholder="Contact person"
            className="input mt-0 min-w-[150px]"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <textarea
            rows={2}
            value={supplierDraft.address}
            onChange={(event) => update({ address: titleCaseEntry(event.target.value, "address") })}
            placeholder="Address"
            className="input mt-0 min-h-[64px] min-w-[210px] resize-y"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <input
            type="email"
            value={supplierDraft.email}
            onChange={(event) => update({ email: event.target.value })}
            placeholder="Email"
            className="input mt-0 min-w-[180px]"
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <input
            type="tel"
            value={supplierDraft.phone}
            onChange={(event) => update({ phone: event.target.value })}
            placeholder="Phone number"
            className="input mt-0 min-w-[140px]"
          />
        </td>
        <td className="px-4 py-3 text-center text-[12px] text-[#8b92a1]">
          Available after save
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center justify-center gap-2">
            <ActionIcon
              label="Save supplier"
              tone="green"
              loading={saving}
              disabled={saving}
              onClick={() => void saveSupplier(supplierDraft, isNew)}
            >
              <Check size={15} />
            </ActionIcon>
            <ActionIcon
              label="Cancel supplier edit"
              confirm={false}
              disabled={saving}
              onClick={clearEditor}
            >
              <X size={15} />
            </ActionIcon>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <Panel
      title="Suppliers"
      detail="Maintain the vendors used for materials and Price Quotations."
      action={
        canManage ? (
          <Button
            disabled={Boolean(newSupplier) || Boolean(editingId)}
            onClick={() => {
              setEditingId(null);
              setDraft(null);
              setNewSupplier(emptyDraft());
            }}
          >
            <Plus size={14} /> Add Supplier
          </Button>
        ) : undefined
      }
    >
      <div className="border-t border-[#edf0f5] px-4 py-2.5 sm:px-5">
        <label className="relative block max-w-md">
          <Search className="absolute left-3 top-2.5 text-[#8b92a1]" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
            placeholder="Search suppliers"
          />
        </label>
      </div>
      <Table
        labels={[
          "Supplier",
          "Contact person",
          "Address",
          "Email",
          "Phone",
          "Available",
          "Actions",
        ]}
        minWidth={980}
      >
        {newSupplier && renderEditorRow(newSupplier, true, "new-supplier")}
        {suppliers.map((supplier) =>
          editingId === supplier.id && draft ? (
            renderEditorRow(draft, false, text(supplier.id))
          ) : (
            <tr key={text(supplier.id)} className="hover:bg-[#fbfcff]">
              <td className="px-4 py-3 font-semibold text-[#202938]">
                {text(supplier.company_name)}
              </td>
              <td className="px-4 py-3">{text(supplier.contact_name, "—")}</td>
              <td className="max-w-[300px] whitespace-pre-line px-4 py-3 text-[#626b7a]">
                {text(supplier.address, "—")}
              </td>
              <td className="px-4 py-3">{text(supplier.email, "—")}</td>
              <td className="px-4 py-3">{text(supplier.phone, "—")}</td>
              <td className="px-4 py-3 text-center">
                {canManage ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={supplier.is_active !== false}
                    aria-label={`${supplier.is_active !== false ? "Mark unavailable" : "Mark available"}: ${text(supplier.company_name)}`}
                    disabled={saving}
                    onClick={() => void toggleAvailability(supplier)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${supplier.is_active !== false ? "bg-[#218b55]" : "bg-[#c7ced8]"} disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block size-3.5 rounded-full bg-white shadow transition ${supplier.is_active !== false ? "translate-x-[18px]" : "translate-x-1"}`}
                    />
                  </button>
                ) : null}
                <span className={`${canManage ? "ml-2" : ""} text-[11px] text-[#687386]`}>
                  {supplier.is_active !== false ? "Available" : "Unavailable"}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                {canManage && (
                  <div className="flex justify-center gap-2">
                    <ActionIcon
                      label={`Edit ${text(supplier.company_name)}`}
                      confirm={false}
                      disabled={saving || Boolean(newSupplier) || Boolean(editingId)}
                      onClick={() => {
                        setNewSupplier(null);
                        setEditingId(text(supplier.id));
                        setDraft(toDraft(supplier));
                      }}
                    >
                      <Pencil size={15} />
                    </ActionIcon>
                    <ActionIcon
                      label={`Delete ${text(supplier.company_name)}`}
                      tone="red"
                      loading={saving}
                      disabled={saving || Boolean(newSupplier) || Boolean(editingId)}
                      onClick={() => void deleteSupplier(supplier)}
                    >
                      <Trash2 size={15} />
                    </ActionIcon>
                  </div>
                )}
              </td>
            </tr>
          ),
        )}
        {!suppliers.length && !newSupplier && (
          <tr>
            <td colSpan={7}>
              <Empty>No suppliers match this view.</Empty>
            </td>
          </tr>
        )}
      </Table>
    </Panel>
  );
}

function SupplierMaterials({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
}) {
  const [tab, setTab] = useState<"suppliers" | "materials">("suppliers");
  const [supplierIdToAdd, setSupplierIdToAdd] = useState<string | null>(null);
  const addMaterialForSupplier = (supplier: Row) => {
    const supplierId = text(supplier.id, "");
    if (!supplierId) return;
    setSupplierIdToAdd(supplierId);
    setTab("materials");
  };
  return (
    <div className="space-y-4">
      <div className="app-tabs px-1">
        <button type="button" onClick={() => setTab("suppliers")} aria-current={tab === "suppliers" ? "page" : undefined} className="app-tab">Suppliers</button>
        <button type="button" onClick={() => setTab("materials")} aria-current={tab === "materials" ? "page" : undefined} className="app-tab">Materials List</button>
      </div>
      {tab === "suppliers" ? (
        <SuppliersList
          store={store}
          orgId={orgId}
          reload={reload}
          notice={notice}
          role={role}
          onAddMaterial={addMaterialForSupplier}
        />
      ) : (
        <MaterialsList
          store={store}
          orgId={orgId}
          reload={reload}
          notice={notice}
          role={role}
          supplierIdToAdd={supplierIdToAdd}
          onSupplierIdHandled={() => setSupplierIdToAdd(null)}
        />
      )}
    </div>
  );
}

function QuotationDocument({
  quote,
  store,
  close,
  onPdfError,
  autoExportPdf = false,
  pdfWindow = null,
  printAfterOpen = false,
  hidden = false,
  showInternalCosting = false,
}: {
  quote: Row;
  store: Store;
  close: () => void;
  onPdfError?: (message: string) => void;
  autoExportPdf?: boolean;
  pdfWindow?: Window | null;
  printAfterOpen?: boolean;
  hidden?: boolean;
  showInternalCosting?: boolean;
}) {
  const documentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoExportPdf || !documentRef.current) return;
    let cancelled = false;
    const exportPdf = async () => {
      const quotationPrintStyles = `
        @page { size: 8.5in 14in; margin: 0.48in 0.42in 0.6in; }
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
        .quotation-print-document { width: auto !important; padding: 0 !important; }
        .quotation-print-document, .quotation-print-document * { color: #000 !important; font-family: Arial, Helvetica, sans-serif !important; border-color: #000 !important; background-color: #fff !important; }
        .quotation-print-document :is(p, h1, h2) { margin: 0; }
        .quotation-print-document img { filter: none !important; }
        .quotation-print-document table :is(th, td) { text-align: center !important; }
        .quotation-print-document .quotation-description-cell { text-align: left !important; }
        .quotation-print-document td { overflow-wrap: anywhere; word-break: break-word; }
        .quotation-print-document :is(th, b, h1, h2) { font-weight: 700 !important; }
        .quotation-signatures { break-inside: avoid; }
        .huswell-workspace .quotation-print-document .text-\\[8px\\] { font-size: 13px !important; line-height: 18px !important; }
        .huswell-workspace .quotation-print-document .text-\\[10px\\] { font-size: 13px !important; line-height: 18px !important; }
        .huswell-workspace .quotation-print-document .text-\\[11px\\] { font-size: 13px !important; line-height: 18px !important; }
        .huswell-workspace .quotation-print-document .text-\\[12px\\] { font-size: 13px !important; line-height: 18px !important; }
        .huswell-workspace .quotation-print-document .text-\\[13px\\] { font-size: 13px !important; line-height: 18px !important; }
        .quotation-print-document .text-\\[34px\\] { font-size: 36px !important; line-height: 36px !important; }
      `;
      const pdfBlob = await pdf(
        <PriceQuotationPdf quote={quote} store={store} origin={window.location.origin} showInternalCosting={showInternalCosting} />,
      ).toBlob();
      if (pdfBlob.size === 0 || pdfBlob.type !== "application/pdf") {
        throw new Error("Unable to open the quotation PDF.");
      }
      if (cancelled) {
        return;
      }
      showGeneratedPdfWindow(pdfWindow, pdfBlob, printAfterOpen);
      close();
    };
    const exportTimer = window.setTimeout(() => {
      void exportPdf().catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to generate the quotation PDF.";
          if (onPdfError) onPdfError(message);
          else window.alert(message);
        }
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(exportTimer);
    };
  }, [
    autoExportPdf,
    close,
    onPdfError,
    pdfWindow,
    printAfterOpen,
    quote,
    showInternalCosting,
    store,
  ]);
  const customer = store.customers.find((c) => c.id === quote.customer_id);
  const lead = store.leads.find((entry) => entry.id === quote.lead_id);
  const lines = store.quotation_items.filter(
    (i) => i.quotation_id === quote.id,
  );
  const costingSource = store.quotations.find(
    (item) => item.id === quote.costing_source_id,
  );
  const isMockupQuotation = text(quote.document_type) === "mockup_quotation";
  const documentLabel = isMockupQuotation ? "Mockup Quotation" : "Price Quotation";
  const sourceQuotation = isMockupQuotation
    ? store.quotations.find((item) => item.id === quote.source_price_quotation_id)
    : null;
  const hasGeneralManagerApproval =
    text(quote.status) === "approved" ||
    text(costingSource?.status) === "approved";
  const clientName = text(
    customer?.company_name ?? lead?.client_name ?? quote.client_name,
    "—",
  );
  const contactName = text(
    customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name,
    "—",
  );
  const contactNumber = text(
    customer?.phone ?? lead?.phone ?? quote.client_phone,
    "—",
  );
  const clientEmail = text(customer?.email ?? lead?.email, "—");
  const clientAddress = text(customer?.billing_address, "—");
  const totalAmount = n(quote.total_amount);
  const totalCost = n(quote.total_cost);
  const projectTerms = text(quote.terms_conditions, DEFAULT_QUOTATION_TERMS)
    .split(/\r?\n+/)
    .map((term) => term.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
  const termsBeforeBank = projectTerms.slice(0, 4);
  const termsAfterBank = projectTerms.slice(4, 6);
  const continuedTerms = projectTerms.slice(6);
  const fullIssueDate = quote.issue_date
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${quote.issue_date}T00:00:00`))
    : "—";
  const plainAmount = (value: number) =>
    new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(value);
  const formatTerm = (term: string) => {
    const match = term.match(/^([^:]+:)(?:\s*)(.*)$/);
    if (!match) return term;
    const [, label, body] = match;
    const paymentTerms = body.match(
      /^(.*?delivery\/release of the order\.)\s*(Production will commence.*)$/,
    );
    const renderBody = (value: string) =>
      value
        .split(/(VAT INCLUSIVE\.?)/i)
        .map((part, index) =>
          /^VAT INCLUSIVE\.?$/i.test(part) ? (
            <b key={`${part}-${index}`}>{part}</b>
          ) : (
            part
          ),
        );
    return (
      <>
        <b>{label}</b>{" "}
        {paymentTerms ? (
          <>
            {renderBody(paymentTerms[1])}
            <p className="mt-3">{renderBody(paymentTerms[2])}</p>
          </>
        ) : (
          renderBody(body)
        )}
      </>
    );
  };
  const sellingLines = lines.map((line, index) => {
    const quantity = n(line.quantity);
    const sourceAmount = quantity * n(line.unit_cost);
    const earlierAmount = lines.slice(0, index).reduce((sum, item) => {
      const itemQuantity = n(item.quantity);
      return sum + itemQuantity * n(item.unit_cost);
    }, 0);
    const amount =
      index === lines.length - 1
        ? Math.max(
            0,
            totalAmount -
              Math.round(
                earlierAmount * (totalAmount / (totalCost || 1)) * 100,
              ) /
                100,
          )
        : Math.round(sourceAmount * (totalAmount / (totalCost || 1)) * 100) /
          100;
    const inventoryItem = store.inventory_items.find(
      (item) => item.id === line.inventory_item_id,
    );
    return {
      ...line,
      description: text(line.description),
      productName: text(line.description).split(/\r?\n/)[0],
      productDetails: text(line.details, "")
        ? text(line.details, "").split(/\r?\n/).filter(Boolean)
        : text(line.description).split(/\r?\n/).slice(1),
      imageUrl: text(line.image_url, ""),
      quantity,
      amount,
      sellingUnitPrice: quantity ? amount / quantity : 0,
      unit: text(inventoryItem?.unit),
    };
  });
  return (
    <div
      className={
        hidden
          ? "hidden"
          : "fixed inset-0 z-50 overflow-y-auto bg-white p-5 print:static print:p-0"
      }
    >
      <div className={hidden ? "w-[8.5in]" : "mx-auto w-fit"}>
        <article
          ref={documentRef}
          data-pdf-document
          className="quotation-print-document bg-white"
          style={{
            width: "8.5in",
            padding: "0.48in 0.42in 0.6in",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "12pt",
            lineHeight: 1.15,
            color: "#202938",
          }}
        >
          <header
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr .85fr",
              columnGap: "0.42in",
              alignItems: "start",
            }}
          >
            <div>
              <Image
                src="/huswell-quotation-logo.png"
                alt="Huswell Trading"
                width={489}
                height={153}
                priority
                unoptimized
                style={{ width: "1.95in", height: "auto", display: "block" }}
              />
              <div
                style={{
                  marginTop: "0.04in",
                  fontWeight: 500,
                  lineHeight: 1.28,
                }}
              >
                <p>72 Adrian St. North Fairview Park Subd.</p>
                <p>Brgy. North Fairview, Quezon City</p>
                <p>09171697153</p>
                <p style={{ color: "#0000ee", textDecoration: "underline" }}>
                  saleshuswell@gmail.com
                </p>
              </div>
            </div>
            <div>
              <h1
                style={{
                  margin: "0.52in 0 0.08in",
                  color: "#c43b43",
                  fontSize: "24pt",
                  lineHeight: 1,
                  textAlign: "center",
                  fontWeight: 500,
                }}
              >
                {documentLabel.toUpperCase()}
              </h1>
              <div style={{ fontWeight: 500, lineHeight: 1.32 }}>
                <p>Quotation No.: {text(quote.quotation_no)}</p>
                {sourceQuotation && <p>Source Price Quotation: {text(sourceQuotation.quotation_no)}</p>}
                <p>Quotation Date: {fullIssueDate}</p>
              </div>
              <div
                style={{
                  marginTop: "0.12in",
                  border: "1px solid #d5dbe5",
                  borderLeft: "4px solid #c43b43",
                  background: "#fff7f7",
                  padding: "0.08in 0.1in",
                  fontWeight: 500,
                  lineHeight: 1.22,
                }}
              >
                <p>Prepared For:</p>
                <p>{clientName}</p>
                <p>Attention:</p>
                <p>{contactName}</p>
              </div>
            </div>
          </header>
          <section style={{ marginTop: "0.45in" }}>
            <p>Dear Sir/Madam,</p>
            <p>We thank you for the opportunity to serve your requirements.</p>
            <p style={{ marginTop: "0.18in", fontWeight: 500 }}>OPTION 1</p>
            <table
              style={{
                width: "100%",
                marginTop: "0.11in",
                borderCollapse: "collapse",
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#c43b43",
                    color: "#fff",
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  <th
                    style={{
                      width: "19.5%",
                      border: "1px solid #d5dbe5",
                      padding: "0.06in",
                    }}
                  >
                    ITEM
                  </th>
                  <th
                    style={{
                      width: "35.5%",
                      border: "1px solid #d5dbe5",
                      padding: "0.06in",
                    }}
                  >
                    DESCRIPTION
                  </th>
                  <th
                    style={{
                      width: "14.5%",
                      border: "1px solid #d5dbe5",
                      padding: "0.06in",
                    }}
                  >
                    QUANTITY
                  </th>
                  <th
                    style={{
                      width: "17.5%",
                      border: "1px solid #d5dbe5",
                      padding: "0.06in",
                      lineHeight: 1.02,
                    }}
                  >
                    SELLING
                    <br />
                    PRICE / UNIT
                  </th>
                  <th
                    style={{
                      width: "13%",
                      border: "1px solid #d5dbe5",
                      padding: "0.06in",
                    }}
                  >
                    AMOUNT
                  </th>
                </tr>
              </thead>
              <tbody>
                {sellingLines.length ? (
                  sellingLines.map((line, index) => (
                    <tr
                      key={text(line.id)}
                      className="quotation-table-row"
                    >
                      <td
                        style={{
                          border: "1px solid #d5dbe5",
                          padding: "0.08in 0.05in",
                          textAlign: "center",
                          verticalAlign: "middle",
                          color: "#555",
                        }}
                      >
                        {line.imageUrl ? (
                          <img
                            src={line.imageUrl}
                            alt={line.productName}
                            style={{
                              display: "block",
                              width: "100%",
                              maxHeight: "0.92in",
                              margin: "0 auto",
                              objectFit: "contain",
                            }}
                          />
                        ) : (
                          index + 1
                        )}
                      </td>
                      <td
                        className="quotation-description-cell"
                        style={{
                          border: "1px solid #d5dbe5",
                          padding: "0.04in 0.08in",
                          verticalAlign: "top",
                          lineHeight: 1.1,
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        <b>{line.productName}</b>
                        {line.productDetails.length > 0 && (
                          <>
                            <br />
                            {line.productDetails.map((detail, detailIndex) => (
                              <span key={`${detail}-${detailIndex}`}>
                                {detail}
                                {detailIndex <
                                  line.productDetails.length - 1 && <br />}
                              </span>
                            ))}
                          </>
                        )}
                      </td>
                      <td
                        style={{
                          border: "1px solid #d5dbe5",
                          padding: "0.06in",
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        {plainAmount(line.quantity)}{" "}
                        {line.quantity === 1 ? "pc" : "pcs"}
                      </td>
                      <td
                        style={{
                          border: "1px solid #d5dbe5",
                          padding: "0.06in",
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        {plainAmount(line.sellingUnitPrice)} / PC
                      </td>
                      <td
                        style={{
                          border: "1px solid #d5dbe5",
                          padding: "0.06in",
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        ₱
                        {plainAmount(line.amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        border: "1px solid #d5dbe5",
                        padding: "0.3in",
                        textAlign: "center",
                      }}
                    >
                      No quotation items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section
            className="quotation-terms"
            style={{
              marginTop: "0.32in",
              paddingTop: "0.2in",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            <h2
              style={{
                marginBottom: "0.16in",
                fontSize: "13pt",
                fontWeight: 500,
              }}
            >
              TERMS AND CONDITIONS
            </h2>
            <ol style={{ margin: 0, paddingLeft: "0.42in" }}>
              {termsBeforeBank.map((term, index) => (
                <li
                  key={`${index}-${term}`}
                  style={{ marginBottom: "0.08in", paddingLeft: "0.04in" }}
                >
                  {formatTerm(term)}
                </li>
              ))}
            </ol>
            <table
              style={{
                width: "4.15in",
                margin: "0.14in auto",
                borderCollapse: "collapse",
              }}
            >
              <tbody>
                <tr>
                  <td
                    style={{
                      border: "1px solid #777",
                      padding: "0.02in 0.12in",
                    }}
                  >
                    Chinabank
                  </td>
                  <td
                    style={{
                      border: "1px solid #777",
                      padding: "0.02in 0.12in",
                    }}
                  >
                    Huswell Trading - 133300003109
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      border: "1px solid #777",
                      padding: "0.02in 0.12in",
                    }}
                  >
                    Unionbank
                  </td>
                  <td
                    style={{
                      border: "1px solid #777",
                      padding: "0.02in 0.12in",
                    }}
                  >
                    Huswell Trading - 002300008069
                  </td>
                </tr>
              </tbody>
            </table>
            <ol start={5} style={{ margin: 0, paddingLeft: "0.42in" }}>
              {[...termsAfterBank, ...continuedTerms].map((term, index) => (
                <li
                  key={`${index + 4}-${term}`}
                  style={{ marginBottom: "0.08in", paddingLeft: "0.04in" }}
                >
                  {formatTerm(term)}
                </li>
              ))}
            </ol>
          </section>
          <section
            className="quotation-signatures"
            style={{ breakInside: "avoid", marginTop: "0.42in" }}
          >
            <p>Prepared by:</p>
            <div
              style={{ position: "relative", height: "0.5in", width: "2.05in" }}
            />
            <p
              style={{
                width: "2.5in",
                borderBottom: "1px solid #111",
                paddingBottom: "0.02in",
                textAlign: "center",
              }}
            >
              {text(quote.representative)}
            </p>
              <p>Sales Executive</p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "end",
                marginTop: "0.36in",
              }}
            >
              <div>
                <p style={{ marginBottom: "0.18in" }}>Approved by:</p>
                {hasGeneralManagerApproval && (
                  <img
                    src="/marvin-tavarez-signature.png"
                    alt="Signature of Mr. Marvin S. Tavarez"
                    style={{ display: "block", height: "0.42in", maxWidth: "1.65in", objectFit: "contain" }}
                  />
                )}
                <p
                  style={{
                    width: "2.5in",
                    borderBottom: "1px solid #111",
                    paddingBottom: "0.02in",
                    textAlign: "center",
                  }}
                >
                  Mr. Marvin S. Tavarez
                </p>
                <p>Proprietor</p>
              </div>
              <div
                style={{
                  width: "1.7in",
                  borderTop: "1px solid #555",
                  paddingTop: "0.03in",
                  textAlign: "center",
                }}
              >
                Conforme
              </div>
            </div>
          </section>
        </article>
        {false && (
          <article
            ref={documentRef}
            className="quotation-print-document bg-white font-serif text-[#111]"
            style={{ width: "8.5in" }}
          >
            <section
              className="quotation-print-page relative min-h-[14in] w-[8.5in] px-[12mm] pb-[15mm] pt-[11mm]"
              style={{
                position: "relative",
                width: "8.5in",
                minHeight: "14in",
                padding: "11mm 12mm 15mm",
              }}
            >
              <header className="text-center">
                <Image
                  src="/huswell-quotation-logo.png"
                  alt="Huswell Trading"
                  width={489}
                  height={153}
                  priority
                  className="mx-auto h-auto w-[160px]"
                />
              </header>
              <div className="mt-7 grid grid-cols-[1.45fr_1fr] gap-8 text-[12px] leading-5">
                <div>
                  <p>
                    <b>Company Name:</b> {clientName}
                  </p>
                  <p>
                    <b>Contact Person:</b> {contactName}
                  </p>
                  <p>
                    <b>Contact Number:</b> {contactNumber}
                  </p>
                </div>
                <div>
                  <p>
                    <b>Date:</b> {day(quote.issue_date)}
                  </p>
                  <p>
                    <b>Address:</b> {clientAddress}
                  </p>
                  <p>
                    <b>Email:</b> {clientEmail}
                  </p>
                </div>
              </div>
              <p className="mt-5 text-[12px] leading-4">
                Dear Sir/Madam,
                <br />
                We thank you for the opportunity to serve your requirements.
              </p>
              <p className="mt-2 text-right text-[10px]">
                <b>Quotation no.:</b> {text(quote.quotation_no)}
              </p>
              <table className="mt-1 w-full border-collapse text-[11px]">
                <thead className="font-bold" style={{ display: "table-header-group" }}>
                  <tr>
                    {[
                      ["ITEM", "w-[11%]"],
                      ["DESCRIPTION", "w-[38%]"],
                      ["QUANTITY", "w-[20%]"],
                      ["SELLING PRICE/UNIT", "w-[16%]"],
                      ["AMOUNT", "w-[15%]"],
                    ].map(([label, width]) => (
                      <th
                        key={label}
                        className={`${width} border border-[#666] px-1 py-2 text-center leading-3`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sellingLines.length ? (
                    sellingLines.map((line, index) => (
                      <tr key={text(line.id)} style={{ breakInside: "avoid" }}>
                        <td className="border border-[#666] px-1 py-3 text-center align-top">
                          {index + 1}
                        </td>
                        <td className="border border-[#666] px-2 py-3 align-top">
                          {text(line.description)}
                        </td>
                        <td className="border border-[#666] px-1 py-3 text-center align-top">
                          {line.quantity} {line.quantity === 1 ? "pc" : "pcs"}
                        </td>
                        <td className="border border-[#666] px-1 py-3 text-center align-top">
                          {peso.format(line.sellingUnitPrice)}
                        </td>
                        <td className="border border-[#666] px-1 py-3 text-center align-top">
                          {peso.format(line.amount)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="border border-[#666] px-2 py-6 text-center"
                      >
                        No quotation items
                      </td>
                    </tr>
                  )}
                  <tr style={{ breakInside: "avoid" }}>
                    <td
                      colSpan={4}
                      className="border border-[#666] px-2 py-2 text-right font-bold"
                    >
                      TOTAL (VAT INCLUSIVE)
                    </td>
                    <td className="border border-[#666] px-1 py-2 text-center font-bold">
                      {peso.format(totalAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p
                className="absolute left-[12mm] right-[12mm] text-center text-[10px] font-bold text-[#315c9c]"
                style={{
                  position: "absolute",
                  bottom: "17mm",
                  left: "12mm",
                  right: "12mm",
                }}
              >
                72 Adrian St., North Fairview Park Subd., Brgy. North Fairview,
                Quezon City, Metro Manila
              </p>
            </section>
            <section
              className="quotation-print-page relative min-h-[14in] w-[8.5in] px-[12mm] pb-[15mm] pt-[12.5mm] text-[12px] leading-[1.4]"
              style={{
                position: "relative",
                width: "8.5in",
                minHeight: "14in",
                padding: "12.5mm 12mm 15mm",
              }}
            >
              <section className="text-[11px] leading-[1.45]">
                <h2 className="mb-3 text-[13px] font-bold">
                  TERMS AND CONDITIONS
                </h2>
                <ol className="list-decimal space-y-[10px] pl-5">
                  {termsBeforeBank.map((term, index) => (
                    <li key={`${index}-${term}`}>{formatTerm(term)}</li>
                  ))}
                </ol>
                <table className="mx-auto mt-5 border-collapse text-[11px]">
                  <tbody>
                    <tr>
                      <td className="border border-[#666] px-3 py-1">
                        Chinabank
                      </td>
                      <td className="border border-[#666] px-3 py-1">
                        Huswell Trading - 133300003109
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-[#666] px-3 py-1">
                        Unionbank
                      </td>
                      <td className="border border-[#666] px-3 py-1">
                        Huswell Trading - 002300008069
                      </td>
                    </tr>
                  </tbody>
                </table>
                {termsAfterBank.length > 0 && (
                  <ol
                    start={5}
                    className="mt-4 list-decimal space-y-[10px] pl-5"
                  >
                    {termsAfterBank.map((term, index) => (
                      <li key={`${index + 4}-${term}`}>{formatTerm(term)}</li>
                    ))}
                  </ol>
                )}
              </section>
              <p
                className="absolute left-[12mm] right-[12mm] text-center text-[10px] font-bold text-[#315c9c]"
                style={{
                  position: "absolute",
                  bottom: "17mm",
                  left: "12mm",
                  right: "12mm",
                }}
              >
                72 Adrian St., North Fairview Park Subd., Brgy. North Fairview,
                Quezon City, Metro Manila
              </p>
            </section>
            <section
              className="quotation-print-page relative min-h-[14in] w-[8.5in] px-[12mm] pb-[15mm] pt-[12.5mm] text-[12px] leading-[1.4]"
              style={{
                position: "relative",
                width: "8.5in",
                minHeight: "14in",
                padding: "12.5mm 12mm 15mm",
              }}
            >
              {continuedTerms.length > 0 && (
                <ol start={7} className="list-decimal space-y-[10px] pl-5">
                  {continuedTerms.map((term, index) => (
                    <li key={`${index + 6}-${term}`}>{formatTerm(term)}</li>
                  ))}
                </ol>
              )}
              <p
                className="absolute"
                style={{ position: "absolute", left: "12.7mm", top: "36.8mm" }}
              >
                Prepared by:
              </p>
              <p
                className="absolute underline"
                style={{
                  position: "absolute",
                  left: "12.7mm",
                  top: "48mm",
                  textDecoration: "underline",
                }}
              >
                {text(quote.representative)}
              </p>
              <p
                className="absolute"
                style={{ position: "absolute", left: "12.7mm", top: "53.6mm" }}
              >
                Sales Executive
              </p>
              <p
                className="absolute"
                style={{ position: "absolute", left: "12.7mm", top: "64.6mm" }}
              >
                Approved by:
              </p>
              <div
                className="absolute w-[52mm] border-t border-[#555] pt-[1mm]"
                style={{
                  position: "absolute",
                  left: "12.7mm",
                  top: "74.8mm",
                  width: "52mm",
                  borderTop: "1px solid #555",
                  paddingTop: "1mm",
                }}
              >
                Mr. Marvin S. Tavarez/Proprietor
              </div>
              <div
                className="absolute w-[41.6mm] border-t border-[#555] pt-[1mm] text-center"
                style={{
                  position: "absolute",
                  left: "126.1mm",
                  top: "74.8mm",
                  width: "41.6mm",
                  borderTop: "1px solid #555",
                  paddingTop: "1mm",
                  textAlign: "center",
                }}
              >
                Conforme
              </div>
              <p
                className="absolute left-[12mm] right-[12mm] text-center text-[10px] font-bold text-[#315c9c]"
                style={{
                  position: "absolute",
                  bottom: "17mm",
                  left: "12mm",
                  right: "12mm",
                }}
              >
                72 Adrian St., North Fairview Park Subd., Brgy. North Fairview,
                Quezon City, Metro Manila
              </p>
            </section>
          </article>
        )}
      </div>
    </div>
  );
}
function Cost({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between border-b border-[#d9e0e9] px-2 py-1.5 ${strong ? "font-medium" : ""}`}
    >
      <span>{label}</span>
      <span>{peso.format(value)}</span>
    </div>
  );
}

function CostingDocument({
  quote,
  store,
  close,
  onPdfError,
  pdfWindow = null,
  printAfterOpen = false,
}: {
  quote: Row;
  store: Store;
  close: () => void;
  onPdfError?: (message: string) => void;
  pdfWindow?: Window | null;
  printAfterOpen?: boolean;
}) {
  const documentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!documentRef.current) return;
    let cancelled = false;
    const exportPdf = async () => {
      await document.fonts?.ready;
      const styles = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules).map((rule) => rule.cssText);
          } catch {
            return [];
          }
        })
        .join("\n");
      const styleLinks = Array.from(document.styleSheets)
        .flatMap((sheet) =>
          sheet.href ? [`<link rel="stylesheet" href="${sheet.href}">`] : [],
        )
        .join("");
      const printStyles = `
        @page { size: 8.5in 14in; margin: 0.48in 0.42in 0.6in; }
        html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
        [data-pdf-document], [data-pdf-document] * { color: #000 !important; font-family: Arial, Helvetica, sans-serif !important; border-color: #000 !important; background-color: #fff !important; }
        [data-pdf-document] img { filter: none !important; }
        [data-pdf-document] table :is(th, td) { text-align: center !important; }
        [data-pdf-document] td { overflow-wrap: anywhere; word-break: break-word; }
        [data-pdf-document] :is(th, b, h1, h2) { font-weight: 700 !important; }
        .huswell-workspace [data-pdf-document] {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 0.5mm 0 0 !important;
          border: 0 !important;
        }
      `;
      const pdfBlob = await pdf(
        <CostingBreakdownPdf quote={quote} store={store} origin={window.location.origin} />,
      ).toBlob();
      if (pdfBlob.size === 0 || pdfBlob.type !== "application/pdf") {
        throw new Error("Unable to open the Costing Breakdown PDF.");
      }
      if (cancelled) return;
      showGeneratedPdfWindow(pdfWindow, pdfBlob, printAfterOpen);
      close();
    };
    const exportTimer = window.setTimeout(() => {
      void exportPdf().catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to generate the Costing Breakdown PDF.";
          if (onPdfError) onPdfError(message);
          else window.alert(message);
        }
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(exportTimer);
    };
  }, [close, onPdfError, pdfWindow, printAfterOpen, quote, store]);
  const lines = store.quotation_items.filter((line) => line.quotation_id === quote.id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const companyName = text(customer?.company_name ?? lead?.client_name ?? quote.client_name, text(quote.project_name));
  const clientName = text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name, "—");
  const approved = text(quote.status) === "approved";
  const cogs = n(quote.total_cost);
  const profit = (cogs * n(quote.profit_margin_rate)) / 100;
  const overhead = (cogs * n(quote.overhead_rate)) / 100;
  const buffer = (cogs * n(quote.buffer_margin_rate)) / 100;
  const commission = (cogs * n(quote.commission_rate)) / 100;
  const sellingExVat = n(quote.subtotal);
  const vatRate = quotationVatRate(quote);
  const projectTypeOptions = quotationProjectTypes;
  return (
    <div className="hidden">
        <article ref={documentRef} data-pdf-document className="mx-auto max-w-[8.5in] border border-[#d5dbe5] bg-white p-8 text-[12px] text-[#202938] print:border-0 print:p-0" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
          <header className="border-b-2 border-[#c43b43] pb-4 text-center">
            <Image src="/huswell-quotation-logo.png" alt="Huswell Trading" width={489} height={153} className="mx-auto h-auto w-56" />
            <h1 className="mt-3 text-lg font-medium text-[#c43b43]">COSTING BREAKDOWN / PRICE QUOTE</h1>
          </header>
          <section className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-10"><div className="min-w-0"><h2 className="font-medium text-[#a22d35]">CLIENT INFORMATION</h2><dl className="mt-2 grid grid-cols-[150px_minmax(180px,1fr)] gap-y-1"><dt>Company Name:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{companyName}</dd><dt>Client Name:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{clientName}</dd><dt>Phone / Email:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{text(quote.client_phone)}</dd></dl></div><div className="pt-7"><span>Date: </span><span className="inline-block min-w-36 border border-[#d5dbe5] px-2 py-1 text-center">{day(quote.issue_date)}</span></div></section>
          <section className="mt-5 grid grid-cols-2 gap-7 border-y border-[#111] py-3"><div><b>DETAILS</b><dl className="mt-2 grid grid-cols-[145px_1fr] gap-y-1"><dt>Size: L x W x H (in./cm.):</dt><dd className="border-b border-[#777] px-1">{text(quote.size_details)}</dd><dt>Quantity:</dt><dd className="border-b border-[#777] px-1">{text(quote.project_quantity)}</dd><dt>Delivery Date:</dt><dd className="border-b border-[#777] px-1">{day(quote.delivery_date)}</dd></dl></div><div><b>PROJECT TYPE</b><div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">{projectTypeOptions.map((type) => <div key={type} className="flex items-center gap-2"><span className="inline-grid size-4 place-items-center border border-[#111] text-[11px]">{text(quote.project_types, "") === type ? "✓" : ""}</span><span>{type}</span></div>)}</div></div></section>
          <table className="pdf-fixed-table mt-6 w-full border-collapse text-sm"><thead className="font-bold"><tr className="bg-[#c43b43] text-white"><th className="w-[52%] border border-[#c43b43] p-2 text-left">Materials and Production</th><th className="w-[14%] border border-[#c43b43] p-2">Quantity</th><th className="w-[17%] border border-[#c43b43] p-2">Unit Cost</th><th className="w-[17%] border border-[#c43b43] p-2">Subtotal</th></tr></thead><tbody>{lines.map((line) => <tr key={text(line.id)}><td className="border border-[#d5dbe5] p-2">{text(line.description)}</td><td className="border border-[#d5dbe5] p-2 text-center">{n(line.quantity)}</td><td className="border border-[#d5dbe5] p-2 text-right">{peso.format(n(line.unit_cost))}</td><td className="border border-[#d5dbe5] p-2 text-right">{peso.format(n(line.line_total))}</td></tr>)}<tr className="font-medium"><td colSpan={3} className="border border-[#d5dbe5] bg-[#fff7f7] p-2">TOTAL ESTIMATED COGS</td><td className="border border-[#d5dbe5] bg-[#fff7f7] p-2 text-right">{peso.format(cogs)}</td></tr></tbody></table>
          <section className="mt-7 max-w-sm border border-[#d5dbe5]"><h2 className="border-b border-[#d5dbe5] bg-[#fff7f7] px-3 py-2 font-medium text-[#a22d35]">MARKUP, VAT, EXPENSES</h2><Cost label={`Declared Markup (${n(quote.profit_margin_rate)}%)`} value={profit} /><Cost label={`Overhead Allocation (${n(quote.overhead_rate)}%)`} value={overhead} /><Cost label={`Buffer Margin (${n(quote.buffer_margin_rate)}%)`} value={buffer} /><Cost label={`Production Commission (${n(quote.commission_rate)}%)`} value={commission} /><Cost label={`VAT (${vatRate}%)`} value={n(quote.vat_amount)} /><Cost label="SELLING PRICE VAT INC." value={n(quote.total_amount)} strong /><Cost label="SELLING PRICE VAT EX." value={sellingExVat} strong /></section>
          <section className="mt-12 flex items-end justify-between"><div className="w-56 text-center"><div className="h-14" /><div className="mx-auto w-52 border-b border-[#111] pb-1 font-semibold">{text(quote.representative)}</div><div>Sales Executive</div></div><div className="w-56 text-center"><div className="h-14">{approved && <img src="/marvin-tavarez-signature.png" alt="Signature of Mr. Marvin S. Tavarez" className="mx-auto h-14 max-w-full object-contain" />}</div><div className="mx-auto w-52 border-b border-[#111] pb-1 font-semibold">{approved ? "Mr. Marvin S. Tavarez" : "Pending approval"}</div><div>{approved ? `Approved and Signed By · ${day(quote.approved_at)}` : "Approved and Signed By"}</div></div></section>
        </article>
    </div>
  );
}

function InvoiceDocument({
  invoice,
  store,
  close,
}: {
  invoice: Row;
  store: Store;
  close: () => void;
}) {
  const customer = store.customers.find((c) => c.id === invoice.customer_id);
  const lines = store.invoice_items.filter(
    (line) => line.invoice_id === invoice.id,
  );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white p-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex justify-between print:hidden">
          <Button secondary onClick={close}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={14} />
            Print / save PDF
          </Button>
        </div>
        <article data-pdf-document className="border border-[#151922] p-8 text-sm">
          <header className="flex justify-between border-b-2 border-[#151922] pb-5">
            <div>
              <h1 className="text-2xl font-semibold">HUSWELL TRADING</h1>
              <p>Custom box printing and packaging</p>
            </div>
            <div className="text-right">
              <b>INVOICE / RECEIPT</b>
              <p>{text(invoice.invoice_no)}</p>
              <p>Receipt: {text(invoice.receipt_no)}</p>
            </div>
          </header>
          <div className="flex justify-between py-5">
            <div>
              <b>Bill to</b>
              <p>{text(customer?.company_name, "Walk-in customer")}</p>
              <p>{text(customer?.billing_address)}</p>
              <p>{text(customer?.tin)}</p>
            </div>
            <div className="text-right">
              <p>Billing date: {day(invoice.issue_date)}</p>
              <p>Due date: {day(invoice.due_date)}</p>
              <p>Channel: {text(invoice.sales_channel)}</p>
            </div>
          </div>
          <table className="pdf-fixed-table w-full border-collapse">
            <thead className="font-bold">
              <tr className="border-y border-[#151922]">
                <th className="w-[44%] p-2 text-left">Product / service</th>
                <th className="w-[9%] p-2 text-right">Qty</th>
                <th className="w-[16%] p-2 text-right">Price</th>
                <th className="w-[15%] p-2 text-right">Discount</th>
                <th className="w-[16%] p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={text(line.id)} className="border-b border-[#d9e0e9]">
                  <td className="p-2">{text(line.description)}</td>
                  <td className="p-2 text-right">{n(line.quantity)}</td>
                  <td className="p-2 text-right">
                    {peso.format(n(line.unit_price))}
                  </td>
                  <td className="p-2 text-right">
                    {peso.format(n(line.discount_amount))}
                  </td>
                  <td className="p-2 text-right">
                    {peso.format(n(line.line_total) - n(line.discount_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <section className="ml-auto mt-5 max-w-xs">
            <Cost label="Net of VAT" value={n(invoice.subtotal)} />
            <Cost
              label={`VAT (${n(invoice.vat_rate)}%)`}
              value={n(invoice.vat_amount)}
            />
            <Cost label="Total amount" value={n(invoice.total_amount)} strong />
          </section>
        </article>
      </div>
    </div>
  );
}

function Quotations({
  store,
  orgId,
  reload,
  notice,
  role,
  profileName,
  mode = "quotation",
  pageLayout = false,
  leadWorkspaceMode,
  onLeadWorkspaceModeChange,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
  profileName: string;
  mode?: "quotation" | "costing";
  pageLayout?: boolean;
  leadWorkspaceMode?: LeadWorkspaceMode;
  onLeadWorkspaceModeChange?: (mode: LeadWorkspaceMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [costingQuoteId, setCostingQuoteId] = useState<string | null>(null);
  const [costingValues, setCostingValues] = useState<{
    inventory_item_id?: string;
    description: string;
    details: string;
    quantity: string;
    unit_cost: string;
    image_url?: string;
  }>({
    description: "",
    details: "",
    quantity: "1",
    unit_cost: "",
  });
  const [costingImage, setCostingImage] = useState<File | null>(null);
  const [costingImagePreview, setCostingImagePreview] = useState<string | null>(
    null,
  );
  const [optimizingCostingImage, setOptimizingCostingImage] = useState(false);
  const imageOptimizationRun = useRef(0);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [pendingCostLines, setPendingCostLines] = useState<PendingCostLine[]>(
    [],
  );
  const [editingCostLine, setEditingCostLine] = useState<
    Row | PendingCostLine | null
  >(null);
  const [costLineModalOpen, setCostLineModalOpen] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [costingPdf, setCostingPdf] = useState<Row | null>(null);
  const [revisionNoteQuote, setRevisionNoteQuote] = useState<Row | null>(null);
  const [pdfWindow, setPdfWindow] = useState<Window | null>(null);
  const [printAfterOpen, setPrintAfterOpen] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState<"quotation" | "costing" | null>(null);
  const [saving, setSaving] = useState(false);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState(currentMonth);
  const [projectOfficerFilter, setProjectOfficerFilter] = useState("all");
  const requestRevision = async (quote: Row) => {
    if (!quote.id) return;
    setSaving(true);
    const { error } = await createClient().rpc("request_quotation_revision", {
      p_costing_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Costing Breakdown revision submitted for General Manager approval.");
    await reload();
  };
  const openPdf = (quote: Row, isCosting: boolean, shouldPrint: boolean) => {
    if (isCosting && text(quote.status) !== "approved") {
      notice("Costing Breakdown PDFs are available after General Manager approval.");
      return;
    }
    const nextWindow = window.open("about:blank", "_blank");
    if (!nextWindow) return notice("Allow pop-ups to open the generated PDF.");
    nextWindow.opener = null;
    setPdfWindow(nextWindow);
    setPrintAfterOpen(shouldPrint);
    setGeneratingPdf(isCosting ? "costing" : "quotation");
    setSelected(isCosting ? null : quote);
    setCostingPdf(isCosting ? quote : null);
  };
  useEffect(() => {
    if (!costingImage) {
      setCostingImagePreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(costingImage);
    setCostingImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [costingImage]);
  const selectCostingImage = async (file: File | null) => {
    if (!file) return;
    if (costingValues.inventory_item_id !== "__manual__") {
      notice(
        "Material images come from the Materials List. Choose Others / Manual Material to upload an image.",
      );
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      notice("Choose a PNG, JPG, or WebP product image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notice("Choose an image that is 20 MB or smaller.");
      return;
    }

    const run = ++imageOptimizationRun.current;
    setOptimizingCostingImage(true);
    try {
      const optimizedImage = await optimizeQuotationImage(file);
      if (run === imageOptimizationRun.current) setCostingImage(optimizedImage);
    } catch {
      if (run === imageOptimizationRun.current) {
        setCostingImage(file);
        notice("The image could not be optimized, so the original was kept.");
      }
    } finally {
      if (run === imageOptimizationRun.current)
        setOptimizingCostingImage(false);
    }
  };
  const isGeneralManager = memberRole(role);
  const canFilterByProjectOfficer = isGeneralManager;
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  const canGenerateCostingPdf = ["owner", "admin"].includes(role);
  const canDeleteQuote = ["owner", "admin"].includes(role);
  const canRequestCostingRevision = isProjectOfficerRole(role) || ["owner", "admin"].includes(role);
  const canCreateQuote = mode === "costing"
    ? isProjectOfficerRole(role) || isGeneralManager
    : false;
  const canUpdateQuote = canAccess(role, "quotations", "update");
  const canCreateQuoteLine = canAccess(role, "quotation_items", "create");
  const canSubmitQuote = canAccess(role, "quotations", "request");
  const qFields: Field[] = [
    {
      key: "lead_id",
      label: "Lead / project",
      type: "select",
      required: true,
      options: store.leads
        .filter((lead) => !["won", "lost"].includes(text(lead.status)))
        .map(
          (lead) =>
            `${lead.id}|${text(lead.contact_name) || text(lead.client_name)} — ${text(lead.project_name)}`,
        ),
    },
    { key: "representative", label: "Sales Executive" },
    { key: "profit_margin_rate", label: "Declared markup %", type: "number" },
    { key: "overhead_rate", label: "Overhead %", type: "number" },
    { key: "buffer_margin_rate", label: "Buffer margin %", type: "number" },
    {
      key: "commission_rate",
      label: "Production commission %",
      type: "number",
    },
    { key: "vat_rate", label: "VAT %", type: "number" },
  ];
  const isCosting = mode === "costing";
  const isManualCostingLine = costingValues.inventory_item_id === "__manual__";
  const officerCostingFields: Field[] = [
    {
      key: "lead_id",
      label: "Client Name - Company Name",
      type: "select",
      required: true,
      options: store.leads.map((lead) => `${lead.id}|${leadClientLabel(lead)}`),
    },
    { key: "client_phone", label: "Phone / email", type: "contact_toggle" },
    { key: "issue_date", label: "Date", type: "date", required: true },
    { key: "size_details", label: "Size: L x W x H", type: "size" },
    { key: "project_quantity", label: "Quantity", type: "number" },
    { key: "delivery_date", label: "Delivery date", type: "date" },
    {
      key: "project_types",
      label: "Project type",
      type: "select",
      options: [...quotationProjectTypes],
    },
    {
      key: "representative",
      label: "Sales Executive",
      required: true,
      readOnly: true,
    },
  ];
  const newQuote = async () => {
    setSaving(true);
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    if (!user.user) {
      setSaving(false);
      return notice("Sign in again before creating a Costing Breakdown.");
    }
    const { data: profile } = await client
      .from("profiles")
      .select("signature_url")
      .eq("id", user.user.id)
      .maybeSingle();
    const leadId = values.lead_id?.split("|")[0];
    const lead = store.leads.find((entry) => entry.id === leadId);
    if (!lead) {
      setSaving(false);
      return notice(
        "Select a Client Name - Company Name from Leads before creating a Costing Breakdown.",
      );
    }
    if (pendingCostLines.length === 0) {
      setSaving(false);
      return notice("Add at least one material or production line before saving.");
    }
    const quotationBusinessSettings = store.business_settings.find(
      (setting) => text(setting.organization_id) === text(orgId),
    );
    const clean: Record<string, unknown> = {
      ...Object.fromEntries(
        officerCostingFields.map((field) => [field.key, values[field.key] ?? ""]),
      ),
      representative: profileName,
      customer_id: null,
      lead_id: leadId,
      client_name: lead?.client_name ?? lead?.contact_name ?? null,
      client_contact_name: lead?.contact_name ?? null,
      client_phone: values.client_phone?.trim() || lead?.phone || lead?.email || null,
      project_name: lead?.project_name ?? lead?.client_name ?? lead?.contact_name ?? "",
      notes: values.notes ?? "",
      bank_details: quotationBankDetails(quotationBusinessSettings?.default_bank_details),
      prepared_by_user_id: user.user.id,
      prepared_by_signature_url: text(profile?.signature_url, "") || null,
      organization_id: orgId,
      quotation_no: ref("QT"),
      document_type: "costing_breakdown",
      status: "draft",
      issue_date: values.issue_date || isoToday(),
      profit_margin_rate: n(values.profit_margin_rate),
      overhead_rate: n(values.overhead_rate),
      buffer_margin_rate: n(values.buffer_margin_rate),
      commission_rate: n(values.commission_rate),
      vat_rate: n(values.vat_rate),
      created_by: user.user.id,
    };
    clean.size_details = costingSizeDetails(
      values.size_details ?? "",
      values.size_unit ?? "Inch",
    );
    delete clean.size_unit;
    delete clean.contact_display;
    const { data, error } = await client
      .from("quotations")
      .insert(clean)
      .select()
      .single();
    if (error || !data) {
      setSaving(false);
      return notice(error?.message ?? "Unable to create quotation.");
    }
    if (pendingCostLines.length) {
      const { error: lineError } = await client.from("quotation_items").insert(
        pendingCostLines.map((line, sort_order) => ({
          quotation_id: data.id,
          inventory_item_id: line.inventory_item_id ?? null,
          description: line.description,
          quantity: line.quantity,
          unit_cost: line.unit_cost,
          ...(line.details ? { details: line.details } : {}),
          ...(line.image_url ? { image_url: line.image_url } : {}),
          sort_order,
        })),
      );
      if (lineError) {
        setSaving(false);
        return notice(
          `Costing Breakdown was created, but its cost lines could not be saved: ${lineError.message}`,
        );
      }
    }
    setSaving(false);
    setCostingValues({
      description: "",
      details: "",
      quantity: "1",
      unit_cost: "",
    });
    setCostingImage(null);
    setImageInputKey((key) => key + 1);
    setPendingCostLines([]);
    await reload();
    setEditingQuote(data);
    setCostingQuoteId(text(data.id));
    notice("Costing Breakdown and its cost lines saved.");
  };
  const addCostLine = async () => {
    if (!isCosting) return;
    if (optimizingCostingImage)
      return notice("Please wait while the product image is optimized.");
    if (!costingValues.inventory_item_id || n(costingValues.quantity) <= 0)
      return notice("Select a material and enter a quantity.");
    if (!costingValues.description.trim())
      return notice("Enter a material name.");
    if (
      !Number.isFinite(Number(costingValues.unit_cost)) ||
      n(costingValues.unit_cost) < 0
    )
      return notice("Enter a valid unit cost.");
    const quantity = n(costingValues.quantity);
    const unitCost = n(costingValues.unit_cost);
    const inventoryItemId = isManualCostingLine
      ? undefined
      : costingValues.inventory_item_id;
    let imageUrl = costingValues.image_url ?? "";
    if (costingImage) {
      if (!costingImage.type.startsWith("image/"))
        return notice("Choose an image file for the quotation item.");
      if (costingImage.size > 5 * 1024 * 1024)
        return notice("The image must be 5 MB or smaller.");
      setSaving(true);
      const extension =
        costingImage.name
          .split(".")
          .pop()
          ?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      const path = `${orgId}/quotation-items/${crypto.randomUUID()}.${extension}`;
      const client = createClient();
      const { error: uploadError } = await client.storage
        .from("quotation-images")
        .upload(path, costingImage, {
          contentType: costingImage.type,
          upsert: false,
        });
      if (uploadError) {
        notice(
          `The cost line was added without its optional image: ${uploadError.message}`,
        );
      } else {
        imageUrl = client.storage.from("quotation-images").getPublicUrl(path)
          .data.publicUrl;
      }
    }
    if (editingCostLine) {
      const lineId = text(editingCostLine.id, "");
      if (lineId.startsWith("pending-")) {
        setPendingCostLines((current) =>
          current.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  inventory_item_id: inventoryItemId,
                  description: costingValues.description.trim(),
                  details: costingValues.details.trim() || undefined,
                  quantity,
                  unit_cost: unitCost,
                  line_total: quantity * unitCost,
                  image_url: imageUrl || line.image_url,
                }
              : line,
          ),
        );
      } else {
        setSaving(true);
        const { error } = await createClient()
          .from("quotation_items")
          .update({
            inventory_item_id: inventoryItemId ?? null,
            description: costingValues.description.trim(),
            ...(costingValues.details.trim() || editingCostLine.details
              ? { details: costingValues.details.trim() || null }
              : {}),
            quantity,
            unit_cost: unitCost,
            ...(imageUrl ? { image_url: imageUrl } : { image_url: null }),
          })
          .eq("id", lineId);
        if (error) {
          setSaving(false);
          return notice(error.message);
        }
        await reload();
      }
      setEditingCostLine(null);
    } else {
      setPendingCostLines((current) => [
        ...current,
        {
          id: `pending-${Date.now()}-${Math.random()}`,
          inventory_item_id: inventoryItemId,
          description: costingValues.description.trim(),
          details: costingValues.details.trim() || undefined,
          quantity,
          unit_cost: unitCost,
          line_total: quantity * unitCost,
          image_url: imageUrl || undefined,
        },
      ]);
    }
    setCostingValues({
      inventory_item_id: undefined,
      description: "",
      details: "",
      quantity: "1",
      unit_cost: "",
      image_url: "",
    });
    setCostingImage(null);
    setImageInputKey((key) => key + 1);
    setCostLineModalOpen(false);
    setSaving(false);
  };
  const editCostLine = (line: Row | PendingCostLine) => {
    imageOptimizationRun.current += 1;
    setOptimizingCostingImage(false);
    setEditingCostLine(line);
    setCostingValues({
      inventory_item_id: text(line.inventory_item_id, "") || "__manual__",
      description: text(line.description, ""),
      details: text(line.details, ""),
      quantity: text(line.quantity, "1"),
      unit_cost: text(line.unit_cost, ""),
      image_url: text(line.image_url, ""),
    });
    setCostingImage(null);
    setImageInputKey((key) => key + 1);
    setCostLineModalOpen(true);
  };
  const cancelCostLineEdit = () => {
    imageOptimizationRun.current += 1;
    setOptimizingCostingImage(false);
    setEditingCostLine(null);
    setCostingValues({
      inventory_item_id: undefined,
      description: "",
      details: "",
      quantity: "1",
      unit_cost: "",
      image_url: "",
    });
    setCostingImage(null);
    setImageInputKey((key) => key + 1);
    setCostLineModalOpen(false);
  };
  const deleteCostLine = async (line: Row | PendingCostLine) => {
    const lineId = text(line.id, "");
    if (!lineId) return;
    if (lineId.startsWith("pending-")) {
      setPendingCostLines((current) =>
        current.filter((item) => item.id !== lineId),
      );
    } else {
      setSaving(true);
      const { error } = await createClient()
        .from("quotation_items")
        .delete()
        .eq("id", lineId);
      if (error) {
        setSaving(false);
        return notice(error.message);
      }
      await reload();
      setSaving(false);
    }
    if (text(editingCostLine?.id, "") === lineId) cancelCostLineEdit();
  };
  const change = async (quote: Row, status: string) => {
    if (!quote.id) return;
    const client = createClient();
    if (status === "pending") {
      const { error } = await client.rpc("submit_costing_breakdown", {
        p_costing_id: quote.id,
      });
      if (error) return notice(error.message);
      notice("Costing Breakdown submitted for General Manager review.");
      await reload();
      return;
    }
    const patch: Record<string, unknown> = { status };
    const { error } = await client
      .from("quotations")
      .update(patch)
      .eq("id", quote.id)
      .eq("organization_id", orgId);
    if (error) return notice(error.message);
    notice(
      "Costing Breakdown status updated.",
    );
    await reload();
  };
  const deleteCostingBreakdown = async (quote: Row) => {
    if (!quote.id || !canDeleteQuote) return;
    setSaving(true);
    const { error } = await createClient().rpc("delete_costing_breakdown", {
      p_costing_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Costing Breakdown and its linked Price Quotation deleted.");
    await reload();
  };
  const saveQuoteEdit = async () => {
    if (!editingQuote?.id) return;
    setSaving(true);
    const patch: Record<string, unknown> = {
      ...values,
    };
    if (values.lead_id) patch.lead_id = values.lead_id.split("|")[0] || null;
    if (values.costing_source_id)
      patch.costing_source_id = values.costing_source_id.split("|")[0] || null;
    patch.size_details = costingSizeDetails(
      values.size_details ?? "",
      values.size_unit ?? "Inch",
    );
    delete patch.size_unit;
    delete patch.contact_display;
    officerCostingFields
      .filter((f) => f.type === "number")
      .forEach((f) => (patch[f.key] = n(patch[f.key])));
    const client = createClient();
    const { error } = await client
      .from("quotations")
      .update(patch)
      .eq("id", editingQuote.id)
      .eq("organization_id", orgId);
    if (error) {
      setSaving(false);
      return notice(error.message);
    }
    if (pendingCostLines.length) {
      const existingLines = store.quotation_items.filter(
        (line) => line.quotation_id === editingQuote.id,
      );
      const { error: lineError } = await client.from("quotation_items").insert(
        pendingCostLines.map((line, index) => ({
          quotation_id: editingQuote.id,
          inventory_item_id: line.inventory_item_id ?? null,
          description: line.description,
          quantity: line.quantity,
          unit_cost: line.unit_cost,
          ...(line.details ? { details: line.details } : {}),
          ...(line.image_url ? { image_url: line.image_url } : {}),
          sort_order: existingLines.length + index,
        })),
      );
      if (lineError) {
        setSaving(false);
        return notice(lineError.message);
      }
    }
    setPendingCostLines([]);
    setSaving(false);
    notice(
      pendingCostLines.length
        ? "Costing Breakdown details and cost lines saved."
        : "Costing Breakdown details saved.",
    );
    await reload();
  };
  const quoteRows = store.quotations.filter(
    (quote) =>
      text(quote.document_type, "price_quotation") ===
      (isCosting ? "costing_breakdown" : "price_quotation"),
  ).filter((quote) =>
    JSON.stringify(quote).toLowerCase().includes(quoteQuery.toLowerCase()) ||
    JSON.stringify(store.leads.find((lead) => lead.id === quote.lead_id) ?? {})
      .toLowerCase()
      .includes(quoteQuery.toLowerCase()),
  ).filter(
    (quote) =>
      !canFilterByProjectOfficer ||
      projectOfficerFilter === "all" ||
      projectOfficerIdForQuote(store, quote) === projectOfficerFilter,
  ).filter((quote) => {
    if (!monthFilter) return true;
    const quoteDate = text(quote.issue_date, "") || text(quote.created_at, "");
    return quoteDate.slice(0, 7) === monthFilter;
  });
  return (
    <div
      className={
        pageLayout
          ? "-m-4 min-h-[calc(100vh-84px)] bg-white lg:-m-5"
          : "space-y-5"
      }
    >
      <Panel
        title={mode === "costing" ? "Costing breakdown" : "Price quotations"}
        detail={
          mode === "costing"
            ? "Build material and production costs, then submit them for General Manager review."
            : "Generated after General Manager approval. View or print the client Price Quotation."
        }
        hideHeading
        action={
          canCreateQuote ? (
            <div className="flex gap-2">
              {canCreateQuote && (
                <>
                  <Button
                    onClick={() => {
                      const s = store.business_settings[0];
                      setEditingQuote(null);
                      setCostingQuoteId(null);
                      setCostingValues({
                        description: "",
                        details: "",
                        quantity: "1",
                        unit_cost: "",
                      });
                      setCostingImage(null);
                      setImageInputKey((key) => key + 1);
                      setPendingCostLines([]);
                      setValues({
                        costing_source_id: "",
                        terms_conditions: DEFAULT_QUOTATION_TERMS,
                        customer_id: "",
                        project_name: "",
                        lead_id: "",
                        contact_display: "phone",
                        client_phone: "",
                        representative: profileName,
                        issue_date: isoToday(),
                        size_details: "",
                        size_unit: "Inch",
                        project_quantity: "",
                        delivery_date: "",
                        project_types: "",
                        valid_until: "",
                        profit_margin_rate: text(
                          s?.default_profit_margin,
                          "75",
                        ),
                        overhead_rate: text(s?.default_overhead_rate, "0"),
                        buffer_margin_rate: text(
                          s?.default_buffer_margin,
                          "20",
                        ),
                        commission_rate: text(s?.production_commission, "5"),
                        vat_rate: text(s?.vat_rate, "12"),
                        notes: "",
                      });
                      setOpen(true);
                    }}
                  >
                    <Plus size={14} />
                    {isCosting
                      ? "Add costing breakdown"
                      : "New price quotation"}
                  </Button>
                </>
              )}
            </div>
          ) : undefined
        }
        variant={pageLayout ? "page" : "card"}
      >
        {leadWorkspaceMode && onLeadWorkspaceModeChange && (
          <LeadWorkspaceTabs
            active={leadWorkspaceMode}
            onChange={onLeadWorkspaceModeChange}
            className="px-4 sm:px-5"
          />
        )}
        <div className="flex flex-wrap gap-2 border-t border-[#edf0f5] px-4 py-2.5 sm:px-5">
          <label className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-md">
            <Search className="absolute left-3 top-2.5 text-[#8b92a1]" size={15} />
            <input
              value={quoteQuery}
              onChange={(event) => setQuoteQuery(event.target.value)}
              className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
              placeholder="Search quotation, project, company, or client"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#687386]">
            <span className="whitespace-nowrap">Month</span>
            <input
              type="month"
              value={monthFilter}
              onClick={(event) => event.currentTarget.showPicker?.()}
              onChange={(event) => setMonthFilter(event.target.value)}
              className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]"
            />
          </label>
          {canFilterByProjectOfficer && (
            <select
              aria-label="Filter by sales officer"
              value={projectOfficerFilter}
              onChange={(event) => setProjectOfficerFilter(event.target.value)}
              className={`lead-filter-select min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${projectOfficerFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
            >
              <option value="all">All Sales Officers</option>
              {projectOfficers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {quoteRows.length ? (
          <div className={pageLayout ? "modern-table-shell" : undefined}>
            <Table
              className={
                pageLayout
                  ? "modern-page-table quotation-list-table"
                  : undefined
              }
              minWidth={760}
              scrollable={pageLayout}
              labels={[
                isCosting ? "Costing Breakdown" : "Price Quotation",
                isCosting ? "Client's Name / Company" : "Customer / project",
                "Estimated COGS",
                "Prepared by",
                isCosting ? "Approval" : "GM approval",
                isCosting ? "Approval date" : "GM approval date",
                "Actions",
              ]}
            >
              {quoteRows.map((q) => {
                const sourceCosting = !isCosting
                  ? store.quotations.find((item) => item.id === q.costing_source_id)
                  : null;
                const revisionRequest = isCosting
                  ? store.quotation_revision_requests.find(
                      (request) =>
                        request.costing_id === q.id &&
                        text(request.status) === "pending",
                    )
                  : null;
                const submittedById = isCosting
                  ? q.submitted_by ?? q.created_by
                  : sourceCosting?.submitted_by ?? sourceCosting?.created_by;
                const submittedBy = text(
                  store.profiles.find((profile) => profile.id === submittedById)
                    ?.full_name,
                  "Sales Officer",
                );
                return (
                <tr key={text(q.id)}>
                  <td className="px-5 py-3">
                    {stackedCell(q.quotation_no, day(q.issue_date))}
                  </td>
                  <td className="px-5 py-3">
                    <b>{text(q.project_name)}</b>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {peso.format(n(q.total_cost))}
                  </td>
                  <td className="px-5 py-3 text-center text-[12px]">
                    {submittedBy}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Status value={q.status} />
                      {revisionRequest && (
                        <span className="text-[11px] text-[#a76605]">Revision requested</span>
                      )}
                      {isCosting && text(q.status) === "needs_revision" && text(q.revision_note, "") && (
                          <NoteAction
                            label="View revision note"
                            tone="amber"
                            onClick={() => setRevisionNoteQuote(q)}
                          />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center text-[12px]">
                    {day(q.approved_at)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {isCosting ? (
                        canGenerateCostingPdf && text(q.status) === "approved" ? (
                          <>
                            <ActionIcon
                              label="View Costing Breakdown PDF"
                              loading={generatingPdf === "costing"}
                              disabled={generatingPdf !== null}
                              onClick={() => openPdf(q, true, false)}
                            >
                              <FileText size={15} />
                            </ActionIcon>
                            <ActionIcon
                              label="Print Costing Breakdown"
                              confirm={false}
                              loading={generatingPdf === "costing"}
                              disabled={generatingPdf !== null}
                              onClick={() => openPdf(q, true, true)}
                            >
                              <Printer size={15} />
                            </ActionIcon>
                          </>
                        ) : !isGeneralManager ? (
                          <ActionIcon
                            label="View Costing Breakdown"
                            confirm={false}
                            onClick={() =>
                              window.open(
                                `/costing-breakdown/${text(q.id, "")}`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <FileText size={15} />
                          </ActionIcon>
                        ) : null
                      ) : <>
                          <ActionIcon
                            label="View Price Quotation PDF"
                            loading={generatingPdf === "quotation"}
                            disabled={generatingPdf !== null}
                            onClick={() => openPdf(q, false, false)}
                        >
                          <FileText size={15} />
                        </ActionIcon>
                        <ActionIcon
                          label="Print Price Quotation"
                          confirm={false}
                          loading={generatingPdf === "quotation"}
                          disabled={generatingPdf !== null}
                          onClick={() => openPdf(q, false, true)}
                        >
                          <Printer size={15} />
                        </ActionIcon>
                      </>}
                      {isCosting &&
                        canUpdateQuote &&
                        ["draft", "needs_revision"].includes(
                          text(q.status),
                        ) && (
                          <ActionIcon
                            label="Edit quotation"
                            onClick={() => {
                              setEditingQuote(q);
                              setValues({
                                ...Object.fromEntries(
                              officerCostingFields.map((f) => [
                                    f.key,
                                    f.key === "lead_id" && q.lead_id
                                      ? `${q.lead_id}|${text(store.leads.find((lead) => lead.id === q.lead_id)?.contact_name) || text(store.leads.find((lead) => lead.id === q.lead_id)?.client_name)} — ${text(store.leads.find((lead) => lead.id === q.lead_id)?.project_name)}`
                                      : f.key === "size_details"
                                        ? costingDimensions(q.size_details)
                                        : text(q[f.key], ""),
                                  ]),
                                ),
                                size_unit: costingSizeUnit(q.size_details),
                                contact_display: "phone",
                              });
                              setCostingQuoteId(text(q.id));
                              setCostingValues({
                                description: "",
                                details: "",
                                quantity: "1",
                                unit_cost: "",
                              });
                              setCostingImage(null);
                              setImageInputKey((key) => key + 1);
                              setPendingCostLines([]);
                            }}
                          >
                            <Pencil size={15} />
                          </ActionIcon>
                        )}
                      {isCosting &&
                        canSubmitQuote &&
                        ["draft", "needs_revision"].includes(text(q.status)) &&
                        <ActionIcon
                          label="Submit for Review"
                          tone="green"
                          loading={saving}
                          disabled={saving}
                          onClick={() => void change(q, "pending")}
                        >
                          <Send size={15} />
                        </ActionIcon>}
                      {isCosting &&
                        canRequestCostingRevision &&
                        text(q.status) === "approved" &&
                        !revisionRequest && (
                          <ActionIcon
                            label="Request costing revision"
                            tone="amber"
                            loading={saving}
                            disabled={saving}
                            onClick={() => void requestRevision(q)}
                          >
                            <RotateCcw size={15} />
                          </ActionIcon>
                        )}
                      {isCosting && canDeleteQuote && (
                        <ActionIcon
                          label="Delete Costing Breakdown and linked Price Quotation"
                          tone="red"
                          loading={saving}
                          disabled={saving}
                          onClick={() => void deleteCostingBreakdown(q)}
                        >
                          <Trash2 size={15} />
                        </ActionIcon>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </Table>
          </div>
        ) : (
          <Empty>
            No generated Price Quotations yet. They appear here after the General
            Manager approves a Costing Breakdown.
          </Empty>
        )}
      </Panel>
      {false &&
        costingQuoteId &&
        (() => {
          const quote = store.quotations.find(
            (item) => item.id === costingQuoteId,
          );
          if (!quote) return null;
          const lines = store.quotation_items.filter(
            (line) => line.quotation_id === costingQuoteId,
          );
          return (
            <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/30 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[14px] shadow-none">
                <Panel
                  title={`Costing — ${text(quote?.quotation_no)}`}
                  detail="Add the material and production costs for this project."
                  action={
                    <ActionIcon
                      label="Close costing editor"
                      onClick={() => setCostingQuoteId(null)}
                    >
                      <X size={16} />
                    </ActionIcon>
                  }
                >
                  <div className="grid gap-3 border-b border-[#edf0f5] p-5 md:grid-cols-[1.4fr_.6fr_.8fr_auto] md:items-end">
                    <label className="text-[12px] font-medium text-[#202938]">
                      Material / Production Cost
                      <input
                        value={costingValues.description}
                        onChange={(event) =>
                          setCostingValues((current) => ({
                            ...current,
                            description: titleCase(event.target.value),
                          }))
                        }
                        placeholder="e.g. PVC tarpaulin"
                        className="mt-1 w-full rounded-md border border-[#d9e0e9] bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-[12px] font-medium text-[#202938]">
                      Quantity
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={costingValues.quantity}
                        onChange={(event) =>
                          setCostingValues((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-[#d9e0e9] bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-[12px] font-medium text-[#202938]">
                      Unit cost
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={costingValues.unit_cost}
                        onChange={(event) =>
                          setCostingValues((current) => ({
                            ...current,
                            unit_cost: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-[#d9e0e9] bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <Button
                      confirm
                      confirmationText="Are you sure you want to add this cost line?"
                      onClick={() => void addCostLine()}
                      loading={saving}
                      disabled={saving}
                    >
                      <Plus size={14} />
                      Add cost
                    </Button>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#edf0f5] px-5 py-3 text-[12px] text-[#626b7a]">
                    <span>Line total</span>
                    <b className="text-[#202938]">
                      {peso.format(
                        n(costingValues.quantity) * n(costingValues.unit_cost),
                      )}
                    </b>
                  </div>
                  {lines.length ? (
                    <Table
                      labels={[
                        "Material / cost",
                        "Quantity",
                        "Unit cost",
                        "Line total",
                      ]}
                    >
                      {lines.map((line) => (
                        <tr key={text(line.id)}>
                          <td className="px-5 py-3 font-medium">
                            {text(line.description)}
                          </td>
                          <td className="px-5 py-3">{n(line.quantity)}</td>
                          <td className="px-5 py-3">
                            {peso.format(n(line.unit_cost))}
                          </td>
                          <td className="px-5 py-3 font-semibold">
                            {peso.format(n(line.line_total))}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <Empty>
                      No cost lines yet. Add the materials and production costs
                      for this quotation.
                    </Empty>
                  )}
                </Panel>
              </div>
            </div>
          );
        })()}
      {isCosting && (open || costingQuoteId) && (
        <>
          <Dialog
            title={
              costingQuoteId
                ? `Costing — ${text(editingQuote?.quotation_no)}`
                : "New Costing Breakdown"
            }
            fields={officerCostingFields}
            values={values}
            setValues={setValues}
            onFieldChange={(key, value, current) => {
              const next = { ...current, [key]: value };
              if (!["lead_id", "contact_display"].includes(key)) return next;
              const selectedLead = store.leads.find(
                (lead) =>
                  lead.id ===
                  (key === "lead_id" ? value : current.lead_id ?? "").split("|")[0],
              );
              const contactType = (
                key === "contact_display" ? value : current.contact_display || "phone"
              ).split("|")[0];
              return {
                ...next,
                ...(key === "contact_display" ? { contact_display: contactType } : {}),
                client_phone: text(
                  contactType === "email"
                    ? selectedLead?.email
                    : selectedLead?.phone,
                  "",
                ),
              };
            }}
            save={() => void (costingQuoteId ? saveQuoteEdit() : newQuote())}
            close={() => {
              setOpen(false);
              setCostingQuoteId(null);
              setEditingQuote(null);
              setPendingCostLines([]);
              setCostLineModalOpen(false);
            }}
            saving={saving}
            saveLabel={
              costingQuoteId ? "Save changes" : "Save costing breakdown"
            }
            className="max-w-5xl"
          >
            {
              <div className="mt-6 border-t border-[#edf0f5] pt-5">
                <h3 className="text-[14px] font-semibold text-[#202938]">
                  Material and production costs
                </h3>
                <p className="mt-1 text-[12px] text-[#8b92a1]">
                  Add every material, labor, and production cost for this
                  breakdown before saving.
                </p>
                {canCreateQuoteLine && (
                  <>
                    <div className="mt-4 flex justify-end">
                      <Button
                        onClick={() => {
                          cancelCostLineEdit();
                          setCostLineModalOpen(true);
                        }}
                      >
                        <Plus size={14} />
                        Add Cost
                      </Button>
                    </div>
                    <div className="hidden">
                      <div className="cost-line-input-grid mt-4">
                        <label className="text-[12px] font-medium text-[#202938]">
                          Product Image{" "}
                          <span className="font-normal text-[#8b92a1]">
                            (Optional)
                          </span>
                          <span
                            title={
                              costingImage?.name ?? "Upload a product image"
                            }
                            className={`input flex cursor-pointer items-center justify-center px-2 py-[7px] text-[12px] ${costingImage ? "border-[#159957] bg-[#f0fbf5] text-[#127543]" : ""}`}
                          >
                            <span>
                              {costingImage
                                ? "✓ Image selected"
                                : "Upload image"}
                            </span>
                            <input
                              key={imageInputKey}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(event) =>
                                void selectCostingImage(
                                  event.target.files?.[0] ?? null,
                                )
                              }
                              className="sr-only"
                            />
                          </span>
                        </label>
                        <label className="text-[12px] font-medium text-[#202938]">
                          Material / Production Cost
                          <input
                            value={costingValues.description}
                            onChange={(event) =>
                              setCostingValues((current) => ({
                                ...current,
                                description: titleCase(event.target.value),
                              }))
                            }
                            placeholder="e.g. PVC tarpaulin"
                            className="input"
                          />
                        </label>
                        <label className="text-[12px] font-medium text-[#202938]">
                          Quantity
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={costingValues.quantity}
                            onChange={(event) =>
                              setCostingValues((current) => ({
                                ...current,
                                quantity: event.target.value,
                              }))
                            }
                            className="input"
                          />
                        </label>
                        <label className="text-[12px] font-medium text-[#202938]">
                          Unit cost
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={costingValues.unit_cost}
                            onChange={(event) =>
                              setCostingValues((current) => ({
                                ...current,
                                unit_cost: event.target.value,
                              }))
                            }
                            className="input"
                          />
                        </label>
                        <div className="cost-line-actions flex items-center gap-1">
                          <Button
                            confirm
                            confirmationText={
                              editingCostLine
                                ? "Are you sure you want to update this cost line?"
                                : "Are you sure you want to add this cost line?"
                            }
                            onClick={() => void addCostLine()}
                            loading={saving}
                            disabled={saving}
                          >
                            <Plus size={14} />
                            {editingCostLine ? "Update cost" : "Add cost"}
                          </Button>
                          {editingCostLine && (
                            <ActionIcon
                              label="Cancel material edit"
                              tone="amber"
                              onClick={cancelCostLineEdit}
                            >
                              <X size={15} />
                            </ActionIcon>
                          )}
                        </div>
                      </div>
                      <label className="mt-3 block text-[12px] font-medium text-[#202938]">
                        Material Description{" "}
                        <span className="font-normal text-[#8b92a1]">
                          (Optional)
                        </span>
                        <textarea
                          rows={3}
                          value={costingValues.details}
                          onChange={(event) =>
                            setCostingValues((current) => ({
                              ...current,
                              details: titleCaseEntry(event.target.value, "details"),
                            }))
                          }
                          placeholder="Add specifications, size, finish, or other details shown in the quotation."
                          className="input mt-1 min-h-[78px] resize-y"
                        />
                      </label>
                    </div>
                  </>
                )}
                {(() => {
                  const savedLines = costingQuoteId
                    ? store.quotation_items.filter(
                        (line) => line.quotation_id === costingQuoteId,
                      )
                    : [];
                  const lines = [...savedLines, ...pendingCostLines];
                  const total = lines.reduce(
                    (sum, line) => sum + n(line.line_total),
                    0,
                  );
                  return (
                    <>
                      {lines.length ? (
                        <div className="mt-4">
                          <Table
                            className="cost-lines-table"
                            minWidth={780}
                            scrollable
                            labels={[
                              "Image",
                              "Material / cost",
                              "Quantity",
                              "Unit cost",
                              "Line total",
                              "Actions",
                            ]}
                          >
                            {lines.map((line) => (
                              <tr
                                key={text(line.id)}
                                className="hover:bg-[#fbfcff]"
                              >
                                <td className="px-4 py-3 text-center align-middle">
                                  {text(line.image_url, "") ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        window.open(
                                          text(line.image_url),
                                          "_blank",
                                          "noopener,noreferrer",
                                        )
                                      }
                                      className="block overflow-hidden rounded-md border border-[#dfe5ed] bg-white shadow-sm transition hover:border-[#c43b43] hover:ring-2 hover:ring-[#c43b43]/10"
                                      title={`Preview image for ${text(line.description)}`}
                                      aria-label={`Preview image for ${text(line.description)}`}
                                    >
                                      <img
                                        src={text(line.image_url)}
                                        alt={`Product image for ${text(line.description)}`}
                                        className="size-12 object-contain"
                                      />
                                    </button>
                                  ) : (
                                    <span
                                      className="inline-grid size-12 place-items-center rounded-md border border-dashed border-[#d7deea] bg-[#fafbfe] text-[#9aa5b5]"
                                      title="No product image"
                                    >
                                      <ImageIcon size={17} />
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 align-middle">
                                  <div className="min-w-0">
                                    <div
                                      className="font-semibold text-[#202938]"
                                      title={text(line.description)}
                                    >
                                      {text(line.description)}
                                    </div>
                                    {text(line.details, "") && (
                                      <div
                                        className="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-4 text-[#6b7485]"
                                        title={text(line.details)}
                                      >
                                        {text(line.details)}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center align-middle tabular-nums">
                                  {n(line.quantity)}
                                </td>
                                <td className="px-4 py-3 text-center align-middle tabular-nums">
                                  {peso.format(n(line.unit_cost))}
                                </td>
                                <td className="px-4 py-3 text-center align-middle font-semibold tabular-nums">
                                  {peso.format(n(line.line_total))}
                                </td>
                                <td className="px-4 py-3 text-center align-middle">
                                  <div className="flex items-center justify-center gap-2">
                                    <ActionIcon
                                      label={`Edit ${text(line.description)}`}
                                      onClick={() => editCostLine(line)}
                                    >
                                      <Pencil size={15} />
                                    </ActionIcon>
                                    <ActionIcon
                                      label={`Delete ${text(line.description)}`}
                                      tone="red"
                                      onClick={() => void deleteCostLine(line)}
                                    >
                                      <Trash2 size={15} />
                                    </ActionIcon>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-lg bg-[#f8faff] px-4 py-5 text-center text-[12px] text-[#8b92a1]">
                          No cost lines yet. Add the materials and production
                          costs above.
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between border-y border-[#edf0f5] py-3 text-[12px] text-[#626b7a]">
                        <span>Total</span>
                        <b className="text-[#202938]">{peso.format(total)}</b>
                      </div>
                    </>
                  );
                })()}
              </div>
            }
          </Dialog>
          {costLineModalOpen && (
            <Dialog
              title={editingCostLine ? "Edit Cost" : "Add Cost"}
              fields={[]}
              values={{}}
              setValues={() => undefined}
              save={() => void addCostLine()}
              close={cancelCostLineEdit}
              saving={saving}
              saveLabel={editingCostLine ? "Update Cost" : "Add Cost"}
              className="max-w-2xl"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="text-[12px] font-medium text-[#202938] sm:col-span-2">
                  <span>
                    Material Image{" "}
                    {isManualCostingLine && (
                      <span className="font-normal text-[#8b92a1]">
                        (Optional)
                      </span>
                    )}
                  </span>
                  {optimizingCostingImage ? (
                    <div className="mt-1 flex min-h-[76px] items-center justify-center gap-2 rounded-lg border border-[#dfe5ed] bg-[#f8faff] px-4 text-center">
                      <ImageIcon size={17} className="text-[#c43b43]" />
                      <span>
                        <span className="block text-[13px] font-medium text-[#313b4b]">
                          Optimizing Image…
                        </span>
                        <span className="block text-[11px] font-normal text-[#7d8797]">
                          Keeping the quotation image clear while reducing its
                          size
                        </span>
                      </span>
                    </div>
                  ) : costingImagePreview || costingValues.image_url ? (
                    <div className="mt-1 flex min-h-[76px] items-center gap-3 rounded-lg border border-[#dfe5ed] bg-[#f8faff] p-2">
                      <img
                        src={costingImagePreview ?? costingValues.image_url}
                        alt="Material preview"
                        className="size-[58px] shrink-0 rounded-md border border-[#e4e8ef] bg-white object-contain"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[#202938]">
                          {costingImage?.name ?? "Image from Materials List"}
                        </p>
                        <p className="mt-0.5 text-[11px] font-normal text-[#778195]">
                          {costingImage
                            ? `${(costingImage.size / 1024 / 1024).toFixed(1)} MB · Ready for quotation`
                            : "Selected automatically with this material"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <label
                          className={`rounded-md px-2 py-1.5 text-[12px] font-medium ${
                            isManualCostingLine
                              ? "cursor-pointer text-[#b5323a] transition hover:bg-[#fff0f1]"
                              : "cursor-not-allowed text-[#9aa5b5]"
                          }`}
                        >
                          Replace
                          <input
                            key={imageInputKey}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!isManualCostingLine}
                            onChange={(event) =>
                              void selectCostingImage(
                                event.target.files?.[0] ?? null,
                              )
                            }
                            className="sr-only"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isManualCostingLine) return;
                            setCostingImage(null);
                            setImageInputKey((key) => key + 1);
                          }}
                          disabled={!isManualCostingLine}
                          className={`grid size-8 place-items-center rounded-md text-[#8a95a6] transition ${
                            isManualCostingLine
                              ? "hover:bg-[#fff0f1] hover:text-[#c43b43]"
                              : "cursor-not-allowed opacity-50"
                          }`}
                          title={isManualCostingLine ? "Remove selected image" : "Image is managed by the Materials List"}
                          aria-label={isManualCostingLine ? "Remove selected image" : "Image is managed by the Materials List"}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label
                      className={`mt-1 flex min-h-[72px] items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center ${
                        isManualCostingLine
                          ? "cursor-pointer border-[#c7d0de] bg-[#fafbfe] transition hover:border-[#c43b43] hover:bg-[#fff8f8]"
                          : "cursor-not-allowed border-[#d7deea] bg-[#f6f8fb]"
                      }`}
                    >
                      <ImageIcon size={17} className="text-[#c43b43]" />
                      <span>
                        <span className="block text-[13px] font-medium text-[#313b4b]">
                          {isManualCostingLine ? "Upload Product Image" : "Image managed by Materials List"}
                        </span>
                        <span className={`block text-[11px] font-normal text-[#7d8797] ${isManualCostingLine ? "" : "hidden"}`}>
                          PNG, JPG or WebP · Images are optimized automatically
                        </span>
                      </span>
                      {!isManualCostingLine && (
                        <span className="text-[11px] font-normal text-[#7d8797]">
                          Choose Others / Manual Material to upload an image
                        </span>
                      )}
                      <input
                        key={imageInputKey}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={!isManualCostingLine}
                        onChange={(event) =>
                          void selectCostingImage(
                            event.target.files?.[0] ?? null,
                          )
                        }
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
                <label className="text-[12px] font-medium text-[#202938]">
                  Material
                  <select
                    required
                    value={costingValues.inventory_item_id ?? ""}
                    onChange={(event) => {
                      const isManual = event.target.value === "__manual__";
                      const material = store.inventory_items.find(
                        (item) => item.id === event.target.value,
                      );
                      setCostingImage(null);
                      setImageInputKey((key) => key + 1);
                      setCostingValues((current) => ({
                        ...current,
                        inventory_item_id: event.target.value,
                        description: isManual ? "" : text(material?.name, ""),
                        details: isManual ? "" : text(material?.description, ""),
                        unit_cost: isManual ? "" : text(material?.standard_cost, ""),
                        image_url: isManual ? "" : text(material?.image_url, ""),
                      }));
                    }}
                    className="input"
                  >
                    <option value="">Select material</option>
                    <option value="__manual__">Others / Manual Material</option>
                    {store.inventory_items
                      .filter(
                        (item) =>
                          item.item_type === "material" &&
                          item.is_active !== false,
                      )
                      .map((item) => (
                        <option key={text(item.id)} value={text(item.id)}>
                          {text(item.name)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-[12px] font-medium text-[#202938]">
                  Quantity
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={costingValues.quantity}
                    onChange={(event) =>
                      setCostingValues((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    className="input"
                  />
                </label>
                {isManualCostingLine && (
                  <label className="text-[12px] font-medium text-[#202938]">
                    Material Name
                    <input
                      value={costingValues.description}
                      onChange={(event) =>
                        setCostingValues((current) => ({
                          ...current,
                          description: titleCase(event.target.value),
                        }))
                      }
                      placeholder="Enter material name"
                      className="input"
                    />
                  </label>
                )}
                <label className="text-[12px] font-medium text-[#202938]">
                  Unit Cost
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={costingValues.unit_cost}
                    readOnly={!isManualCostingLine}
                    onChange={(event) =>
                      setCostingValues((current) => ({
                        ...current,
                        unit_cost: event.target.value,
                      }))
                    }
                    className={`input ${isManualCostingLine ? "" : "bg-[#f6f8fb] text-[#687386]"}`}
                  />
                </label>
                <label className="text-[12px] font-medium text-[#202938] sm:col-span-2">
                  Material Description
                  <textarea
                    rows={2}
                    value={costingValues.details}
                    readOnly={!isManualCostingLine}
                    onChange={(event) =>
                      setCostingValues((current) => ({
                        ...current,
                        details: titleCaseEntry(event.target.value, "details"),
                      }))
                    }
                    placeholder={
                      isManualCostingLine
                        ? "Description shown in the Price Quotation"
                        : ""
                    }
                    className={`input min-h-[64px] resize-none ${isManualCostingLine ? "" : "bg-[#f6f8fb] text-[#687386]"}`}
                  />
                  <span className="mt-1 block text-[10px] font-normal text-[#8b92a1]">
                    {isManualCostingLine
                      ? "Add the description to be shown in the Price Quotation."
                      : "Filled from Materials List. It appears in the Price Quotation, not the Costing Breakdown PDF."}
                  </span>
                </label>
              </div>
              {optimizingCostingImage && (
                <div className="fixed inset-0 z-[60] grid place-items-center bg-[#151922]/35 p-4">
                  <div
                    role="status"
                    aria-live="polite"
                    className="w-full max-w-[280px] rounded-xl border border-[#e6eaf0] bg-white px-6 py-7 text-center shadow-[0_18px_45px_rgba(21,25,34,0.18)]"
                  >
                    <span className="mx-auto block size-9 animate-spin rounded-full border-[3px] border-[#f3d4d7] border-t-[#c43b43]" />
                    <h3 className="mt-4 text-[15px] font-semibold text-[#202938]">
                      Uploading Image
                    </h3>
                    <p className="mt-1 text-[12px] text-[#7d8797]">
                      Please wait a moment.
                    </p>
                  </div>
                </div>
              )}
            </Dialog>
          )}
        </>
      )}
      {false && (
        <Dialog
          title={`Revise ${text(editingQuote?.quotation_no)}`}
          fields={qFields}
          values={values}
          setValues={setValues}
          save={() => void saveQuoteEdit()}
          close={() => {
            setEditingQuote(null);
          }}
          saving={saving}
        />
      )}
      {false && (
        <Dialog
          title="Add quotation cost line"
          fields={[
            {
              key: "quotation_id",
              label: "Quotation",
              type: "select",
              required: true,
              options: store.quotations.map(
                (q) =>
                  `${q.id}|${text(q.quotation_no)} — ${text(q.project_name)}`,
              ),
            },
            {
              key: "description",
              label: "Material / production cost",
              required: true,
            },
            {
              key: "quantity",
              label: "Quantity",
              type: "number",
              required: true,
            },
            {
              key: "unit_cost",
              label: "Unit cost",
              type: "number",
              required: true,
            },
          ]}
          values={values}
          setValues={setValues}
          save={() => void addCostLine()}
          close={() => undefined}
          saving={saving}
        />
      )}
      {selected && (
        <QuotationDocument
          quote={selected}
          store={store}
          close={() => {
            setSelected(null);
            setPdfWindow(null);
            setPrintAfterOpen(false);
            setGeneratingPdf(null);
          }}
          onPdfError={(message) => {
            setSelected(null);
            setPdfWindow(null);
            setPrintAfterOpen(false);
            setGeneratingPdf(null);
            notice(message);
          }}
          autoExportPdf
          pdfWindow={pdfWindow}
          printAfterOpen={printAfterOpen}
          hidden
        />
      )}
      {costingPdf && (
        <CostingDocument
          quote={costingPdf}
          store={store}
          close={() => {
            setCostingPdf(null);
            setPdfWindow(null);
            setPrintAfterOpen(false);
            setGeneratingPdf(null);
          }}
          onPdfError={(message) => {
            setCostingPdf(null);
            setPdfWindow(null);
            setPrintAfterOpen(false);
            setGeneratingPdf(null);
            notice(message);
          }}
          pdfWindow={pdfWindow}
          printAfterOpen={printAfterOpen}
        />
      )}
      <NoteDialog
        open={Boolean(revisionNoteQuote)}
        title="General Manager revision note"
        context={revisionNoteQuote ? text(revisionNoteQuote.quotation_no, "Costing breakdown") : undefined}
        note={text(revisionNoteQuote?.revision_note, "")}
        titleId="costing-revision-note-title"
        onClose={() => setRevisionNoteQuote(null)}
      />
    </div>
  );
}

function PriceQuotationSubmissions({
  store,
  reload,
  notice,
}: {
  store: Store;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [selectedPriceQuotation, setSelectedPriceQuotation] = useState<Row | null>(null);
  const [noteQuotation, setNoteQuotation] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [submissionType, setSubmissionType] = useState<"all" | "new" | "revised">("all");
  const [quotationKind, setQuotationKind] = useState<"price_quotation" | "mockup_quotation">("price_quotation");
  const [queueStage, setQueueStage] = useState<"pending" | "gm_revision">("pending");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  const assignedProjectTypes = new Set(
    store.pricing_officer_project_types
      .filter((assignment) => text(assignment.pricing_officer_user_id, "") === currentUserId)
      .map((assignment) => pricingProjectTypeKey(assignment.project_type)),
  );
  const pendingPriceQuotations = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending" &&
      text(quotation.document_type) === "price_quotation" &&
      !quotation.costing_source_id &&
      assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
  ).sort(newestActivityFirst);
  const pendingMockupQuotations = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending" &&
      text(quotation.document_type) === "mockup_quotation" &&
      assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
  ).sort(newestActivityFirst);
  const gmRevisionPriceQuotations = store.quotations.filter(
    (quotation) =>
      isPricingOfficerRevision(quotation) &&
      text(quotation.document_type) === "price_quotation" &&
      !quotation.costing_source_id &&
      assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
  ).sort(newestActivityFirst);
  const gmRevisionMockupQuotations = store.quotations.filter(
    (quotation) =>
      isPricingOfficerRevision(quotation) &&
      text(quotation.document_type) === "mockup_quotation" &&
      assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
  ).sort(newestActivityFirst);
  const normalizedSearch = search.trim().toLowerCase();
  const matchesSubmissionFilters = (quotation: Row) => {
    const activityAt = queueStage === "gm_revision"
      ? text(quotation.revision_requested_at ?? quotation.updated_at ?? quotation.created_at, "")
      : text(quotation.submitted_at, "");
    const preparedBy = store.profiles.find((profile) => profile.id === (quotation.prepared_by_user_id ?? quotation.submitted_by ?? quotation.created_by))?.full_name;
    const party = quotationParty(quotation, store);
    const matchesSearch = !normalizedSearch || [quotation.quotation_no, party.clientName, party.companyName, quotation.project_name, preparedBy]
      .some((value) => text(value).toLowerCase().includes(normalizedSearch));
    const matchesMonth = !month || activityAt.startsWith(month);
    const revised = n(quotation.resubmission_count) > 0;
    const matchesSubmission = submissionType === "all" || (submissionType === "new" ? !revised : revised);
    return matchesSearch && matchesMonth && matchesSubmission;
  };
  const sortSubmissions = (left: Row, right: Row) => {
    const activityAt = (quotation: Row) => queueStage === "gm_revision"
      ? text(quotation.revision_requested_at ?? quotation.updated_at ?? quotation.created_at, "")
      : text(quotation.submitted_at, "");
    const activityDifference = new Date(activityAt(right)).getTime() - new Date(activityAt(left)).getTime();
    if (Number.isFinite(activityDifference) && activityDifference !== 0) return activityDifference;
    return new Date(text(right.created_at, "")).getTime() - new Date(text(left.created_at, "")).getTime();
  };
  const filteredPriceQuotations = pendingPriceQuotations.filter(matchesSubmissionFilters).sort(sortSubmissions);
  const filteredMockupQuotations = pendingMockupQuotations.filter(matchesSubmissionFilters).sort(sortSubmissions);
  const filteredGmRevisionPriceQuotations = gmRevisionPriceQuotations.filter(matchesSubmissionFilters).sort(sortSubmissions);
  const filteredGmRevisionMockupQuotations = gmRevisionMockupQuotations.filter(matchesSubmissionFilters).sort(sortSubmissions);
  const activeSubmissions = queueStage === "gm_revision"
    ? quotationKind === "price_quotation" ? filteredGmRevisionPriceQuotations : filteredGmRevisionMockupQuotations
    : quotationKind === "price_quotation" ? filteredPriceQuotations : filteredMockupQuotations;
  const activePendingSubmissions = queueStage === "gm_revision"
    ? quotationKind === "price_quotation" ? gmRevisionPriceQuotations : gmRevisionMockupQuotations
    : quotationKind === "price_quotation" ? pendingPriceQuotations : pendingMockupQuotations;
  const submissionLabel = (quotation: Row) => {
    const count = n(quotation.resubmission_count);
    return count === 0 ? "New" : count === 1 ? "Revised" : `Revised ${count}×`;
  };
  const officerName = (quotation: Row) =>
    text(
      store.profiles.find(
        (profile) =>
          profile.id === (quotation.prepared_by_user_id ?? quotation.submitted_by ?? quotation.created_by),
      )?.full_name,
      "Sales Executive",
    );
  return (
    <Panel
      title="Quotation Review Queue"
      detail="Review assigned quotations and address General Manager revisions before resubmitting."
      variant="page"
      hideHeading
    >
      <div className="app-tabs border-b border-[#edf0f5] px-4 pt-3 sm:px-5">
        <button type="button" onClick={() => { setQuotationKind("price_quotation"); setSelectedPriceQuotation(null); }} aria-current={quotationKind === "price_quotation" ? "page" : undefined} className="app-tab">Price Quotations ({queueStage === "gm_revision" ? gmRevisionPriceQuotations.length : pendingPriceQuotations.length})</button>
        <button type="button" onClick={() => { setQuotationKind("mockup_quotation"); setSelectedPriceQuotation(null); }} aria-current={quotationKind === "mockup_quotation" ? "page" : undefined} className="app-tab">Mockup Quotations ({queueStage === "gm_revision" ? gmRevisionMockupQuotations.length : pendingMockupQuotations.length})</button>
      </div>
      <div className="app-tabs border-b border-[#edf0f5] px-4 pt-2 sm:px-5">
        <button type="button" onClick={() => { setQueueStage("pending"); setSelectedPriceQuotation(null); }} aria-current={queueStage === "pending" ? "page" : undefined} className="app-tab">Awaiting Review ({quotationKind === "price_quotation" ? pendingPriceQuotations.length : pendingMockupQuotations.length})</button>
        <button type="button" onClick={() => { setQueueStage("gm_revision"); setSelectedPriceQuotation(null); }} aria-current={queueStage === "gm_revision" ? "page" : undefined} className="app-tab">GM Revisions ({quotationKind === "price_quotation" ? gmRevisionPriceQuotations.length : gmRevisionMockupQuotations.length})</button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[#edf0f5] px-4 py-3 sm:px-5">
        <label className="min-w-[190px] flex-1 text-[11px] font-medium text-[#687386]">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Quotation, client, or project" className="input mt-1" /></label>
        <label className="text-[11px] font-medium text-[#687386]">Month<input type="month" value={month} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setMonth(event.target.value)} className="input mt-1 w-[155px]" /></label>
        <label className="text-[11px] font-medium text-[#687386]">Submission<select value={submissionType} onChange={(event) => setSubmissionType(event.target.value as "all" | "new" | "revised")} className="input mt-1 w-[130px]"><option value="all">All</option><option value="new">New</option><option value="revised">Revised</option></select></label>
        {(search || month || submissionType !== "all") && <Button secondary onClick={() => { setSearch(""); setMonth(""); setSubmissionType("all"); }}>Clear filters</Button>}
      </div>
      {activeSubmissions.length ? (
        <div className="modern-table-shell">
        <Table labels={[quotationKind === "price_quotation" ? "Price Quotation" : "Mockup Quotation", "Client's Name", "Company Name", "Prepared by", queueStage === "gm_revision" ? "Returned" : "Submitted", "Note", "Review"]} minWidth={940}>
          {activeSubmissions.map((quotation) => {
            const lead = store.leads.find((item) => item.id === quotation.lead_id);
            const party = quotationParty(quotation, store);
            return (
              <tr key={text(quotation.id)}>
                <td className="px-5 py-3"><div className="flex items-center gap-2"><b>{text(quotation.quotation_no)}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${queueStage === "gm_revision" ? "bg-[#fff4dd] text-[#9a6700]" : n(quotation.resubmission_count) > 0 ? "bg-[#fff4dd] text-[#9a6700]" : "bg-[#edf5ff] text-[#175cd3]"}`}>{queueStage === "gm_revision" ? "GM Revision" : submissionLabel(quotation)}</span></div>{comparableDisplayText(text(quotation.project_name, text(lead?.project_name))) !== comparableDisplayText(quotation.quotation_no) && <small>{text(quotation.project_name, text(lead?.project_name))}</small>}</td>
                <td className="px-5 py-3 font-medium">{party.clientName}</td>
                <td className="px-5 py-3">{party.companyName}</td>
                <td className="px-5 py-3">{officerName(quotation)}</td>
                <td className="px-5 py-3">{day(queueStage === "gm_revision" ? quotation.revision_requested_at ?? quotation.updated_at ?? quotation.created_at : quotation.submitted_at)}</td>
                <td className="px-5 py-3">
                  {text(quotation.revision_note, "").trim() ? (
                    <NoteAction
                      label="View General Manager instructions"
                      tone="amber"
                      onClick={() => setNoteQuotation(quotation)}
                    />
                  ) : (
                    <span className="text-[11px] text-[#8b92a1]">—</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <ActionIcon label={quotationKind === "price_quotation" ? "Review Price Quotation" : "Review Mockup Quotation"} confirm={false} onClick={() => setSelectedPriceQuotation(quotation)}><FileText size={15} /></ActionIcon>
                </td>
              </tr>
            );
          })}
        </Table>
        </div>
      ) : (
        <Empty>{activePendingSubmissions.length ? `No ${quotationKind === "price_quotation" ? "Price Quotations" : "Mockup Quotations"} match the selected filters.` : queueStage === "gm_revision" ? `No ${quotationKind === "price_quotation" ? "Price Quotations" : "Mockup Quotations"} have been returned by the General Manager.` : `No ${quotationKind === "price_quotation" ? "Price Quotations" : "Mockup Quotations"} are awaiting review.`}</Empty>
      )}
      <NoteDialog
        open={Boolean(noteQuotation)}
        title="General Manager instructions"
        context={noteQuotation ? text(noteQuotation.quotation_no, quotationKind === "price_quotation" ? "Price Quotation" : "Mockup Quotation") : undefined}
        note={text(noteQuotation?.revision_note, "")}
        emptyText="No instructions were provided."
        titleId="quotation-queue-note-title"
        onClose={() => setNoteQuotation(null)}
      />
      {selectedPriceQuotation && (
        <PriceQuotationReview
          quotation={selectedPriceQuotation}
          store={store}
          quotationKind={quotationKind}
          saving={false}
          close={() => setSelectedPriceQuotation(null)}
          notice={notice}
          reload={reload}
        />
      )}
    </Panel>
  );
}

function PriceQuotationWorkspace({
  store,
  orgId,
  reload,
  notice,
  role,
  profileName,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
  profileName: string;
}) {
  type DraftItem = {
    key: string;
    id?: string;
    description: string;
    quantity: string;
    imageUrl?: string;
    imageFile?: File;
    imagePreview?: string;
  };
  type QuotationIllustrationDraft = {
    key: string;
    imageUrl?: string;
    imageFile?: File;
    imagePreview?: string;
    fileName?: string;
    contentType?: string;
  };
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [leadId, setLeadId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { key: "item-1", description: "", quantity: "1" },
  ]);
  const [quotationIllustrations, setQuotationIllustrations] = useState<
    QuotationIllustrationDraft[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [quotationTab, setQuotationTab] = useState<"draft" | "pending" | "needs_revision" | "approved">(() => isProjectOfficerRole(role) ? "draft" : memberRole(role) ? "approved" : "pending");
  const [quotationQuery, setQuotationQuery] = useState("");
  const quotationDefaultMonth = isPricingOfficerRole(role) ? "" : currentMonth();
  const [quotationMonth, setQuotationMonth] = useState(quotationDefaultMonth);
  const [preparedByFilter, setPreparedByFilter] = useState("all");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pdfQuote, setPdfQuote] = useState<Row | null>(null);
  const [pdfWindow, setPdfWindow] = useState<Window | null>(null);
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const [revisionNoteQuote, setRevisionNoteQuote] = useState<Row | null>(null);
  const [illustrationQuote, setIllustrationQuote] = useState<Row | null>(null);
  const [proofQuote, setProofQuote] = useState<Row | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<Row | null>(null);
  const [endorseQuote, setEndorseQuote] = useState<Row | null>(null);
  const [printAfterOpen, setPrintAfterOpen] = useState(false);
  const [endorsementValues, setEndorsementValues] = useState<Record<string, string>>({ recipient_user_id: "", note: "" });
  const [endorsing, setEndorsing] = useState(false);
  const [openingEndorsementId, setOpeningEndorsementId] = useState<string | null>(null);
  const canPrepare = isProjectOfficerRole(role);
  const isGeneralManager = memberRole(role);
  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => { active = false; };
  }, []);
  const isCombinedRole = role === "sales_pricing_officer";
  const quotations = store.quotations.filter(
    (quote) =>
      text(quote.document_type) === "price_quotation" &&
      (!isCombinedRole ||
        [quote.created_by, quote.prepared_by_user_id, quote.submitted_by].some(
          (userId) => text(userId, "") === currentUserId,
        ) || text(quote.pricing_reviewed_by, "") === currentUserId),
  );
  const preparedByKey = (quote: Row) =>
    projectOfficerIdForQuote(store, quote) || text(quote.representative, "");
  const preparedByName = (quote: Row) =>
    text(
      store.profiles.find(
        (profile) => profile.id === preparedByKey(quote),
      )?.full_name,
      text(quote.representative, "Sales Executive"),
    );
  const quotationPreparers = Array.from(
    new Map(quotations.map((quote) => [preparedByKey(quote), preparedByName(quote)])).entries(),
  ).map(([id, name]) => ({ id, name })).filter((officer) => officer.id);
  const recipientEndorsements = store.price_quotation_endorsements.filter(
    (endorsement) => text(endorsement.recipient_user_id) === currentUserId && text(endorsement.status) === "active",
  );
  const availableEndorsementRecipients = projectOfficerOptions(store).filter(
    (officer) => officer.id !== currentUserId,
  );
  const filteredQuotations = quotations.filter((quote) => {
    if (text(quote.status) !== quotationTab) return false;
    if (preparedByFilter !== "all" && preparedByKey(quote) !== preparedByFilter) return false;
    const quotationDate = text(
      text(quote.status) === "approved"
        ? quote.approved_at ?? quote.issue_date ?? quote.created_at
        : quote.issue_date ?? quote.created_at,
    );
    if (quotationMonth && quotationDate.slice(0, 7) !== quotationMonth) return false;
    const searchable = [
      quote.quotation_no,
      quote.client_name,
      quote.project_name,
      quote.representative,
      preparedByName(quote),
    ].map((value) => text(value).toLowerCase()).join(" ");
    return searchable.includes(quotationQuery.trim().toLowerCase());
  }).sort(newestActivityFirst);
  const availableLeads = store.leads.filter(
    (lead) =>
      !["won", "lost"].includes(text(lead.status)) &&
      (!isProjectOfficerRole(role) || Boolean(currentUserId) && lead.assigned_to === currentUserId),
  );
  const resetEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setLeadId("");
    setProjectType("");
    setItems([{ key: `item-${Date.now()}`, description: "", quantity: "1" }]);
    setQuotationIllustrations([]);
  };
  const openNew = () => {
    setEditing(null);
    setLeadId("");
    setProjectType("");
    setItems([{ key: `item-${Date.now()}`, description: "", quantity: "1" }]);
    setQuotationIllustrations([]);
    setEditorOpen(true);
  };
  const openEdit = (quote: Row) => {
    const quoteItems = store.quotation_items.filter(
      (item) => item.quotation_id === quote.id,
    );
    setEditing(quote);
    setLeadId(text(quote.lead_id));
    setProjectType(text(quote.project_types));
    setItems(
      quoteItems.length
        ? quoteItems.map((item, index) => ({
            key: text(item.id, `item-${index}`),
            id: text(item.id, "") || undefined,
            description: text(item.description),
            quantity: text(item.quantity, "1"),
            imageUrl: text(item.image_url, "") || undefined,
          }))
        : [{ key: "item-1", description: "", quantity: "1" }],
    );
    setQuotationIllustrations(
      store.price_quotation_illustrations
        .filter((illustration) => illustration.quotation_id === quote.id)
        .sort((left, right) => n(left.sort_order) - n(right.sort_order))
        .map((illustration, index) => ({
          key: text(illustration.id, `illustration-${index}`),
          imageUrl: text(illustration.image_url, "") || undefined,
          fileName: text(illustration.file_name, "") || undefined,
          contentType: text(illustration.content_type, "") || undefined,
        })),
    );
    setEditorOpen(true);
  };
  const openEndorsement = (quote: Row) => {
    setEndorseQuote(quote);
    setEndorsementValues({ recipient_user_id: "", note: "" });
  };
  const endorse = async () => {
    if (!endorseQuote) return;
    const recipientUserId = text(endorsementValues.recipient_user_id).trim();
    if (!recipientUserId) return notice("Select the Sales Executive receiving this copy.");
    setEndorsing(true);
    const client = createClient();
    try {
      const { data, error } = await client.rpc("create_price_quotation_endorsement", {
        p_quotation_id: endorseQuote.id,
        p_recipient_user_id: recipientUserId,
        p_note: text(endorsementValues.note).trim() || null,
      });
      if (error) throw error;
      const endorsement = Array.isArray(data) ? data[0] : data;
      if (!endorsement?.id || !endorsement.snapshot_path) throw new Error("Unable to prepare the endorsement.");
      const pdfBlob = await pdf(<PriceQuotationPdf quote={endorseQuote} store={store} origin={window.location.origin} />).toBlob();
      if (!pdfBlob.size) throw new Error("Unable to generate the approved Price Quotation PDF.");
      const { error: uploadError } = await client.storage.from("price-quotation-endorsements").upload(endorsement.snapshot_path, pdfBlob, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const { error: activateError } = await client.rpc("activate_price_quotation_endorsement", { p_endorsement_id: endorsement.id });
      if (activateError) throw activateError;
      setEndorseQuote(null);
      notice("Approved Price Quotation copy endorsed successfully.");
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Failed to endorse the Price Quotation.");
    }
    setEndorsing(false);
  };
  const openEndorsedSnapshot = async (endorsement: Row) => {
    const endorsementWindow = window.open("", "_blank");
    if (!endorsementWindow) return notice("Allow pop-ups to view the endorsed PDF.");
    endorsementWindow.opener = null;
    setOpeningEndorsementId(text(endorsement.id));
    try {
      const { data, error } = await createClient().storage.from("price-quotation-endorsements").createSignedUrl(text(endorsement.snapshot_path), 5 * 60);
      if (error || !data?.signedUrl) throw error ?? new Error("Unable to open the endorsed PDF.");
      endorsementWindow.location.href = data.signedUrl;
    } catch (error) {
      endorsementWindow.close();
      notice(error instanceof Error ? error.message : "Unable to open the endorsed PDF.");
    } finally { setOpeningEndorsementId(null); }
  };
  const saveDraft = async () => {
    if (!leadId) return notice("Select a lead before saving the quotation.");
    if (!projectType.trim()) return notice("Enter the project type before saving the quotation.");
    if (items.filter((item) => item.imageUrl || item.imageFile).length > 5) {
      return notice("A Price Quotation can have a maximum of five illustrations.");
    }
    setSaving(true);
    const client = createClient();
    const savedItems: DraftItem[] = [];
    const savedQuotationIllustrations: { image_url: string; file_name?: string; content_type?: string }[] = [];
    try {
      for (const item of items) {
        let imageUrl = item.imageUrl;
        if (item.imageFile) {
          const extension = item.imageFile.type === "image/png" ? "png" : item.imageFile.type === "image/webp" ? "webp" : "jpg";
          const path = `${orgId}/price-quotation-illustrations/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await client.storage
            .from("quotation-images")
            .upload(path, item.imageFile, { contentType: item.imageFile.type, upsert: false });
          if (uploadError) throw uploadError;
          imageUrl = client.storage.from("quotation-images").getPublicUrl(path).data.publicUrl;
        }
        savedItems.push({ ...item, imageUrl });
      }
      for (const illustration of quotationIllustrations) {
        let imageUrl = illustration.imageUrl;
        let fileName = illustration.fileName;
        let contentType = illustration.contentType;
        if (illustration.imageFile) {
          const extension = illustration.imageFile.type === "application/pdf" ? "pdf" : illustration.imageFile.type === "image/png" ? "png" : illustration.imageFile.type === "image/webp" ? "webp" : "jpg";
          const path = `${orgId}/price-quotation-illustrations/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await client.storage
            .from("quotation-images")
            .upload(path, illustration.imageFile, { contentType: illustration.imageFile.type, upsert: false });
          if (uploadError) throw uploadError;
          imageUrl = client.storage.from("quotation-images").getPublicUrl(path).data.publicUrl;
          fileName = illustration.imageFile.name;
          contentType = illustration.imageFile.type;
        }
        if (imageUrl) savedQuotationIllustrations.push({ image_url: imageUrl, ...(fileName ? { file_name: fileName } : {}), ...(contentType ? { content_type: contentType } : {}) });
      }
    } catch (error) {
      setSaving(false);
      return notice(error instanceof Error ? error.message : "Illustrations could not be uploaded.");
    }
    const { data, error } = await client.rpc("save_price_quotation_draft", {
      p_quotation_id: editing?.id ?? null,
      p_lead_id: leadId,
      p_project_type: projectType.trim(),
      p_items: savedItems.map((item) => ({
        id: item.id ?? null,
        description: item.description,
        quantity: n(item.quantity),
        image_url: item.imageUrl ?? "",
      })),
      // The established five-argument draft function validates only the
      // legacy per-item image URLs. Gallery illustrations are validated and
      // persisted by the six-argument wrapper in migration 093.
      p_has_illustrations: savedItems.some((item) => Boolean(item.imageUrl)),
      p_quotation_illustrations: savedQuotationIllustrations,
    });
    if (error) {
      setSaving(false);
      return notice(error.message);
    }
    const resubmitRevision =
      isProjectOfficerRole(role) &&
      text(editing?.status) === "needs_revision";
    if (resubmitRevision) {
      const { error: submitError } = await client.rpc("submit_price_quotation", {
        p_quotation_id: text(data),
      });
      if (submitError) {
        setSaving(false);
        return notice(`Changes were saved as a draft, but could not be submitted: ${submitError.message}`);
      }
    }
    setSaving(false);
    resetEditor();
    notice(
      resubmitRevision
        ? "Price Quotation updated and submitted to the assigned Sales & Pricing Officer."
        : editing
          ? "Price Quotation updated."
          : "Price Quotation draft created.",
    );
    await reload();
    return data;
  };
  const submit = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("submit_price_quotation", {
      p_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Price Quotation submitted to the assigned Sales & Pricing Officer.");
    await reload();
  };
  const unsubmit = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("unsubmit_price_quotation", {
      p_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Price Quotation returned to draft.");
    await reload();
  };
  const unsubmitRevisionRequest = async (request: Row) => {
    if (!request.id) return;
    setSaving(true);
    const { error } = await createClient().rpc(
      "unsubmit_price_quotation_revision",
      { p_request_id: request.id },
    );
    setSaving(false);
    if (error) return notice(error.message);
    notice("Price Quotation revision request unsubmitted.");
    await reload();
  };
  const beginRevision = async (quote: Row) => {
    setSaving(true);
    const { error } = await createClient().rpc("begin_price_quotation_revision", {
      p_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    await reload();
    openEdit({ ...quote, status: "needs_revision" });
    notice("Update the Price Quotation, then submit it to the assigned Sales & Pricing Officer.");
  };
  const canDeletePriceQuotation = (quote: Row) =>
    isGeneralManager ||
    (isProjectOfficerRole(role) &&
      !isPricingOfficerRevision(quote) &&
      !quote.costing_source_id &&
      quote.created_by === currentUserId &&
      ["draft", "needs_revision"].includes(text(quote.status)));
  const deletePriceQuotation = async (quote: Row) => {
    if (!quote.id || !canDeletePriceQuotation(quote)) return;
    setSaving(true);
    const { error } = await createClient().rpc("delete_price_quotation", {
      p_quotation_id: quote.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    notice("Price Quotation deleted.");
    await reload();
  };
  const chooseIllustration = (itemKey: string, file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return notice("Illustrations must be JPEG, PNG, or WebP images.");
    }
    if (file.size > 5 * 1024 * 1024) {
      return notice("Each illustration must be 5 MB or smaller.");
    }
    const item = items.find((value) => value.key === itemKey);
    const illustrationCount = items.filter((value) => value.imageUrl || value.imageFile).length;
    if (!item?.imageUrl && !item?.imageFile && illustrationCount >= 5) {
      return notice("A Price Quotation can have a maximum of five illustrations.");
    }
    setItems((current) => current.map((value) => value.key === itemKey ? { ...value, imageFile: file, imagePreview: URL.createObjectURL(file) } : value));
  };
  const addQuotationIllustrations = (files?: FileList | File[]) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    if (quotationIllustrations.length + selected.length > 5) {
      return notice("A Price Quotation can have a maximum of five illustrations.");
    }
    const invalidFile = selected.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) ||
        file.size > 5 * 1024 * 1024,
    );
    if (invalidFile) {
      return notice("Illustrations must be JPEG, PNG, WebP, or PDF files no larger than 5 MB each.");
    }
    setQuotationIllustrations((current) => [
      ...current,
      ...selected.map((file) => ({
        key: `quotation-illustration-${crypto.randomUUID()}`,
        imageFile: file,
        imagePreview: URL.createObjectURL(file),
        fileName: file.name,
        contentType: file.type,
      })),
    ]);
  };
  const openPdf = (quote: Row, shouldPrint = false) => {
    if (text(quote.status) !== "approved") {
      return notice("Price Quotations can be opened after General Manager approval.");
    }
    // `noopener` can cause window.open to return null, leaving the PDF renderer
    // without the tab it needs to populate. Open the blank tab from the click,
    // then remove its opener before loading the generated blob URL.
    const nextWindow = window.open("about:blank", "_blank");
    if (!nextWindow) return notice("Allow pop-ups to open the quotation PDF.");
    nextWindow.opener = null;
    setPrintAfterOpen(shouldPrint);
    setPdfWindow(nextWindow);
    setPdfQuote(quote);
  };
  return (
    <Panel
      title="Price Quotations"
      detail={
        isGeneralManager
          ? "View approved and historical quotation records. Management approval actions are collected in the Approval Center."
          : "Prepare a quotation from a lead, then submit it to the assigned Sales & Pricing Officer."
      }
      variant="page"
      hideHeading
      action={
        canPrepare ? (
          <Button onClick={openNew}>
            <Plus size={14} /> Request Price Quotation
          </Button>
        ) : undefined
      }
    >
      <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mb-4">
        <nav aria-label="Price quotation sections" className="app-tabs">
          {(["draft", "pending", "needs_revision", "approved"] as const).map((tab) => {
            const labels = { draft: "Draft", pending: "Pending Review", needs_revision: "Needs Revision", approved: "Approved" };
            return <button key={tab} type="button" onClick={() => setQuotationTab(tab)} aria-current={quotationTab === tab ? "page" : undefined} className="app-tab">{labels[tab]} ({quotations.filter((quote) => text(quote.status) === tab).length})</button>;
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#edf0f5] py-3">
          <label className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm" htmlFor="price-quotation-search"><Search className="pointer-events-none absolute left-3 top-2.5 text-[#8b92a1]" size={15} /><span className="sr-only">Search quotations</span><input id="price-quotation-search" type="search" value={quotationQuery} onChange={(event) => setQuotationQuery(event.target.value)} placeholder="Search quotations" className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]" /></label>
          <label className="flex items-center gap-2 text-[12px] text-[#687386]"><span className="whitespace-nowrap">Month</span><input type="month" value={quotationMonth} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setQuotationMonth(event.target.value)} className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-2 text-[12px] text-[#202938] outline-none focus:border-[#c43b43]" /></label>
          {!isProjectOfficerRole(role) && <><label className="sr-only" htmlFor="price-quotation-officer">Sales Officer</label><select id="price-quotation-officer" value={preparedByFilter} onChange={(event) => setPreparedByFilter(event.target.value)} className={`min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${preparedByFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}><option value="all">All Sales Officers</option>{quotationPreparers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select></>}
          {!quotationMonth && <span className="text-[11px] text-[#8b92a1]">All months</span>}
          {(quotationQuery || quotationMonth !== quotationDefaultMonth || preparedByFilter !== "all") && <Button secondary onClick={() => { setQuotationQuery(""); setQuotationMonth(quotationDefaultMonth); setPreparedByFilter("all"); }}>Clear filters</Button>}
        </div>
      </div>
      {filteredQuotations.length ? (
        <div className="modern-table-shell">
        <Table
          labels={isProjectOfficerRole(role) ? ["Quotation", "Client's Name", "Company Name", "Status", "Payment status", "Paid / total", "Date", "Actions"] : ["Quotation", "Client's Name", "Company Name", "Prepared by", "Status", "Payment status", "Paid / total", "Date", "Actions"]}
          minWidth={isProjectOfficerRole(role) ? 1120 : 1260}
          className="!w-full"
        >
          {filteredQuotations.map((quote) => {
            const lead = store.leads.find((item) => item.id === quote.lead_id);
            const party = quotationParty(quote, store);
            const preparedBy = preparedByName(quote);
            const isLegacy = Boolean(quote.costing_source_id);
            const pricingOfficerRevision = isPricingOfficerRevision(quote);
            const editable = !isLegacy && !pricingOfficerRevision && ["draft", "needs_revision"].includes(text(quote.status));
            const priceRevisionRequest = store.price_quotation_revision_requests.find(
              (request) =>
                request.quotation_id === quote.id &&
                text(request.status) === "pending",
            );
            const illustrationCount =
              store.price_quotation_illustrations.filter(
                (illustration) => illustration.quotation_id === quote.id,
              ).length +
              store.quotation_items.filter(
                (item) =>
                  item.quotation_id === quote.id && Boolean(text(item.image_url, "")),
              ).length;
            const proofCount = store.quotation_signed_proofs.filter(
              (proof) => proof.quotation_id === quote.id,
            ).length;
            const paymentSummary = quotationPaymentSummary(
              quote,
              store.quotation_payment_records.filter((record) => record.quotation_id === quote.id),
            );
            return (
              <tr key={text(quote.id)}>
                <td className="px-5 py-3">{stackedCell(quote.quotation_no, day(quote.issue_date))}</td>
                <td className="px-5 py-3">{stackedCell(party.clientName, text(quote.project_name, text(lead?.project_name)))}</td>
                <td className="px-5 py-3">{party.companyName}</td>
                {!isProjectOfficerRole(role) && <td className="px-5 py-3">{preparedBy}</td>}
                <td className="px-5 py-3"><div className="flex items-center gap-1.5"><Status value={quote.status} />{priceRevisionRequest && <span className="text-[11px] text-[#a76605]">Revision requested</span>}{text(quote.status) === "needs_revision" && <NoteAction label="View revision note" tone="amber" onClick={() => setRevisionNoteQuote(quote)} />}</div></td>
                <td className="px-5 py-3"><PaymentStatusBadge status={paymentSummary.status} /></td>
                <td className="px-5 py-3 text-right">{peso.format(paymentSummary.verified)} / {peso.format(paymentSummary.total)}</td>
                <td className="px-5 py-3">{text(quote.status) === "approved" ? day(quote.approved_at) : day(quote.submitted_at)}</td>
                <td className="px-5 py-3"><div className="flex items-center gap-1">
                  {editable && canPrepare && (
                    <ActionIcon label="Edit Price Quotation" onClick={() => openEdit(quote)}><Pencil size={15} /></ActionIcon>
                  )}
                  {isProjectOfficerRole(role) && editable && (
                    <ActionIcon label="Submit to Sales & Pricing Officer" tone="green" loading={saving} disabled={saving} onClick={() => void submit(quote)}><Send size={15} /></ActionIcon>
                  )}
                  {isProjectOfficerRole(role) && text(quote.status) === "pending" && (
                    <ActionIcon label="Unsubmit and return to draft" tone="amber" loading={saving} disabled={saving} onClick={() => void unsubmit(quote)}><RotateCcw size={15} /></ActionIcon>
                  )}
                  {isProjectOfficerRole(role) && priceRevisionRequest && (
                    <ActionIcon
                      label="Unsubmit Price Quotation revision request"
                      tone="amber"
                      loading={saving}
                      disabled={saving}
                      confirm
                      onClick={() => void unsubmitRevisionRequest(priceRevisionRequest)}
                    >
                      <RotateCcw size={15} />
                    </ActionIcon>
                  )}
                  {isProjectOfficerRole(role) && !isLegacy && text(quote.status) === "approved" && (
                    <ActionIcon label="Edit and resubmit Price Quotation" tone="amber" loading={saving} disabled={saving || Boolean(priceRevisionRequest)} onClick={() => void beginRevision(quote)}><RotateCcw size={15} /></ActionIcon>
                  )}
                  {isProjectOfficerRole(role) && !isLegacy && text(quote.status) === "approved" && preparedByKey(quote) === currentUserId && (
                    <ActionIcon label="Endorse approved Price Quotation" confirm={false} disabled={endorsing} onClick={() => openEndorsement(quote)}><Send size={15} /></ActionIcon>
                  )}
                  {canDeletePriceQuotation(quote) && (
                    <ActionIcon
                      label="Delete Price Quotation"
                      tone="red"
                      loading={saving}
                      disabled={saving}
                      confirm
                      confirmationDescription={quote.costing_source_id
                        ? "This permanently deletes the historical Price Quotation, its Costing Breakdown, any derived Price Quotations, linked Mockup Quotations, and all linked invoices, payments, production jobs, stock-ins, schedules, and related requests. This cannot be undone."
                        : "This permanently deletes the Price Quotation, any linked Mockup Quotations, and their linked invoices, payments, production jobs, stock-ins, schedules, and related requests. This cannot be undone."}
                      onClick={() => void deletePriceQuotation(quote)}
                    >
                      <Trash2 size={15} />
                    </ActionIcon>
                  )}
                  {illustrationCount > 0 && <ActionIcon label="View quotation illustrations" confirm={false} onClick={() => setIllustrationQuote(quote)}><ImageIcon size={15} /></ActionIcon>}
                  {text(quote.status) === "approved" && <ActionIcon label={isGeneralManager ? "View Internal Costing PDF" : "View Price Quotation PDF"} confirm={false} onClick={() => openPdf(quote)}><FileText size={15} /></ActionIcon>}
                  {text(quote.status) === "approved" && <ActionIcon label={isGeneralManager ? "Print Internal Costing" : "Print Price Quotation"} confirm={false} onClick={() => openPdf(quote, true)}><Printer size={15} /></ActionIcon>}
                  {text(quote.status) === "approved" && <ActionIcon label={"View signed client proof" + (proofCount ? " (" + proofCount + "/5)" : "")} confirm={false} onClick={() => setProofQuote(quote)}><Paperclip size={15} /></ActionIcon>}
                  {text(quote.status) === "approved" && <ActionIcon label="View quotation payments" confirm={false} onClick={() => setPaymentQuote(quote)}><ReceiptText size={15} /></ActionIcon>}
                </div></td>
              </tr>
            );
          })}
        </Table>
        </div>
      ) : <Empty>{quotations.length ? "No Price Quotations match the selected filters." : "No Price Quotations yet. Create one from a lead to begin."}</Empty>}
      </div>
      {isProjectOfficerRole(role) && recipientEndorsements.length > 0 && (
        <section className="border-t border-[#edf0f5] px-4 py-4 sm:px-5 lg:px-6">
          <div className="mb-3"><h3 className="text-[14px] font-semibold text-[#202938]">Endorsed to Me</h3><p className="mt-0.5 text-[12px] text-[#687386]">Read-only PDF copies shared by another Sales Executive.</p></div>
          <div className="modern-table-shell">
          <Table labels={["Price Quotation", "Client's Name", "Company Name", "Endorsed", "PDF"]} minWidth={800}>
            {recipientEndorsements.map((endorsement) => {
              const quotation = store.quotations.find((item) => item.id === endorsement.quotation_id);
              const party = quotation
                ? quotationParty(quotation, store)
                : { clientName: "-", companyName: text(endorsement.client_name) };
              return <tr key={text(endorsement.id)}><td className="px-5 py-3 font-medium">{text(endorsement.quotation_no)}</td><td className="px-5 py-3">{stackedCell(party.clientName, endorsement.project_name)}</td><td className="px-5 py-3">{party.companyName}</td><td className="px-5 py-3">{day(endorsement.activated_at ?? endorsement.created_at)}</td><td className="px-5 py-3"><ActionIcon label="View endorsed Price Quotation PDF" confirm={false} loading={openingEndorsementId === text(endorsement.id)} onClick={() => void openEndorsedSnapshot(endorsement)}><FileText size={15} /></ActionIcon></td></tr>;
           })}
         </Table>
           </div>
       </section>
      )}
      {endorseQuote && (
        <Dialog title="Endorse Price Quotation" fields={[{ key: "recipient_user_id", label: "Sales Executive", type: "select", required: true, options: availableEndorsementRecipients.map((officer) => `${officer.id}|${officer.name}`) }, { key: "note", label: "Note (optional)", type: "textarea", placeholder: "Add a note for the receiving officer." }]} values={endorsementValues} setValues={setEndorsementValues} save={() => void endorse()} close={() => setEndorseQuote(null)} saving={endorsing} saveLabel="Create PDF Copy & Endorse" className="max-w-xl">
          <p className="mt-4 rounded-lg border border-[#f2dadd] bg-[#fff9f9] p-3 text-[12px] leading-5 text-[#687386]">This creates an immutable, read-only PDF copy of {text(endorseQuote.quotation_no)}. Future revisions to the original will not change this endorsed copy.</p>
        </Dialog>
      )}
      {editorOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/30 p-4">
          <section className="mx-auto my-4 w-full max-w-3xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">{editing ? "Edit Price Quotation" : "Request Price Quotation"}</h2><p className="mt-1 text-[12px] text-[#687386]">Add the requested materials and quantities. Selling prices are entered by the assigned Sales & Pricing Officer.</p></div><button type="button" onClick={resetEditor} aria-label="Close" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button></div>
            <label className="mt-5 block text-[12px] font-medium text-[#202938]">Client&apos;s Name - Company Name<select value={leadId} onChange={(event) => setLeadId(event.target.value)} className="input mt-1" required><option value="">Select a lead</option>{availableLeads.map((lead) => <option key={text(lead.id)} value={text(lead.id)}>{leadClientLabel(lead)}</option>)}</select></label>
            <label className="mt-4 block text-[12px] font-medium text-[#202938]">Project Type<select value={projectType} onChange={(event) => setProjectType(event.target.value)} className={`input mt-1 ${projectType ? "text-[#151922]" : "text-[#8b92a1]"}`} required><option value="">Select project type</option>{quotationProjectTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <section className="mt-5 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-[14px] font-semibold text-[#202938]">Illustrations</h3><p className="mt-1 text-[12px] text-[#687386]">Upload up to five pictures or PDF reference files (5 MB each). They are public, view-only, and are not included in the PDF.</p></div>
                <label className={`inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#344054] hover:bg-[#f7f9fc] ${quotationIllustrations.length >= 5 ? "pointer-events-none opacity-50" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" disabled={quotationIllustrations.length >= 5} onChange={(event) => { addQuotationIllustrations(event.target.files ?? undefined); event.currentTarget.value = ""; }} />Add files ({quotationIllustrations.length}/5)</label>
              </div>
              {quotationIllustrations.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{quotationIllustrations.map((illustration, index) => <div key={illustration.key} className="relative overflow-hidden rounded-lg border border-[#d9e0e9] bg-white"><a href={illustration.imagePreview || illustration.imageUrl} target="_blank" rel="noreferrer" className="block aspect-square"><AttachmentPreview url={illustration.imagePreview || illustration.imageUrl} contentType={illustration.contentType} fileName={illustration.fileName} alt={`Quotation illustration ${index + 1}`} className="size-full object-cover" /></a><button type="button" aria-label={`Remove illustration ${index + 1}`} onClick={() => setQuotationIllustrations((current) => current.filter((item) => item.key !== illustration.key))} className="absolute right-1 top-1 grid size-7 place-items-center rounded-md bg-white/90 text-[#8b92a1] shadow-sm hover:bg-[#fff1f1] hover:text-[#b42318]"><X size={14} /></button><span className="absolute bottom-1 left-1 rounded bg-[#151922]/75 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}</span></div>)}</div>}
            </section>
            <div className="mt-5">
              <div className="flex items-center justify-between"><div><h3 className="text-[14px] font-semibold text-[#202938]">Finished products</h3><p className="mt-1 text-[12px] text-[#687386]">List each product requested by the client. The assigned Sales & Pricing Officer adds its internal material, labor, and production costs during review.</p></div></div>
              <Table labels={["#", "Description", "Qty", ""]} minWidth={0} className="table-fixed" columnWidths={["8%", "64%", "18%", "10%"]}>
                {items.map((item, index) => <tr key={item.key}>
                  <td className="px-3 py-2 text-center font-medium">{index + 1}</td>
                  <td className="px-3 py-2"><textarea rows={2} aria-label={`Item ${index + 1} description`} value={item.description} onChange={(event) => setItems((current) => current.map((value) => value.key === item.key ? { ...value, description: titleCase(event.target.value) } : value))} className="input mt-0 min-h-[58px] resize-y" placeholder="Finished product description" /></td>
                  <td className="px-3 py-2"><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="any" value={item.quantity} onChange={(event) => setItems((current) => current.map((value) => value.key === item.key ? { ...value, quantity: event.target.value } : value))} className="input mt-0 text-center" style={{ width: "6rem", marginInline: "auto" }} /></td>
                  <td className="px-3 py-2 text-center"><ActionIcon label={`Remove item ${index + 1}`} tone="red" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((value) => value.key !== item.key))}><Trash2 size={15} /></ActionIcon></td>
                </tr>)}
              </Table>
              <div className="mt-3 flex justify-end"><Button onClick={() => setItems((current) => [...current, { key: `item-${Date.now()}`, description: "", quantity: "1" }])}><Plus size={14} /> Add Item</Button></div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-[#edf0f5] pt-4"><Button secondary disabled={saving} onClick={resetEditor}>Cancel</Button><Button loading={saving} disabled={saving} onClick={() => void saveDraft()}>{saving ? (editing ? "Saving changes…" : "Saving draft…") : (editing ? "Save changes" : "Save draft")}</Button></div>
          </section>
        </div>
      )}
      <NoteDialog
        open={Boolean(revisionNoteQuote)}
        title="General Manager revision note"
        context={revisionNoteQuote ? text(revisionNoteQuote.quotation_no, "Price Quotation") : undefined}
        note={text(revisionNoteQuote?.revision_note, "")}
        titleId="price-quotation-revision-note-title"
        onClose={() => setRevisionNoteQuote(null)}
      />
      {illustrationQuote && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIllustrationQuote(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="price-quotation-illustrations-title" className="w-full max-w-4xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="price-quotation-illustrations-title" className="text-[16px] font-semibold text-[#202938]">Quotation illustrations</h2><p className="mt-1 text-[12px] text-[#687386]">{text(illustrationQuote.quotation_no, "Price Quotation")} · View-only; not included in the PDF.</p></div><button type="button" onClick={() => setIllustrationQuote(null)} aria-label="Close illustrations" className="rounded-md p-1 text-[#687386] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]"><X size={18} /></button></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{[
              ...store.price_quotation_illustrations
                .filter((illustration) => illustration.quotation_id === illustrationQuote.id)
                .sort((left, right) => n(left.sort_order) - n(right.sort_order))
                .map((illustration, index) => ({ id: text(illustration.id, `quotation-illustration-${index}`), imageUrl: text(illustration.image_url, ""), fileName: text(illustration.file_name, ""), contentType: text(illustration.content_type, ""), description: `Illustration ${index + 1}` })),
              ...store.quotation_items
                .filter((item) => item.quotation_id === illustrationQuote.id && Boolean(text(item.image_url, "")))
                .map((item) => ({ id: text(item.id), imageUrl: text(item.image_url, ""), fileName: undefined, contentType: undefined, description: text(item.description, "Quotation illustration") })),
            ].map((illustration) => <a key={illustration.id} href={illustration.imageUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-2 hover:border-[#c4ccd8]"><AttachmentPreview url={illustration.imageUrl} contentType={illustration.contentType} fileName={illustration.fileName} alt={illustration.description} className="aspect-square w-full rounded-md object-cover" /><p className="mt-2 text-[12px] font-medium text-[#344054]">{illustration.description}</p></a>)}</div>
            <div className="mt-5 flex justify-end"><Button secondary onClick={() => setIllustrationQuote(null)}>Close</Button></div>
          </section>
        </div>
      )}
      {pdfQuote && <QuotationDocument quote={pdfQuote} store={store} close={() => { setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); }} onPdfError={(message) => { if (pdfWindow && !pdfWindow.closed) pdfWindow.close(); setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); notice(message); }} autoExportPdf pdfWindow={pdfWindow} printAfterOpen={printAfterOpen} hidden showInternalCosting={isGeneralManager} />}
      {reviewing && <PriceQuotationReview quotation={reviewing} store={store} saving={saving} showInternalMarkups={isGeneralManager} close={() => setReviewing(null)} notice={notice} reload={reload} />}
      {proofQuote && <SignedProofDialog quote={proofQuote} store={store} canUpload={isProjectOfficerRole(role) && preparedByKey(proofQuote) === currentUserId} close={() => setProofQuote(null)} notice={notice} reload={reload} />}
      {paymentQuote && <QuotationPaymentDialog quote={paymentQuote} store={store} orgId={orgId} role={role} close={() => setPaymentQuote(null)} reload={reload} />}
    </Panel>
  );
}

function PriceQuotationReviewContentLegacy({ lines, prices, setPrices, subtotal, vatRate, setVatRate, tax, shipping, setShipping, total, terms, setTerms, bankDetails, setBankDetails, revisionNote, setRevisionNote, close, saving, working, review }: {
  lines: Row[]; prices: Record<string, string>; setPrices: (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void; subtotal: number; vatRate: string; setVatRate: (value: string) => void; tax: number; shipping: string; setShipping: (value: string) => void; total: number; terms: string[]; setTerms: (next: string[] | ((current: string[]) => string[])) => void; bankDetails: BankDetail[]; setBankDetails: (next: BankDetail[] | ((current: BankDetail[]) => BankDetail[])) => void; revisionNote: string; setRevisionNote: (value: string) => void; close: () => void; saving: boolean; working: boolean; review: (decision: "approved" | "needs_revision") => Promise<void>;
}) {
  return <div className="mt-5 space-y-5"><section className="overflow-hidden rounded-xl border border-[#e1e6ee]"><Table labels={["Item", "Description", "Quantity", "Selling Price / Unit", "Amount"]} minWidth={0}>{lines.map((line, index) => { const price = n(prices[text(line.id)]); return <tr key={text(line.id)}><td className="px-4 py-3 text-center">{index + 1}</td><td className="px-4 py-3 font-medium">{text(line.description)}</td><td className="px-4 py-3 text-center">{n(line.quantity)}</td><td className="px-4 py-2"><input aria-label={`Selling price for ${text(line.description)}`} type="number" min="0" step="any" value={prices[text(line.id)] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [text(line.id)]: event.target.value }))} className="input mt-0 text-right" /></td><td className="px-4 py-3 text-right font-semibold">{peso.format(n(line.quantity) * price)}</td></tr>; })}</Table><Table labels={["Quotation Total", "Amount"]} minWidth={0}><tr><td className="px-4 py-3">Subtotal</td><td className="px-4 py-3 text-right font-medium">{peso.format(subtotal)}</td></tr><tr><td className="px-4 py-2">Tax <input aria-label="Tax percentage" type="number" min="0" step="any" value={vatRate} onChange={(event) => setVatRate(event.target.value)} className="input ml-2 mt-0 w-20 px-2 py-1 text-right" />%</td><td className="px-4 py-3 text-right">{peso.format(tax)}</td></tr><tr><td className="px-4 py-2">Shipping / Handling</td><td className="px-4 py-2"><input aria-label="Shipping and handling" type="number" min="0" step="any" value={shipping} onChange={(event) => setShipping(event.target.value)} className="input mt-0 text-right" /></td></tr><tr className="bg-[#eff7f1] text-[15px] font-bold text-[#176b40]"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{peso.format(total)}</td></tr></Table></section><section className="rounded-xl border border-[#e1e6ee] p-4"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Terms and Conditions</h3><Button secondary onClick={() => setTerms((current) => [...current, ""])}><Plus size={13} /> Add term</Button></div><div className="mt-3 space-y-2">{terms.map((term, index) => <div key={`${index}-${term}`} className="flex gap-2"><span className="pt-2 text-[12px] text-[#7d8797]">{index + 1}.</span><input value={term} onChange={(event) => setTerms((current) => current.map((value, itemIndex) => itemIndex === index ? titleCaseEntry(event.target.value, "term") : value))} className="input mt-0 flex-1" /><button type="button" aria-label={`Remove term ${index + 1}`} onClick={() => setTerms((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div></section><section className="rounded-xl border border-[#e1e6ee] p-4"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Bank Details</h3><Button secondary onClick={() => setBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div><div className="mt-3 space-y-2">{bankDetails.map((bank, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Bank ${index + 1} name`} value={bank.bank_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, bank_name: event.target.value } : value))} placeholder="Bank" className="input mt-0" /><input aria-label={`Bank ${index + 1} account name`} value={bank.account_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_name: event.target.value } : value))} placeholder="Account name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account number`} value={bank.account_number} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_number: event.target.value } : value))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label={`Remove bank ${index + 1}`} onClick={() => setBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div></section><label className="block text-[12px] font-medium text-[#202938]">Revision note<textarea rows={3} value={revisionNote} onChange={(event) => setRevisionNote(titleCaseEntry(event.target.value, "revision_note"))} placeholder="Required only when returning for revision" className="input mt-1 min-h-[78px] resize-y" /></label><div className="flex justify-end gap-2 border-t border-[#edf0f5] pt-4"><Button secondary onClick={close}>Close</Button><Button secondary loading={saving || working} disabled={saving || working} onClick={() => void review("needs_revision")}><RotateCcw size={14} /> Return for revision</Button><Button tone="green" loading={saving || working} disabled={saving || working} onClick={() => void review("approved")}><Check size={14} /> Approve Price Quotation</Button></div></div>;
}

/*
function ProductCostingsSection({
  projectName,
  lines,
  vatRate,
  setVatRate,
  costings,
  setCostings,
  pricingDefaults,
}: {
  projectName: string;
  lines: Row[];
  vatRate: string;
  setVatRate: (value: string) => void;
  costings: ProductCostingDraft[];
  setCostings: (next: ProductCostingDraft[] | ((current: ProductCostingDraft[]) => ProductCostingDraft[])) => void;
  pricingDefaults: Record<string, unknown>;
}) {
  const displayProjectName = projectName.trim() || "Project";
  const updateCosting = (key: string, update: (costing: ProductCostingDraft) => ProductCostingDraft) =>
    setCostings((current) => current.map((costing) => costing.key === key ? update(costing) : costing));
  const canAddCosting = costings.length < lines.length;
  return (
    <section className="rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-[14px] font-semibold text-[#202938]">Internal product costings</h3><p className="mt-1 text-[12px] text-[#687386]">General Manager / Sales &amp; Pricing Officer only. Add one costing table for each finished product; all internal costs and markups calculate the quotation price automatically.</p></div>
        <Button secondary disabled={!canAddCosting} onClick={() => {
          const nextLine = lines.find((line) => !costings.some((costing) => costing.quotationItemId === line.id));
          if (nextLine?.id) setCostings((current) => [...current, {
            ...newProductCostingDraft(text(nextLine.id)),
            markups: [
              { key: `markup-${crypto.randomUUID()}`, label: "Profit Margin", rate: text(pricingDefaults.default_profit_margin, "75") },
              { key: `markup-${crypto.randomUUID()}`, label: "Overhead Expense", rate: text(pricingDefaults.default_overhead_rate, "0") },
              { key: `markup-${crypto.randomUUID()}`, label: "Buffer Margin", rate: text(pricingDefaults.default_buffer_margin, "20") },
              { key: `markup-${crypto.randomUUID()}`, label: "Additional Markup", rate: text(pricingDefaults.default_additional_markup, "15") },
            ],
          }]);
        }}><Plus size={14} /> Add costing table</Button>
      </div>
      {costings.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#ccd5e0] bg-white px-3 py-3 text-[12px] text-[#687386]">No internal costing table has been added. Add one costing table for each finished product before submitting for review.</p> : <div className="mt-4 space-y-4">{costings.map((costing, costingIndex) => {
        const product = lines.find((line) => line.id === costing.quotationItemId);
        const totals = productCostingTotals(costing, n(product?.quantity), n(vatRate));
        return <article key={costing.key} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#edf0f5] pb-3">
            <label className="min-w-64 flex-1 text-[12px] font-medium text-[#202938]">Finished product<select value={costing.quotationItemId} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, quotationItemId: event.target.value }))} className="input mt-1"><option value="">Select quotation product</option>{lines.map((line, index) => <option key={text(line.id)} value={text(line.id)} disabled={costings.some((other) => other.key !== costing.key && other.quotationItemId === line.id)}>{displayProjectName} - Product {index + 1} - Qty: {n(line.quantity)} pcs</option>)}</select></label>
            <Button secondary onClick={() => setCostings((current) => current.filter((item) => item.key !== costing.key))}><Trash2 size={14} /> Remove table</Button>
          </div>
          <div className="mt-3"><div className="mb-3"><h4 className="text-[12px] font-semibold text-[#344054]">Internal costs</h4></div>
            <Table labels={["Mode", "Description", "Quantity", "Unit Cost", "Amount", ""]} minWidth={0} className="table-fixed" scrollable={false} compact columnWidths={["12%", "42%", "12%", "12%", "12%", "10%"]} alignRightLabels={["Quantity", "Unit Cost"]}>{costing.costLines.map((line, lineIndex) => { const isFixedAmount = line.calculationType === "fixed_amount"; const lineAmount = isFixedAmount ? n(line.amount) : n(line.quantity) * n(line.unitCost); const setCalculationType = (value: "quantity_unit_cost" | "fixed_amount") => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, calculationType: value, amount: value === "fixed_amount" && item.calculationType !== "fixed_amount" ? String(n(item.quantity) * n(item.unitCost)) : item.amount } : item) })); return <tr key={line.key}><td className="min-w-0 px-1 py-2"><div aria-label={`Cost ${lineIndex + 1} calculation type`} role="group" className="inline-flex w-full items-center justify-center whitespace-nowrap overflow-hidden rounded-md border border-[#d9e0e9] text-[10px] font-semibold"><button type="button" aria-pressed={!isFixedAmount} onClick={() => setCalculationType("quantity_unit_cost")} className={`min-w-0 flex-1 min-h-6 px-1 transition-colors ${!isFixedAmount ? "bg-[#c43b43] text-white" : "bg-white text-[#687386] hover:bg-[#f5f7fa]"}`}>Q×C</button><button type="button" aria-pressed={isFixedAmount} onClick={() => setCalculationType("fixed_amount")} className={`min-w-0 flex-1 min-h-6 px-1 transition-colors ${isFixedAmount ? "bg-[#c43b43] text-white" : "bg-white text-[#687386] hover:bg-[#f5f7fa]"}`}>Fixed</button></div></td><td className="min-w-0 !whitespace-normal break-words px-2 py-2"><input aria-label={`Cost ${lineIndex + 1} description`} value={line.description} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, description: titleCaseEntry(event.target.value, "description") } : item) }))} className="input mt-0 min-w-0 max-w-full px-2" placeholder="Material, labor, logistics" /></td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} quantity`} type="number" min="0.001" step="any" value={line.quantity} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" />}</td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} unit cost`} type="number" min="0" step="any" value={line.unitCost} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, unitCost: event.target.value } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" />}</td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <input aria-label={`Cost ${lineIndex + 1} fixed amount`} type="number" min="0" step="any" value={line.amount} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, amount: event.target.value } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" /> : <span className="flex min-h-9 items-center justify-end whitespace-nowrap font-medium">{peso.format(lineAmount)}</span>}</td><td className="px-1 py-2 text-center"><ActionIcon label={`Remove cost ${lineIndex + 1}`} tone="red" disabled={costing.costLines.length === 1} onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.filter((item) => item.key !== line.key) }))}><Trash2 size={14} /></ActionIcon></td></tr>; })}</Table><div className="mt-2 mb-2 flex items-center justify-between gap-3"><h4 className="text-[12px] font-semibold text-[#344054]">Markup, VAT &amp; Expenses</h4><Button onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: [...current.costLines, { key: `cost-line-${crypto.randomUUID()}`, description: "", calculationType: "quantity_unit_cost", quantity: "1", unitCost: "0", amount: "0" }] }))}><Plus size={13} /> Add cost</Button></div></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><div><div className="mt-1 space-y-2 w-fit"><p className="px-1 text-[12px] text-[#687386]">Pricing defaults are managed by the General Manager.</p><div className="grid grid-cols-[auto_104px_88px] gap-4"><span className="flex min-h-9 items-center px-1 text-[12px] font-medium text-[#344054]">VAT</span><div className="flex items-center gap-1"><input aria-label="VAT percentage" type="number" min="0" step="any" value={vatRate} onChange={(event) => setVatRate(event.target.value)} className="input mt-0 w-[78px] text-center" /><span className="text-[12px] text-[#687386]">%</span></div><output aria-label="VAT total" className="flex min-h-9 items-center justify-end whitespace-nowrap text-[12px] font-medium text-[#344054]">{peso.format(totals.vat)}</output></div></div></div>
            <dl className="overflow-hidden rounded-lg border border-[#d9e0e9] text-[12px]"><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Total Direct Cost</dt><dd className="font-medium">{peso.format(totals.cogs)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>All markups</dt><dd>{peso.format(totals.markupTotal)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Selling Price VAT EX (total)</dt><dd>{peso.format(totals.sellingExVat)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>VAT ({n(vatRate)}%)</dt><dd>{peso.format(totals.vat)}</dd></div><div className="flex justify-between bg-[#f8fbff] px-3 py-2"><dt>Selling Price VAT EX / Piece</dt><dd>{peso.format(totals.unitExVat)}</dd></div><div className="flex justify-between bg-[#eff7f1] px-3 py-2 font-semibold text-[#176b40]"><dt>Selling Price VAT INC / Piece</dt><dd>{peso.format(totals.unitIncVat)}</dd></div></dl></div>
        </article>;
      })}</div>}
    </section>
  );
}

*/
function PricingMarkupEditor({
  costing,
  editable,
  visibleMarkupKeys,
  update,
  heading,
  showInternalVat = false,
}: {
  costing: ProductCostingDraft;
  editable: boolean;
  visibleMarkupKeys: ReadonlyArray<PricingMarkupKey>;
  update: (next: ProductCostingDraft) => void;
  heading?: string;
  showInternalVat?: boolean;
}) {
  const totals = productCostingTotals(costing, 1, 0);
  const visibleMarkups = costing.markups.filter((markup) => {
    const key = markup.markupKey || pricingMarkupKeyForLabel(markup.label);
    return Boolean(key) && visibleMarkupKeys.includes(key as PricingMarkupKey);
  });
  const discountOnly = visibleMarkupKeys.length === 1 && visibleMarkupKeys[0] === "discounts";
  const includesDiscount = visibleMarkupKeys.includes("discounts");
  return (
    <div className="rounded-lg border border-[#d9e0e9] bg-white">
      <div className="border-b border-[#edf0f5] px-3 py-2">
        <h4 className="text-[12px] font-semibold text-[#344054]">{heading ?? (discountOnly ? "Discount" : "Internal pricing adjustments")}</h4>
      </div>
      <Table labels={includesDiscount ? ["Category", "Basis", "Value", "Calculated amount"] : ["Category", "Percentage", "Calculated amount"]} minWidth={0} compact alignRightLabels={includesDiscount ? ["Value", "Calculated amount"] : ["Percentage", "Calculated amount"]}>
        {visibleMarkups.map((markup) => {
          const key = markup.markupKey || pricingMarkupKeyForLabel(markup.label);
          const isDiscount = key === "discounts";
          const label = discountOnly && key === "discounts"
            ? "Discount"
            : pricingMarkupDefinition(key as PricingMarkupKey)?.label ?? markup.label;
          const calculationType = markupCalculationType(markup);
          const rowCalculationType = isDiscount ? calculationType : "percentage";
          const amount = totals.markupAmounts[markup.key] ?? 0;
          return (
            <tr key={markup.key} className="hover:bg-[#fbfcff]">
              <td className="px-3 py-2 font-medium text-[#344054]">{label}</td>
              {includesDiscount && <td className="px-2 py-2">
                {isDiscount && editable ? <SegmentedToggle ariaLabel={`${label} calculation basis`} value={rowCalculationType} options={markupBasisOptions} onChange={(value) => update({ ...costing, markups: costing.markups.map((item) => item.key === markup.key ? { ...item, calculationType: value as MarkupCalculationType } : item) })} size="compact" className="w-16" /> : <span className="block text-right text-[#687386]">{rowCalculationType === "fixed_amount" ? "Amount" : "Percent"}</span>}
              </td>}
              <td className="px-2 py-2">
                {editable ? <div className="flex items-center justify-end gap-1"><input aria-label={`${label} ${rowCalculationType === "fixed_amount" ? "amount" : "percentage"}`} type="number" min="0" max={rowCalculationType === "percentage" ? "100" : undefined} step="any" value={markupValue(markup)} onChange={(event) => update({ ...costing, markups: costing.markups.map((item) => item.key === markup.key ? { ...item, calculationType: isDiscount ? rowCalculationType : "percentage", value: event.target.value } : item) })} className="input mt-0 px-2 py-1.5 tabular-nums" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} /><span className="w-4 text-[11px] text-[#687386]">{rowCalculationType === "fixed_amount" ? "₱" : "%"}</span></div> : <span className="block text-right tabular-nums text-[#687386]">{rowCalculationType === "fixed_amount" ? peso.format(n(markupValue(markup))) : `${n(markupValue(markup))}%`}</span>}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{peso.format(amount)}</td>
            </tr>
          );
        })}
        {showInternalVat && <tr className="bg-[#fafbfc]">
          <td className="px-3 py-2 font-medium text-[#344054]">Internal VAT</td>
          {includesDiscount && <td className="px-2 py-2"><span className="block text-right text-[#687386]">Percent</span></td>}
          <td className="px-2 py-2">{editable ? <div className="flex items-center justify-end gap-1"><input aria-label="Internal VAT percentage" type="number" min="0" max="100" step="any" value={costing.internalVatRate} onChange={(event) => update({ ...costing, internalVatRate: event.target.value })} className="input mt-0 px-2 py-1.5 tabular-nums" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} /><span className="w-4 text-[11px] text-[#687386]">%</span></div> : <span className="block text-right tabular-nums text-[#687386]">{`${n(costing.internalVatRate)}%`}</span>}</td>
          <td className="px-3 py-2 text-right font-medium tabular-nums">{peso.format(totals.internalVatAmount)}</td>
        </tr>}
      </Table>
    </div>
  );
}

/*
function ProductCostingsSectionWithPricing({
  projectName,
  lines,
  vatCalculationType,
  setVatCalculationType,
  vatValue,
  setVatValue,
  costings,
  setCostings,
  pricingDefaults,
  editableMarkups,
}: {
  projectName: string;
  lines: Row[];
  vatCalculationType: MarkupCalculationType;
  setVatCalculationType: (value: MarkupCalculationType) => void;
  vatValue: string;
  setVatValue: (value: string) => void;
  costings: ProductCostingDraft[];
  setCostings: (next: ProductCostingDraft[] | ((current: ProductCostingDraft[]) => ProductCostingDraft[])) => void;
  pricingDefaults: Record<string, unknown>;
  editableMarkups: boolean;
}) {
  const displayProjectName = projectName.trim() || "Project";
  const defaults = pricingMarkupDefaults(pricingDefaults.pricing_markup_defaults, pricingDefaults);
  const updateCosting = (key: string, update: (costing: ProductCostingDraft) => ProductCostingDraft) => setCostings((current) => current.map((costing) => costing.key === key ? update(costing) : costing));
  const canAddCosting = costings.length < lines.length;
  const vatBaseTotal = costings.reduce((sum, costing) => {
    const product = lines.find((line) => line.id === costing.quotationItemId);
    return sum + productCostingTotals(costing, n(product?.quantity), "percentage", 0).sellingExVat;
  }, 0);
  const vatTotal = costings.reduce((sum, costing) => {
    const product = lines.find((line) => line.id === costing.quotationItemId);
    return sum + productCostingTotals(costing, n(product?.quantity), vatCalculationType, n(vatValue), vatBaseTotal).vat;
  }, 0);
  return (
    <section className="rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-[14px] font-semibold text-[#202938]">Internal product costings</h3><p className="mt-1 text-[12px] text-[#687386]">General Manager / Sales &amp; Pricing Officer only. Add one costing table for each finished product; internal pricing adjustments calculate the quotation price automatically.</p></div>
        <Button secondary disabled={!canAddCosting} onClick={() => { const nextLine = lines.find((line) => !costings.some((costing) => costing.quotationItemId === line.id)); if (nextLine?.id) setCostings((current) => [...current, newProductCostingDraft(text(nextLine.id), defaults)]); }}><Plus size={14} /> Add costing table</Button>
      </div>
      {costings.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[#ccd5e0] bg-white px-3 py-3 text-[12px] text-[#687386]">No internal costing table has been added. Add one costing table for each finished product before submitting for review.</p> : <div className="mt-4 space-y-4">{costings.map((costing, costingIndex) => {
        const product = lines.find((line) => line.id === costing.quotationItemId);
        const totals = productCostingTotals(costing, n(product?.quantity), vatCalculationType, n(vatValue), vatBaseTotal);
        return <article key={costing.key} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#edf0f5] pb-3"><label className="min-w-64 flex-1 text-[12px] font-medium text-[#202938]">Finished product<select value={costing.quotationItemId} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, quotationItemId: event.target.value }))} className="input mt-1"><option value="">Select quotation product</option>{lines.map((line, index) => <option key={text(line.id)} value={text(line.id)} disabled={costings.some((other) => other.key !== costing.key && other.quotationItemId === line.id)}>{displayProjectName} - Product {index + 1} - Qty: {n(line.quantity)} pcs</option>)}</select></label><Button secondary onClick={() => setCostings((current) => current.filter((item) => item.key !== costing.key))}><Trash2 size={14} /> Remove table</Button></div>
          <div className="mt-3"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-[12px] font-semibold text-[#344054]">Internal costs</h4><span className="text-[11px] text-[#687386]">Product {costingIndex + 1}</span></div><Table labels={["Mode", "Description", "Quantity", "Unit Cost", "Amount", ""]} minWidth={0} className="table-fixed" scrollable={false} compact columnWidths={["12%", "42%", "12%", "12%", "12%", "10%"]} alignRightLabels={["Quantity", "Unit Cost", "Amount"]}>{costing.costLines.map((line, lineIndex) => { const isFixedAmount = line.calculationType === "fixed_amount"; const lineAmount = isFixedAmount ? n(line.amount) : n(line.quantity) * n(line.unitCost); const setCalculationType = (value: "quantity_unit_cost" | "fixed_amount") => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, calculationType: value, amount: value === "fixed_amount" && item.calculationType !== "fixed_amount" ? String(n(item.quantity) * n(item.unitCost)) : item.amount } : item) })); return <tr key={line.key}><td className="min-w-0 px-1 py-2"><div aria-label={`Cost ${lineIndex + 1} calculation type`} role="group" className="inline-flex w-full items-center justify-center whitespace-nowrap overflow-hidden rounded-md border border-[#d9e0e9] text-[10px] font-semibold"><button type="button" aria-pressed={!isFixedAmount} onClick={() => setCalculationType("quantity_unit_cost")} className={`min-w-0 flex-1 min-h-6 px-1 transition-colors ${!isFixedAmount ? "bg-[#c43b43] text-white" : "bg-white text-[#687386] hover:bg-[#f5f7fa]"}`}>Q×C</button><button type="button" aria-pressed={isFixedAmount} onClick={() => setCalculationType("fixed_amount")} className={`min-w-0 flex-1 min-h-6 px-1 transition-colors ${isFixedAmount ? "bg-[#c43b43] text-white" : "bg-white text-[#687386] hover:bg-[#f5f7fa]"}`}>Fixed</button></div></td><td className="min-w-0 !whitespace-normal break-words px-2 py-2"><input aria-label={`Cost ${lineIndex + 1} description`} value={line.description} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, description: titleCaseEntry(event.target.value, "description") } : item) }))} className="input mt-0 min-w-0 max-w-full px-2" placeholder="Material, labor, logistics" /></td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} quantity`} type="number" min="0.001" step="any" value={line.quantity} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" />}</td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} unit cost`} type="number" min="0" step="any" value={line.unitCost} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, unitCost: event.target.value } } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" />}</td><td className="min-w-0 px-2 py-2">{isFixedAmount ? <input aria-label={`Cost ${lineIndex + 1} fixed amount`} type="number" min="0" step="any" value={line.amount} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.map((item) => item.key === line.key ? { ...item, amount: event.target.value } : item) }))} className="input mt-0 min-w-0 max-w-full px-1 text-right" /> : <span className="flex min-h-9 items-center justify-end whitespace-nowrap font-medium">{peso.format(lineAmount)}</span>}</td><td className="px-1 py-2 text-center"><ActionIcon label={`Remove cost ${lineIndex + 1}`} tone="red" disabled={costing.costLines.length === 1} onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.filter((item) => item.key !== line.key) }))}><Trash2 size={14} /></ActionIcon></td></tr>; })}</Table><div className="mt-2 flex justify-end"><Button onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: [...current.costLines, { key: `cost-line-${crypto.randomUUID()}`, description: "", calculationType: "quantity_unit_cost", quantity: "1", unitCost: "0", amount: "0" }] }))}><Plus size={13} /> Add cost</Button></div></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><div>{editableMarkups ? <PricingMarkupEditor costing={costing} editable update={(next) => updateCosting(costing.key, () => next)} /> : <p className="rounded-lg border border-dashed border-[#ccd5e0] bg-[#fafbfc] px-3 py-3 text-[12px] text-[#687386]">Internal pricing adjustments are managed by the General Manager and are not editable in this review.</p>}</div><dl className="overflow-hidden rounded-lg border border-[#d9e0e9] text-[12px]"><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Total Direct Cost</dt><dd className="font-medium">{peso.format(totals.cogs)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Cost Base Before Profit</dt><dd>{peso.format(totals.costBase)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Target Profit</dt><dd>{peso.format(totals.profitAmount)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Discount</dt><dd>{peso.format(totals.discountAmount)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>List Price VAT Ex</dt><dd>{peso.format(totals.listSellingExVat)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2 font-medium"><dt>Net Selling Price VAT Ex</dt><dd>{peso.format(totals.sellingExVat)}</dd></div><div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>VAT</dt><dd>{peso.format(totals.vat)}</dd></div><div className="flex justify-between bg-[#f8fbff] px-3 py-2"><dt>Selling Price VAT Ex / Piece</dt><dd>{peso.format(totals.unitExVat)}</dd></div><div className="flex justify-between bg-[#eff7f1] px-3 py-2 font-semibold text-[#176b40]"><dt>Selling Price VAT Inc / Piece</dt><dd>{peso.format(totals.unitIncVat)}</dd></div></dl></div>
        </article>;
      })}</div>}
      <div className="mt-4 rounded-lg border border-[#d9e0e9] bg-white p-3"><div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><h4 className="text-[12px] font-semibold text-[#344054]">Quotation VAT</h4><p className="mt-0.5 text-[11px] text-[#687386]">VAT is applied after the final VAT-exclusive selling price.</p></div><label className="text-[11px] font-medium text-[#344054]">Basis<select aria-label="VAT calculation basis" value={vatCalculationType} onChange={(event) => setVatCalculationType(event.target.value as MarkupCalculationType)} className="input mt-1 min-w-36 px-2 py-1.5"><option value="percentage">Percentage (%)</option><option value="fixed_amount">Amount (₱)</option></select></label><label className="text-[11px] font-medium text-[#344054]">Value<div className="mt-1 flex items-center gap-1"><input aria-label="VAT value" type="number" min="0" step="any" value={vatValue} onChange={(event) => setVatValue(event.target.value)} className="input mt-0 w-28 px-2 py-1.5 text-right" /><span className="text-[#687386]">{vatCalculationType === "fixed_amount" ? "₱" : "%"}</span></div></label><output aria-label="VAT total" className="min-w-28 text-right text-[12px] font-semibold text-[#344054]">{peso.format(vatTotal)}</output></div></div>
    </section>
  );
}

*/
type PriceQuotationReviewContentProps = {
  lines: Row[];
  projectName: string;
  projectType: string;
  illustrations: { id: string; description: string; imageUrl: string; fileName?: string; contentType?: string }[];
  productCostings: ProductCostingDraft[];
  pricingDefaults: Row;
  setProductCostings: (next: ProductCostingDraft[] | ((current: ProductCostingDraft[]) => ProductCostingDraft[])) => void;
  prices: Record<string, string>;
  setPrices: (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  subtotal: number;
  vatRate: string;
  setVatRate: (value: string) => void;
  tax: number;
  total: number;
  terms: string[];
  setTerms: (next: string[] | ((current: string[]) => string[])) => void;
  bankDetails: BankDetail[];
  setBankDetails: (next: BankDetail[] | ((current: BankDetail[]) => BankDetail[])) => void;
  revisionNote: string;
  setRevisionNote: (value: string) => void;
  close: () => void;
  saving: boolean;
  working: boolean;
  review: (decision: "approved" | "needs_revision") => Promise<void>;
  finalApproval: boolean;
  showInternalMarkups: boolean;
  visibleMarkupKeys?: ReadonlyArray<PricingMarkupKey>;
  bankVisibility?: ReadonlyArray<boolean>;
  pricingRevision?: boolean;
  documentLabel?: string;
  sourceQuotationNo?: string;
};

function QuotationReviewSummary({
  lines,
  prices,
  subtotal,
  vatRate,
  tax,
  total,
  productCostings,
}: Pick<PriceQuotationReviewContentProps, "lines" | "prices" | "subtotal" | "vatRate" | "tax" | "total" | "productCostings">) {
  const hasVat = n(vatRate) > 0 && tax > 0;
  const priceLabel = hasVat ? "Selling Price / Unit (VAT inc.)" : "Selling Price / Unit";
  return <section>
    <Table labels={["Item", "Description", "Quantity", priceLabel, "Amount"]} minWidth={0} className="price-quotation-review-items table-fixed" columnWidths={["7%", "43%", "11%", "22%", "17%"]}>
      {lines.map((line, index) => {
        const storedPrice = prices[text(line.id)] ?? "";
        const price = n(storedPrice);
        const displayedPrice = price;
        const productCosting = productCostings.find((costing) => costing.quotationItemId === line.id);
        return <tr key={text(line.id)}>
          <td className="px-4 py-3 text-center">{index + 1}</td>
          <td className="whitespace-pre-wrap break-words px-4 py-3 font-medium">{text(line.description)}</td>
          <td className="px-4 py-3 text-center">{n(line.quantity)}</td>
          <td className="px-4 py-2">{productCosting ? <span aria-label={`${priceLabel} for ${text(line.description)}`} className="flex min-h-9 items-center justify-center font-medium text-[#202938]">{peso.format(displayedPrice)}</span> : <span aria-label={`${priceLabel} for ${text(line.description)}`} className="flex min-h-9 items-center justify-center text-[#8b92a1]">—</span>}</td>
          <td className="px-4 py-3 text-right font-semibold">{productCosting ? wholePeso.format(n(line.quantity) * displayedPrice) : <span className="text-[#8b92a1]">—</span>}</td>
        </tr>;
      })}
    </Table>
  </section>;
}

function ProductCostingsSectionWithPricing({
  projectName,
  lines,
  vatValue,
  setVatValue,
  costings,
  setCostings,
  pricingDefaults,
  editableMarkups,
  visibleMarkupKeys,
  canEditVat,
  showPricingOfficerDiscount,
}: {
  projectName: string;
  lines: Row[];
  vatValue: string;
  setVatValue: (value: string) => void;
  costings: ProductCostingDraft[];
  setCostings: (next: ProductCostingDraft[] | ((current: ProductCostingDraft[]) => ProductCostingDraft[])) => void;
  pricingDefaults: Record<string, unknown>;
  editableMarkups: boolean;
  visibleMarkupKeys: ReadonlyArray<PricingMarkupKey>;
  canEditVat: boolean;
  showPricingOfficerDiscount: boolean;
}) {
  const displayProjectName = projectName.trim() || "Project";
  const defaults = pricingMarkupDefaults(pricingDefaults.pricing_markup_defaults, pricingDefaults);
  const updateCosting = (key: string, update: (costing: ProductCostingDraft) => ProductCostingDraft) =>
    setCostings((current) => current.map((costing) => costing.key === key ? update(costing) : costing));
  const canAddCosting = costings.length < lines.length;
  const vatTotal = costings.reduce((sum, costing) => {
    const product = lines.find((line) => line.id === costing.quotationItemId);
    return sum + productCostingTotals(costing, n(product?.quantity), n(vatValue)).vat;
  }, 0);

  return (
    <section className="rounded-xl border border-[#e1e6ee] bg-[#fafbfc] p-4">
      {canEditVat && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f5] pb-3">
        <p className="text-[12px] text-[#687386]">The customer selling price per piece is the final grand total divided by quantity.</p>
      </div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[#202938]">Internal product costings</h3>
          <p className="mt-1 text-[12px] text-[#687386]">General Manager / Sales &amp; Pricing Officer only. Add one costing table for each finished product; internal pricing adjustments calculate the quotation price automatically.</p>
        </div>
        <Button
          disabled={!canAddCosting}
          onClick={() => {
            const nextLine = lines.find((line) => !costings.some((costing) => costing.quotationItemId === line.id));
            if (nextLine?.id) {
              const nextCosting = newProductCostingDraft(text(nextLine.id), defaults);
              setCostings((current) => [
                ...current,
                visibleMarkupKeys.includes("discounts")
                  ? withQuotationDiscount(nextCosting)
                  : nextCosting,
              ]);
            }
          }}
        >
          <Plus size={14} /> Add Costing Breakdown
        </Button>
      </div>

      {costings.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[#ccd5e0] bg-white px-3 py-3 text-[12px] text-[#687386]">No internal costing table has been added. Add one costing table for each finished product before submitting for review.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {costings.map((costing, costingIndex) => {
            const product = lines.find((line) => line.id === costing.quotationItemId);
            const totals = productCostingTotals(costing, n(product?.quantity), n(vatValue));
            return (
              <article key={costing.key} className="rounded-lg border border-[#d9e0e9] bg-white p-3">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#edf0f5] pb-3">
                  <label className="min-w-64 flex-1 text-[12px] font-medium text-[#202938]">
                    Finished product
                    <select value={costing.quotationItemId} onChange={(event) => updateCosting(costing.key, (current) => ({ ...current, quotationItemId: event.target.value }))} className="input mt-1">
                      <option value="">Select quotation product</option>
                      {lines.map((line, index) => <option key={text(line.id)} value={text(line.id)} disabled={costings.some((other) => other.key !== costing.key && other.quotationItemId === line.id)}>{displayProjectName} - Product {index + 1} - Qty: {n(line.quantity)} pcs</option>)}
                    </select>
                  </label>
                  <Button secondary onClick={() => setCostings((current) => current.filter((item) => item.key !== costing.key))}><Trash2 size={14} /> Remove table</Button>
                </div>

                <div className="mt-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-[12px] font-semibold text-[#344054]">Internal costs</h4>
                    <span className="text-[11px] text-[#687386]">Product {costingIndex + 1}</span>
                  </div>
                  <Table labels={["Mode", "Description", "Quantity", "Unit Cost", "Amount", ""]} minWidth={940} className="table-fixed" compact columnWidths={["10%", "48%", "12%", "12%", "12%", "6%"]} alignRightLabels={["Quantity", "Unit Cost", "Amount"]}>
                    {costing.costLines.map((line, lineIndex) => {
                      const isFixedAmount = line.calculationType === "fixed_amount";
                      const lineAmount = isFixedAmount ? n(line.amount) : n(line.quantity) * n(line.unitCost);
                      const updateLine = (next: Partial<typeof line>) => updateCosting(costing.key, (current) => ({
                        ...current,
                        costLines: current.costLines.map((item) => item.key === line.key ? { ...item, ...next } : item),
                      }));
                      return (
                        <tr key={line.key}>
                          <td className="min-w-0 px-1 py-2">
                            <SegmentedToggle
                              ariaLabel={`Cost ${lineIndex + 1} calculation type`}
                              value={isFixedAmount ? "fixed_amount" : "quantity_unit_cost"}
                              options={costLineCalculationOptions}
                              size="compact"
                              className="w-full"
                              onChange={(value) => {
                                if (value === "fixed_amount") {
                                  updateLine({ calculationType: "fixed_amount", amount: line.calculationType === "fixed_amount" ? line.amount : String(n(line.quantity) * n(line.unitCost)) });
                                } else {
                                  updateLine({ calculationType: "quantity_unit_cost", amount: line.amount || "0" });
                                }
                              }}
                            />
                          </td>
                          <td className="min-w-0 !whitespace-normal break-words px-2 py-2"><input aria-label={`Cost ${lineIndex + 1} description`} value={line.description} onChange={(event) => updateLine({ description: titleCaseEntry(event.target.value, "description") })} className="input mt-0 min-w-0 max-w-full px-2" placeholder="Material, labor, logistics" /></td>
                          <td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} quantity`} type="number" min="0.001" step="any" value={line.quantity} onChange={(event) => updateLine({ quantity: event.target.value })} className="input mt-0 px-1" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} />}</td>
                          <td className="min-w-0 px-2 py-2">{isFixedAmount ? <span className="flex min-h-9 items-center justify-end text-[#8b92a1]">—</span> : <input aria-label={`Cost ${lineIndex + 1} unit cost`} type="number" min="0" step="any" value={line.unitCost} onChange={(event) => updateLine({ unitCost: event.target.value })} className="input mt-0 px-1" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} />}</td>
                          <td className="min-w-0 px-2 py-2">{isFixedAmount ? <input aria-label={`Cost ${lineIndex + 1} fixed amount`} type="number" min="0" step="any" value={line.amount} onChange={(event) => updateLine({ amount: event.target.value })} className="input mt-0 px-1" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} /> : <span className="flex min-h-9 items-center justify-end whitespace-nowrap font-medium">{peso.format(lineAmount)}</span>}</td>
                          <td className="px-1 py-2 text-left"><ActionIcon label={`Remove cost ${lineIndex + 1}`} tone="red" disabled={costing.costLines.length === 1} onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: current.costLines.filter((item) => item.key !== line.key) }))}><Trash2 size={14} /></ActionIcon></td>
                        </tr>
                      );
                    })}
                  </Table>
                  <div className="mt-2 flex justify-end"><Button onClick={() => updateCosting(costing.key, (current) => ({ ...current, costLines: [...current.costLines, { key: `cost-line-${crypto.randomUUID()}`, description: "", calculationType: "quantity_unit_cost", quantity: "1", unitCost: "0", amount: "0" }] }))}><Plus size={13} /> Add cost</Button></div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  {editableMarkups && <div className="space-y-4">
                    <PricingMarkupEditor costing={costing} editable visibleMarkupKeys={visibleMarkupKeys} update={(next) => updateCosting(costing.key, () => next)} showInternalVat={canEditVat} />
                    {showPricingOfficerDiscount && <PricingMarkupEditor
                      costing={costing}
                      editable
                      visibleMarkupKeys={["discounts"]}
                      update={(next) => updateCosting(costing.key, () => next)}
                      heading="Pricing Officer Discount"
                    />}
                  </div>}
                  <dl className={`overflow-hidden rounded-lg border border-[#d9e0e9] text-[12px] ${editableMarkups ? "" : "lg:col-span-2"}`}>
                    {!canEditVat ? <>
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Total Direct Cost</dt><dd className="font-medium">{peso.format(totals.cogs)}</dd></div>
                      {totals.vat > 0 && <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>VAT</dt><dd>{peso.format(totals.vat)}</dd></div>}
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2 font-semibold"><dt>Grand Total</dt><dd>{peso.format(totals.sellingIncVat)}</dd></div>
                      <div className="flex justify-between bg-[#f8fbff] px-3 py-2 font-semibold"><dt>Selling Price Per Piece</dt><dd>{peso.format(totals.unitIncVat)}</dd></div>
                    </> : <>
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Total Direct Cost</dt><dd className="font-medium">{peso.format(totals.cogs)}</dd></div>
                      {visibleMarkupKeys.length > 1 && <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>All Markups</dt><dd>{peso.format(totals.markupTotal)}</dd></div>}
                      {visibleMarkupKeys.length > 1 && <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Total Before Discount</dt><dd>{peso.format(totals.listSellingExVat)}</dd></div>}
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>Discount</dt><dd>{peso.format(totals.discountAmount)}</dd></div>
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2 font-medium"><dt>Net Total</dt><dd>{peso.format(totals.sellingExVat)}</dd></div>
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2"><dt>VAT</dt><dd>{peso.format(totals.vat)}</dd></div>
                      <div className="flex justify-between border-b border-[#edf0f5] px-3 py-2 font-semibold"><dt>Grand Total</dt><dd>{peso.format(totals.sellingIncVat)}</dd></div>
                      <div className="flex justify-between bg-[#eff7f1] px-3 py-2 font-semibold text-[#176b40]"><dt>Selling Price Per Piece</dt><dd>{peso.format(totals.unitIncVat)}</dd></div>
                    </>}
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {canEditVat && <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-[#d9e0e9] bg-white p-3">
          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 border-b border-[#edf0f5] pb-2 text-[10px] font-medium text-[#687386]"><span>Category</span><span>Percentage</span><span className="text-right">Calculated Amount</span></div>
          <div className="mt-2 grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3">
            <span className="text-[11px] font-medium text-[#344054]">VAT</span>
            <div className="flex items-center gap-1"><input aria-label="VAT percentage" type="number" min="0" max="100" step="any" value={vatValue} onChange={(event) => setVatValue(event.target.value)} className="input mt-0 px-2 py-1.5" style={{ width: "7rem", minWidth: "7rem", maxWidth: "7rem", textAlign: "center" }} /><span className="text-[11px] text-[#687386]">%</span></div>
            <output aria-label="VAT total" className="min-w-20 text-right text-[12px] font-semibold text-[#344054]">{peso.format(vatTotal)}</output>
          </div>
        </div>
      </div>}
    </section>
  );
}

function PriceQuotationReviewContent({
  lines, projectName, projectType, illustrations, productCostings, pricingDefaults, setProductCostings, prices, setPrices, subtotal, vatRate, setVatRate, tax,
  total, terms, setTerms, bankDetails, setBankDetails,
  revisionNote, setRevisionNote, close, saving, working, review, finalApproval, showInternalMarkups, visibleMarkupKeys, bankVisibility, pricingRevision,
  documentLabel = "Price Quotation", sourceQuotationNo,
}: PriceQuotationReviewContentProps) {
  const displayedBankDetails = bankDetails
    .map((bank, index) => ({ bank, index }))
    .filter(({ index }) => !showInternalMarkups || bankVisibility?.[index] !== false);
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-[#e1e6ee] p-4">
        <h3 className="text-[14px] font-semibold">{documentLabel} details</h3>
        <dl className="mt-3 grid gap-1 text-[13px] sm:grid-cols-[120px_1fr]">
          <dt className="text-[#687386]">Project type</dt>
          <dd className="font-medium text-[#202938]">{projectType || "—"}</dd>
          {sourceQuotationNo && <><dt className="text-[#687386]">Source Price Quotation</dt><dd className="font-medium text-[#1769e8]">{sourceQuotationNo}</dd></>}
        </dl>
        {illustrations.length > 0 && <div className="mt-4"><p className="text-[12px] font-medium text-[#687386]">Illustrations</p><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{illustrations.map((illustration) => <a key={illustration.id} href={illustration.imageUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-2 hover:border-[#c4ccd8]"><AttachmentPreview url={illustration.imageUrl} contentType={illustration.contentType} fileName={illustration.fileName} alt={illustration.description || "Quotation illustration"} className="aspect-square w-full rounded-md object-cover" /><p className="mt-2 text-[12px] font-medium text-[#344054]">{illustration.description}</p></a>)}</div></div>}
      </section>
      <QuotationReviewSummary lines={lines} prices={prices} subtotal={subtotal} vatRate={vatRate} tax={tax} total={total} productCostings={productCostings} />
      <ProductCostingsSectionWithPricing projectName={projectName} lines={lines} vatValue={vatRate} setVatValue={setVatRate} costings={productCostings} setCostings={setProductCostings} pricingDefaults={pricingDefaults} editableMarkups visibleMarkupKeys={visibleMarkupKeys ?? (showInternalMarkups ? internalPricingMarkupKeys : ["discounts"])} canEditVat={finalApproval} showPricingOfficerDiscount={finalApproval} />
      <section className="rounded-xl border border-[#e1e6ee] p-4">
        <h3 className="text-[14px] font-semibold">Terms and Conditions</h3>
        <div className="mt-3 space-y-2">{terms.map((term, index) => <div key={index} className="flex gap-2"><span className="pt-2 text-[12px] text-[#7d8797]">{index + 1}.</span><input value={term} onChange={(event) => setTerms((current) => current.map((value, itemIndex) => itemIndex === index ? titleCaseEntry(event.target.value, "term") : value))} className="input mt-0 flex-1" /><button type="button" aria-label={`Remove term ${index + 1}`} onClick={() => setTerms((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
        <div className="mt-3 flex justify-end"><Button onClick={() => setTerms((current) => [...current, ""])}><Plus size={13} /> Add term</Button></div>
      </section>
      <section className="rounded-xl border border-[#e1e6ee] p-4">
        <h3 className="text-[14px] font-semibold">Bank Details</h3>
        <div className="mt-3 space-y-2">{displayedBankDetails.map(({ bank, index }) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Bank ${index + 1} name`} value={bank.bank_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, bank_name: event.target.value } : value))} placeholder="Bank" className="input mt-0" /><input aria-label={`Bank ${index + 1} account name`} value={bank.account_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_name: event.target.value } : value))} placeholder="Account name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account number`} value={bank.account_number} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_number: event.target.value } : value))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label={`Remove bank ${index + 1}`} onClick={() => setBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
        {showInternalMarkups && displayedBankDetails.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-[#ccd5e0] px-3 py-3 text-[11px] text-[#8b92a1]">Bank details are hidden from the GM review view in GM Settings.</p>}
        <div className="mt-3 flex justify-end"><Button onClick={() => setBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div>
      </section>
      {!pricingRevision && <label className="block text-[12px] font-medium text-[#202938]">Revision note<textarea rows={3} value={revisionNote} onChange={(event) => setRevisionNote(titleCaseEntry(event.target.value, "revision_note"))} placeholder="Required only when returning for revision" className="input mt-1 min-h-[78px] resize-y" /></label>}
      <div className="flex justify-end gap-2 border-t border-[#edf0f5] pt-4"><Button secondary onClick={close}>Close</Button>{!pricingRevision && <Button secondary loading={saving || working} disabled={saving || working} onClick={() => void review("needs_revision")}><RotateCcw size={14} /> Return for revision</Button>}<Button tone="green" loading={saving || working} disabled={saving || working} onClick={() => void review("approved")}><Check size={14} /> {pricingRevision ? `Resubmit ${documentLabel} to General Manager` : finalApproval ? `Approve ${documentLabel}` : `Submit ${documentLabel} to General Manager`}</Button></div>
    </div>
  );
}

function PriceQuotationReview({
  quotation,
  store,
  saving,
  close,
  notice,
  reload,
  finalApproval = false,
  showInternalMarkups = finalApproval,
  quotationKind = "price_quotation",
}: {
  quotation: Row;
  store: Store;
  saving: boolean;
  close: () => void;
  notice: (message: string) => void;
  reload: () => Promise<void>;
  finalApproval?: boolean;
  showInternalMarkups?: boolean;
  quotationKind?: "price_quotation" | "mockup_quotation";
}) {
  const isMockupQuotation = quotationKind === "mockup_quotation";
  const pricingRevision = !finalApproval && isPricingOfficerRevision(quotation);
  const documentLabel = isMockupQuotation ? "Mockup Quotation" : "Price Quotation";
  const sourceQuotation = isMockupQuotation
    ? store.quotations.find((quote) => quote.id === quotation.source_price_quotation_id)
    : null;
  const illustrationQuotationId = isMockupQuotation
    ? text(quotation.source_price_quotation_id, "")
    : text(quotation.id, "");
  const pricingDefaultSettings = store.business_settings.find(
    (setting) => text(setting.organization_id) === text(quotation.organization_id),
  );
  const [fetchedPricingDefaultSettings, setFetchedPricingDefaultSettings] = useState<Row | undefined>();
  const activePricingDefaultSettings = fetchedPricingDefaultSettings ?? pricingDefaultSettings;
  const defaultPricingDefaults = useMemo(
    () => pricingMarkupDefaults(activePricingDefaultSettings?.pricing_markup_defaults, activePricingDefaultSettings),
    [activePricingDefaultSettings],
  );
  const initialVatRate = () => finalApproval ? "12" : "0";
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      store.quotation_items
        .filter((item) => item.quotation_id === quotation.id)
        .map((item) => [text(item.id), text(item.unit_cost, "")]),
    ),
  );
  const [vatRate, setVatRate] = useState(initialVatRate);
  const [terms, setTerms] = useState(
    text(quotation.terms_conditions, DEFAULT_QUOTATION_TERMS)
      .split(/\r?\n+/)
      .filter((term) => term && !term.trim().toLowerCase().startsWith("validity:")),
  );
  const businessSettings = store.business_settings.find(
    (setting) => text(setting.organization_id) === text(quotation.organization_id),
  );
  const savedBankDetails = quotationBankDetailsSnapshot(quotation.bank_details);
  // The Pricing Officer may still use the live GM default until submitting to GM.
  const useLatestBankDefault = !finalApproval && (
    text(quotation.status, "") === "pending" || pricingRevision
  );
  const bankDetailsTouched = useRef(false);
  const [bankDetails, setBankDetails] = useState<BankDetail[]>(() =>
    useLatestBankDefault
      ? quotationBankDetails(businessSettings?.default_bank_details)
      : savedBankDetails ?? quotationBankDetails(businessSettings?.default_bank_details),
  );
  const updateBankDetails = (
    next: BankDetail[] | ((current: BankDetail[]) => BankDetail[]),
  ) => {
    bankDetailsTouched.current = true;
    setBankDetails(next);
  };
  useEffect(() => {
    let active = true;
    const organizationId = text(quotation.organization_id);
    if (!organizationId) return;
    void createClient()
      .from("business_settings")
      .select("default_bank_details, vat_rate, pricing_markup_defaults")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        setFetchedPricingDefaultSettings((data ?? {}) as Row);
        if (useLatestBankDefault && !bankDetailsTouched.current && data?.default_bank_details !== undefined) {
          setBankDetails(quotationBankDetails(data.default_bank_details));
        }
      });
    return () => {
      active = false;
    };
  }, [quotation.organization_id, useLatestBankDefault]);
  const [revisionNote, setRevisionNote] = useState("");
  const [working, setWorking] = useState(false);
  const [productCostings, setProductCostings] = useState<ProductCostingDraft[]>(() => {
    const savedCostings = productCostingDrafts(
      store.price_quotation_product_costings.filter(
        (costing) => costing.quotation_id === quotation.id,
      ),
      store.price_quotation_costing_lines,
      store.price_quotation_costing_markups,
      finalApproval ? defaultPricingDefaults : undefined,
    );
    return finalApproval
      ? productCostingsWithMissingDefaultMarkups(savedCostings, defaultPricingDefaults)
      : savedCostings;
  });
  useEffect(() => {
    let active = true;
    const loadProductCostings = async () => {
      const client = createClient();
      const { data: costingData, error: costingError } = await client
        .from("price_quotation_product_costings")
        .select("*")
        .eq("quotation_id", quotation.id);
      if (!active || costingError) return;

      const costings = (costingData ?? []) as Row[];
      if (!costings.length) {
        setProductCostings([]);
        return;
      }
      const costingIds = costings.map((costing) => text(costing.id)).filter(Boolean);
      const [costLineResult, markupResult] = await Promise.all([
        client
          .from("price_quotation_costing_lines")
          .select("*")
          .in("product_costing_id", costingIds),
        client
          .from("price_quotation_costing_markups")
          .select("*")
          .in("product_costing_id", costingIds),
      ]);
      if (!active || costLineResult.error || markupResult.error) return;
      const loadedCostings = productCostingDrafts(
        costings,
        (costLineResult.data ?? []) as Row[],
        (markupResult.data ?? []) as Row[],
        finalApproval ? defaultPricingDefaults : undefined,
      );
      setProductCostings(finalApproval
        ? productCostingsWithMissingDefaultMarkups(loadedCostings, defaultPricingDefaults)
        : loadedCostings);
    };
    void loadProductCostings();
    return () => {
      active = false;
    };
  }, [defaultPricingDefaults, finalApproval, quotation.id]);
  const [galleryIllustrations, setGalleryIllustrations] = useState<Row[]>(() =>
    store.price_quotation_illustrations.filter(
      (illustration) => illustration.quotation_id === illustrationQuotationId,
    ),
  );
  useEffect(() => {
    let active = true;
    void createClient()
      .from("price_quotation_illustrations")
      .select("*")
      .eq("quotation_id", illustrationQuotationId)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (active && data) setGalleryIllustrations(data as Row[]);
      });
    return () => {
      active = false;
    };
  }, [illustrationQuotationId]);
  const lines = store.quotation_items.filter((item) => item.quotation_id === quotation.id);
  useEffect(() => {
    if (!productCostings.length) return;
    setPrices((current) => {
      const next = { ...current };
      let changed = false;
      productCostings.forEach((costing) => {
        const product = lines.find((line) => line.id === costing.quotationItemId);
        if (!product) return;
        const totals = productCostingTotals(
          costing,
          n(product.quantity),
          finalApproval ? n(vatRate) : 0,
        );
        const unitPrice = (finalApproval ? totals.unitIncVat : totals.unitExVat).toFixed(2);
        if (next[text(product.id)] !== unitPrice) {
          next[text(product.id)] = unitPrice;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [finalApproval, lines, productCostings, vatRate]);
  const illustrations = [
    ...galleryIllustrations
      .sort((left, right) => n(left.sort_order) - n(right.sort_order))
      .map((illustration, index) => ({
        id: text(illustration.id, `quotation-illustration-${index}`),
        description: `Illustration ${index + 1}`,
        imageUrl: text(illustration.image_url, ""),
        fileName: text(illustration.file_name, ""),
        contentType: text(illustration.content_type, ""),
      })),
    ...lines.flatMap((line) => {
      const imageUrl = text(line.image_url, "");
      return imageUrl ? [{ id: text(line.id), description: text(line.description, "Quotation illustration"), imageUrl }] : [];
    }),
  ];
  const subtotal = productCostings.reduce((sum, costing) => {
    const product = lines.find((line) => line.id === costing.quotationItemId);
    const totals = productCostingTotals(costing, n(product?.quantity), 0);
    return sum + Math.round(totals.unitExVat * n(product?.quantity) * 100) / 100;
  }, 0);
  const total = productCostings.reduce((sum, costing) => {
    const product = lines.find((line) => line.id === costing.quotationItemId);
    const totals = productCostingTotals(costing, n(product?.quantity), finalApproval ? n(vatRate) : 0);
    const unitPrice = finalApproval ? totals.unitIncVat : totals.unitExVat;
    return sum + Math.round(unitPrice * n(product?.quantity) * 100) / 100;
  }, 0);
  const tax = Math.round((total - subtotal) * 100) / 100;
  const gmVisibleMarkupKeys = defaultPricingDefaults
    .filter((definition) => definition.key !== "vat" && definition.visible !== false)
    .map((definition) => definition.key);
  const configuredBankDetails = quotationBankDetailsSnapshot(activePricingDefaultSettings?.default_bank_details) ?? [];
  const bankVisibility = bankDetails.map((bank, index) => {
    const configured = configuredBankDetails.find((candidate) =>
      candidate.bank_name === bank.bank_name &&
      candidate.account_name === bank.account_name &&
      candidate.account_number === bank.account_number,
    ) ?? configuredBankDetails[index];
    return bank.visible !== false && configured?.visible !== false;
  });
  const review = async (decision: "approved" | "needs_revision") => {
    if (pricingRevision && decision !== "approved") {
      return notice("GM revisions must be resubmitted to the General Manager.");
    }
    if (!finalApproval && isMockupQuotation && productCostings.length !== lines.length) {
      return notice("Add one costing table for every Mockup Quotation product before reviewing.");
    }
    if (!finalApproval && !isMockupQuotation && productCostings.length !== lines.length) {
      return notice("Add one costing table for every quotation product before reviewing.");
    }
    setWorking(true);
    const savedTerms = terms
      .filter((term) => term.trim())
      .filter((term) => !finalApproval || n(vatRate) > 0 || !/vat\s+inclusive/i.test(term))
      .join("\n");
    const costingsPayload = productCostings.map((costing) => ({
      quotation_item_id: costing.quotationItemId,
      internal_vat_rate: n(costing.internalVatRate),
      cost_lines: costing.costLines.map((line) => ({
        description: line.description,
        calculation_type: line.calculationType,
        quantity: line.calculationType === "fixed_amount" ? 1 : n(line.quantity),
        unit_cost: line.calculationType === "fixed_amount" ? n(line.amount) : n(line.unitCost),
        amount: line.calculationType === "fixed_amount" ? n(line.amount) : undefined,
      })),
      markups: costing.markups.map((markup) => ({
        markup_key: markup.markupKey || pricingMarkupKeyForLabel(markup.label) || undefined,
        label: markup.label,
        calculation_type: markupCalculationType(markup),
        rate: markupCalculationType(markup) === "fixed_amount" ? 0 : n(markupValue(markup)),
        amount: markupCalculationType(markup) === "fixed_amount" ? n(markupValue(markup)) : 0,
      })),
      pricing_model: costing.pricingModel,
    }));
      const { error } = finalApproval && decision === "needs_revision"
        ? await createClient().rpc(isMockupQuotation ? "return_mockup_quotation_from_gm" : "return_price_quotation_from_gm", { p_quotation_id: quotation.id, p_note: revisionNote })
        : finalApproval && decision === "approved"
        ? await createClient().rpc(
          "final_approve_price_quotation_with_edits",
          {
            p_quotation_id: quotation.id,
            p_vat_rate: n(vatRate),
            p_vat_calculation_type: "percentage",
            p_vat_fixed_amount: 0,
            p_terms_conditions: savedTerms,
            p_bank_details: bankDetails.filter((bank) => bank.bank_name || bank.account_name || bank.account_number),
            p_costings: costingsPayload,
          },
        )
      : isMockupQuotation
      ? await createClient().rpc("pricing_review_mockup_quotation", {
          p_quotation_id: quotation.id,
          p_decision: decision,
          p_vat_rate: 0,
          p_vat_calculation_type: "percentage",
          p_vat_fixed_amount: 0,
          p_terms_conditions: savedTerms,
          p_bank_details: bankDetails.filter((bank) => bank.bank_name || bank.account_name || bank.account_number),
          p_costings: costingsPayload,
          p_revision_note: revisionNote,
        })
      : !finalApproval
      ? await createClient().rpc("pricing_review_price_quotation", {
          p_quotation_id: quotation.id,
          p_decision: decision,
          p_vat_rate: 0,
          p_vat_calculation_type: "percentage",
          p_vat_fixed_amount: 0,
          p_terms_conditions: savedTerms,
          p_bank_details: bankDetails.filter((bank) => bank.bank_name || bank.account_name || bank.account_number),
          p_costings: costingsPayload,
          p_revision_note: revisionNote,
        })
      : await createClient().rpc("review_price_quotation", {
          p_quotation_id: quotation.id,
          p_decision: decision,
          p_vat_rate: n(vatRate),
          p_shipping_handling: 0,
          p_terms_conditions: savedTerms,
          p_bank_details: bankDetails.filter((bank) => bank.bank_name || bank.account_name || bank.account_number),
          p_line_prices: lines.map((line) => ({ id: line.id, unit_cost: n(prices[text(line.id)]) })),
          p_revision_note: revisionNote,
        });
    setWorking(false);
    if (error) return notice(error.message);
    close();
    notice(decision === "approved" ? (finalApproval ? `${documentLabel} approved.` : pricingRevision ? `${documentLabel} resubmitted to the General Manager.` : `${documentLabel} submitted to the General Manager.`) : `${documentLabel} returned for revision.`);
    await reload();
  };
  /*
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/35 p-4"><section className="mx-auto my-4 w-full max-w-4xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">Review Price Quotation</h2><p className="mt-1 text-[12px] text-[#687386]">{text(quotation.quotation_no)} - {text(quotation.client_name)} - Enter selling prices before approval.</p></div><button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button></div><PriceQuotationReviewContent lines={lines} prices={prices} setPrices={setPrices} subtotal={subtotal} vatRate={vatRate} setVatRate={setVatRate} tax={tax} shipping={shipping} setShipping={setShipping} total={total} terms={terms} setTerms={setTerms} bankDetails={bankDetails} setBankDetails={setBankDetails} revisionNote={revisionNote} setRevisionNote={setRevisionNote} close={close} saving={saving} working={working} review={review} /></section></div>;
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/35 p-4"><section className="mx-auto my-4 w-full max-w-6xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">Review Price Quotation</h2><p className="mt-1 text-[12px] text-[#687386]">{text(quotation.quotation_no)} · {text(quotation.client_name)} · Enter selling prices before approval.</p></div><button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button></div><div className="mt-5 grid gap-5 lg:grid-cols-[1.45fr_.75fr]"><div><Table labels={["Item", "Description", "Quantity", "Selling Price / Unit", "Amount"]}>{lines.map((line, index) => { const price = n(prices[text(line.id)]); return <tr key={text(line.id)}><td className="px-4 py-3 text-center">{index + 1}</td><td className="px-4 py-3 font-medium">{text(line.description)}</td><td className="px-4 py-3 text-center">{n(line.quantity)}</td><td className="px-4 py-2"><input aria-label={`Selling price for ${text(line.description)}`} type="number" min="0" step="any" value={prices[text(line.id)] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [text(line.id)]: event.target.value }))} className="input mt-0 text-right" /></td><td className="px-4 py-3 text-right font-semibold">{peso.format(n(line.quantity) * price)}</td></tr>; })}</Table><section className="mt-5 rounded-xl border border-[#e1e6ee] p-4"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Terms and Conditions</h3><Button secondary onClick={() => setTerms((current) => [...current, ""])}><Plus size={13} /> Add term</Button></div><div className="mt-3 space-y-2">{terms.map((term, index) => <div key={`${index}-${term}`} className="flex gap-2"><span className="pt-2 text-[12px] text-[#7d8797]">{index + 1}.</span><input value={term} onChange={(event) => setTerms((current) => current.map((value, itemIndex) => itemIndex === index ? titleCaseEntry(event.target.value, "term") : value))} className="input mt-0 flex-1" /><button type="button" aria-label={`Remove term ${index + 1}`} onClick={() => setTerms((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div></section><section className="mt-4 rounded-xl border border-[#e1e6ee] p-4"><div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Bank Details</h3><Button secondary onClick={() => setBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div><div className="mt-3 space-y-2">{bankDetails.map((bank, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Bank ${index + 1} name`} value={bank.bank_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, bank_name: event.target.value } : value))} placeholder="Bank" className="input mt-0" /><input aria-label={`Bank ${index + 1} account name`} value={bank.account_name} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_name: event.target.value } : value))} placeholder="Account name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account number`} value={bank.account_number} onChange={(event) => setBankDetails((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, account_number: event.target.value } : value))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label={`Remove bank ${index + 1}`} onClick={() => setBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div></section><label className="mt-4 block text-[12px] font-medium text-[#202938]">Revision note<textarea rows={3} value={revisionNote} onChange={(event) => setRevisionNote(titleCaseEntry(event.target.value, "revision_note"))} placeholder="Required only when returning for revision" className="input mt-1 min-h-[78px] resize-y" /></label></div><aside><section className="overflow-hidden rounded-xl border border-[#e1e6ee]"><div className="border-b border-[#edf0f5] px-4 py-3"><h3 className="text-[14px] font-semibold">Quotation Total</h3></div><Table labels={["Category", "Amount"]} minWidth={0}><tr><td className="px-4 py-3">Subtotal</td><td className="px-4 py-3 text-right font-medium">{peso.format(subtotal)}</td></tr><tr><td className="px-4 py-2">Tax <input aria-label="Tax percentage" type="number" min="0" step="any" value={vatRate} onChange={(event) => setVatRate(event.target.value)} className="input ml-2 mt-0 w-20 px-2 py-1 text-right" />%</td><td className="px-4 py-3 text-right">{peso.format(tax)}</td></tr><tr><td className="px-4 py-2">Shipping / Handling</td><td className="px-4 py-2"><input aria-label="Shipping and handling" type="number" min="0" step="any" value={shipping} onChange={(event) => setShipping(event.target.value)} className="input mt-0 text-right" /></td></tr><tr className="bg-[#eff7f1] text-[15px] font-bold text-[#176b40]"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{peso.format(total)}</td></tr></Table></section></aside></div><div className="mt-6 flex justify-end gap-2 border-t border-[#edf0f5] pt-4"><Button secondary onClick={close}>Close</Button><Button secondary loading={saving || working} disabled={saving || working} onClick={() => void review("needs_revision")}><RotateCcw size={14} /> Return for revision</Button><Button tone="green" loading={saving || working} disabled={saving || working} onClick={() => void review("approved")}><Check size={14} /> Approve Price Quotation</Button></div></section></div>;
  */
  return <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-[#151922]/35 p-4"><section className="mx-auto my-4 w-full max-w-6xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">Review {documentLabel}</h2><p className="mt-1 text-[12px] text-[#687386]">{text(quotation.quotation_no)} - {text(quotation.client_name)} - {pricingRevision ? "Address the General Manager's instructions and resubmit." : finalApproval ? "Finalize approval." : `Complete pricing and submit ${documentLabel} to the General Manager.`}</p></div><button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] hover:bg-[#f0f3f7]"><X size={18} /></button></div><PriceQuotationReviewContent lines={lines} projectName={text(quotation.project_name, "")} projectType={text(quotation.project_types, "")} sourceQuotationNo={text(sourceQuotation?.quotation_no, "") || undefined} documentLabel={documentLabel} illustrations={illustrations} productCostings={productCostings} pricingDefaults={activePricingDefaultSettings ?? {}} setProductCostings={setProductCostings} prices={prices} setPrices={setPrices} subtotal={subtotal} vatRate={vatRate} setVatRate={setVatRate} tax={tax} total={total} terms={terms} setTerms={setTerms} bankDetails={bankDetails} setBankDetails={updateBankDetails} revisionNote={revisionNote} setRevisionNote={setRevisionNote} close={close} saving={saving} working={working} review={review} finalApproval={finalApproval} showInternalMarkups={showInternalMarkups} visibleMarkupKeys={showInternalMarkups ? gmVisibleMarkupKeys : ["discounts"]} bankVisibility={bankVisibility} pricingRevision={pricingRevision} /></section></div>;
}

function GeneralManagerCostingReview({
  quotation,
  store,
  officer,
  saving,
  close,
  decide,
}: {
  quotation: Row;
  store: Store;
  officer: string;
  saving: boolean;
  close: () => void;
  decide: (
    status: "approved" | "needs_revision",
    changes?: Record<string, unknown>,
    revisionNote?: string,
  ) => void;
}) {
  const [rates, setRates] = useState({
    profit_margin_rate: text(quotation.profit_margin_rate, "75"),
    overhead_rate: text(quotation.overhead_rate, "0"),
    buffer_margin_rate: text(quotation.buffer_margin_rate, "20"),
    commission_rate: text(quotation.commission_rate, "5"),
    vat_rate: text(quotationVatRate(quotation), "12"),
  });
  const [terms, setTerms] = useState(
    text(quotation.terms_conditions, DEFAULT_QUOTATION_TERMS)
      .split(/\r?\n+/)
      .filter(Boolean),
  );
  const businessSettings = store.business_settings.find(
    (setting) => text(setting.organization_id) === text(quotation.organization_id),
  );
  const savedBankDetails = quotationBankDetailsSnapshot(quotation.bank_details);
  const hasSavedBankDetails = savedBankDetails !== null;
  const bankDetailsTouched = useRef(false);
  const [bankDetails, setBankDetailsState] = useState<BankDetail[]>(() =>
    savedBankDetails ?? quotationBankDetails(businessSettings?.default_bank_details),
  );
  const updateBankDetails = (
    next: BankDetail[] | ((current: BankDetail[]) => BankDetail[]),
  ) => {
    bankDetailsTouched.current = true;
    setBankDetailsState(next);
  };
  const setBankDetails = updateBankDetails;
  useEffect(() => {
    let active = true;
    const organizationId = text(quotation.organization_id);
    if (!organizationId || hasSavedBankDetails) return;
    void createClient()
      .from("business_settings")
      .select("default_bank_details")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || bankDetailsTouched.current || data?.default_bank_details === undefined) return;
        setBankDetailsState(quotationBankDetails(data.default_bank_details));
      });
    return () => {
      active = false;
    };
  }, [hasSavedBankDetails, quotation.organization_id]);
  const [revisionNote, setRevisionNote] = useState("");
  const lines = store.quotation_items.filter(
    (line) => line.quotation_id === quotation.id,
  );
  const cogs = lines.reduce((sum, line) => sum + n(line.line_total), 0);
  const profit = (cogs * n(rates.profit_margin_rate)) / 100;
  const overhead = (cogs * n(rates.overhead_rate)) / 100;
  const buffer = (cogs * n(rates.buffer_margin_rate)) / 100;
  const commission = (cogs * n(rates.commission_rate)) / 100;
  const sellingExVat = Math.round((cogs + profit + overhead + buffer + commission) * 100) / 100;
  const vat = Math.round(sellingExVat * n(rates.vat_rate)) / 100;
  const changes = {
    profit_margin_rate: n(rates.profit_margin_rate),
    overhead_rate: n(rates.overhead_rate),
    buffer_margin_rate: n(rates.buffer_margin_rate),
    commission_rate: n(rates.commission_rate),
    vat_rate: n(rates.vat_rate),
    terms_conditions: terms.filter((term) => term.trim()).join("\n"),
    bank_details: bankDetails.filter((detail) => detail.bank_name || detail.account_name || detail.account_number),
  };
  const rateRows: Array<{
    key: keyof typeof rates;
    label: string;
    amount: number;
  }> = [
    { key: "profit_margin_rate", label: "Declared Markup", amount: profit },
    { key: "overhead_rate", label: "Overhead Allocation", amount: overhead },
    { key: "buffer_margin_rate", label: "Buffer Margin", amount: buffer },
    {
      key: "commission_rate",
      label: "Production Commission",
      amount: commission,
    },
    { key: "vat_rate", label: "VAT", amount: vat },
  ];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/35 p-4">
      <section className="mx-auto my-4 w-full max-w-6xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#202938]">Review Costing Breakdown</h2>
            <p className="mt-1 text-[12px] text-[#687386]">{text(quotation.quotation_no)} · {text(quotation.client_name, text(quotation.project_name))} · Submitted by {officer}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]"><X size={18} /></button>
        </div>
        {/* Keep the costing table and the editable GM markup table in one vertical review flow. */}
        <div className="mt-5 grid grid-cols-1 gap-0">
          <div className="contents">
            <h3 className="mb-2 text-[14px] font-semibold text-[#202938]">Materials and Production</h3>
            <Table labels={["Preview", "Material", "Quantity", "Unit cost", "Subtotal"]}>
              {lines.map((line) => (
                <tr key={text(line.id)}>
                  <td className="px-4 py-2">{text(line.image_url, "") ? <img src={text(line.image_url)} alt={text(line.description)} className="size-10 rounded border object-contain" /> : <span className="grid size-10 place-items-center rounded border border-dashed text-[#a0a9b7]"><ImageIcon size={15} /></span>}</td>
                  <td className="px-4 py-2 font-medium">{text(line.description)}</td>
                  <td className="px-4 py-2 text-center">{n(line.quantity)}</td>
                  <td className="px-4 py-2 text-right">{peso.format(n(line.unit_cost))}</td>
                  <td className="px-4 py-2 text-right font-semibold">{peso.format(n(line.line_total))}</td>
                </tr>
              ))}
              <tr className="bg-[#f8fbff] text-[15px] font-bold text-[#202938]">
                <td colSpan={4} className="px-4 py-3.5 text-right">
                  Total Estimated COGS
                </td>
                <td className="px-4 py-3.5 text-right tabular-nums">
                  {peso.format(cogs)}
                </td>
              </tr>
            </Table>
            <section className="order-3 mt-5 rounded-xl border border-[#e1e6ee] p-4">
<div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Terms and Conditions</h3><Button onClick={() => setTerms((current) => [...current, ""])}><Plus size={13} /> Add term</Button></div>
              <div className="mt-3 space-y-2">{terms.map((term, index) => <div key={index} className="flex gap-2"><span className="pt-2 text-[12px] text-[#7d8797]">{index + 1}.</span><input value={term} onChange={(event) => setTerms((current) => current.map((value, itemIndex) => itemIndex === index ? titleCaseEntry(event.target.value, "term") : value))} className="input mt-0 flex-1" /><button type="button" aria-label="Remove term" onClick={() => setTerms((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
            </section>
            <section className="order-4 mt-4 rounded-xl border border-[#e1e6ee] p-4">
              <div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Bank Details</h3><Button secondary onClick={() => setBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div>
              <div className="mt-3 space-y-2">{bankDetails.map((detail, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Bank ${index + 1} name`} value={detail.bank_name} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bank_name: event.target.value } : item))} placeholder="Bank name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account name`} value={detail.account_name} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_name: event.target.value } : item))} placeholder="Account name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account number`} value={detail.account_number} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_number: event.target.value } : item))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label="Remove bank" onClick={() => setBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
            </section>
            <label className="order-5 mt-4 block text-[12px] font-medium text-[#202938]">
              Revision notes for Sales Executive
              <textarea
                rows={3}
                value={revisionNote}
                onChange={(event) => setRevisionNote(titleCaseEntry(event.target.value, "revision_note"))}
                placeholder="Required only when returning this Costing Breakdown for revision."
                className="input mt-1 min-h-[78px] resize-y"
              />
            </label>
          </div>
          <aside className="order-2 mt-5 space-y-4">
            <section className="overflow-hidden rounded-xl border border-[#e1e6ee]">
              <div className="border-b border-[#edf0f5] px-4 py-3">
                <h3 className="text-[14px] font-semibold text-[#202938]">
                  Markup, VAT, Expenses
                </h3>
                <p className="mt-0.5 text-[12px] text-[#687386]">
                  Edit a percentage directly in the table. Totals update automatically.
                </p>
              </div>
              <Table labels={["Category", "Rate", "Total"]} minWidth={0}>
                {rateRows.slice(0, 4).map((row) => (
                  <tr key={row.key} className="hover:bg-[#fbfcff]">
                    <td className="px-4 py-3 font-medium text-[#344054]">
                      {row.label}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`${row.label} rate`}
                          type="number"
                          min="0"
                          step="any"
                          value={rates[row.key]}
                          onChange={(event) =>
                            setRates((current) => ({
                              ...current,
                              [row.key]: event.target.value,
                            }))
                          }
                          className="input mt-0 min-w-0 px-2 py-1.5 text-right tabular-nums"
                        />
                        <span className="text-[#7d8797]">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {peso.format(row.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#f8fbff] font-semibold text-[#202938]">
                  <td className="px-4 py-3">Selling Price VAT Ex.</td>
                  <td className="px-4 py-3 text-center text-[#8b92a1]">—</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {peso.format(sellingExVat)}
                  </td>
                </tr>
                {rateRows.slice(4).map((row) => (
                  <tr key={row.key} className="hover:bg-[#fbfcff]">
                    <td className="px-4 py-3 font-medium text-[#344054]">
                      {row.label}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`${row.label} rate`}
                          type="number"
                          min="0"
                          step="any"
                          value={rates[row.key]}
                          onChange={(event) =>
                            setRates((current) => ({
                              ...current,
                              [row.key]: event.target.value,
                            }))
                          }
                          className="input mt-0 min-w-0 px-2 py-1.5 text-right tabular-nums"
                        />
                        <span className="text-[#7d8797]">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {peso.format(row.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#eff7f1] font-semibold text-[#176b40]">
                  <td className="px-4 py-3">Selling Price VAT Inc.</td>
                  <td className="px-4 py-3 text-center">—</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {peso.format(sellingExVat + vat)}
                  </td>
                </tr>
        </Table>
      </section>
          </aside>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-4">
          <Button secondary onClick={close}>Close</Button>
          <Button secondary loading={saving} disabled={saving} onClick={() => decide("needs_revision", changes, revisionNote)}><RotateCcw size={14} /> Return for revision</Button>
          <Button tone="green" loading={saving} disabled={saving} onClick={() => decide("approved", changes)}><Check size={14} /> Approve & Create Price Quotation</Button>
        </div>
      </section>
    </div>
  );
}

function SubmissionReview({
  quotation,
  store,
  officer,
  saving,
  close,
  decide,
}: {
  quotation: Row;
  store: Store;
  officer: string;
  saving: boolean;
  close: () => void;
  decide: (status: "approved" | "needs_revision") => void;
}) {
  const lead = store.leads.find((item) => item.id === quotation.lead_id);
  const customer = store.customers.find(
    (item) => item.id === quotation.customer_id,
  );
  const lines = store.quotation_items.filter(
    (line) => line.quotation_id === quotation.id,
  );
  const isCosting = text(quotation.document_type) === "costing_breakdown";
  const terms = isCosting
    ? []
    : text(quotation.terms_conditions, DEFAULT_QUOTATION_TERMS)
        .split(/\r?\n+/)
        .map((term) => term.trim())
        .filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/30 p-4">
      <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[14px] border border-[#d9e0e9] bg-white p-5">
        <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[#202938]">
              Review {isCosting ? "Costing Breakdown" : "Price Quotation"}
            </h2>
            <p className="mt-1 text-[12px] text-[#626b7a]">
              {text(quotation.quotation_no)} · {text(quotation.project_name)}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
          <div>
            <span className="text-[#8b92a1]">Client</span>
            <p className="mt-1 font-medium">
              {text(customer?.company_name ?? lead?.client_name)}
            </p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Sales Executive</span>
            <p className="mt-1 font-medium">{officer}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Submitted</span>
            <p className="mt-1 font-medium">{day(quotation.submitted_at)}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Sales Executive</span>
            <p className="mt-1 font-medium">{text(quotation.representative)}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Status</span>
            <p className="mt-1">
              <Status value={quotation.status} />
            </p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-[14px] font-semibold text-[#202938]">
            Materials and production costs
          </h3>
          {lines.length ? (
            <Table
              labels={[
                "Material / cost",
                "Quantity",
                "Unit cost",
                "Line total",
              ]}
            >
              {lines.map((line) => (
                <tr key={text(line.id)}>
                  <td className="px-5 py-3 font-medium">
                    {text(line.description)}
                  </td>
                  <td className="px-5 py-3">{n(line.quantity)}</td>
                  <td className="px-5 py-3">
                    {peso.format(n(line.unit_cost))}
                  </td>
                  <td className="px-5 py-3 font-semibold">
                    {peso.format(n(line.line_total))}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No material or production costs were submitted.</Empty>
          )}
        </div>

        <div className="ml-auto mt-5 max-w-sm text-[13px]">
          <Cost label="Total cost" value={n(quotation.total_cost)} />
          <Cost
            label={`Declared markup (${n(quotation.profit_margin_rate)}%)`}
            value={
              (n(quotation.total_cost) * n(quotation.profit_margin_rate)) / 100
            }
          />
          <Cost
            label={`Overhead (${n(quotation.overhead_rate)}%)`}
            value={(n(quotation.total_cost) * n(quotation.overhead_rate)) / 100}
          />
          <Cost
            label={`Buffer margin (${n(quotation.buffer_margin_rate)}%)`}
            value={
              (n(quotation.total_cost) * n(quotation.buffer_margin_rate)) / 100
            }
          />
          <Cost
            label={`Commission (${n(quotation.commission_rate)}%)`}
            value={
              (n(quotation.total_cost) * n(quotation.commission_rate)) / 100
            }
          />
          <Cost
            label={`VAT (${quotationVatRate(quotation)}%)`}
            value={n(quotation.vat_amount)}
          />
          <Cost
            label={isCosting ? "Total quotation amount" : "Quotation amount"}
            value={n(quotation.total_amount)}
            strong
          />
        </div>

        {terms.length > 0 && (
          <div className="mt-6 border-t border-[#edf0f5] pt-5">
            <h3 className="text-[14px] font-semibold text-[#202938]">
              Terms and conditions
            </h3>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12px] text-[#626b7a]">
              {terms.map((term, index) => (
                <li key={`${index}-${term}`}>{term}</li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-[#edf0f5] pt-4">
          <Button secondary onClick={close}>
            Close
          </Button>
          <Button
            secondary
            confirm
            confirmationText="Are you sure you want to return this submission for revision?"
            loading={saving}
            disabled={saving}
            onClick={() => decide("needs_revision")}
          >
            <RotateCcw size={14} />
            Return for revision
          </Button>
          <Button
            tone="green"
            confirm
            confirmationText="Are you sure you want to approve this submission?"
            loading={saving}
            disabled={saving}
            onClick={() => decide("approved")}
          >
            <Check size={14} />
            Approve
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProjectEditRequestReview({
  request,
  store,
  saving,
  close,
  decide,
}: {
  request: Row;
  store: Store;
  saving: boolean;
  close: () => void;
  decide: (decision: "approved" | "needs_revision", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const project = store.leads.find((item) => item.id === request.project_id);
  const changes =
    request.proposed_changes && typeof request.proposed_changes === "object"
      ? (request.proposed_changes as Record<string, unknown>)
      : {};
  const labels: Record<string, string> = {
    project_name: "Project name",
    contact_name: "Client's Name",
    client_name: "Company name",
    email: "Email",
    phone: "Phone",
    date_sent: leadRecordedDateLabel,
    date_contacted: "Date contacted",
    contact_method: "Contact method",
    outbound_caller: "Outbound caller",
    done_deal_status: "Done Deal status",
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/35 p-4">
      <section className="mx-auto my-8 w-full max-w-2xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#202938]">Review Project Edit</h2>
            <p className="mt-1 text-[12px] text-[#687386]">{text(project?.project_name)} · {text(project?.lead_no)}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]"><X size={18} /></button>
        </div>
        <Table labels={["Field", "Current", "Requested"]} minWidth={0}>
          {Object.entries(changes).map(([key, value]) => (
            <tr key={key}>
              <td className="px-4 py-3 font-medium text-[#344054]">{labels[key] ?? key}</td>
              <td className="px-4 py-3 text-[#687386]">{key === "done_deal_status" ? doneDealStatusLabel(project?.[key]) : text(project?.[key], "—")}</td>
              <td className="px-4 py-3 font-medium">{key === "done_deal_status" ? doneDealStatusLabel(value) : text(value, "—")}</td>
            </tr>
          ))}
        </Table>
        <label className="mt-4 block text-[12px] font-medium text-[#202938]">
          Revision note
          <textarea rows={3} value={note} onChange={(event) => setNote(titleCaseEntry(event.target.value, "note"))} className="input mt-1 min-h-[76px] resize-y" placeholder="Required when returning for revision" />
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-4">
          <Button secondary onClick={close}>Close</Button>
          <Button secondary loading={saving} disabled={saving || !note.trim()} onClick={() => decide("needs_revision", note)}><RotateCcw size={14} /> Return for revision</Button>
          <Button tone="green" loading={saving} disabled={saving} onClick={() => decide("approved", note)}><Check size={14} /> Approve edit</Button>
        </div>
      </section>
    </div>
  );
}

function LeadChangeRequestReview({
  request,
  store,
  saving,
  close,
  decide,
}: {
  request: Row;
  store: Store;
  saving: boolean;
  close: () => void;
  decide: (decision: "approved" | "needs_revision" | "rejected", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const lead = store.leads.find((item) => item.id === request.lead_id);
  const isDeletion = text(request.change_type, "") === "delete";
  const changes =
    request.proposed_changes && typeof request.proposed_changes === "object"
      ? (request.proposed_changes as Record<string, unknown>)
      : {};
  const labels: Record<string, string> = {
    project_name: "Project name",
    contact_name: "Client's Name",
    client_name: "Company name",
    email: "Email",
    phone: "Phone number",
    date_sent: leadRecordedDateLabel,
    date_contacted: "Date contacted",
    contact_method: "Outbound method",
    evaluation_number: "Lead status",
    done_deal_status: "Done Deal status",
  };
  const valueFor = (key: string, value: unknown) =>
    key === "evaluation_number"
      ? evaluationLabel(value)
      : key === "done_deal_status"
        ? doneDealStatusLabel(value)
        : text(value, "—");
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#151922]/35 p-4">
      <section className="mx-auto my-8 w-full max-w-2xl rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#edf0f5] pb-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#202938]">
              {isDeletion ? "Review Lead Deletion" : "Review Lead Edit"}
            </h2>
            <p className="mt-1 text-[12px] text-[#687386]">
              {text(lead?.project_name)} · {text(lead?.lead_no)}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close review" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]">
            <X size={18} />
          </button>
        </div>
        {isDeletion ? (
          <>
            <p className="mt-4 rounded-lg border border-[#fed7d7] bg-[#fff5f5] p-3 text-[13px] leading-5 text-[#9b1c1c]">
              Approving this request permanently deletes the Lead and every linked workflow record. This cannot be undone.
            </p>
            <section className="mt-4 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3">
              <h3 className="text-[12px] font-semibold text-[#344054]">
                Sales Executive reason
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[#4b5565]">
                {text(request.request_note, "No reason provided.")}
              </p>
            </section>
          </>
        ) : (
          <Table labels={["Field", "Current", "Requested"]} minWidth={0}>
            {Object.entries(changes).map(([key, value]) => (
              <tr key={key}>
                <td className="px-4 py-3 font-medium text-[#344054]">
                  {labels[key] ?? key}
                </td>
                <td className="px-4 py-3 text-[#687386]">
                  {valueFor(key, lead?.[key])}
                </td>
                <td className="px-4 py-3 font-medium">
                  {valueFor(key, value)}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {!isDeletion && text(request.request_note, "") && (
          <section className="mt-4 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3">
            <h3 className="text-[12px] font-semibold text-[#344054]">
              Sales Executive note
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[#4b5565]">
              {text(request.request_note)}
            </p>
          </section>
        )}
        <label className="mt-4 block text-[12px] font-medium text-[#202938]">
          {isDeletion ? "Decision note" : "Revision note"}
          <textarea rows={3} value={note} onChange={(event) => setNote(titleCaseEntry(event.target.value, "note"))} className="input mt-1 min-h-[76px] resize-y" placeholder={isDeletion ? "Optional note for the Sales Executive" : "Required when returning for revision"} />
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-4">
          <Button secondary onClick={close}>Close</Button>
          {isDeletion ? (
            <Button secondary loading={saving} disabled={saving} onClick={() => decide("rejected", note)}><X size={14} /> Reject deletion</Button>
          ) : (
            <Button secondary loading={saving} disabled={saving || !note.trim()} onClick={() => decide("needs_revision", note)}><RotateCcw size={14} /> Return for revision</Button>
          )}
          <Button
            tone="green"
            loading={saving}
            disabled={saving}
            confirm={isDeletion}
            confirmationText="Approve and permanently delete this Lead? This cannot be undone."
            onClick={() => decide("approved", note)}
          >
            <Check size={14} />
            {isDeletion ? "Approve deletion" : "Approve edit"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Submissions({
  store,
  orgId,
  reload,
  notice,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [tab, setTab] = useState<ApprovalCenterTab>("all");
  const [selectedProjectEdit, setSelectedProjectEdit] = useState<Row | null>(null);
  const [selectedLeadChange, setSelectedLeadChange] = useState<Row | null>(null);
  const [selectedPriceQuotation, setSelectedPriceQuotation] = useState<Row | null>(null);
  const [pdfQuote, setPdfQuote] = useState<Row | null>(null);
  const [pdfWindow, setPdfWindow] = useState<Window | null>(null);
  const [printAfterOpen, setPrintAfterOpen] = useState(false);
  const [approvalQuery, setApprovalQuery] = useState("");
  const [approvalMonth, setApprovalMonth] = useState("");
  const [approvalOfficerFilter, setApprovalOfficerFilter] = useState("all");
  const [selectedApprovalKeys, setSelectedApprovalKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkDecision, setBulkDecision] = useState<ApprovalDecision | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const approvalOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  const pendingPriceQuotations = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending_gm_approval" &&
      text(quotation.document_type) === "price_quotation" &&
      !quotation.costing_source_id,
  ).sort(newestActivityFirst);
  const pendingMockupQuotations = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending_gm_approval" &&
      text(quotation.document_type) === "mockup_quotation",
  ).sort(newestActivityFirst);
  const pendingCostings = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending" &&
      text(quotation.document_type) === "costing_breakdown",
  ).sort(newestActivityFirst);
  const pendingApprovalRequests = store.approval_requests.filter(
    (request) =>
      text(request.status) === "pending" &&
      text(request.resource_type) !== "quotation",
  ).sort(newestActivityFirst);
  const quotationOfficerId = (quotation: Row) => {
    const source = text(quotation.document_type) === "mockup_quotation"
      ? store.quotations.find((item) => item.id === quotation.source_price_quotation_id)
      : quotation;
    return projectOfficerIdForQuote(store, source ?? quotation);
  };
  const officerName = (quotation: Row) =>
    text(
      store.profiles.find((profile) => profile.id === quotationOfficerId(quotation))?.full_name,
      "Sales Executive",
    );
  const decide = async (
    quotation: Row,
    status: "approved" | "needs_revision",
    reviewChanges: Record<string, unknown> = {},
    revisionNote = "",
  ) => {
    if (!quotation.id) return;
    setSavingId(quotation.id);
    const client = createClient();
    const { error } = await client.rpc("review_costing_breakdown", {
      p_costing_id: quotation.id,
      p_decision: status,
      p_profit_margin_rate: n(
        reviewChanges.profit_margin_rate ?? quotation.profit_margin_rate,
      ),
      p_overhead_rate: n(reviewChanges.overhead_rate ?? quotation.overhead_rate),
      p_buffer_margin_rate: n(
        reviewChanges.buffer_margin_rate ?? quotation.buffer_margin_rate,
      ),
      p_commission_rate: n(
        reviewChanges.commission_rate ?? quotation.commission_rate,
      ),
      p_vat_rate: n(reviewChanges.vat_rate ?? quotationVatRate(quotation)),
      p_terms_conditions:
        typeof reviewChanges.terms_conditions === "string"
          ? reviewChanges.terms_conditions
          : text(quotation.terms_conditions, ""),
      p_bank_details: Array.isArray(reviewChanges.bank_details)
        ? reviewChanges.bank_details
        : quotationBankDetails(quotation.bank_details),
      p_revision_note: revisionNote,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    setSelected(null);
    const hasLinkedPriceQuotation = store.quotations.some(
      (item) =>
        item.costing_source_id === quotation.id &&
        text(item.document_type) === "price_quotation",
    );
    notice(
      status === "approved"
        ? hasLinkedPriceQuotation
          ? "Costing Breakdown approved and Price Quotation updated."
          : "Costing Breakdown approved and Price Quotation created."
        : "Returned to the Sales Executive for re-evaluation.",
    );
    await reload();
  };
  const decideApprovalRequest = async (
    request: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    const { error } = await createClient().rpc("review_approval_request", {
      p_request_id: request.id,
      p_decision: decision,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    notice(decision === "approved" ? "Approval request approved." : "Approval request rejected.");
    await reload();
  };
  const decideProjectEdit = async (
    request: Row,
    decision: "approved" | "needs_revision",
    note: string,
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    const { error } = await createClient().rpc("review_project_edit", {
      p_request_id: request.id,
      p_decision: decision,
      p_decision_note: note,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    setSelectedProjectEdit(null);
    notice(
      decision === "approved"
        ? "Project edit approved."
        : "Project edit returned for revision.",
    );
    await reload();
  };
  const decideLeadChange = async (
    request: Row,
    decision: "approved" | "needs_revision" | "rejected",
    note: string,
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    const { error } = await createClient().rpc("review_lead_change", {
      p_request_id: request.id,
      p_decision: decision,
      p_decision_note: note,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    setSelectedLeadChange(null);
    const isDeletion = text(request.change_type, "") === "delete";
    notice(
      decision === "approved"
        ? isDeletion
          ? "Lead deletion approved."
          : "Lead edit approved."
        : decision === "needs_revision"
          ? "Lead edit returned for revision."
          : "Lead deletion rejected.",
    );
    await reload();
  };
  const decideQuotationRevision = async (
    request: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    const { error } = await createClient().rpc("review_quotation_revision", {
      p_request_id: request.id,
      p_decision: decision,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    notice(
      decision === "approved"
        ? "Costing Breakdown reopened for revision."
        : "Costing Breakdown revision request rejected.",
    );
    await reload();
  };
  const decidePriceQuotationRevision = async (
    request: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    const { error } = await createClient().rpc("review_price_quotation_revision", {
      p_request_id: request.id,
      p_decision: decision,
    });
    setSavingId(null);
    if (error) return notice(error.message);
    notice(decision === "approved" ? "Price Quotation reopened for revision." : "Price Quotation revision request rejected.");
    await reload();
  };
  const decideProjectSchedule = async (
    schedule: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!schedule.id) return;
    setSavingId(text(schedule.id));
    try {
      const client = createClient();
      const { data } = await client.auth.getUser();
      if (!data.user) throw new Error("Please sign in again before reviewing this project.");
      const { error } = await client.rpc("review_project_schedule", {
        p_schedule_id: schedule.id,
        p_decision: decision,
      });
      if (error) throw error;
      notice(
        decision === "approved"
          ? "Production request approved and linked to the production job."
          : "Production request rejected.",
      );
      await reload();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Project review could not be saved.");
    } finally {
      setSavingId(null);
    }
  };
  const decideProjectScheduleRevision = async (
    request: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    try {
      const { error } = await createClient().rpc(
        "review_project_schedule_revision",
        {
          p_request_id: request.id,
          p_decision: decision,
        },
      );
      if (error) throw error;
      notice(
        decision === "approved"
          ? "Project schedule revision approved."
          : "Project schedule revision rejected.",
      );
      await reload();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Project schedule revision could not be reviewed.",
      );
    } finally {
      setSavingId(null);
    }
  };
  const decideProjectScheduleCompletion = async (
    request: Row,
    decision: "approved" | "rejected",
  ) => {
    if (!request.id) return;
    setSavingId(text(request.id));
    try {
      const { error } = await createClient().rpc(
        "review_project_schedule_completion",
        {
          p_request_id: request.id,
          p_decision: decision,
        },
      );
      if (error) throw error;
      notice(
        decision === "approved"
          ? "Project marked completed, delivered, and counted in the KPI."
          : "Project completion request rejected.",
      );
      await reload();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Project completion could not be reviewed.",
      );
    } finally {
      setSavingId(null);
    }
  };
  const pendingProjectEdits = store.project_edit_requests.filter(
    (request) => text(request.status) === "pending",
  ).sort(newestActivityFirst);
  const pendingLeadChanges = store.lead_change_requests.filter(
    (request) => text(request.status) === "pending",
  ).sort(newestActivityFirst);
  const pendingQuotationRevisions = store.quotation_revision_requests.filter(
    (request) => text(request.status) === "pending",
  ).sort(newestActivityFirst);
  const pendingPriceQuotationRevisions = store.price_quotation_revision_requests.filter(
    (request) => text(request.status) === "pending",
  ).sort(newestActivityFirst);
  const pendingProjectSchedules = store.project_schedules.filter(
    (schedule) => text(schedule.status) === "pending",
  ).sort(newestActivityFirst);
  const pendingProjectScheduleRevisions =
    store.project_schedule_revision_requests.filter(
      (request) => text(request.status) === "pending",
    ).sort(newestActivityFirst);
  const pendingProjectScheduleCompletions =
    store.project_schedule_completion_requests.filter(
      (request) => text(request.status) === "pending",
    ).sort(newestActivityFirst);
  const projectOfficerName = (request: Row) =>
    text(
      store.profiles.find((profile) => profile.id === request.submitted_by)
        ?.full_name,
      "Sales Executive",
    );
  const scheduleOfficerName = (schedule: Row) =>
    text(
      store.profiles.find((profile) => profile.id === schedule.assigned_to)
        ?.full_name,
      "Sales Executive",
    );
  const approvalStaffName = (userId: unknown) =>
    text(
      store.profiles.find((profile) => profile.id === userId)?.full_name,
      "Sales Executive",
    );
  const approvalSearch = approvalQuery.trim().toLowerCase();
  const matchesApprovalFilters = (
    submittedAt: unknown,
    officerId: unknown,
    ...values: unknown[]
  ) => {
    if (approvalMonth && text(submittedAt, "").slice(0, 7) !== approvalMonth) return false;
    if (approvalOfficerFilter !== "all" && text(officerId, "") !== approvalOfficerFilter) return false;
    if (!approvalSearch) return true;
    return values
      .concat(approvalStaffName(officerId))
      .some((value) => text(value, "").toLowerCase().includes(approvalSearch));
  };
  const visiblePendingPriceQuotations = pendingPriceQuotations.filter((quotation) => {
    const party = quotationParty(quotation, store);
    const officerId = quotationOfficerId(quotation);
    return matchesApprovalFilters(
      quotation.submitted_at ?? quotation.created_at,
      officerId,
      quotation.quotation_no,
      quotation.project_name,
      party.clientName,
      party.companyName,
    );
  });
  const visiblePendingMockupQuotations = pendingMockupQuotations.filter((quotation) => {
    const source = store.quotations.find((item) => item.id === quotation.source_price_quotation_id);
    const party = quotationParty(quotation, store);
    const officerId = quotationOfficerId(quotation);
    return matchesApprovalFilters(
      quotation.submitted_at ?? quotation.created_at,
      officerId,
      quotation.quotation_no,
      source?.quotation_no,
      quotation.project_name,
      quotation.project_types,
      party.clientName,
      party.companyName,
    );
  });
  const visiblePendingCostings = pendingCostings.filter((quotation) => {
    const lead = store.leads.find((item) => item.id === quotation.lead_id);
    const officerId = quotationOfficerId(quotation);
    return matchesApprovalFilters(
      quotation.submitted_at ?? quotation.created_at,
      officerId,
      quotation.quotation_no,
      quotation.project_name,
      quotation.client_name,
      lead?.client_name,
      lead?.contact_name,
    );
  });
  const visiblePendingPriceQuotationRevisions = pendingPriceQuotationRevisions.filter((request) => {
    const quotation = store.quotations.find((item) => item.id === request.quotation_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      quotation?.quotation_no,
      quotation?.project_name,
    );
  });
  const visiblePendingQuotationRevisions = pendingQuotationRevisions.filter((request) => {
    const quotation = store.quotations.find((item) => item.id === request.costing_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      quotation?.quotation_no,
      quotation?.project_name,
    );
  });
  const visiblePendingProjectSchedules = pendingProjectSchedules.filter((schedule) =>
    matchesApprovalFilters(
      schedule.created_at,
      schedule.assigned_to,
      schedule.quotation_no,
      schedule.client_name,
      schedule.product_name,
      schedule.project_name,
    ),
  );
  const visiblePendingProjectScheduleRevisions = pendingProjectScheduleRevisions.filter((request) => {
    const schedule = store.project_schedules.find((item) => item.id === request.schedule_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      schedule?.quotation_no,
      schedule?.client_name,
      schedule?.product_name,
    );
  });
  const visiblePendingProjectScheduleCompletions = pendingProjectScheduleCompletions.filter((request) => {
    const schedule = store.project_schedules.find((item) => item.id === request.schedule_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      schedule?.quotation_no,
      schedule?.client_name,
      schedule?.product_name,
    );
  });
  const visiblePendingProjectEdits = pendingProjectEdits.filter((request) => {
    const project = store.leads.find((lead) => lead.id === request.project_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      project?.project_name,
      project?.client_name,
    );
  });
  const visiblePendingLeadChanges = pendingLeadChanges.filter((request) => {
    const lead = store.leads.find((item) => item.id === request.lead_id);
    return matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      lead?.project_name,
      lead?.client_name,
    );
  });
  const visiblePendingApprovalRequests = pendingApprovalRequests.filter((request) =>
    matchesApprovalFilters(
      request.submitted_at ?? request.created_at,
      request.submitted_by,
      request.resource_type,
      request.resource_id,
    ),
  );
  const openQuotationPdf = (quotation?: Row, shouldPrint = false) => {
    if (!quotation) return notice("The Price Quotation for this project could not be found.");
    const nextWindow = window.open("about:blank", "_blank");
    if (!nextWindow) return notice("Allow pop-ups to open the quotation PDF.");
    nextWindow.opener = null;
    setPrintAfterOpen(shouldPrint);
    setPdfWindow(nextWindow);
    setPdfQuote(quotation);
  };
  const pendingTotal = visiblePendingPriceQuotations.length + visiblePendingMockupQuotations.length + visiblePendingPriceQuotationRevisions.length + visiblePendingCostings.length + visiblePendingQuotationRevisions.length + visiblePendingProjectSchedules.length + visiblePendingProjectScheduleRevisions.length + visiblePendingProjectScheduleCompletions.length + visiblePendingProjectEdits.length + visiblePendingLeadChanges.length + visiblePendingApprovalRequests.length;
  const pendingQueueItems: ApprovalQueueItem[] = [
    ...visiblePendingPriceQuotations.map((quotation) => ({
      key: `price-${text(quotation.id)}`,
      tab: "quotations" as const,
      category: "Price quotation",
      title: text(quotation.quotation_no, "Price Quotation"),
      detail: text(quotation.project_name),
      requester: officerName(quotation),
      submittedAt: quotation.submitted_at,
      selectable: true,
      bulkDecisions: ["approved"] as ApprovalDecision[],
      bulkAction: async (decision: ApprovalDecision) => {
        if (decision !== "approved") {
          return { error: { message: "Direct Price Quotations can only be approved in bulk." } };
        }
        return createClient().rpc("final_approve_price_quotation_from_saved_state", {
          p_quotation_id: text(quotation.id),
        });
      },
      action: <ActionIcon label="Review Price Quotation" confirm={false} onClick={() => setSelectedPriceQuotation(quotation)}><FileText size={15} /></ActionIcon>,
    })),
    ...visiblePendingMockupQuotations.map((quotation) => ({
      key: `mockup-${text(quotation.id)}`,
      tab: "mockup_quotations" as const,
      category: "Mockup quotation",
      title: text(quotation.quotation_no, "Mockup Quotation"),
      detail: text(quotation.project_name),
      requester: officerName(quotation),
      submittedAt: quotation.submitted_at,
      selectable: false,
      action: <ActionIcon label="Review Mockup Quotation" confirm={false} onClick={() => setSelectedPriceQuotation(quotation)}><FileText size={15} /></ActionIcon>,
    })),
    ...visiblePendingPriceQuotationRevisions.map((request) => {
      const quotation = store.quotations.find((item) => item.id === request.quotation_id);
      return {
        key: `price-revision-${text(request.id)}`,
        tab: "price_revisions" as const,
        category: "Price revision",
        title: text(quotation?.quotation_no, "Price Quotation"),
        detail: text(quotation?.project_name),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: true,
        bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_price_quotation_revision", {
          p_request_id: text(request.id),
          p_decision: decision,
        }),
        action: <span className="flex items-center gap-1"><ActionIcon label="Approve Price Quotation revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decidePriceQuotationRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject Price Quotation revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decidePriceQuotationRevision(request, "rejected")}><X size={15} /></ActionIcon></span>,
      };
    }),
    ...visiblePendingCostings.map((quotation) => ({
      key: `costing-${text(quotation.id)}`,
      tab: "costings" as const,
      category: "Costing breakdown",
      title: text(quotation.quotation_no, "Costing Breakdown"),
      detail: text(quotation.project_name),
      requester: officerName(quotation),
      submittedAt: quotation.submitted_at,
      selectable: false,
      action: <ActionIcon label="Review costing breakdown" confirm={false} onClick={() => setSelected(quotation)}><FileText size={15} /></ActionIcon>,
    })),
    ...visiblePendingQuotationRevisions.map((request) => {
      const costing = store.quotations.find((item) => item.id === request.costing_id);
      return {
        key: `costing-revision-${text(request.id)}`,
        tab: "revisions" as const,
        category: "Costing revision",
        title: text(costing?.quotation_no, "Costing Breakdown"),
        detail: text(costing?.project_name),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: true,
        bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_quotation_revision", {
          p_request_id: text(request.id),
          p_decision: decision,
        }),
        action: <span className="flex items-center gap-1"><ActionIcon label="Approve costing revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideQuotationRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject costing revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideQuotationRevision(request, "rejected")}><X size={15} /></ActionIcon></span>,
      };
    }),
    ...visiblePendingProjectSchedules.map((schedule) => ({
      key: `production-${text(schedule.id)}`,
      tab: "calendar_projects" as const,
      category: "Production request",
      title: text(schedule.quotation_no, "Production request"),
      detail: text(schedule.client_name, text(schedule.product_name)),
      requester: scheduleOfficerName(schedule),
      submittedAt: schedule.created_at,
      selectable: true,
      bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_project_schedule", {
        p_schedule_id: text(schedule.id),
        p_decision: decision,
      }),
      action: <span className="flex items-center gap-1"><ActionIcon label="View Price Quotation PDF" confirm={false} disabled={bulkSaving} onClick={() => openQuotationPdf(store.quotations.find((item) => item.id === schedule.quotation_id))}><FileText size={15} /></ActionIcon><ActionIcon label="Print Price Quotation" confirm={false} disabled={bulkSaving} onClick={() => openQuotationPdf(store.quotations.find((item) => item.id === schedule.quotation_id), true)}><Printer size={15} /></ActionIcon><ActionIcon label="Approve production request" tone="green" loading={savingId === schedule.id} disabled={savingId === schedule.id || bulkSaving} onClick={() => void decideProjectSchedule(schedule, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject production request" tone="red" loading={savingId === schedule.id} disabled={savingId === schedule.id || bulkSaving} onClick={() => void decideProjectSchedule(schedule, "rejected")}><X size={15} /></ActionIcon></span>,
    })),
    ...visiblePendingProjectScheduleRevisions.map((request) => {
      const schedule = store.project_schedules.find((item) => item.id === request.schedule_id);
      return {
        key: `schedule-revision-${text(request.id)}`,
        tab: "calendar_revisions" as const,
        category: "Schedule revision",
        title: text(schedule?.quotation_no, "Project schedule"),
        detail: text(schedule?.client_name, text(schedule?.product_name)),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: true,
        bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_project_schedule_revision", {
          p_request_id: text(request.id),
          p_decision: decision,
        }),
        action: <span className="flex items-center gap-1"><ActionIcon label="Approve schedule revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject schedule revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleRevision(request, "rejected")}><X size={15} /></ActionIcon></span>,
      };
    }),
    ...visiblePendingProjectScheduleCompletions.map((request) => {
      const schedule = store.project_schedules.find((item) => item.id === request.schedule_id);
      return {
        key: `completion-${text(request.id)}`,
        tab: "calendar_completions" as const,
        category: "Project completion",
        title: text(schedule?.quotation_no, "Project completion"),
        detail: text(schedule?.client_name, text(schedule?.product_name)),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: true,
        bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_project_schedule_completion", {
          p_request_id: text(request.id),
          p_decision: decision,
        }),
        action: <span className="flex items-center gap-1"><ActionIcon label="Approve project completion" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleCompletion(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject project completion" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleCompletion(request, "rejected")}><X size={15} /></ActionIcon></span>,
      };
    }),
    ...visiblePendingProjectEdits.map((request) => {
      const project = store.leads.find((lead) => lead.id === request.project_id);
      return {
        key: `project-edit-${text(request.id)}`,
        tab: "projects" as const,
        category: "Project change",
        title: text(project?.project_name, "Project edit"),
        detail: text(project?.client_name, "Requested project changes"),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: false,
        action: <ActionIcon label="Review project edit" confirm={false} onClick={() => setSelectedProjectEdit(request)}><FileText size={15} /></ActionIcon>,
      };
    }),
    ...visiblePendingLeadChanges.map((request) => {
      const lead = store.leads.find((item) => item.id === request.lead_id);
      return {
        key: `lead-change-${text(request.id)}`,
        tab: "leads" as const,
        category: "Lead change",
        title: text(lead?.project_name, "Lead change"),
        detail: text(lead?.client_name, "Requested lead changes"),
        requester: projectOfficerName(request),
        submittedAt: request.submitted_at,
        selectable: false,
        action: <ActionIcon label="Review lead change" confirm={false} onClick={() => setSelectedLeadChange(request)}><FileText size={15} /></ActionIcon>,
      };
    }),
    ...visiblePendingApprovalRequests.map((request) => ({
      key: `approval-${text(request.id)}`,
      tab: "other" as const,
      category: "Other approval",
      title: text(request.resource_type, "Approval request").replaceAll("_", " "),
      detail: text(request.resource_id),
      requester: text(store.profiles.find((profile) => profile.id === request.submitted_by)?.full_name, "Team member"),
      submittedAt: request.submitted_at,
      selectable: true,
      bulkAction: async (decision: ApprovalDecision) => createClient().rpc("review_approval_request", {
        p_request_id: text(request.id),
        p_decision: decision,
      }),
      action: <span className="flex items-center gap-1"><ActionIcon label="Approve request" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideApprovalRequest(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject request" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideApprovalRequest(request, "rejected")}><X size={15} /></ActionIcon></span>,
    })),
  ];
  const pendingQueueItemByKey = new Map(
    pendingQueueItems.map((item) => [item.key, item]),
  );
  const currentApprovalItems = tab === "all"
    ? pendingQueueItems
    : pendingQueueItems.filter((item) => item.tab === tab);
  const currentSelectableItems = currentApprovalItems.filter(
    (item) => item.selectable && item.bulkAction,
  );
  const selectedCurrentApprovalItems = currentSelectableItems.filter((item) =>
    selectedApprovalKeys.has(item.key),
  );
  const canBulkApproveCurrent = currentSelectableItems.some((item) =>
    (item.bulkDecisions ?? ["approved", "rejected"]).includes("approved"),
  );
  const canBulkRejectCurrent = currentSelectableItems.some((item) =>
    (item.bulkDecisions ?? ["approved", "rejected"]).includes("rejected"),
  );
  const selectedCanBulkApprove =
    selectedCurrentApprovalItems.length > 0 &&
    selectedCurrentApprovalItems.every((item) =>
      (item.bulkDecisions ?? ["approved", "rejected"]).includes("approved"),
    );
  const selectedCanBulkReject =
    selectedCurrentApprovalItems.length > 0 &&
    selectedCurrentApprovalItems.every((item) =>
      (item.bulkDecisions ?? ["approved", "rejected"]).includes("rejected"),
    );
  const allCurrentItemsSelected =
    currentSelectableItems.length > 0 &&
    selectedCurrentApprovalItems.length === currentSelectableItems.length;
  const someCurrentItemsSelected =
    selectedCurrentApprovalItems.length > 0 && !allCurrentItemsSelected;
  const toggleApprovalSelection = (key: string) => {
    setSelectedApprovalKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAllApprovalSelection = () => {
    const currentKeys = currentSelectableItems.map((item) => item.key);
    setSelectedApprovalKeys((current) => {
      const next = new Set(current);
      if (allCurrentItemsSelected) currentKeys.forEach((key) => next.delete(key));
      else currentKeys.forEach((key) => next.add(key));
      return next;
    });
  };
  const runBulkDecision = async (decision: ApprovalDecision) => {
    const items = currentSelectableItems.filter((item) =>
      selectedApprovalKeys.has(item.key),
    );
    if (!items.length) {
      notice("Select at least one approval with a one-click decision.");
      return;
    }
    if (items.some((item) =>
      !(item.bulkDecisions ?? ["approved", "rejected"]).includes(decision),
    )) {
      notice(`Some selected approvals cannot be ${decision} in bulk.`);
      return;
    }

    setBulkSaving(true);
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const result = await item.bulkAction?.(decision);
        if (result?.error) {
          throw new Error(result.error.message || "The approval could not be updated.");
        }
      }),
    );
    setBulkSaving(false);
    setSelectedApprovalKeys(new Set());

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const succeeded = results.length - failures.length;
    const actionLabel = decision === "approved" ? "approved" : "rejected";
    if (failures.length) {
      const failureSummary = failures
        .slice(0, 2)
        .map((failure) =>
          failure.reason instanceof Error
            ? failure.reason.message
            : "One approval could not be updated.",
        )
        .join(" ");
      notice(
        `${succeeded} approval${succeeded === 1 ? "" : "s"} ${actionLabel}; ${failures.length} failed. ${failureSummary}`,
      );
    } else {
      notice(`${succeeded} approval${succeeded === 1 ? "" : "s"} ${actionLabel}.`);
    }
    await reload();
  };
  const renderSelectionCell = (key: string) => {
    const item = pendingQueueItemByKey.get(key);
    return (
      <td className="px-5 py-3">
        {item?.selectable && item.bulkAction ? (
          <SelectionCheckbox
            checked={selectedApprovalKeys.has(key)}
            disabled={bulkSaving}
            label={`Select ${item.category}: ${item.title}`}
            onChange={() => toggleApprovalSelection(key)}
          />
        ) : (
          <span
            className="text-[11px] text-[#8b92a1]"
            title="This request requires individual review"
          >
            —
          </span>
        )}
      </td>
    );
  };
  return (
    <Panel
      title="Management Approval Center"
      detail="One queue for management decisions across quotations, production, project changes, leads, and other approval requests."
      hideHeading
    >
      <div className="app-tabs px-5">
        <button type="button" onClick={() => setTab("all")} aria-current={tab === "all" ? "page" : undefined} className="app-tab">All Pending ({pendingTotal})</button>
        <button type="button" onClick={() => setTab("quotations")} aria-current={tab === "quotations" ? "page" : undefined} className="app-tab">Price Quotations ({visiblePendingPriceQuotations.length})</button>
        <button type="button" onClick={() => setTab("mockup_quotations")} aria-current={tab === "mockup_quotations" ? "page" : undefined} className="app-tab">Mockup Quotations ({visiblePendingMockupQuotations.length})</button>
        <button type="button" onClick={() => setTab("price_revisions")} aria-current={tab === "price_revisions" ? "page" : undefined} className="app-tab">Quotation Revisions ({visiblePendingPriceQuotationRevisions.length})</button>
        <button type="button" onClick={() => setTab("costings")} aria-current={tab === "costings" ? "page" : undefined} className="app-tab">Costing Breakdowns ({visiblePendingCostings.length})</button>
        <button type="button" onClick={() => setTab("revisions")} aria-current={tab === "revisions" ? "page" : undefined} className="app-tab">Costing Revisions ({visiblePendingQuotationRevisions.length})</button>
        <button type="button" onClick={() => setTab("calendar_projects")} aria-current={tab === "calendar_projects" ? "page" : undefined} className="app-tab">Production Requests ({visiblePendingProjectSchedules.length})</button>
        <button type="button" onClick={() => setTab("calendar_revisions")} aria-current={tab === "calendar_revisions" ? "page" : undefined} className="app-tab">Project Revisions ({visiblePendingProjectScheduleRevisions.length})</button>
        <button type="button" onClick={() => setTab("calendar_completions")} aria-current={tab === "calendar_completions" ? "page" : undefined} className="app-tab">Project Completion ({visiblePendingProjectScheduleCompletions.length})</button>
        <button type="button" onClick={() => setTab("projects")} aria-current={tab === "projects" ? "page" : undefined} className="app-tab">Project Edits ({visiblePendingProjectEdits.length})</button>
        <button type="button" onClick={() => setTab("leads")} aria-current={tab === "leads" ? "page" : undefined} className="app-tab">Lead Changes ({visiblePendingLeadChanges.length})</button>
        <button type="button" onClick={() => setTab("other")} aria-current={tab === "other" ? "page" : undefined} className="app-tab">Other ({visiblePendingApprovalRequests.length})</button>
      </div>
      <div className="px-5">
        <WorkspaceListFilters
          query={approvalQuery}
          onQueryChange={setApprovalQuery}
          queryPlaceholder="Search quotation, client, project, or requester"
          month={approvalMonth}
          onMonthChange={setApprovalMonth}
          monthLabel="Submission month"
          showOfficer
          officerFilter={approvalOfficerFilter}
          onOfficerChange={setApprovalOfficerFilter}
          officerOptions={approvalOfficers}
          onClear={() => {
            setApprovalQuery("");
            setApprovalMonth("");
            setApprovalOfficerFilter("all");
          }}
          hasFilters={Boolean(approvalQuery || approvalMonth || approvalOfficerFilter !== "all")}
        />
      </div>
      {currentSelectableItems.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f5] px-5 py-3">
          <div className="flex items-center gap-2 text-[12px] text-[#687386]">
            <SelectionCheckbox
              checked={allCurrentItemsSelected}
              indeterminate={someCurrentItemsSelected}
              disabled={bulkSaving}
              label="Select all selectable approvals currently shown"
              onChange={toggleAllApprovalSelection}
            />
            <span>
              {selectedCurrentApprovalItems.length
                ? `${selectedCurrentApprovalItems.length} selected`
                : "Select approvals with one-click decisions"}
            </span>
            <span className="hidden text-[11px] text-[#8b92a1] sm:inline">
              Bulk actions use each record&apos;s saved state; edits and revision requests remain individual.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canBulkApproveCurrent && (
              <Button
                tone="green"
                loading={bulkSaving && bulkDecision === "approved"}
                disabled={bulkSaving || !selectedCanBulkApprove}
                onClick={() => setBulkDecision("approved")}
              >
                <Check size={14} /> Approve selected
              </Button>
            )}
            {canBulkRejectCurrent && (
              <Button
                secondary
                loading={bulkSaving && bulkDecision === "rejected"}
                disabled={bulkSaving || !selectedCanBulkReject}
                onClick={() => setBulkDecision("rejected")}
              >
                <X size={14} /> Reject selected
              </Button>
            )}
            {selectedCurrentApprovalItems.length > 0 && (
              <Button
                secondary
                disabled={bulkSaving}
                onClick={() => setSelectedApprovalKeys(new Set())}
              >
                Clear selection
              </Button>
            )}
          </div>
        </div>
      ) : currentApprovalItems.length > 0 && tab !== "all" ? (
        <div className="border-b border-[#edf0f5] px-5 py-3 text-[12px] text-[#687386]">
          These requests require individual review before approval or revision.
        </div>
      ) : null}
      <div className="modern-table-shell">
      {tab === "all" && (pendingQueueItems.length ? (
        <Table labels={["Select", "Category", "Request", "Requester", "Submitted", "Review"]} minWidth={940}>
          {pendingQueueItems.sort((left, right) => text(right.submittedAt).localeCompare(text(left.submittedAt))).map((item) => (
            <tr key={item.key}>
              {renderSelectionCell(item.key)}
              <td className="px-5 py-3"><Status value={item.category} /></td>
              <td className="px-5 py-3">{stackedCell(item.title, item.detail)}</td>
              <td className="px-5 py-3">{item.requester}</td>
              <td className="px-5 py-3">{day(item.submittedAt)}</td>
              <td className="px-5 py-3"><div className="flex items-center gap-1">{item.action}</div></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No management approvals are awaiting review.</Empty>)}
      {tab === "quotations" && (visiblePendingPriceQuotations.length ? (
        <Table labels={["Select", "Price Quotation", "Client's Name", "Company Name", "Prepared by", "Submitted", "Review"]} minWidth={940}>
          {visiblePendingPriceQuotations.map((quotation) => {
            const party = quotationParty(quotation, store);
            return <tr key={text(quotation.id)}>{renderSelectionCell(`price-${text(quotation.id)}`)}<td className="px-5 py-3">{stackedCell(quotation.quotation_no, quotation.project_name)}</td><td className="px-5 py-3 font-medium">{party.clientName}</td><td className="px-5 py-3">{party.companyName}</td><td className="px-5 py-3">{officerName(quotation)}</td><td className="px-5 py-3">{day(quotation.submitted_at)}</td><td className="px-5 py-3"><ActionIcon label="Review Price Quotation" confirm={false} onClick={() => setSelectedPriceQuotation(quotation)}><FileText size={15} /></ActionIcon></td></tr>;
          })}
        </Table>
      ) : <Empty>No Price Quotations are awaiting review.</Empty>)}
      {tab === "mockup_quotations" && (visiblePendingMockupQuotations.length ? (
        <Table labels={["Mockup Quotation", "Source Price Quotation", "Client's Name", "Project Type", "Prepared by", "Submitted", "Review"]} minWidth={1120}>
          {visiblePendingMockupQuotations.map((quotation) => {
            const source = store.quotations.find((item) => item.id === quotation.source_price_quotation_id);
            const party = quotationParty(quotation, store);
            return <tr key={text(quotation.id)}><td className="px-5 py-3">{stackedCell(quotation.quotation_no, quotation.project_name)}</td><td className="px-5 py-3 font-medium">{source?.id ? <button type="button" onClick={() => openQuotationPdf(source)} className="text-[#1769e8] underline decoration-[#b9d2fb] underline-offset-2 hover:text-[#1256bf]">{text(source.quotation_no)}</button> : text(quotation.source_price_quotation_id, "—")}</td><td className="px-5 py-3 font-medium">{stackedCell(party.clientName, party.companyName)}</td><td className="px-5 py-3">{text(quotation.project_types)}</td><td className="px-5 py-3">{officerName(quotation)}</td><td className="px-5 py-3">{day(quotation.submitted_at)}</td><td className="px-5 py-3"><ActionIcon label="Review Mockup Quotation" confirm={false} onClick={() => setSelectedPriceQuotation(quotation)}><FileText size={15} /></ActionIcon></td></tr>;
          })}
        </Table>
      ) : <Empty>No Mockup Quotations are awaiting General Manager review.</Empty>)}
      {tab === "price_revisions" && (visiblePendingPriceQuotationRevisions.length ? (
        <Table labels={["Select", "Price Quotation", "Client's Name", "Company Name", "Sales Executive", "Requested", "Review"]} minWidth={900}>
          {visiblePendingPriceQuotationRevisions.map((request) => {
            const quotation = store.quotations.find((item) => item.id === request.quotation_id);
            const party = quotation ? quotationParty(quotation, store) : { clientName: "-", companyName: "-" };
            return <tr key={text(request.id)}>{renderSelectionCell(`price-revision-${text(request.id)}`)}<td className="px-5 py-3">{stackedCell(text(quotation?.quotation_no, "Price Quotation"), quotation?.project_name)}</td><td className="px-5 py-3">{party.clientName}</td><td className="px-5 py-3">{party.companyName}</td><td className="px-5 py-3">{projectOfficerName(request)}</td><td className="px-5 py-3">{day(request.submitted_at)}</td><td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="Approve Price Quotation revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decidePriceQuotationRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject Price Quotation revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decidePriceQuotationRevision(request, "rejected")}><X size={15} /></ActionIcon></div></td></tr>;
          })}
        </Table>
      ) : <Empty>No Price Quotation revisions are awaiting review.</Empty>)}
      {tab === "costings" && (visiblePendingCostings.length ? (
        <Table
          labels={[
            "Costing Breakdown",
            "Client",
            "Sales Executive",
            "Submitted",
            "Estimated COGS",
            "Review",
          ]}
        >
          {visiblePendingCostings.map((quotation) => {
            const lead = store.leads.find(
              (item) => item.id === quotation.lead_id,
            );
            return (
              <tr key={text(quotation.id)}>
                <td className="px-5 py-3">
                  <b>Costing Breakdown</b>
                  <small>
                    {text(quotation.quotation_no)} ·{" "}
                    {text(quotation.project_name)}
                  </small>
                </td>
                <td className="px-5 py-3 font-medium">
                  {text(
                    quotation.client_name,
                    text(lead?.client_name, text(lead?.contact_name)),
                  )}
                </td>
                <td className="px-5 py-3 font-medium">
                  {officerName(quotation)}
                </td>
                <td className="px-5 py-3">{day(quotation.submitted_at)}</td>
                <td className="px-5 py-3 font-semibold">
                  {peso.format(n(quotation.total_cost))}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1">
                    <ActionIcon
                      label="Review"
                      confirm={false}
                      onClick={() => {
                        setSelected(quotation);
                      }}
                    >
                      <FileText size={15} />
                    </ActionIcon>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No costing breakdowns are awaiting review.</Empty>)}
      {tab === "revisions" && (visiblePendingQuotationRevisions.length ? (
        <Table labels={["Select", "Costing Breakdown", "Sales Executive", "Requested", "Review"]}>
          {visiblePendingQuotationRevisions.map((request) => {
            const costing = store.quotations.find((item) => item.id === request.costing_id);
            return <tr key={text(request.id)}>
              {renderSelectionCell(`costing-revision-${text(request.id)}`)}
              <td className="px-5 py-3">{stackedCell(text(costing?.quotation_no, "Costing Breakdown"), costing?.project_name)}</td>
              <td className="px-5 py-3">{projectOfficerName(request)}</td>
              <td className="px-5 py-3">{day(request.submitted_at)}</td>
              <td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="Approve costing revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideQuotationRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject costing revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideQuotationRevision(request, "rejected")}><X size={15} /></ActionIcon></div></td>
            </tr>;
          })}
        </Table>
      ) : <Empty>No Costing Breakdown revisions are awaiting review.</Empty>)}
      {tab === "calendar_projects" && (visiblePendingProjectSchedules.length ? (
        <Table labels={["Select", "Assigned Sales Executive", "Price Quotation", "Mockup Quotation", "Signed proofs", "Client's Name / Company", "Quantity", "Project Type", "Start Date", "Due Date", "Project Status", "Review"]} minWidth={1540}>
          {visiblePendingProjectSchedules.map((schedule) => {
            const quotation = store.quotations.find((item) => item.id === schedule.quotation_id);
            const mockupQuotation = store.quotations.find((item) => item.id === schedule.mockup_quotation_id);
            const schedulePriceProofs = store.quotation_signed_proofs.filter(
              (proof) => text(proof.quotation_id, "") === text(schedule.quotation_id, ""),
            );
            const scheduleMockupProofs = store.quotation_signed_proofs.filter(
              (proof) => text(proof.quotation_id, "") === text(schedule.mockup_quotation_id, ""),
            );
            const scheduleProofs = [...schedulePriceProofs, ...scheduleMockupProofs];
            return (
            <tr key={text(schedule.id)}>
              {renderSelectionCell(`production-${text(schedule.id)}`)}
              <td className="px-5 py-3">{scheduleOfficerName(schedule)}</td>
              <td className="px-5 py-3">{text(schedule.quotation_no)}</td>
              <td className="px-5 py-3">{text(mockupQuotation?.quotation_no, "—")}</td>
              <td className="px-5 py-3"><SignedProofThumbnails label="Signed proofs" proofs={scheduleProofs} priceProofs={schedulePriceProofs} mockupProofs={scheduleMockupProofs} compact /></td>
              <td className="px-5 py-3">{text(schedule.client_name)}</td>
              <td className="px-5 py-3">{n(schedule.quantity).toLocaleString()}</td>
              <td className="px-5 py-3">{text(schedule.product_name)}</td>
              <td className="px-5 py-3">{day(schedule.start_date)}</td>
              <td className="px-5 py-3">{day(schedule.due_date)}</td>
              <td className="px-5 py-3"><Status value={schedule.status} /></td>
              <td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="View Price Quotation PDF" confirm={false} disabled={bulkSaving} onClick={() => openQuotationPdf(quotation)}><FileText size={15} /></ActionIcon><ActionIcon label="Print Price Quotation" confirm={false} disabled={bulkSaving} onClick={() => openQuotationPdf(quotation, true)}><Printer size={15} /></ActionIcon><ActionIcon label="Approve project schedule" tone="green" loading={savingId === schedule.id} disabled={savingId === schedule.id || bulkSaving} onClick={() => void decideProjectSchedule(schedule, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject project schedule" tone="red" loading={savingId === schedule.id} disabled={savingId === schedule.id || bulkSaving} onClick={() => void decideProjectSchedule(schedule, "rejected")}><X size={15} /></ActionIcon></div></td>
            </tr>
            );
          })}
        </Table>
      ) : <Empty>No production requests are awaiting review.</Empty>)}
      {tab === "calendar_revisions" && (visiblePendingProjectScheduleRevisions.length ? (
        <Table labels={["Select", "Assigned Sales Executive", "Quotation Code", "Client's Name / Company", "Quantity", "Project Type", "Start Date", "Due Date", "Project Status", "Review"]} minWidth={1180}>
          {visiblePendingProjectScheduleRevisions.map((request) => {
            const schedule = store.project_schedules.find(
              (item) => item.id === request.schedule_id,
            );
            return (
              <tr key={text(request.id)}>
                {renderSelectionCell(`schedule-revision-${text(request.id)}`)}
                <td className="px-5 py-3">{projectOfficerName(request)}</td>
                <td className="px-5 py-3">{text(schedule?.quotation_no)}</td>
                <td className="px-5 py-3">{text(schedule?.client_name)}</td>
                <td className="px-5 py-3">{n(schedule?.quantity).toLocaleString()}</td>
                <td className="px-5 py-3">{text(schedule?.product_name)}</td>
                <td className="px-5 py-3"><b>{day(request.proposed_start_date)}</b><small>Current: {day(schedule?.start_date)}</small></td>
                <td className="px-5 py-3"><b>{day(request.proposed_due_date)}</b><small>Current: {day(schedule?.due_date)}</small></td>
                <td className="px-5 py-3"><Status value="revision pending" /></td>
                <td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="Approve project schedule revision" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleRevision(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject project schedule revision" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleRevision(request, "rejected")}><X size={15} /></ActionIcon></div></td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No Project Calendar revisions are awaiting review.</Empty>)}
      {tab === "calendar_completions" && (visiblePendingProjectScheduleCompletions.length ? (
        <Table labels={["Select", "Assigned Sales Executive", "Quotation Code", "Client's Name / Company", "Quantity", "Project Type", "Start Date", "Due Date", "Project Status", "Review"]} minWidth={1180}>
          {visiblePendingProjectScheduleCompletions.map((request) => {
            const schedule = store.project_schedules.find(
              (item) => item.id === request.schedule_id,
            );
            return (
              <tr key={text(request.id)}>
                {renderSelectionCell(`completion-${text(request.id)}`)}
                <td className="px-5 py-3">{projectOfficerName(request)}</td>
                <td className="px-5 py-3">{text(schedule?.quotation_no)}</td>
                <td className="px-5 py-3">{text(schedule?.client_name)}</td>
                <td className="px-5 py-3">{n(schedule?.quantity).toLocaleString()}</td>
                <td className="px-5 py-3">{text(schedule?.product_name)}</td>
                <td className="px-5 py-3">{day(schedule?.start_date)}</td>
                <td className="px-5 py-3">{day(schedule?.due_date)}</td>
                <td className="px-5 py-3"><Status value="completion pending" /></td>
                <td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="Approve project completion" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleCompletion(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject project completion" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideProjectScheduleCompletion(request, "rejected")}><X size={15} /></ActionIcon></div></td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No Project Calendar completion requests are awaiting review.</Empty>)}
      {tab === "projects" && (visiblePendingProjectEdits.length ? (
        <Table labels={["Project", "Sales Executive", "Submitted", "Requested changes", "Review"]}>
          {visiblePendingProjectEdits.map((request) => {
            const project = store.leads.find((lead) => lead.id === request.project_id);
            const changes = request.proposed_changes && typeof request.proposed_changes === "object" ? Object.keys(request.proposed_changes as Record<string, unknown>) : [];
            return <tr key={text(request.id)}>
              <td className="px-5 py-3">{stackedCell(project?.project_name, [project?.client_name, project?.contact_name], " · ")}</td>
              <td className="px-5 py-3">{projectOfficerName(request)}</td>
              <td className="px-5 py-3">{day(request.submitted_at)}</td>
              <td className="px-5 py-3">{changes.map((change) => change.replaceAll("_", " ")).join(", ")}</td>
              <td className="px-5 py-3"><ActionIcon label="Review project edit" confirm={false} onClick={() => setSelectedProjectEdit(request)}><FileText size={15} /></ActionIcon></td>
            </tr>;
          })}
        </Table>
      ) : <Empty>No project edits are awaiting review.</Empty>)}
      {tab === "leads" && (visiblePendingLeadChanges.length ? (
        <Table labels={["Lead", "Sales Executive", "Requested", "Change", "Review"]}>
          {visiblePendingLeadChanges.map((request) => {
            const lead = store.leads.find((item) => item.id === request.lead_id);
            const changes = request.proposed_changes && typeof request.proposed_changes === "object" ? Object.keys(request.proposed_changes as Record<string, unknown>) : [];
            const isDeletion = text(request.change_type, "") === "delete";
            const changeLabels = changes.map((change) => change.replaceAll("_", " "));
            const changeSummary = isDeletion
              ? "Deletion request"
              : changeLabels.length <= 2
                ? changeLabels.join(", ")
                : `${changeLabels.slice(0, 2).join(", ")} +${changeLabels.length - 2} more`;
            return <tr key={text(request.id)}>
              <td className="px-5 py-3">{stackedCell(lead?.project_name, [lead?.client_name, lead?.contact_name], " · ")}</td>
              <td className="px-5 py-3">{projectOfficerName(request)}</td>
              <td className="px-5 py-3">{day(request.submitted_at)}</td>
              <td className="px-5 py-3">{changeSummary || "-"}</td>
              <td className="px-5 py-3"><ActionIcon label="Review lead change" confirm={false} onClick={() => setSelectedLeadChange(request)}><FileText size={15} /></ActionIcon></td>
            </tr>;
          })}
        </Table>
      ) : <Empty>No lead changes are awaiting review.</Empty>)}
      {tab === "other" && (visiblePendingApprovalRequests.length ? (
        <Table labels={["Select", "Request", "Submitted by", "Submitted", "Review"]} minWidth={800}>
          {visiblePendingApprovalRequests.map((request) => <tr key={text(request.id)}>{renderSelectionCell(`approval-${text(request.id)}`)}<td className="px-5 py-3"><b className="capitalize">{text(request.resource_type, "Approval request").replaceAll("_", " ")}</b><small>{text(request.resource_id)}</small></td><td className="px-5 py-3">{text(store.profiles.find((profile) => profile.id === request.submitted_by)?.full_name, "Team member")}</td><td className="px-5 py-3">{day(request.submitted_at)}</td><td className="px-5 py-3"><div className="flex items-center gap-1"><ActionIcon label="Approve request" tone="green" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideApprovalRequest(request, "approved")}><Check size={15} /></ActionIcon><ActionIcon label="Reject request" tone="red" loading={savingId === request.id} disabled={savingId === request.id || bulkSaving} onClick={() => void decideApprovalRequest(request, "rejected")}><X size={15} /></ActionIcon></div></td></tr>)}
        </Table>
      ) : <Empty>No other approval requests are awaiting review.</Empty>)}
      </div>
      {bulkDecision && (
        <ConfirmationDialog
          open
          title={`${bulkDecision === "approved" ? "Approve" : "Reject"} selected approvals?`}
          description={`This will ${bulkDecision === "approved" ? "approve" : "reject"} ${selectedCurrentApprovalItems.length} selected approval${selectedCurrentApprovalItems.length === 1 ? "" : "s"}. Each record will still be checked by its existing approval workflow.`}
          onCancel={() => setBulkDecision(null)}
          onConfirm={() => {
            const decision = bulkDecision;
            setBulkDecision(null);
            void runBulkDecision(decision);
          }}
        />
      )}
      {selected && (
        <GeneralManagerCostingReview
          quotation={selected}
          store={store}
          officer={officerName(selected)}
          saving={savingId === selected.id}
          close={() => setSelected(null)}
          decide={(status, changes, revisionNote) => void decide(selected, status, changes, revisionNote)}
        />
      )}
      {selectedPriceQuotation && (
        <PriceQuotationReview
          quotation={selectedPriceQuotation}
          store={store}
          saving={savingId === selectedPriceQuotation.id}
          quotationKind={text(selectedPriceQuotation.document_type) === "mockup_quotation" ? "mockup_quotation" : "price_quotation"}
          finalApproval
          close={() => setSelectedPriceQuotation(null)}
          notice={notice}
          reload={reload}
        />
      )}
      {selectedProjectEdit && (
        <ProjectEditRequestReview
          request={selectedProjectEdit}
          store={store}
          saving={savingId === selectedProjectEdit.id}
          close={() => setSelectedProjectEdit(null)}
          decide={(decision, note) => void decideProjectEdit(selectedProjectEdit, decision, note)}
        />
      )}
      {selectedLeadChange && (
        <LeadChangeRequestReview
          request={selectedLeadChange}
          store={store}
          saving={savingId === selectedLeadChange.id}
          close={() => setSelectedLeadChange(null)}
          decide={(decision, note) => void decideLeadChange(selectedLeadChange, decision, note)}
        />
      )}
      {pdfQuote && <QuotationDocument quote={pdfQuote} store={store} close={() => { setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); }} onPdfError={(message) => { if (pdfWindow && !pdfWindow.closed) pdfWindow.close(); setPdfQuote(null); setPdfWindow(null); setPrintAfterOpen(false); notice(message); }} autoExportPdf pdfWindow={pdfWindow} printAfterOpen={printAfterOpen} hidden showInternalCosting />}
    </Panel>
  );
}

function Production({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [usage, setUsage] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activityNote, setActivityNote] = useState<Row | null>(null);
  const canRecordUsage = canAccess(role, "production_material_usage", "create");
  const canUpdateJob = canAccess(role, "production_jobs", "update");
  const addUsage = async () => {
    setSaving(true);
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client.from("production_material_usage").insert({
      organization_id: orgId,
      production_job_id: values.production_job_id?.split("|")[0],
      item_id: values.item_id?.split("|")[0],
      quantity: n(values.quantity),
      unit_cost: n(values.unit_cost),
      notes: values.notes,
      created_by: user.user?.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    setUsage(false);
    notice("Material usage saved. Raw-supply stock updated.");
    await reload();
  };
  const updateStatus = async (job: Row, status: string) => {
    const { error } = await createClient()
      .from("production_jobs")
      .update({
        status,
        ...(status === "completed"
          ? { completed_at: new Date().toISOString() }
          : {}),
        ...(status === "delivered"
          ? { delivered_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", job.id)
      .eq("organization_id", orgId);
    if (error) notice(error.message);
    else {
      notice("Production stage updated.");
      await reload();
    }
  };
  return (
    <div className="space-y-5">
      <Panel
        title="Production jobs"
        detail="An approved quotation opens a production job. Record material usage before completion."
        action={
          canRecordUsage ? (
            <Button
              onClick={() => {
                setValues({
                  production_job_id: "",
                  item_id: "",
                  quantity: "",
                  unit_cost: "",
                  notes: "",
                });
                setUsage(true);
              }}
            >
              <Plus size={14} />
              Material usage
            </Button>
          ) : undefined
        }
      >
        {store.production_jobs.length ? (
          <Table
            labels={[
              "Job",
              "Customer / due",
              "Stage",
              "Payment",
              "Material use",
              "Signed proofs",
              "Actions",
            ]}
            minWidth={920}
          >
            {store.production_jobs.map((job) => {
              const used = store.production_material_usage.filter(
                (u) => u.production_job_id === job.id,
              ).length;
              const jobPriceProofs = store.quotation_signed_proofs.filter(
                (proof) => text(proof.quotation_id, "") === text(job.quotation_id, ""),
              );
              const jobMockupProofs = store.quotation_signed_proofs.filter(
                (proof) => text(proof.quotation_id, "") === text(job.mockup_quotation_id, ""),
              );
              const proofs = [...jobPriceProofs, ...jobMockupProofs];
              const jobQuote = store.quotations.find((quote) => quote.id === job.quotation_id);
              const paymentSummary = jobQuote
                ? quotationPaymentSummary(
                    jobQuote,
                    store.quotation_payment_records.filter((record) => record.quotation_id === jobQuote.id),
                  )
                : null;
              const late =
                job.due_date &&
                new Date(String(job.due_date)) < new Date() &&
                !["completed", "delivered", "cancelled"].includes(
                  text(job.status),
                );
              return (
                <tr key={text(job.id)}>
                  <td className="px-5 py-3">
                    {stackedCell(job.job_no, job.title)}
                  </td>
                  <td className="px-5 py-3">
                    {text(
                      store.customers.find((c) => c.id === job.customer_id)
                        ?.company_name,
                    )}
                    <small className={late ? "text-[#b42318]" : ""}>
                      Due {day(job.due_date)}
                      {late ? " · Delayed" : ""}
                    </small>
                  </td>
                  <td className="px-5 py-3">
                    <Status value={job.status} />
                  </td>
                  <td className="px-5 py-3">{paymentSummary ? <div><PaymentStatusBadge status={paymentSummary.status} /><small>{peso.format(paymentSummary.verified)} / {peso.format(paymentSummary.total)}</small></div> : "-"}</td>
                  <td className="px-5 py-3">
                    {used} line{used === 1 ? "" : "s"}
                  </td>
                  <td className="px-5 py-3"><SignedProofThumbnails label="Signed proofs" proofs={proofs} priceProofs={jobPriceProofs} mockupProofs={jobMockupProofs} compact /></td>
                  <td className="px-5 py-3">
                    {canUpdateJob ? (
                      <select
                        value={text(job.status)}
                        onChange={(e) => void updateStatus(job, e.target.value)}
                        className="rounded border border-[#d9e0e9] bg-white p-1.5 text-[11px]"
                      >
                        {[
                          "queued",
                          "artwork_approval",
                          "materials_ready",
                          "in_production",
                          "quality_check",
                          "completed",
                          "delivered",
                          "cancelled",
                        ].map((v) => (
                          <option key={v}>{v.replaceAll("_", " ")}</option>
                        ))}
                      </select>
                    ) : (
                      <Status value={job.status} />
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty>
            Production jobs appear here after a quotation is approved.
          </Empty>
        )}
      </Panel>
      <Panel
        title="Production activity"
        detail="Review each job's status changes and activity history."
      >
        {store.production_job_activity.length ? (
          <Table labels={["When", "Job", "Action", "Note"]}>
            {store.production_job_activity.slice(0, 30).map((activity) => (
              <tr key={text(activity.id)}>
                <td className="px-5 py-3">{day(activity.created_at)}</td>
                <td className="px-5 py-3">
                  <b>
                    {text(
                      store.production_jobs.find(
                        (job) => job.id === activity.production_job_id,
                      )?.job_no,
                    )}
                  </b>
                </td>
                <td className="px-5 py-3">
                  {text(activity.action).replaceAll("_", " ")}
                </td>
                <td className="px-5 py-3">
                  {text(activity.note, "").trim() ? (
                    <NoteAction
                      label="View production activity note"
                      onClick={() => setActivityNote(activity)}
                    />
                  ) : (
                    <span className="text-[11px] text-[#8b92a1]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No production activity recorded yet.</Empty>
        )}
      </Panel>
      <NoteDialog
        open={Boolean(activityNote)}
        title="Production activity note"
        context={activityNote ? text(store.production_jobs.find((job) => job.id === activityNote.production_job_id)?.job_no, "Production job") : undefined}
        note={text(activityNote?.note, "")}
        titleId="production-activity-note-title"
        onClose={() => setActivityNote(null)}
      />
      {usage && (
        <Dialog
          title="Record production material usage"
          fields={[
            {
              key: "production_job_id",
              label: "Production job",
              type: "select",
              required: true,
              options: store.production_jobs.map(
                (j) => `${j.id}|${text(j.job_no)} — ${text(j.title)}`,
              ),
            },
            {
              key: "item_id",
              label: "Raw supply",
              type: "select",
              required: true,
              options: store.inventory_items
                .filter((i) => i.item_type === "material")
                .map((i) => `${i.id}|${text(i.name)}`),
            },
            {
              key: "quantity",
              label: "Quantity used",
              type: "number",
              required: true,
            },
            { key: "unit_cost", label: "Unit cost", type: "number" },
          ]}
          values={values}
          setValues={setValues}
          save={() => void addUsage()}
          close={() => setUsage(false)}
          saving={saving}
        />
      )}
    </div>
  );
}

function Inventory({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [move, setMove] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canRecordMovement = canAccess(role, "inventory_movements", "create");
  const saveMovement = async () => {
    setSaving(true);
    const kind = values.movement_type;
    const amount = n(values.quantity);
    const signed = ["production_use", "sale", "adjustment_out"].includes(kind)
      ? -Math.abs(amount)
      : Math.abs(amount);
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client.from("inventory_movements").insert({
      organization_id: orgId,
      item_id: values.item_id?.split("|")[0],
      movement_type: kind,
      quantity_change: signed,
      unit_cost: n(values.unit_cost),
      notes: values.notes,
      created_by: user.user?.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    setMove(false);
    notice("Stock movement saved. Quantity on hand updated.");
    await reload();
  };
  const materials = {
    ...inventory,
    fields: inventory.fields.filter((f) => f.key !== "quantity_on_hand"),
  };
  return (
    <div className="space-y-5">
      <Records
        module={materials}
        store={{
          ...store,
          inventory_items: store.inventory_items.filter(
            (i) => i.item_type === "material",
          ),
        }}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <FinishedStockIns
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <Panel
        title="Stock movement log"
        detail="Opening, stock in, production use, sales, returns, and adjustments."
        action={
          canRecordMovement ? (
            <Button
              onClick={() => {
                setValues({
                  item_id: "",
                  movement_type: "stock_in",
                  quantity: "",
                  unit_cost: "",
                  notes: "",
                });
                setMove(true);
              }}
            >
              <Plus size={14} />
              Record movement
            </Button>
          ) : undefined
        }
      >
        {store.inventory_movements.length ? (
          <Table labels={["Date", "Supply", "Type", "Change", "Unit cost"]}>
            {store.inventory_movements.slice(0, 20).map((m) => (
              <tr key={text(m.id)}>
                <td className="px-5 py-3">{day(m.occurred_at)}</td>
                <td className="px-5 py-3">
                  <b>
                    {text(
                      store.inventory_items.find((i) => i.id === m.item_id)
                        ?.name,
                    )}
                  </b>
                </td>
                <td className="px-5 py-3">
                  <Status value={m.movement_type} />
                </td>
                <td
                  className={`px-5 py-3 font-semibold ${n(m.quantity_change) < 0 ? "text-[#b42318]" : "text-[#218b55]"}`}
                >
                  {n(m.quantity_change) > 0 ? "+" : ""}
                  {n(m.quantity_change)}
                </td>
                <td className="px-5 py-3">{peso.format(n(m.unit_cost))}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No material movements recorded.</Empty>
        )}
      </Panel>
      {move && (
        <Dialog
          title="Record stock movement"
          fields={[
            {
              key: "item_id",
              label: "Supply",
              type: "select",
              required: true,
              options: store.inventory_items
                .filter((i) => i.item_type === "material")
                .map((i) => `${i.id}|${text(i.name)}`),
            },
            {
              key: "movement_type",
              label: "Movement type",
              type: "select",
              required: true,
              options: [
                "opening",
                "stock_in",
                "production_use",
                "sale",
                "return",
                "adjustment_in",
                "adjustment_out",
              ],
            },
            {
              key: "quantity",
              label: "Quantity",
              type: "number",
              required: true,
            },
            { key: "unit_cost", label: "Unit cost", type: "number" },
          ]}
          values={values}
          setValues={setValues}
          save={() => void saveMovement()}
          close={() => setMove(false)}
          saving={saving}
        />
      )}
    </div>
  );
}

function FinishedStockIns({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const canStockIn = canAccess(role, "finished_product_stock_ins", "create");
  const save = async () => {
    setSaving(true);
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client.from("finished_product_stock_ins").insert({
      organization_id: orgId,
      item_id: values.item_id?.split("|")[0],
      stock_in_date: values.stock_in_date,
      quantity: n(values.quantity),
      status: values.status,
      notes: values.notes,
      production_job_id: values.production_job_id?.split("|")[0] || null,
      created_by: user.user?.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    setOpen(false);
    notice("Finished-product stock-in saved.");
    await reload();
  };
  return (
    <Panel
      title="Finished-product stock-in log"
      detail="Completed stock-ins increase finished-goods inventory."
      action={
        canStockIn ? (
          <Button
            onClick={() => {
              setValues({
                item_id: "",
                stock_in_date: isoToday(),
                quantity: "",
                status: "in_process",
                production_job_id: "",
                notes: "",
              });
              setOpen(true);
            }}
          >
            <Plus size={14} />
            Stock in finished goods
          </Button>
        ) : undefined
      }
    >
      {store.finished_product_stock_ins.length ? (
        <Table labels={["Date", "Product", "Quantity", "Status", "Job"]}>
          {store.finished_product_stock_ins.slice(0, 20).map((row) => (
            <tr key={text(row.id)}>
              <td className="px-5 py-3">{day(row.stock_in_date)}</td>
              <td className="px-5 py-3">
                <b>
                  {text(
                    store.inventory_items.find((i) => i.id === row.item_id)
                      ?.name,
                  )}
                </b>
              </td>
              <td className="px-5 py-3">{n(row.quantity)}</td>
              <td className="px-5 py-3">
                <Status value={row.status} />
              </td>
              <td className="px-5 py-3">
                {text(
                  store.production_jobs.find(
                    (j) => j.id === row.production_job_id,
                  )?.job_no,
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No finished-product stock-ins yet.</Empty>
      )}
      {open && (
        <Dialog
          title="Stock in finished goods"
          fields={[
            {
              key: "item_id",
              label: "Finished product",
              type: "select",
              required: true,
              options: store.inventory_items
                .filter((i) => i.item_type === "product")
                .map((i) => `${i.id}|${text(i.name)}`),
            },
            {
              key: "stock_in_date",
              label: "Stock-in date",
              type: "date",
              required: true,
            },
            {
              key: "quantity",
              label: "Quantity added",
              type: "number",
              required: true,
            },
            {
              key: "status",
              label: "Status",
              type: "select",
              required: true,
              options: ["in_process", "completed"],
            },
            {
              key: "production_job_id",
              label: "Production job",
              type: "select",
              options: store.production_jobs.map(
                (j) => `${j.id}|${text(j.job_no)}`,
              ),
            },
          ]}
          values={values}
          setValues={setValues}
          save={() => void save()}
          close={() => setOpen(false)}
          saving={saving}
        />
      )}
    </Panel>
  );
}

function Sales({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [pay, setPay] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canCreateInvoiceLine = canAccess(role, "invoice_items", "create");
  const canUpdateInvoice = canAccess(role, "invoices", "update");
  const canCreatePayment = canAccess(role, "payments", "create");
  const canRequestSalesApproval = canAccess(role, "payments", "request");
  const recordPayment = async () => {
    setSaving(true);
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const invoiceId = values.invoice_id?.split("|")[0];
    const invoice = store.invoices.find((i) => i.id === invoiceId);
    const { error } = await client.from("payments").insert({
      organization_id: orgId,
      invoice_id: invoiceId,
      customer_id: invoice?.customer_id ?? null,
      amount: n(values.amount),
      payment_kind: values.payment_kind || "payment",
      method: values.method,
      reference_no: values.reference_no,
      notes: values.notes,
      created_by: user.user?.id,
    });
    setSaving(false);
    if (error) return notice(error.message);
    setPay(false);
    notice("Payment recorded. Invoice status updated.");
    await reload();
  };
  const saveLine = async () => {
    setSaving(true);
    const { error } = await createClient()
      .from("invoice_items")
      .insert({
        invoice_id: values.invoice_id?.split("|")[0],
        inventory_item_id: values.inventory_item_id?.split("|")[0] || null,
        description: values.description,
        quantity: n(values.quantity),
        unit_price: n(values.unit_price),
        discount_amount: n(values.discount_amount),
      });
    setSaving(false);
    if (error) return notice(error.message);
    setLineOpen(false);
    notice("Invoice line saved. Invoice totals updated.");
    await reload();
  };
  const requestVoid = async (invoice: Row) => {
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client.from("approval_requests").upsert(
      {
        organization_id: orgId,
        resource_type: "invoice_void",
        resource_id: invoice.id,
        status: "pending",
        submitted_by: user.user?.id,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "resource_type,resource_id" },
    );
    if (error) return notice(error.message);
    notice("Invoice void request sent for admin approval.");
    await reload();
  };
  const requestPaymentReversal = async (payment: Row) => {
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client.from("approval_requests").upsert(
      {
        organization_id: orgId,
        resource_type: "payment_reversal",
        resource_id: payment.id,
        status: "pending",
        submitted_by: user.user?.id,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "resource_type,resource_id" },
    );
    if (error) return notice(error.message);
    notice("Payment reversal request sent for approval.");
    await reload();
  };
  const invoiceModule = {
    ...sales,
    fields: [
      {
        key: "customer_id",
        label: "Customer / walk-in",
        type: "select" as const,
        options: store.customers.map((c) => `${c.id}|${text(c.company_name)}`),
      },
      ...sales.fields,
    ],
  };
  return (
    <div className="space-y-5">
      <Records
        module={invoiceModule}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
        onPrint={setSelectedInvoice}
      />
      <Panel
        title="Invoice line items"
        detail="Add products, services, discounts, and other sales lines to draft invoices."
        action={
          canCreateInvoiceLine ? (
            <Button
              onClick={() => {
                setValues({
                  invoice_id: "",
                  inventory_item_id: "",
                  description: "",
                  quantity: "1",
                  unit_price: "",
                  discount_amount: "0",
                });
                setLineOpen(true);
              }}
            >
              <Plus size={14} />
              Add invoice line
            </Button>
          ) : undefined
        }
      >
        {store.invoice_items.length ? (
          <Table
            labels={[
              "Invoice",
              "Description",
              "Qty",
              "Price",
              "Discount",
              "Net",
            ]}
          >
            {store.invoice_items.slice(0, 20).map((line) => (
              <tr key={text(line.id)}>
                <td className="px-5 py-3">
                  <b>
                    {text(
                      store.invoices.find((i) => i.id === line.invoice_id)
                        ?.invoice_no,
                    )}
                  </b>
                </td>
                <td className="px-5 py-3">{text(line.description)}</td>
                <td className="px-5 py-3">{n(line.quantity)}</td>
                <td className="px-5 py-3">{peso.format(n(line.unit_price))}</td>
                <td className="px-5 py-3">
                  {peso.format(n(line.discount_amount))}
                </td>
                <td className="px-5 py-3 font-semibold">
                  {peso.format(n(line.line_total) - n(line.discount_amount))}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>
            No invoice lines yet. Add lines to calculate a draft invoice.
          </Empty>
        )}
      </Panel>
      <Panel
        title="Invoice actions"
        detail="Issue a draft invoice before recording payment."
      >
        {store.invoices.filter((i) =>
          ["draft", "issued", "partial"].includes(text(i.status)),
        ).length ? (
          <Table labels={["Invoice", "Customer", "Total", "State", "Action"]}>
            {store.invoices
              .filter((i) =>
                ["draft", "issued", "partial"].includes(text(i.status)),
              )
              .map((invoice) => (
                <tr key={text(invoice.id)}>
                  <td className="px-5 py-3">
                    <b>{text(invoice.invoice_no)}</b>
                  </td>
                  <td className="px-5 py-3">
                    {text(
                      store.customers.find((c) => c.id === invoice.customer_id)
                        ?.company_name,
                      "Walk-in",
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {peso.format(n(invoice.total_amount))}
                  </td>
                  <td className="px-5 py-3">
                    <Status value={invoice.status} />
                  </td>
                  <td className="px-5 py-3">
                    {canUpdateInvoice && invoice.status === "draft" && (
                      <ActionIcon
                        label="Issue invoice"
                        onClick={async () => {
                          const { error } = await createClient()
                            .from("invoices")
                            .update({ status: "issued" })
                            .eq("id", invoice.id)
                            .eq("organization_id", orgId);
                          if (error) notice(error.message);
                          else {
                            notice("Invoice issued.");
                            await reload();
                          }
                        }}
                      >
                        <Send size={15} />
                      </ActionIcon>
                    )}
                    {canRequestSalesApproval && invoice.status !== "draft" && (
                      <ActionIcon
                        label="Request invoice void"
                        tone="red"
                        onClick={() => void requestVoid(invoice)}
                      >
                        <XCircle size={15} />
                      </ActionIcon>
                    )}
                  </td>
                </tr>
              ))}
          </Table>
        ) : (
          <Empty>No draft or outstanding invoices.</Empty>
        )}
      </Panel>
      <Panel
        title="Payment collection"
        detail="Record downpayments and partial customer payments against issued invoices."
        action={
          canCreatePayment ? (
            <Button
              onClick={() => {
                setValues({
                  invoice_id: "",
                  amount: "",
                  payment_kind: "payment",
                  method: "cash",
                  reference_no: "",
                  notes: "",
                });
                setPay(true);
              }}
            >
              <Plus size={14} />
              Record payment
            </Button>
          ) : undefined
        }
      >
        {store.payments.length ? (
          <Table
            labels={[
              "Payment date",
              "Invoice",
              "Method",
              "Amount",
              "Reference",
              "Action",
            ]}
          >
            {store.payments.slice(0, 12).map((p) => (
              <tr key={text(p.id)}>
                <td className="px-5 py-3">{day(p.paid_at)}</td>
                <td className="px-5 py-3">
                  <b>
                    {text(
                      store.invoices.find((i) => i.id === p.invoice_id)
                        ?.invoice_no,
                    )}
                  </b>
                </td>
                <td className="px-5 py-3">{text(p.method)}</td>
                <td className="px-5 py-3">{peso.format(n(p.amount))}</td>
                <td className="px-5 py-3">{text(p.reference_no)}</td>
                <td className="px-5 py-3">
                  {p.reversed_at ? (
                    <Status value="reversed" />
                  ) : canRequestSalesApproval ? (
                    <ActionIcon
                      label="Request payment reversal"
                      tone="red"
                      onClick={() => void requestPaymentReversal(p)}
                    >
                      <XCircle size={15} />
                    </ActionIcon>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No payments recorded.</Empty>
        )}
      </Panel>
      {pay && (
        <Dialog
          title="Record payment"
          fields={[
            {
              key: "invoice_id",
              label: "Invoice",
              type: "select",
              required: true,
              options: store.invoices
                .filter(
                  (i) => !["draft", "void", "paid"].includes(text(i.status)),
                )
                .map(
                  (i) =>
                    `${i.id}|${text(i.invoice_no)} — ${peso.format(n(i.total_amount))}`,
                ),
            },
            {
              key: "amount",
              label: "Amount received",
              type: "number",
              required: true,
            },
            {
              key: "payment_kind",
              label: "Payment type",
              type: "select",
              required: true,
              options: [
                "downpayment",
                "partial_payment",
                "full_payment",
                "payment",
              ],
            },
            {
              key: "method",
              label: "Payment method",
              type: "select",
              required: true,
              options: [
                "cash",
                "bank_transfer",
                "gcash",
                "card",
                "check",
                "other",
              ],
            },
            { key: "reference_no", label: "Reference number" },
          ]}
          values={values}
          setValues={setValues}
          save={() => void recordPayment()}
          close={() => setPay(false)}
          saving={saving}
        />
      )}
      {lineOpen && (
        <Dialog
          title="Add invoice line"
          fields={[
            {
              key: "invoice_id",
              label: "Draft invoice",
              type: "select",
              required: true,
              options: store.invoices
                .filter((i) => i.status === "draft")
                .map((i) => `${i.id}|${text(i.invoice_no)}`),
            },
            {
              key: "inventory_item_id",
              label: "Catalog item",
              type: "select",
              options: store.inventory_items.map(
                (i) => `${i.id}|${text(i.name)}`,
              ),
            },
            { key: "description", label: "Product / service", required: true },
            {
              key: "quantity",
              label: "Quantity",
              type: "number",
              required: true,
            },
            {
              key: "unit_price",
              label: "Item price",
              type: "number",
              required: true,
            },
            { key: "discount_amount", label: "Discount", type: "number" },
          ]}
          values={values}
          setValues={setValues}
          save={() => void saveLine()}
          close={() => setLineOpen(false)}
          saving={saving}
        />
      )}
      {selectedInvoice && (
        <InvoiceDocument
          invoice={selectedInvoice}
          store={store}
          close={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}

function PayslipDocument({
  entry,
  store,
  close,
}: {
  entry: Row;
  store: Store;
  close: () => void;
}) {
  const employee = store.employees.find((e) => e.id === entry.employee_id);
  const period = store.payroll_periods.find(
    (p) => p.id === entry.payroll_period_id,
  );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white p-5">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex justify-between print:hidden">
          <Button secondary onClick={close}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={14} />
            Print payslip
          </Button>
        </div>
        <article data-pdf-document className="border border-[#151922] p-8 text-sm">
          <h1 className="text-xl font-semibold">HUSWELL TRADING</h1>
          <h2 className="mt-1 font-semibold">PAYSLIP</h2>
          <div className="my-6 grid grid-cols-2 gap-4">
            <p>
              <b>Employee</b>
              <br />
              {text(employee?.full_name)}
            </p>
            <p>
              <b>Period</b>
              <br />
              {day(period?.start_date)} – {day(period?.end_date)}
            </p>
            <p>
              <b>Position</b>
              <br />
              {text(employee?.position)}
            </p>
            <p>
              <b>Daily rate</b>
              <br />
              {peso.format(n(entry.daily_rate))}
            </p>
          </div>
          <Table labels={["Earnings / deductions", "Amount"]}>
            <tr>
              <td className="px-5 py-3">
                Days worked ({n(entry.days_worked)})
              </td>
              <td className="px-5 py-3">
                {peso.format(n(entry.days_worked) * n(entry.daily_rate))}
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3">Allowances</td>
              <td className="px-5 py-3">{peso.format(n(entry.allowances))}</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Deductions</td>
              <td className="px-5 py-3">{peso.format(-n(entry.deductions))}</td>
            </tr>
            <tr>
              <td className="px-5 py-3 font-semibold">Net pay</td>
              <td className="px-5 py-3 font-semibold">
                {peso.format(n(entry.net_pay))}
              </td>
            </tr>
          </Table>
        </article>
      </div>
    </div>
  );
}

function PayrollLeave({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [payslip, setPayslip] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const canManagePayroll = canAccess(role, "payroll_periods", "update");
  const canCreatePayrollEntry = canAccess(role, "payroll_entries", "create");
  const canCreateLeaveRequest = canAccess(role, "leave_requests", "create");
  const saveLeave = async () => {
    setSaving(true);
    const { error } = await createClient()
      .from("leave_requests")
      .insert({
        organization_id: orgId,
        employee_id: values.employee_id?.split("|")[0],
        leave_date: values.leave_date,
        leave_type: values.leave_type,
        is_paid: values.is_paid === "yes",
        days: n(values.days),
        notes: values.notes,
      });
    setSaving(false);
    if (error) return notice(error.message);
    setLeaveOpen(false);
    notice("Leave request recorded for approval.");
    await reload();
  };
  const saveEntry = async () => {
    setSaving(true);
    const employee = store.employees.find(
      (e) => e.id === values.employee_id?.split("|")[0],
    );
    const { error } = await createClient()
      .from("payroll_entries")
      .insert({
        payroll_period_id: values.payroll_period_id?.split("|")[0],
        employee_id: employee?.id,
        days_worked: n(values.days_worked),
        daily_rate: n(values.daily_rate) || n(employee?.daily_rate),
        allowances: n(values.allowances),
        deductions: n(values.deductions),
      });
    setSaving(false);
    if (error) return notice(error.message);
    setEntryOpen(false);
    notice("Payroll entry saved.");
    await reload();
  };
  const leaveModule: Module = {
    table: "leave_requests",
    title: "Leave requests",
    detail: "Approved unpaid leave is included in no-work-no-pay deductions.",
    add: "Request leave",
    fields: [],
    columns: [
      {
        label: "Employee",
        value: (r) => (
          <b>
            {text(
              store.employees.find((e) => e.id === r.employee_id)?.full_name,
            )}
          </b>
        ),
      },
      { label: "Date", value: (r) => day(r.leave_date) },
      { label: "Type", value: (r) => text(r.leave_type) },
      { label: "Days", value: (r) => n(r.days) },
      { label: "Status", value: (r) => <Status value={r.status} /> },
    ],
  };
  const updatePeriod = async (
    period: Row,
    status: "in_review" | "approved" | "paid",
  ) => {
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const patch: Record<string, unknown> = { status };
    if (status === "approved")
      Object.assign(patch, {
        approved_by: user.user?.id,
        approved_at: new Date().toISOString(),
      });
    if (status === "paid") patch.paid_at = new Date().toISOString();
    const { error } = await client
      .from("payroll_periods")
      .update(patch)
      .eq("id", period.id)
      .eq("organization_id", orgId);
    if (error) return notice(error.message);
    notice(`Payroll marked ${status.replaceAll("_", " ")}.`);
    await reload();
  };
  const updateLeave = async (leave: Row, status: "approved" | "rejected") => {
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client
      .from("leave_requests")
      .update({ status, approved_by: user.user?.id })
      .eq("id", leave.id)
      .eq("organization_id", orgId);
    if (error) return notice(error.message);
    notice(`Leave request ${status}.`);
    await reload();
  };
  return (
    <div className="space-y-5">
      <Records
        module={payroll}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <Panel
        title="Payroll approvals"
        detail="Submit periods for review, approve them, then mark approved payroll as paid."
      >
        {store.payroll_periods.length ? (
          <Table labels={["Period", "State", "Approval", "Action"]}>
            {store.payroll_periods.map((period) => (
              <tr key={text(period.id)}>
                <td className="px-5 py-3">
                  <b>
                    {day(period.start_date)} – {day(period.end_date)}
                  </b>
                </td>
                <td className="px-5 py-3">
                  <Status value={period.status} />
                </td>
                <td className="px-5 py-3">
                  {period.approved_at
                    ? day(period.approved_at)
                    : "Awaiting decision"}
                </td>
                <td className="px-5 py-3">
                  {canManagePayroll && period.status === "draft" && (
                    <ActionIcon
                      label="Submit payroll period"
                      onClick={() => void updatePeriod(period, "in_review")}
                    >
                      <Send size={15} />
                    </ActionIcon>
                  )}
                  {memberRole(role) && period.status === "in_review" && (
                    <ActionIcon
                      label="Approve payroll period"
                      tone="green"
                      onClick={() => void updatePeriod(period, "approved")}
                    >
                      <Check size={15} />
                    </ActionIcon>
                  )}
                  {memberRole(role) && period.status === "approved" && (
                    <ActionIcon
                      label="Mark payroll period paid"
                      tone="green"
                      onClick={() => void updatePeriod(period, "paid")}
                    >
                      <Check size={15} />
                    </ActionIcon>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No payroll periods to approve.</Empty>
        )}
      </Panel>
      <Panel
        title="Payroll entries"
        detail="Daily rate × days worked, plus allowances less deductions."
        action={
          canCreatePayrollEntry ? (
            <Button
              onClick={() => {
                setValues({
                  payroll_period_id: "",
                  employee_id: "",
                  days_worked: "",
                  daily_rate: "",
                  allowances: "0",
                  deductions: "0",
                });
                setEntryOpen(true);
              }}
            >
              <Plus size={14} />
              Add payroll entry
            </Button>
          ) : undefined
        }
      >
        {store.payroll_entries.length ? (
          <Table
            labels={[
              "Employee",
              "Period",
              "Days",
              "Gross pay",
              "Net pay",
              "Document",
            ]}
          >
            {store.payroll_entries.map((e) => (
              <tr key={text(e.id)}>
                <td className="px-5 py-3">
                  <b>
                    {text(
                      store.employees.find(
                        (employee) => employee.id === e.employee_id,
                      )?.full_name,
                    )}
                  </b>
                </td>
                <td className="px-5 py-3">
                  {text(
                    store.payroll_periods.find(
                      (p) => p.id === e.payroll_period_id,
                    )?.start_date,
                  )}{" "}
                  –{" "}
                  {text(
                    store.payroll_periods.find(
                      (p) => p.id === e.payroll_period_id,
                    )?.end_date,
                  )}
                </td>
                <td className="px-5 py-3">{n(e.days_worked)}</td>
                <td className="px-5 py-3">{peso.format(n(e.gross_pay))}</td>
                <td className="px-5 py-3 font-semibold">
                  {peso.format(n(e.net_pay))}
                </td>
                <td className="px-5 py-3">
                  <ActionIcon
                    label="View payslip"
                    onClick={() => setPayslip(e)}
                  >
                    <ReceiptText size={15} />
                  </ActionIcon>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No payroll entries in saved periods.</Empty>
        )}
      </Panel>
      <Panel
        title={leaveModule.title}
        detail={leaveModule.detail}
        action={
          canCreateLeaveRequest ? (
            <Button
              onClick={() => {
                setValues({
                  employee_id: "",
                  leave_date: isoToday(),
                  leave_type: "unpaid",
                  is_paid: "no",
                  days: "1",
                  notes: "",
                });
                setLeaveOpen(true);
              }}
            >
              <Plus size={14} />
              Request leave
            </Button>
          ) : undefined
        }
      >
        {store.leave_requests.length ? (
          <Table
            labels={[...leaveModule.columns.map((c) => c.label), "Action"]}
          >
            {store.leave_requests.map((r) => (
              <tr key={text(r.id)}>
                {leaveModule.columns.map((c) => (
                  <td key={c.label} className="px-5 py-3">
                    {c.value(r, store)}
                  </td>
                ))}
                <td className="px-5 py-3">
                  {memberRole(role) && r.status === "pending" && (
                    <>
                      <ActionIcon
                        label="Approve leave request"
                        tone="green"
                        onClick={() => void updateLeave(r, "approved")}
                      >
                        <Check size={15} />
                      </ActionIcon>
                      <ActionIcon
                        label="Reject leave request"
                        tone="red"
                        onClick={() => void updateLeave(r, "rejected")}
                      >
                        <XCircle size={15} />
                      </ActionIcon>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No leave requests recorded.</Empty>
        )}
      </Panel>
      {leaveOpen && (
        <Dialog
          title="Leave request"
          fields={[
            {
              key: "employee_id",
              label: "Employee",
              type: "select",
              required: true,
              options: store.employees.map(
                (e) => `${e.id}|${text(e.full_name)}`,
              ),
            },
            {
              key: "leave_date",
              label: "Leave date",
              type: "date",
              required: true,
            },
            {
              key: "leave_type",
              label: "Leave type",
              type: "select",
              required: true,
              options: ["unpaid", "paid", "sick", "vacation"],
            },
            {
              key: "is_paid",
              label: "Paid leave",
              type: "select",
              required: true,
              options: ["no", "yes"],
            },
            { key: "days", label: "Days", type: "number", required: true },
          ]}
          values={values}
          setValues={setValues}
          save={() => void saveLeave()}
          close={() => setLeaveOpen(false)}
          saving={saving}
        />
      )}
      {entryOpen && (
        <Dialog
          title="Payroll entry"
          fields={[
            {
              key: "payroll_period_id",
              label: "Payroll period",
              type: "select",
              required: true,
              options: store.payroll_periods.map(
                (p) => `${p.id}|${day(p.start_date)} – ${day(p.end_date)}`,
              ),
            },
            {
              key: "employee_id",
              label: "Employee",
              type: "select",
              required: true,
              options: store.employees.map(
                (e) => `${e.id}|${text(e.full_name)}`,
              ),
            },
            {
              key: "days_worked",
              label: "Days worked",
              type: "number",
              required: true,
            },
            { key: "daily_rate", label: "Daily rate override", type: "number" },
            { key: "allowances", label: "Allowances", type: "number" },
            { key: "deductions", label: "Deductions", type: "number" },
          ]}
          values={values}
          setValues={setValues}
          save={() => void saveEntry()}
          close={() => setEntryOpen(false)}
          saving={saving}
        />
      )}
      {payslip && (
        <PayslipDocument
          entry={payslip}
          store={store}
          close={() => setPayslip(null)}
        />
      )}
    </div>
  );
}

function FinanceReports({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const inRange = (value: unknown) => {
    const d = String(value ?? "").slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  };
  const revenue = store.invoices
    .filter((i) => i.status !== "void" && inRange(i.issue_date))
    .reduce((sum, i) => sum + n(i.total_amount), 0);
  const expensesTotal = store.expenses
    .filter(
      (e) =>
        !e.archived_at &&
        !["cancelled", "rejected"].includes(text(e.status)) &&
        inRange(e.expense_date),
    )
    .reduce((sum, e) => sum + n(e.amount), 0);
  const cashIn =
    store.payments
      .filter((p) => inRange(p.paid_at))
      .reduce((sum, p) => sum + n(p.amount), 0) +
    store.cash_flow_entries
      .filter(
        (e) =>
          [
            "starting_capital",
            "additional_capital",
            "loan_received",
            "reimbursement",
          ].includes(text(e.entry_type)) && inRange(e.occurred_on),
      )
      .reduce((sum, e) => sum + n(e.amount), 0);
  const cashOut =
    expensesTotal +
    store.cash_flow_entries
      .filter(
        (e) =>
          ["loan_payment", "owner_withdrawal", "expense_paid"].includes(
            text(e.entry_type),
          ) && inRange(e.occurred_on),
      )
      .reduce((sum, e) => sum + n(e.amount), 0);
  const receivables = store.invoices
    .filter(
      (invoice) => invoice.status !== "void" && inRange(invoice.issue_date),
    )
    .map((invoice) => {
      const paid = store.payments
        .filter(
          (payment) =>
            payment.invoice_id === invoice.id && !payment.reversed_at,
        )
        .reduce((sum, payment) => sum + n(payment.amount), 0);
      return { invoice, balance: Math.max(n(invoice.total_amount) - paid, 0) };
    })
    .filter(({ balance }) => balance > 0);
  const receivableTotal = receivables.reduce(
    (sum, item) => sum + item.balance,
    0,
  );
  const payables = store.supplier_payables.filter(
    (payable) =>
      !["paid", "cancelled"].includes(text(payable.status)) &&
      inRange(payable.due_date),
  );
  const payableTotal = payables.reduce(
    (sum, payable) =>
      sum + Math.max(n(payable.amount) - n(payable.amount_paid), 0),
    0,
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#d9e0e9] bg-white p-4">
        <label className="text-[12px] font-medium">
          From
          <input
            type="date"
            value={from}
            onClick={(e) => openNativeDatePicker(e.currentTarget)}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-[12px] font-medium">
          To
          <input
            type="date"
            value={to}
            onClick={(e) => openNativeDatePicker(e.currentTarget)}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </label>
        <Button
          secondary
          onClick={() => {
            const csv = `Metric,Amount\nRevenue,${revenue}\nExpenses,${expensesTotal}\nProfit / loss,${revenue - expensesTotal}\nCash in,${cashIn}\nCash out,${cashOut}`;
            const url = URL.createObjectURL(
              new Blob([csv], { type: "text/csv" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "huswell-financial-report.csv";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Sales / cash in", cashIn],
          ["Client receivables", receivableTotal],
          ["Business cash out", cashOut],
          ["Supplier payables", payableTotal],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-[14px] border border-[#d9e0e9] bg-white p-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#8b92a1]">
              {label}
            </p>
            <p className="mt-2 text-xl font-semibold">
              {peso.format(Number(value))}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Receivables"
          detail="Client balances still due for collection."
        >
          {receivables.length ? (
            <Table
              labels={["Client / invoice", "Due date", "Balance", "Status"]}
            >
              {receivables.map(({ invoice, balance }) => (
                <tr key={text(invoice.id)}>
                  <td className="px-5 py-3">
                    {stackedCell(
                      store.customers.find(
                        (customer) => customer.id === invoice.customer_id,
                      )?.company_name,
                      invoice.invoice_no,
                    )}
                  </td>
                  <td className="px-5 py-3">{day(invoice.due_date)}</td>
                  <td className="px-5 py-3 font-semibold">
                    {peso.format(balance)}
                  </td>
                  <td className="px-5 py-3">
                    <Status value={invoice.status} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No client balances awaiting collection.</Empty>
          )}
        </Panel>
        <Panel
          title="Supplier payables"
          detail="Supplier balances and upcoming payment obligations."
        >
          {payables.length ? (
            <Table labels={["Supplier", "Due date", "Balance", "Status"]}>
              {payables.map((payable) => (
                <tr key={text(payable.id)}>
                  <td className="px-5 py-3">
                    {stackedCell(
                      store.suppliers.find(
                        (supplier) => supplier.id === payable.supplier_id,
                      )?.company_name,
                      payable.payable_no,
                    )}
                  </td>
                  <td className="px-5 py-3">{day(payable.due_date)}</td>
                  <td className="px-5 py-3 font-semibold">
                    {peso.format(
                      Math.max(n(payable.amount) - n(payable.amount_paid), 0),
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Status value={payable.status} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No supplier balances awaiting payment.</Empty>
          )}
        </Panel>
      </div>
      <Records
        module={finance}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <Records
        module={expenses}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <Records
        module={supplierPayables}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
      <Panel
        title="Financial statement"
        detail="Income, expenses, and cash movements for the selected period."
        action={
          <Button secondary onClick={() => window.print()}>
            <Printer size={14} />
            Print report
          </Button>
        }
      >
        <Table labels={["Statement", "Amount"]}>
          <tr>
            <td className="px-5 py-3">Sales revenue</td>
            <td className="px-5 py-3">{peso.format(revenue)}</td>
          </tr>
          <tr>
            <td className="px-5 py-3">Operating expenses</td>
            <td className="px-5 py-3">{peso.format(expensesTotal)}</td>
          </tr>
          <tr>
            <td className="px-5 py-3 font-semibold">Net profit / loss</td>
            <td className="px-5 py-3 font-semibold">
              {peso.format(revenue - expensesTotal)}
            </td>
          </tr>
          <tr>
            <td className="px-5 py-3">Cash in</td>
            <td className="px-5 py-3">{peso.format(cashIn)}</td>
          </tr>
          <tr>
            <td className="px-5 py-3">Cash out</td>
            <td className="px-5 py-3">{peso.format(cashOut)}</td>
          </tr>
          <tr>
            <td className="px-5 py-3 font-semibold">Available funds</td>
            <td className="px-5 py-3 font-semibold">
              {peso.format(cashIn - cashOut)}
            </td>
          </tr>
        </Table>
      </Panel>
      <Panel
        title="Expense category breakdown"
        detail="Operating expenses by category for the selected period."
      >
        <Table labels={["Category", "Amount", "Coverage"]}>
          {Object.entries(
            store.expenses
              .filter(
                (expense) =>
                  !expense.archived_at &&
                  !["cancelled", "rejected"].includes(text(expense.status)) &&
                  inRange(expense.expense_date),
              )
              .reduce<Record<string, number>>(
                (groups, expense) => ({
                  ...groups,
                  [text(expense.category, "Uncategorized")]:
                    (groups[text(expense.category, "Uncategorized")] ?? 0) +
                    n(expense.amount),
                }),
                {},
              ),
          ).map(([category, amount]) => (
            <tr key={category}>
              <td className="px-5 py-3">
                <b>{category}</b>
              </td>
              <td className="px-5 py-3">{peso.format(amount)}</td>
              <td className="px-5 py-3">
                <Progress value={amount} total={expensesTotal} />
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function ProjectOfficerSalesFunnel({
  store,
}: {
  store: Store;
}) {
  const isColorMode = true;
  const countUniqueLeads = (rows: Row[]) => new Set(rows.map((row) => text(row.lead_id, text(row.id, ""))).filter(Boolean)).size;
  const priceQuotations = store.quotations.filter((quotation) => text(quotation.document_type) === "price_quotation" && ["sent", "approved"].includes(text(quotation.status)));
  const doneDeals = store.leads.filter((lead) => n(lead.evaluation_number) === 7);
  const completedProjects = store.project_schedules.filter(
    (schedule) => Boolean(schedule.completed_at),
  ).length;
  const completedAt = (stage: number) => doneDeals.filter((lead) => n(lead.done_deal_status) >= stage).length;
  const stages = [
    { label: "1. Leads Generated", description: "All potential leads collected", total: store.leads.length, color: "#0863c4", Icon: UsersRound },
    { label: "2. Leads Contacted", description: "Leads that were successfully contacted", total: store.leads.filter((lead) => Boolean(text(lead.date_contacted, ""))).length, color: "#08aabd", Icon: MessageSquareText },
    { label: "3. Price Quotation", description: "Quotation provided to interested leads", total: countUniqueLeads(priceQuotations), color: "#ee9500", Icon: FileText },
    { label: "4. Paid Clients", description: "Leads who made a payment / became clients", total: completedAt(6), color: "#e74408", Icon: PhilippinePeso },
    { label: "5. Completed Projects", description: "General Manager-approved finished projects", total: completedProjects, color: "#075fc3", Icon: Check },
  ];
  const percentage = (current: number, previous: number) => previous ? `${((current / previous) * 100).toFixed(2)}%` : "—";
  const overallPercentage = percentage(stages.at(-1)?.total ?? 0, stages[0].total);
  const todayLabel = new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
  }).format(new Date());
  const ink = isColorMode ? "#092d67" : "#000000";
  const border = isColorMode ? "#6e7480" : "#000000";
  const displayColor = (stage: (typeof stages)[number]) => isColorMode ? stage.color : "#000000";

  const StageIdentity = ({ stage }: { stage: (typeof stages)[number] }) => {
    const { Icon } = stage;
    return <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: stage.color }}><Icon aria-hidden="true" size={16} strokeWidth={2.2} /></span>
      <p className="text-[13px] font-semibold leading-tight text-[#202938]">{stage.label.replace(/^\d+\.\s*/, "")}</p>
    </div>;
  };

  return <section className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4e8ef] pb-4">
      <div><h1 className="text-[20px] font-semibold tracking-[-.02em] text-[#202938]">Sales pipeline</h1><p className="mt-1 text-[12px] text-[#687386]">Track leads from first contact through completed projects.</p></div>
      <span className="inline-flex items-center gap-2 text-[12px] text-[#687386]"><CalendarDays size={15} className="text-[#c43b43]" />{todayLabel}</span>
    </header>

    <div className="hidden overflow-hidden rounded-lg border border-[#d6dee8] bg-white md:block">
      <div className="grid grid-cols-[1.25fr_1.4fr_.55fr_.65fr] bg-[#16386d] text-[11px] font-semibold text-white">
        <div className="px-4 py-3">Stage</div>
        <div className="px-4 py-3">Description</div>
        <div className="px-4 py-3 text-right">Total</div>
        <div className="px-4 py-3 text-right">Conversion</div>
      </div>
      {stages.map((stage, index) => {
        const previous = stages[index - 1];
        return <div className="grid grid-cols-[1.25fr_1.4fr_.55fr_.65fr] border-t border-[#e4e8ef]" key={stage.label}>
          <div className="flex min-h-[58px] items-center px-4"><StageIdentity stage={stage} /></div>
          <div className="flex min-h-[58px] items-center px-4 text-[12px] leading-snug text-[#687386]">{stage.description}</div>
          <div className="flex min-h-[58px] items-center justify-end px-4 text-[13px] font-semibold tabular-nums text-[#202938]">{stage.total.toLocaleString()}</div>
          <div className="flex min-h-[52px] flex-col items-center justify-center border-t px-2 text-center" style={{ borderColor: border, color: displayColor(stage) }}><b className="text-[13px] leading-none tabular-nums">{index ? percentage(stage.total, previous.total) : "—"}</b>{index > 0 && <span className="mt-0.5 text-[13px] font-medium leading-none text-black">({stage.total.toLocaleString()} / {previous.total.toLocaleString()})</span>}</div>
        </div>;
      })}
    </div>

    <div className="space-y-2 md:hidden">
      {stages.map((stage, index) => {
        const previous = stages[index - 1];
        return <article className="overflow-hidden rounded-lg border border-[#dfe5ed] bg-white" key={stage.label}>
          <StageIdentity stage={stage} />
          <p className="border-t px-4 py-3 text-[13px] font-medium leading-snug text-black" style={{ borderColor: border }}>{stage.description}</p>
          <dl className="grid grid-cols-2 border-t" style={{ borderColor: border }}><div className="border-r p-3 text-center" style={{ borderColor: border }}><dt className="text-[13px] font-black">TOTAL (PROJECTS)</dt><dd className="mt-1 text-[13px] font-black tabular-nums" style={{ color: displayColor(stage) }}>{stage.total.toLocaleString()}</dd></div><div className="p-3 text-center"><dt className="text-[13px] font-black">CONVERSION</dt><dd className="mt-1 text-[13px] font-black tabular-nums" style={{ color: displayColor(stage) }}>{index ? percentage(stage.total, previous.total) : "—"}</dd>{index > 0 && <span className="text-[13px] text-black">({stage.total.toLocaleString()} / {previous.total.toLocaleString()})</span>}</div></dl>
        </article>;
      })}
    </div>

    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dfe5ed] bg-[#f7f8fa] px-4 py-3">
      <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-md bg-[#16386d] text-white"><Goal aria-hidden="true" size={16} /></span><p className="text-[12px] font-medium text-[#687386]">Lead-to-project conversion</p></div>
      <p className="text-[16px] font-semibold tabular-nums text-[#202938]">{overallPercentage}<span className="ml-2 text-[11px] font-normal text-[#687386]">({stages.at(-1)?.total.toLocaleString()} / {stages[0].total.toLocaleString()})</span></p>
    </footer>
  </section>;
}

function GeneralManagerKpiDashboard({ store }: { store: Store }) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const isInMonth = (value: unknown, year: number, month: number) => {
    const date = new Date(String(value));
    return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
  };
  const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const invoices = store.invoices.filter((invoice) => text(invoice.status) !== "void");
  const invoiceBalance = (invoice: Row) => Math.max(
    n(invoice.total_amount) - store.payments.filter((payment) => payment.invoice_id === invoice.id && !payment.reversed_at).reduce((sum, payment) => sum + n(payment.amount), 0),
    0,
  );
  const salesFor = (year: number, month: number) => invoices.filter((invoice) => isInMonth(invoice.issue_date, year, month)).reduce((sum, invoice) => sum + n(invoice.total_amount), 0);
  const collectionsFor = (year: number, month: number) => store.payments.filter((payment) => !payment.reversed_at && isInMonth(payment.paid_at, year, month)).reduce((sum, payment) => sum + n(payment.amount), 0);
  const totalSales = salesFor(currentYear, currentMonth);
  const collections = collectionsFor(currentYear, currentMonth);
  const previousSales = salesFor(previousYear, previousMonth);
  const previousCollections = collectionsFor(previousYear, previousMonth);
  const receivables = invoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const today = new Date(currentYear, currentMonth, now.getDate());
  const overdue = invoices.filter((invoice) => {
    const dueDate = new Date(text(invoice.due_date, ""));
    return invoiceBalance(invoice) > 0 && !Number.isNaN(dueDate.getTime()) && dueDate < today;
  }).reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const previousOverdue = invoices.filter((invoice) => {
    const dueDate = new Date(text(invoice.due_date, ""));
    const previousToday = new Date(previousYear, previousMonth, Math.min(now.getDate(), new Date(previousYear, previousMonth + 1, 0).getDate()));
    return invoiceBalance(invoice) > 0 && !Number.isNaN(dueDate.getTime()) && dueDate < previousToday;
  }).reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const quarter = Math.floor(currentMonth / 3);
  const quarterStart = new Date(currentYear, quarter * 3, 1);
  const quarterEnd = new Date(currentYear, quarter * 3 + 3, 1);
  const quarterSales = invoices.filter((invoice) => {
    const date = new Date(String(invoice.issue_date));
    return !Number.isNaN(date.getTime()) && date >= quarterStart && date < quarterEnd;
  }).reduce((sum, invoice) => sum + n(invoice.total_amount), 0);
  const quota = n(store.target_goals.find((goal) => text(goal.goal_type) === "quarterly_sales" && isInMonth(goal.period_start, currentYear, quarter * 3))?.target_value);
  const quotaProgress = quota ? Math.min(Math.round((quarterSales / quota) * 100), 100) : 0;
  const monthLabel = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(now);
  const compare = (value: number, previous: number) => previous ? `${Math.abs(((value - previous) / previous) * 100).toFixed(1)}% ${value >= previous ? "up" : "down"}` : "No prior month";
  const financeAmountSize = (value: number) => {
    const length = peso.format(value).length;
    if (length > 18) return "16px";
    if (length > 15) return "19px";
    if (length > 12) return "23px";
    return "28px";
  };
  const metricCards = [
    { title: "TOTAL SALES", value: totalSales, detail: "This month", compare: compare(totalSales, previousSales), previous: previousSales, Icon: TrendingUp, color: "#1262e7", tint: "#edf4ff" },
    { title: "COLLECTIONS RECEIVED", value: collections, detail: "This month", compare: compare(collections, previousCollections), previous: previousCollections, Icon: Wallet, color: "#087b19", tint: "#edf9ef" },
    { title: "TOTAL RECEIVABLES", value: receivables, detail: "As of today", Icon: ReceiptText, color: "#f38300", tint: "#fff5e8" },
    { title: "OVERDUE RECEIVABLES", value: overdue, detail: "As of today", compare: compare(overdue, previousOverdue), previous: previousOverdue, Icon: CalendarDays, color: "#e30719", tint: "#fff0f1" },
  ];

  return <div className="space-y-4">
    <section className="overflow-hidden rounded-lg border border-[#dfe5ed] bg-white">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4e8ef] px-4 py-4 sm:px-5">
        <div><h1 className="text-[20px] font-semibold tracking-[-.02em] text-[#202938]">KPI dashboard</h1><p className="mt-1 text-[12px] text-[#687386]">Sales, collections, and cash exposure at a glance.</p></div>
        <span className="inline-flex items-center gap-2 text-[12px] text-[#687386]"><CalendarDays size={15} className="text-[#c43b43]" />{monthLabel}</span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
        {metricCards.map(({ title, value, detail, compare: change, previous, Icon, color, tint }) => <article key={title} className="min-w-0 rounded-lg border border-[#dfe5ed] p-4">
          <div className="flex items-start justify-between gap-3"><span className="grid size-8 place-items-center rounded-md text-white" style={{ backgroundColor: color }}><Icon size={16} /></span><span className="text-[11px] text-[#687386]">{detail}</span></div>
          <h2 className="mt-4 text-[11px] font-medium text-[#687386]">{title}</h2>
          <p className="mt-1 whitespace-nowrap font-semibold leading-none tabular-nums text-[#202938]" style={{ fontSize: financeAmountSize(value) }}>{peso.format(value)}</p>
          {change && <div className="mt-4 flex items-center justify-between border-t border-[#edf0f5] pt-3 text-left text-[11px] text-[#687386]"><span className="font-medium text-[#202938]">{change}</span><span className="text-right">Previous <b className="text-[#202938]">{peso.format(previous ?? 0)}</b></span></div>}
        </article>)}
      </div>
      <section className="mx-4 mb-4 overflow-hidden rounded-lg border border-[#dfe5ed] sm:mx-5 sm:mb-5">
        <div className="flex items-center gap-2 border-b border-[#e4e8ef] px-4 py-3"><span className="grid size-8 place-items-center rounded-md bg-[#16386d] text-white"><Goal size={16} /></span><div><h2 className="text-[14px] font-semibold text-[#202938]">Quarterly sales quota</h2><p className="mt-0.5 text-[11px] text-[#687386]">Q{quarter + 1} {currentYear}</p></div></div>
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          <div><div className="flex items-end justify-between gap-3"><div><p className="text-[11px] font-medium text-[#687386]">Progress toward target</p><p className="mt-1 text-[24px] font-semibold leading-none tabular-nums text-[#202938]">{quotaProgress}%</p></div><p className="text-right text-[11px] text-[#687386]">{peso.format(quarterSales)} of<br /><span className="font-medium text-[#202938]">{peso.format(quota)}</span></p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf0f5]"><div className="h-full rounded-full bg-[#c43b43]" style={{ width: `${quotaProgress}%` }} /></div></div>
          <dl className="divide-y divide-[#edf0f5]">
            {[{ label: "Quarterly target", value: quota, Icon: Goal }, { label: "Achieved", value: quarterSales, Icon: Check }, { label: "Remaining", value: Math.max(quota - quarterSales, 0), Icon: Wallet }].map(({ label, value, Icon }) => <div className="flex items-center justify-between gap-3 py-2.5" key={label}><dt className="flex items-center gap-2 text-[12px] text-[#687386]"><Icon size={15} className="text-[#16386d]" />{label}</dt><dd className="text-[13px] font-semibold tabular-nums text-[#202938]">{peso.format(value)}</dd></div>)}
          </dl>
        </div>
      </section>
    </section>
    <ProjectOfficerSalesFunnel store={store} />
  </div>;
}

function Dashboard({
  store,
  go,
  role,
  orgId,
}: {
  store: Store;
  go: (view: View) => void;
  role: string;
  orgId: string;
}) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [sharedKpis, setSharedKpis] = useState<Row | null>(null);
  const [selectedYear, selectedMonthIndex] = selectedMonth.split("-").map(Number);
  const monthDate = new Date(selectedYear, selectedMonthIndex - 1, 1);
  const monthName = new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
  }).format(monthDate);
  const isProjectOfficer = isProjectOfficerRole(role);
  useEffect(() => {
    if (isProjectOfficer) return;
    let active = true;
    void createClient()
      .rpc("shared_kpi_dashboard", {
        p_organization_id: orgId,
        p_month: `${selectedMonth}-01`,
      })
      .then(({ data }) => {
        if (active && data && typeof data === "object") setSharedKpis(data as Row);
      });
    return () => {
      active = false;
    };
  }, [isProjectOfficer, orgId, selectedMonth]);
  if (isProjectOfficer) return <ProjectOfficerSalesFunnel store={store} />;
  if (role === "admin") return <GeneralManagerKpiDashboard store={store} />;
  const quarter = Math.floor((selectedMonthIndex - 1) / 3) + 1;
  const quarterStartMonth = (quarter - 1) * 3;
  const quarterLabel = `Q${quarter} ${selectedYear}`;
  const isCurrentMonth = (value: unknown) => {
    const date = new Date(String(value));
    return !Number.isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() === selectedMonthIndex - 1;
  };
  const nonVoidInvoices = store.invoices.filter((invoice) => text(invoice.status) !== "void");
  const monthInvoices = nonVoidInvoices.filter((invoice) => isCurrentMonth(invoice.issue_date));
  const monthPayments = store.payments.filter((payment) => !payment.reversed_at && isCurrentMonth(payment.paid_at));
  const invoiceBalance = (invoice: Row) => Math.max(
    n(invoice.total_amount) - store.payments.filter((payment) => payment.invoice_id === invoice.id && !payment.reversed_at).reduce((sum, payment) => sum + n(payment.amount), 0),
    0,
  );
  const totalSales = monthInvoices.reduce((sum, invoice) => sum + n(invoice.total_amount), 0);
  const collections = monthPayments.reduce((sum, payment) => sum + n(payment.amount), 0);
  const receivables = nonVoidInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const overdueReceivables = nonVoidInvoices.filter((invoice) => {
    const dueDate = new Date(text(invoice.due_date, ""));
    return invoiceBalance(invoice) > 0 && !Number.isNaN(dueDate.getTime()) && dueDate < todayStart;
  }).reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const costings = store.quotations.filter((quotation) => text(quotation.document_type) === "costing_breakdown");
  const priceQuotations = store.quotations.filter((quotation) => text(quotation.document_type) === "price_quotation");
  const monthlyQuotedValue = priceQuotations.filter((quotation) => isCurrentMonth(quotation.issue_date)).reduce((sum, quotation) => sum + n(quotation.total_amount), 0);
  const leadsGenerated = store.leads.filter((lead) => isCurrentMonth(lead.date_sent ?? lead.created_at)).length;
  const priceQuoteSent = priceQuotations.filter((quotation) => isCurrentMonth(quotation.issue_date) && ["sent", "approved"].includes(text(quotation.status))).length;
  const paidClients = new Set(monthInvoices.filter((invoice) => text(invoice.status) === "paid").map((invoice) => invoice.customer_id).filter(Boolean)).size;
  const isSelectedQuarter = (value: unknown) => {
    const date = new Date(String(value));
    return !Number.isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() >= quarterStartMonth && date.getMonth() < quarterStartMonth + 3;
  };
  const quarterSales = nonVoidInvoices
    .filter((invoice) => isSelectedQuarter(invoice.issue_date))
    .reduce((sum, invoice) => sum + n(invoice.total_amount), 0);
  const quarterlySalesTarget = store.target_goals.find(
    (goal) =>
      text(goal.goal_type, "") === "quarterly_sales" &&
      isSelectedQuarter(goal.period_start),
  );
  const quarterlyTargetValue = n(quarterlySalesTarget?.target_value);
  const quarterlyActual = quarterSales;
  const quarterlyTargetProgress = quarterlyTargetValue
    ? Math.min(Math.round((quarterlyActual / quarterlyTargetValue) * 100), 100)
    : 0;
  const monthlyPerformance = Array.from({ length: 12 }, (_, index) => {
    const inMonth = (value: unknown) => {
      const date = new Date(String(value));
      return !Number.isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() === index;
    };
    return {
      label: new Intl.DateTimeFormat("en-PH", { month: "short" }).format(new Date(selectedYear, index, 1)),
      revenue: isProjectOfficer
        ? priceQuotations.filter((quotation) => inMonth(quotation.issue_date)).reduce((sum, quotation) => sum + n(quotation.total_amount), 0)
        : nonVoidInvoices.filter((invoice) => inMonth(invoice.issue_date)).reduce((sum, invoice) => sum + n(invoice.total_amount), 0),
      expense: isProjectOfficer
        ? costings.filter((quotation) => inMonth(quotation.created_at)).reduce((sum, quotation) => sum + n(quotation.total_cost), 0)
      : store.payments.filter((payment) => !payment.reversed_at && inMonth(payment.paid_at)).reduce((sum, payment) => sum + n(payment.amount), 0),
    };
  });
  const sharedPerformance = Array.isArray(sharedKpis?.monthly_performance)
    ? (sharedKpis.monthly_performance as Row[]).map((point) => ({ label: text(point.label), revenue: n(point.revenue), expense: n(point.expense) }))
    : monthlyPerformance;
  const dashboardSales = sharedKpis ? n(sharedKpis.total_sales) : totalSales;
  const dashboardCollections = sharedKpis ? n(sharedKpis.collections) : collections;
  const dashboardReceivables = sharedKpis ? n(sharedKpis.receivables) : receivables;
  const dashboardOverdue = sharedKpis ? n(sharedKpis.overdue_receivables) : overdueReceivables;
  const dashboardLeads = sharedKpis ? n(sharedKpis.leads_generated) : leadsGenerated;
  const dashboardQuotes = sharedKpis ? n(sharedKpis.price_quotations) : priceQuoteSent;
  const dashboardOfficerLeads = sharedKpis ? n(sharedKpis.officer_leads_generated) : 0;
  const dashboardOfficerQuotes = sharedKpis ? n(sharedKpis.officer_price_quotations) : 0;
  const dashboardPaidClients = sharedKpis ? n(sharedKpis.paid_clients) : paidClients;
  const dashboardQuarterSales = sharedKpis ? n(sharedKpis.quarter_sales) : quarterlyActual;
  const dashboardQuarterTarget = sharedKpis ? n(sharedKpis.quarter_target) : quarterlyTargetValue;
  const dashboardQuarterProgress = dashboardQuarterTarget ? Math.min(Math.round((dashboardQuarterSales / dashboardQuarterTarget) * 100), 100) : 0;
  const readOnlyKpiView = isProjectOfficer ? "Dashboard" as View : "Finance" as View;
  const ongoingMockups = store.leads.filter(
    (lead) =>
      n(lead.evaluation_number) === 7 &&
      text(lead.mockup_status, "").toLowerCase() === "ongoing",
  ).length;
  const submittedMockups = store.leads.filter(
    (lead) =>
      n(lead.evaluation_number) === 7 &&
      text(lead.mockup_status, "").toLowerCase() === "submitted",
  ).length;
  const primaryMetrics = [
    { label: "Total sales", value: peso.format(dashboardSales), detail: "Invoiced this month", icon: TrendingUp, iconClass: "bg-[#1769e8] text-white", accent: "bg-[#1769e8]", view: readOnlyKpiView },
    { label: "Collections received", value: peso.format(dashboardCollections), detail: "Payments received", icon: PhilippinePeso, iconClass: "bg-[#16854f] text-white", accent: "bg-[#16854f]", view: readOnlyKpiView },
    { label: "Total receivables", value: peso.format(dashboardReceivables), detail: "Balance awaiting payment", icon: ReceiptText, iconClass: "bg-[#d98a1d] text-white", accent: "bg-[#d98a1d]", view: readOnlyKpiView },
    { label: "Overdue receivables", value: peso.format(dashboardOverdue), detail: "Past due balances", icon: CalendarDays, iconClass: "bg-[#c43b43] text-white", accent: "bg-[#c43b43]", view: readOnlyKpiView },
    { label: "Quarterly sales quota", value: dashboardQuarterTarget ? `${dashboardQuarterProgress}%` : "Not set", detail: dashboardQuarterTarget ? `${quarterLabel} · ${peso.format(Math.max(dashboardQuarterTarget - dashboardQuarterSales, 0))} remaining` : `Set a target for ${quarterLabel}`, icon: Goal, iconClass: "bg-[#7043ca] text-white", accent: "bg-[#7043ca]", view: isProjectOfficer ? "Dashboard" as View : "Targets" as View },
  ];
  const operationsMetrics = [
    { label: "Leads generated", value: dashboardLeads, detail: "All sales officers", icon: ClipboardCheck, tone: "bg-[#7043ca]", view: "Leads" as View },
    { label: "Price quotations", value: dashboardQuotes, detail: "Sent or approved", icon: FileText, tone: "bg-[#1769e8]", view: "Price Quotations" as View },
  ];
  const projectOfficerMetrics = [
    { label: "All leads generated", value: dashboardLeads, detail: "All sales officers", icon: ClipboardCheck, tone: "bg-[#7043ca]" },
    { label: "My leads generated", value: dashboardOfficerLeads, detail: "Assigned to you", icon: UserRound, tone: "bg-[#7043ca]" },
    { label: "All price quotations", value: dashboardQuotes, detail: "Team sent or approved", icon: FileText, tone: "bg-[#1769e8]" },
    { label: "My price quotations", value: dashboardOfficerQuotes, detail: "Your sent or approved", icon: UserRound, tone: "bg-[#1769e8]" },
  ];
  const generalManagerMockupMetrics = role === "admin"
    ? [
        { label: "Ongoing mockup", value: ongoingMockups, detail: "Projects in mockup progress", icon: ImageIcon, tone: "bg-[#7043ca]", view: "Leads" as View },
        { label: "Submitted mockup", value: submittedMockups, detail: "Projects awaiting mockup review", icon: ImageIcon, tone: "bg-[#1769e8]", view: "Leads" as View },
      ]
    : [];
  const funnel = [
    { label: "Leads generated", value: dashboardLeads, width: "w-full", color: "bg-[#7043ca]", view: isProjectOfficer ? "Dashboard" as View : "Leads" as View },
    { label: "Price quotations", value: dashboardQuotes, width: "w-[72%]", color: "bg-[#1769e8]", view: isProjectOfficer ? "Dashboard" as View : "Price Quotations" as View },
    { label: "Paid clients", value: dashboardPaidClients, width: "w-[58%]", color: "bg-[#16854f]", view: readOnlyKpiView },
  ];
  const canReviewSubmissions = ["admin", "owner", "super_admin"].includes(role);
  const funnelMax = Math.max(1, ...funnel.map((stage) => stage.value));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-3">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-[#dfe4eb] bg-white px-3 text-[12px] font-medium text-[#4b5565] shadow-[0_1px_2px_rgb(16_24_40_/_3%)]">
          <CalendarDays size={15} className="text-[#c43b43]" />
          <span className="sr-only">Reporting month</span>
          <input
            type="month"
            value={selectedMonth}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="border-0 bg-transparent p-0 text-[12px] font-medium text-[#202124] outline-none"
          />
        </label>
      </div>
      {isProjectOfficer ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {projectOfficerMetrics.map(({ label, value, detail, icon: Icon, tone }) => (
            <div key={label} className="dashboard-metric h-[108px] rounded-[14px] border border-[#dfe5ed] bg-white px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40_/_3%)] lg:px-5">
              <div className="grid h-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3">
                <span className={`grid size-11 shrink-0 place-items-center rounded-full text-white ${tone}`}><Icon size={21} strokeWidth={2.2} /></span>
                <div className="min-w-0">
                  <p className="dashboard-metric-label truncate font-semibold uppercase tracking-[.08em] text-[#626b7a]">{label}</p>
                  <p className="dashboard-metric-value mt-1 truncate font-semibold tracking-tight text-[#151922]">{value.toLocaleString()}</p>
                  <p className="dashboard-metric-hint mt-1 truncate font-medium text-[#626b7a]">{detail}</p>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {primaryMetrics.map(({ label, value, detail, icon: Icon, iconClass, accent, view }) => (
              <button
                key={label}
                type="button"
                onClick={() => go(view)}
                className="group rounded-lg border border-[#e7ebf0] bg-white p-3.5 text-left shadow-[0_1px_2px_rgb(16_24_40_/_3%)] transition-all hover:-translate-y-0.5 hover:border-[#d6dce6] hover:shadow-[0_8px_18px_rgb(16_24_40_/_7%)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid size-8 place-items-center rounded-md ${iconClass}`}><Icon size={16} /></span>
                  <span className={`mt-1 size-2 rounded-full ${accent}`} aria-hidden />
                </div>
                <p className="mt-3 text-[11px] font-medium text-[#4b5565]">{label}</p>
                <p className="mt-1 truncate text-[22px] font-semibold tracking-[-.03em] text-[#151922]" title={value}>{value}</p>
                <p className="mt-1 text-[10px] text-[#8b92a1]">{detail}</p>
              </button>
            ))}
          </section>
          {canReviewSubmissions && (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[...operationsMetrics, ...generalManagerMockupMetrics].map(({ label, value, detail, icon: Icon, tone, view }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => go(view)}
                  className="group rounded-lg border border-[#e7ebf0] bg-white p-3.5 text-left shadow-[0_1px_2px_rgb(16_24_40_/_3%)] transition-all hover:-translate-y-0.5 hover:border-[#d6dce6] hover:shadow-[0_8px_18px_rgb(16_24_40_/_7%)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`grid size-8 place-items-center rounded-md text-white ${tone}`}><Icon size={16} /></span>
                    <span className={`mt-1 size-2 rounded-full ${tone}`} aria-hidden />
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-[#4b5565]">{label}</p>
                  <p className="mt-1 truncate text-[22px] font-semibold tracking-[-.03em] text-[#151922]">{value.toLocaleString()}</p>
                  <p className="mt-1 text-[10px] text-[#8b92a1]">{detail}</p>
                </button>
              ))}
            </section>
          )}
        </>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,.98fr)_minmax(0,1.02fr)]">
        <section className="rounded-lg border border-[#e7ebf0] bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40_/_3%)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[#151922]">Collection forecast</h2>
              <p className="mt-1 text-[11px] text-[#8b92a1]">Your current month summary.</p>
            </div>
            <span className="rounded-full bg-[#f5f7fa] px-2 py-1 text-[10px] font-medium text-[#626b7a]">{monthName}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => go(readOnlyKpiView)} className="rounded-lg border border-[#eef1f5] bg-[#fbfcfe] p-3 text-left transition-colors hover:bg-[#f6f8fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]">
              <span className="grid size-7 place-items-center rounded-md bg-[#1769e8] text-white"><TrendingUp size={15} /></span>
              <p className="mt-4 text-[10px] font-medium uppercase tracking-[.06em] text-[#8b92a1]">Sales invoiced</p>
              <p className="mt-1 text-[23px] font-semibold tracking-[-.03em] text-[#151922]">{peso.format(dashboardSales)}</p>
              <p className="mt-1 text-[10px] text-[#16854f]">For {monthName}</p>
            </button>
            <button type="button" onClick={() => go(readOnlyKpiView)} className="rounded-lg border border-[#eef1f5] bg-[#fbfcfe] p-3 text-left transition-colors hover:bg-[#f6f8fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]">
              <span className="grid size-7 place-items-center rounded-md bg-[#16854f] text-white"><PhilippinePeso size={15} /></span>
              <p className="mt-4 text-[10px] font-medium uppercase tracking-[.06em] text-[#8b92a1]">Collections</p>
              <p className="mt-1 text-[23px] font-semibold tracking-[-.03em] text-[#151922]">{peso.format(dashboardCollections)}</p>
              <p className="mt-1 text-[10px] text-[#16854f]">For {monthName}</p>
            </button>
          </div>
        </section>
        <section className="overflow-hidden rounded-lg border border-[#e7ebf0] bg-white shadow-[0_1px_2px_rgb(16_24_40_/_3%)]">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-[#151922]">Sales trend</h2>
              <p className="mt-1 text-[11px] text-[#8b92a1]">Invoiced sales and collections in {selectedYear}.</p>
            </div>
            <span className="text-[11px] font-semibold text-[#202124]">{peso.format(dashboardSales)}</span>
          </div>
          <MonthlyPerformanceChart
            data={sharedPerformance}
            primaryLabel="Total sales"
            secondaryLabel="Collections received"
            primaryColor="#1769e8"
            secondaryColor="#16854f"
          />
        </section>
      </div>
      <section className="rounded-lg border border-[#e7ebf0] bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40_/_3%)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[#151922]">Pipeline overview</h2>
              <p className="mt-1 text-[11px] text-[#8b92a1]">Lead progression in {monthName}.</p>
            </div>
            <span className="grid size-8 place-items-center rounded-md bg-[#7043ca] text-white"><UsersRound size={16} /></span>
          </div>
          <div className="mt-5 space-y-3.5">
            {funnel.map((stage) => (
              <button key={stage.label} type="button" onClick={() => go(stage.view)} className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]">
                <span className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-medium text-[#4b5565]">{stage.label}</span>
                  <b className="text-[14px] font-semibold text-[#151922]">{stage.value}</b>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#f0f2f6]">
                  <span className={`block h-full rounded-full ${stage.color} transition-[width]`} style={{ width: `${Math.max(8, Math.round((stage.value / funnelMax) * 100))}%` }} />
                </span>
              </button>
            ))}
          </div>
      </section>
    </div>
  );
}

function Directory({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [tab, setTab] = useState<"customers" | "suppliers" | "employees">(
    "customers",
  );
  const modules: Record<typeof tab, Module> = {
    customers: directory,
    suppliers: {
      ...directory,
      table: "suppliers",
      title: "Suppliers",
      detail: "Vendors linked to materials, stock-ins, and expenses.",
      add: "Add supplier",
      fields: [
        { key: "company_name", label: "Company name", required: true },
        { key: "contact_name", label: "Contact person" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "address", label: "Address", type: "textarea" },
      ],
      columns: [
        {
          label: "Supplier",
          value: (r) => (
            <>
              {stackedCell(r.company_name, r.contact_name)}
            </>
          ),
        },
        { label: "Phone", value: (r) => text(r.phone) },
        {
          label: "Linked materials",
          value: (r, s) =>
            s.inventory_items.filter((item) => item.supplier_id === r.id)
              .length,
        },
        {
          label: "Expense history",
          value: (r, s) =>
            peso.format(
              s.expenses
                .filter(
                  (expense) =>
                    expense.supplier_id === r.id && !expense.archived_at,
                )
                .reduce((sum, expense) => sum + n(expense.amount), 0),
            ),
        },
        {
          label: "Status",
          value: (r) => (
            <Status value={r.is_active === false ? "archived" : "active"} />
          ),
        },
      ],
    },
    employees: {
      ...directory,
      table: "employees",
      title: "Employees",
      detail: "Employee rates, payroll, and leave histories.",
      add: "Add employee",
      fields: [
        { key: "employee_no", label: "Employee number" },
        { key: "full_name", label: "Full name", required: true },
        { key: "role", label: "Department role" },
        { key: "position", label: "Position" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "daily_rate", label: "Daily rate", type: "number" },
        { key: "hire_date", label: "Hire date", type: "date" },
      ],
      columns: [
        {
          label: "Employee",
          value: (r) => (
            <>
              {stackedCell(r.full_name, r.employee_no)}
            </>
          ),
        },
        { label: "Position", value: (r) => text(r.position) },
        { label: "Daily rate", value: (r) => peso.format(n(r.daily_rate)) },
        { label: "Started", value: (r) => day(r.hire_date) },
      ],
    },
  };
  return (
    <div className="space-y-4">
      <div className="app-tabs">
        {(Object.keys(modules) as (typeof tab)[]).map((k) => (
          <button
            type="button"
            onClick={() => setTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className="app-tab capitalize"
            key={k}
          >
            {k}
          </button>
        ))}
      </div>
      <Records
        module={modules[tab]}
        store={store}
        orgId={orgId}
        reload={reload}
        notice={notice}
        role={role}
      />
    </div>
  );
}

function Approvals({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const admin = memberRole(role);
  const [approvalNote, setApprovalNote] = useState<Row | null>(null);
  const decide = async (r: Row, status: "approved" | "rejected") => {
    if (r.resource_type === "quotation") {
      return notice(
            "Review submitted Price Quotations from the Management Approval Center.",
      );
    }
    const client = createClient();
    const { error } = await client
      .rpc("review_approval_request", {
        p_request_id: r.id,
        p_decision: status,
      });
    if (error) return notice(error.message);
    notice("Decision recorded.");
    await reload();
  };
  return (
    <Panel
      title="Approvals & audit"
      detail="Approval requests and activity history."
      action={undefined}
    >
      {store.approval_requests.length ? (
        <Table labels={["Request", "Submitted", "Status", "Decision"]}>
          {store.approval_requests.map((r) => (
            <tr key={text(r.id)}>
              <td className="px-5 py-3">
                <b className="capitalize">
                  {text(r.resource_type).replaceAll("_", " ")}
                </b>
                <small>{day(r.submitted_at)}</small>
              </td>
              <td className="px-5 py-3">{day(r.submitted_at)}</td>
              <td className="px-5 py-3">
                <Status value={r.status} />
              </td>
              <td className="px-5 py-3">
                {admin && r.status === "pending" ? r.resource_type === "quotation" ? (
                  <span className="text-[12px] text-[#687386]">
                    Review in the Management Approval Center
                  </span>
                ) : (
                  <>
                    <ActionIcon
                      label="Approve request"
                      tone="green"
                      onClick={() => void decide(r, "approved")}
                    >
                      <Check size={15} />
                    </ActionIcon>
                    <ActionIcon
                      label="Reject request"
                      tone="red"
                      onClick={() => void decide(r, "rejected")}
                    >
                      <XCircle size={15} />
                    </ActionIcon>
                  </>
                ) : (
                  text(r.decision_note, "").trim() ? (
                    <NoteAction
                      label="View approval decision note"
                      onClick={() => setApprovalNote(r)}
                    />
                  ) : (
                    <span className="text-[11px] text-[#8b92a1]">—</span>
                  )
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No approval requests yet.</Empty>
      )}
      <div className="border-t border-[#e4e8ef] p-5">
        <h3 className="text-[15px] font-semibold">Recent activity</h3>
        {store.activity_log.slice(0, 8).map((a) => (
          <p className="mt-2 text-[12px] text-[#626b7a]" key={text(a.id)}>
            {day(a.created_at)} · <b>{text(a.resource_type)}</b>{" "}
            {text(a.action)}
          </p>
        ))}
      </div>
      <NoteDialog
        open={Boolean(approvalNote)}
        title="Approval decision note"
        context={approvalNote ? text(approvalNote.resource_type, "Approval request").replaceAll("_", " ") : undefined}
        note={text(approvalNote?.decision_note, "")}
        titleId="approval-decision-note-title"
        onClose={() => setApprovalNote(null)}
      />
    </Panel>
  );
}

function CommissionsView({ store, role }: { store: Store; role: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [commissionQuery, setCommissionQuery] = useState("");
  const [commissionMonth, setCommissionMonth] = useState("");
  const [commissionOfficerFilter, setCommissionOfficerFilter] = useState("all");
  const [payoutRow, setPayoutRow] = useState<Row | null>(null);
  const [payoutValues, setPayoutValues] = useState<Record<string, string>>({});
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [payoutError, setPayoutError] = useState("");
  const isGeneralManager = memberRole(role);
  const projectOfficers = useMemo(() => projectOfficerOptions(store), [store]);
  const loadCommissions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const { data, error } = await createClient().rpc("sales_project_officer_commissions");
    if (error) {
      setRows([]);
      setLoadError(error.message);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void loadCommissions();
  }, [loadCommissions]);
  const quoteFor = (row: Row) => store.quotations.find((quote) => quote.id === row.quotation_id);
  const officerName = (row: Row) =>
    text(
      store.profiles.find((profile) => profile.id === row.officer_user_id)?.full_name,
      "Sales staff",
    );
  const normalizedQuery = commissionQuery.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const quotation = quoteFor(row);
    const commissionDate = text(
      row.last_verified_at ?? quotation?.approved_at ?? quotation?.issue_date ?? quotation?.created_at,
      "",
    );
    if (commissionMonth && commissionDate.slice(0, 7) !== commissionMonth) return false;
    if (isGeneralManager && commissionOfficerFilter !== "all" && text(row.officer_user_id, "") !== commissionOfficerFilter) return false;
    if (!normalizedQuery) return true;
    return [
      row.quotation_no,
      row.project_name,
      row.client_name,
      officerName(row),
    ].some((value) => text(value, "").toLowerCase().includes(normalizedQuery));
  });
  const paid = filteredRows.reduce((sum, row) => sum + n(row.paid_amount), 0);
  const earned = filteredRows.reduce((sum, row) => sum + n(row.earned_commission), 0);
  const paidOut = filteredRows.reduce((sum, row) => sum + n(row.paid_out_commission), 0);
  const payable = filteredRows.reduce((sum, row) => sum + n(row.payable_commission), 0);
  const openPayout = (row: Row) => {
    setPayoutError("");
    setPayoutValues({
      amount: n(row.payable_commission).toFixed(2),
      reference_no: "",
      notes: "",
    });
    setPayoutRow(row);
  };
  const savePayout = async () => {
    if (!payoutRow) return;
    const amount = n(payoutValues.amount);
    const payableAmount = n(payoutRow.payable_commission);
    if (amount <= 0) {
      setPayoutError("Enter a payout amount greater than zero.");
      return;
    }
    if (amount > payableAmount) {
      setPayoutError(`Payout cannot exceed the earned unpaid commission of ${peso.format(payableAmount)}.`);
      return;
    }
    setPayoutSaving(true);
    setPayoutError("");
    try {
      const { error } = await createClient().rpc("mark_sales_commission_paid", {
        p_quotation_id: payoutRow.quotation_id,
        p_amount: amount,
        p_reference_no: payoutValues.reference_no.trim() || null,
        p_notes: payoutValues.notes.trim() || null,
      });
      if (error) throw error;
      setPayoutRow(null);
      await loadCommissions();
    } catch (error) {
      setPayoutError(error instanceof Error ? error.message : "Commission payout could not be saved.");
    } finally {
      setPayoutSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <Panel
        title={isProjectOfficerRole(role) ? "My commissions" : "Sales commissions"}
        detail="Commission uses the VAT-exclusive quotation value. It earns from verified client receipts: first PHP 300,000 at 3%, then the balance at 5%."
      >
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[8px] border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[12px]"><p className="text-[#687386]">Verified client payments</p><p className="mt-1 text-[16px] font-semibold text-[#202938]">{peso.format(paid)}</p></div>
          <div className="rounded-[8px] border border-[#b7dfc5] bg-[#f1fbf4] p-3 text-[12px]"><p className="text-[#687386]">Commission earned</p><p className="mt-1 text-[16px] font-semibold text-[#176b40]">{peso.format(earned)}</p></div>
          <div className="rounded-[8px] border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[12px]"><p className="text-[#687386]">Commission paid out</p><p className="mt-1 text-[16px] font-semibold text-[#202938]">{peso.format(paidOut)}</p></div>
          <div className="rounded-[8px] border border-[#f1d294] bg-[#fff8e9] p-3 text-[12px]"><p className="text-[#687386]">Commission payable</p><p className="mt-1 text-[16px] font-semibold text-[#a76605]">{peso.format(payable)}</p></div>
        </div>
        <div className="px-4 sm:px-5">
          <WorkspaceListFilters
            query={commissionQuery}
            onQueryChange={setCommissionQuery}
            queryPlaceholder="Search quotation, client, or staff"
            month={commissionMonth}
            onMonthChange={setCommissionMonth}
            monthLabel="Commission month"
            showOfficer={isGeneralManager}
            officerFilter={commissionOfficerFilter}
            onOfficerChange={setCommissionOfficerFilter}
            officerOptions={projectOfficers}
            onClear={() => {
              setCommissionQuery("");
              setCommissionMonth("");
              setCommissionOfficerFilter("all");
            }}
            hasFilters={Boolean(commissionQuery || commissionMonth || commissionOfficerFilter !== "all")}
          />
        </div>
        {loading ? (
          <Empty>Loading commissions...</Empty>
        ) : loadError ? (
          <Empty>Commission data could not be loaded: {loadError}</Empty>
        ) : filteredRows.length ? (
          <Table
            labels={isGeneralManager
              ? ["Officer", "Quotation", "Client", "Base VAT excl.", "Client paid", "Payment", "Projected", "Earned", "Paid out", "Payable", "Payout", "Actions"]
              : ["Quotation", "Client", "Base VAT excl.", "Client paid", "Payment", "Projected", "Earned", "Paid out", "Payable", "Payout"]}
            minWidth={isGeneralManager ? 1540 : 1220}
          >
            {filteredRows.map((row) => (
              <tr key={text(row.quotation_id)}>
                {isGeneralManager && <td className="px-4 py-3 font-medium">{officerName(row)}</td>}
                <td className="px-4 py-3">{stackedCell(row.quotation_no, row.project_name)}</td>
                <td className="px-4 py-3">{text(row.client_name)}</td>
                <td className="px-4 py-3 text-right">{peso.format(n(row.quoted_amount))}</td>
                <td className="px-4 py-3 text-right">{peso.format(n(row.paid_amount))}</td>
                <td className="px-4 py-3"><Status value={text(row.payment_status)} /></td>
                <td className="px-4 py-3 text-right">{peso.format(n(row.projected_commission))}</td>
                <td className="px-4 py-3 text-right font-semibold text-[var(--color-success)]">{peso.format(n(row.earned_commission))}</td>
                <td className="px-4 py-3 text-right">{peso.format(n(row.paid_out_commission))}</td>
                <td className="px-4 py-3 text-right font-semibold text-[var(--color-success)]">{peso.format(n(row.payable_commission))}</td>
                <td className="px-4 py-3"><Status value={text(row.payout_status)} /></td>
                {isGeneralManager && (
                  <td className="px-4 py-3">
                    <Button
                      tone="green"
                      compact
                      onClick={() => openPayout(row)}
                      disabled={n(row.payable_commission) <= 0}
                    >
                      <PhilippinePeso className="h-3.5 w-3.5" aria-hidden="true" />
                      Pay
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>{rows.length ? "No commissions match the selected filters." : "No approved quotations with commission eligibility yet."}</Empty>
        )}
      </Panel>

      {isGeneralManager && payoutRow && (
        <Dialog
          title="Record commission payout"
          fields={[
            { key: "amount", label: "Payout amount", type: "number", required: true, hint: `Earned unpaid commission: ${peso.format(n(payoutRow.payable_commission))}` },
            { key: "reference_no", label: "Reference number", type: "text", placeholder: "Optional payout reference" },
            { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional payout note" },
          ]}
          values={payoutValues}
          setValues={setPayoutValues}
          save={() => void savePayout()}
          close={() => {
            if (payoutSaving) return;
            setPayoutError("");
            setPayoutRow(null);
          }}
          saving={payoutSaving}
          saveLabel="Record payout"
        >
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            This records company payment to {officerName(payoutRow)}. It does not change the client payment receipt.
          </p>
          {payoutError && <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">{payoutError}</p>}
        </Dialog>
      )}
    </div>
  );
}

function SettingsView({
  store,
  orgId,
  reload,
  notice,
  role,
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
}) {
  const [bankDetailsOpen, setBankDetailsOpen] = useState(false);
  const [defaultBankDetails, setDefaultBankDetails] = useState<BankDetail[]>([]);
  const [savingBankDetails, setSavingBankDetails] = useState(false);
  const [pricingDefaultsOpen, setPricingDefaultsOpen] = useState(false);
  const [pricingDefaults, setPricingDefaults] = useState<Record<string, string>>({});
  const [savingPricingDefaults, setSavingPricingDefaults] = useState(false);
  const [customMarkupOpen, setCustomMarkupOpen] = useState(false);
  const [customMarkupValues, setCustomMarkupValues] = useState<Record<string, string>>({ label: "", value: "" });
  const setting = store.business_settings[0];
  const pricingDefaultEntries = pricingMarkupDefaults(setting?.pricing_markup_defaults, setting);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileValues, setProfileValues] = useState<Record<string, string>>(
    {},
  );
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [projectManagerValues, setProjectManagerValues] = useState<
    Record<string, string>
  >({});
  const [creatingProjectManager, setCreatingProjectManager] = useState(false);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const isSuperAdmin = role === "super_admin";
  useEffect(() => {
    const userIds = store.organization_members
      .map((member) => text(member.user_id, ""))
      .filter(Boolean);
    if (!userIds.length) return;
    void createClient()
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds)
      .then(({ data }) =>
        setStaffNames(
          Object.fromEntries(
            (data ?? []).map((profile) => [
              text(profile.id),
              text(profile.full_name, "Unnamed staff"),
            ]),
          ),
        ),
      );
  }, [store.organization_members]);
  const openProfile = async () => {
    const { data, error } = await createClient()
      .from("organizations")
      .select("name,legal_name,address,phone,email")
      .eq("id", orgId)
      .single();
    if (error) return notice(error.message);
    setProfileValues({
      name: text(data?.name, ""),
      legal_name: text(data?.legal_name, ""),
      address: text(data?.address, ""),
      phone: text(data?.phone, ""),
      email: text(data?.email, ""),
    });
    setProfileOpen(true);
  };
  const saveProfile = async () => {
    const { error } = await createClient()
      .from("organizations")
      .update(profileValues)
      .eq("id", orgId);
    if (error) return notice(error.message);
    setProfileOpen(false);
    notice("Business profile saved.");
  };
  const changeMemberRole = async (userId: string, nextRole: string) => {
    const { error } = await createClient()
      .from("organization_members")
      .update({ role: nextRole })
      .eq("organization_id", orgId)
      .eq("user_id", userId);
    if (error) return notice(error.message);
    notice("Staff role updated.");
    await reload();
  };
  const createProjectManager = async () => {
    setCreatingProjectManager(true);
    const response = await fetch("/api/staff/project-managers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectManagerValues),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    setCreatingProjectManager(false);
    if (!response.ok)
      return notice(
        result.error ?? "Unable to create the Sales Executive account.",
      );
    setProjectManagerOpen(false);
    setProjectManagerValues({});
    notice("Sales Executive account created.");
    await reload();
  };
  const saveDefaultBankDetails = async (
    details = defaultBankDetails,
    closeDialog = true,
  ) => {
    setSavingBankDetails(true);
    const payload = {
      organization_id: orgId,
      default_bank_details: details
        .filter((detail) => detail.bank_name || detail.account_name || detail.account_number)
        .map((detail) => ({ ...detail, visible: detail.visible !== false })),
    };
    const { error } = await createClient()
      .from("business_settings")
      .upsert(payload);
    setSavingBankDetails(false);
    if (error) return notice(error.message);
    if (closeDialog) setBankDetailsOpen(false);
    notice("Default bank details saved.");
    await reload();
  };
  const persistPricingDefaults = async (
    defaults: PricingMarkupDefault[],
    successMessage = "Pricing defaults saved.",
  ) => {
    const invalid = defaults.find((definition) =>
      String(definition.value ?? "").trim() === "" ||
      !Number.isFinite(Number(definition.value)) ||
      n(definition.value) < 0 ||
      n(definition.value) > 100 ||
      (definition.key === "target_profit_margin" && n(definition.value) >= 100) ||
      (definition.custom && !definition.label.trim()),
    );
    if (invalid) {
      notice(`${invalid.label || "Markup"} must use a valid percentage; Target Profit Margin must be below 100%.`);
      return false;
    }
    setSavingPricingDefaults(true);
    const { error } = await createClient().rpc("save_pricing_defaults", {
      p_organization_id: orgId,
      p_defaults: pricingMarkupDefaultPayload(defaults),
    });
    setSavingPricingDefaults(false);
    if (error) {
      notice(error.message);
      return false;
    }
    notice(successMessage);
    await reload();
    return true;
  };
  const savePricingDefaults = async () => {
    const defaults = pricingDefaultEntries.map((definition) => ({
      ...definition,
      calculationType: "percentage" as const,
      value: pricingDefaults[`${definition.key}_value`] ?? definition.value,
    }));
    if (await persistPricingDefaults(defaults)) setPricingDefaultsOpen(false);
  };
  const toggleMarkupVisibility = async (key: PricingMarkupKey) => {
    const next = pricingDefaultEntries.map((definition) =>
      definition.key === key ? { ...definition, visible: definition.visible === false } : definition,
    );
    await persistPricingDefaults(next, "GM markup visibility saved.");
  };
  const addCustomMarkup = async () => {
    const label = text(customMarkupValues.label, "").trim();
    const value = text(customMarkupValues.value, "").trim();
    if (!label) return notice("Enter a name for the custom markup.");
    if (pricingDefaultEntries.some((definition) => definition.label.trim().toLowerCase() === label.toLowerCase())) {
      return notice("A markup with that name already exists.");
    }
    const customMarkup: PricingMarkupDefault = {
      key: `custom_${crypto.randomUUID()}`,
      label,
      calculationType: "percentage",
      value,
      visible: true,
      custom: true,
    };
    if (await persistPricingDefaults([...pricingDefaultEntries, customMarkup], "Custom markup added and included in new quotation computations.")) {
      setCustomMarkupValues({ label: "", value: "" });
      setCustomMarkupOpen(false);
    }
  };
  const toggleBankVisibility = async (index: number) => {
    const next = quotationBankDetails(setting?.default_bank_details).map((detail, detailIndex) =>
      detailIndex === index ? { ...detail, visible: detail.visible === false } : detail,
    );
    setDefaultBankDetails(next);
    await saveDefaultBankDetails(next, false);
  };
  return (
    <div className="space-y-5">
      <AccountProfileDialog open embedded fullWidth role={role} />
      <Panel title="Pricing defaults - Internal" detail="Applied to new internal product costings as percentages. Existing quotations keep their saved pricing. Sales &amp; Pricing Officers can adjust the VAT percentage per quotation." action={memberRole(role) ? <div className="flex flex-wrap justify-end gap-2"><Button secondary onClick={() => { setCustomMarkupValues({ label: "", value: "" }); setCustomMarkupOpen(true); }}><Plus size={14} /> Add markup</Button><Button secondary onClick={() => { setPricingDefaults(Object.fromEntries(pricingDefaultEntries.map((definition) => [`${definition.key}_value`, definition.value]))); setPricingDefaultsOpen(true); }}><Settings size={14} /> Edit pricing defaults</Button></div> : undefined}>
        <Table labels={["Pricing default", "Default percentage", "Visibility in GM review"]}>
          {pricingDefaultEntries.map((definition) => <tr key={definition.key} className={definition.visible === false ? "bg-[#fafbfc] text-[#8b92a1]" : undefined}><td className="px-4 py-3 font-medium">{definition.label}{definition.custom && <span className="ml-2 rounded-full bg-[#f1f4f8] px-2 py-0.5 text-[10px] font-medium text-[#687386]">Custom</span>}</td><td className="px-4 py-3 text-right">{`${n(definition.value)}%`}</td><td className="px-4 py-3 text-right">{definition.key === "vat" ? <span className="text-[11px] text-[#8b92a1]">Not an internal markup</span> : <ActionIcon label={definition.visible === false ? `Show ${definition.label} in GM review` : `Hide ${definition.label} from GM review`} confirm={false} onClick={() => void toggleMarkupVisibility(definition.key)} loading={savingPricingDefaults}><>{definition.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}</></ActionIcon>}</td></tr>)}
        </Table>
      </Panel>
      {pricingDefaultsOpen && <Dialog title="Pricing defaults - Internal" fields={pricingDefaultEntries.map((definition) => ({ key: `${definition.key}_value`, label: definition.label, type: "number" as const, required: true }))} values={pricingDefaults} setValues={setPricingDefaults} save={() => void savePricingDefaults()} close={() => { if (!savingPricingDefaults) setPricingDefaultsOpen(false); }} saving={savingPricingDefaults} saveLabel="Save pricing defaults" className="max-w-lg" compact />}
      {customMarkupOpen && <Dialog title="Add custom markup" fields={[{ key: "label", label: "Markup name", required: true }, { key: "value", label: "Percentage", type: "number" as const, required: true }]} values={customMarkupValues} setValues={setCustomMarkupValues} save={() => void addCustomMarkup()} close={() => { if (!savingPricingDefaults) setCustomMarkupOpen(false); }} saving={savingPricingDefaults} saveLabel="Add markup" className="max-w-lg" compact><p className="mt-3 rounded-lg border border-[#e1e6ee] bg-[#fafbfc] p-3 text-[11px] leading-5 text-[#687386]">This markup will be included in the computed pricing and used as a default for new quotations. Visibility only controls the GM review view.</p></Dialog>}
      <Panel
        title="Default bank details"
        detail="Shown on new Price Quotations."
        action={<Button secondary onClick={() => { setDefaultBankDetails(quotationBankDetails(setting?.default_bank_details)); setBankDetailsOpen(true); }}><Settings size={14} /> Edit bank details</Button>}
      >
        {quotationBankDetails(setting?.default_bank_details).length ? <Table labels={["Bank", "Account name", "Account number", "Visibility in GM review"]}>{quotationBankDetails(setting?.default_bank_details).map((detail, index) => <tr key={`${detail.bank_name}-${detail.account_number}-${index}`} className={detail.visible === false ? "bg-[#fafbfc] text-[#8b92a1]" : undefined}><td className="px-5 py-3 font-medium">{detail.bank_name}</td><td className="px-5 py-3">{detail.account_name}</td><td className="px-5 py-3">{detail.account_number}</td><td className="px-5 py-3 text-right"><ActionIcon label={detail.visible === false ? `Show ${detail.bank_name || "bank details"} in GM review` : `Hide ${detail.bank_name || "bank details"} from GM review`} confirm={false} onClick={() => void toggleBankVisibility(index)} loading={savingBankDetails}>{detail.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}</ActionIcon></td></tr>)}</Table> : <Empty>No default bank details added.</Empty>}
      </Panel>
      <Panel
        title="Business profile"
        detail="Legal business and contact information shown on customer documents."
        action={
          <Button secondary onClick={() => void openProfile()}>
            <Settings size={14} />
            Edit profile
          </Button>
        }
      >
        <div className="p-5 text-[12px] text-[#626b7a]">
          Business identity, address, and contact details are managed here.
        </div>
      </Panel>
      {isSuperAdmin && (
      <Panel
        title="Staff access"
        detail="Each person uses their own account; assign every Sales Executive, Sales & Pricing Officer, and Accountant separately."
      >
        <Table labels={["User", "Role", "Access"]}>
          {store.organization_members.map((m) => (
            <tr key={text(m.user_id)}>
              <td className="px-5 py-3">
                <b>{staffNames[text(m.user_id)] ?? "Loading staff name…"}</b>
                <small>{text(m.user_id)}</small>
              </td>
              <td className="px-5 py-3">
                {memberRole(role) &&
                !["owner", "super_admin"].includes(text(m.role)) ? (
                  <select
                    value={text(m.role)}
                    onChange={(event) =>
                      void changeMemberRole(
                        text(m.user_id, ""),
                        event.target.value,
                      )
                    }
                    className="rounded border border-[#d9e0e9] bg-white p-1.5 text-[11px]"
                  >
                    {[
                      "admin",
                      "project_manager",
                      "sales_pricing_officer",
                      "sales",
                      "production",
                      "warehouse",
                      "accountant",
                      "payroll",
                      "viewer",
                    ].map((item) => (
                      <option key={item} value={item}>
                        {item === "admin"
                          ? "Administrator"
                          : item === "project_manager"
                            ? "Sales Executive"
                            : titleCase(item.replaceAll("_", " "))}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Status
                    value={
                      text(m.role) === "super_admin"
                        ? "Super Admin"
                        : text(m.role) === "owner"
                          ? "Owner / General Manager"
                          : text(m.role) === "sales_pricing_officer"
                              ? "Sales & Pricing Officer"
                              : text(m.role) === "project_manager"
                                ? "Sales Executive"
                              : m.role
                    }
                  />
                )}
              </td>
              <td className="px-5 py-3">
                {text(m.role) === "super_admin"
                  ? "Super Admin access"
                  : text(m.role) === "owner"
                    ? "Owner access"
                    : text(m.role) === "admin"
                      ? "Administrator access"
                      : isProjectOfficerRole(text(m.role))
                        ? "Projects & quotations"
                        : "Scoped access"}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      )}
      {isSuperAdmin && (
        <Panel
          title="Sales Staff Accounts"
          detail="Create the secure sign-in accounts used by Sales Executives and Sales & Pricing Officers."
          action={
            <Button
              onClick={() => {
                setProjectManagerValues({
                  full_name: "",
                  email: "",
                  password: "",
                });
                setProjectManagerOpen(true);
              }}
            >
              <Plus size={14} />
              Create Sales Executive
            </Button>
          }
        >
          {store.organization_members.some(
            (member) => isProjectOfficerRole(text(member.role)),
          ) ? (
            <Table labels={["Sales Staff", "Account Status"]}>
              {store.organization_members
                .filter((member) => isProjectOfficerRole(text(member.role)))
                .map((member) => (
                  <tr key={text(member.user_id)}>
                    <td className="px-5 py-3 font-medium">
                      {staffNames[text(member.user_id)] ??
                        "Loading staff name…"}
                    </td>
                    <td className="px-5 py-3 text-[#218b55]">Active</td>
                  </tr>
                ))}
            </Table>
          ) : (
            <Empty>No Sales Staff accounts have been created yet.</Empty>
          )}
        </Panel>
      )}
      {bankDetailsOpen && (
        <Dialog
          title="Default bank details"
          fields={[]}
          values={{}}
          setValues={() => undefined}
          save={() => void saveDefaultBankDetails()}
          close={() => setBankDetailsOpen(false)}
          saving={savingBankDetails}
          saveLabel="Save bank details"
        >
          <section className="border-t border-[#edf0f5] pt-5">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-[14px] font-semibold text-[#202938]">Bank details</h3><p className="mt-0.5 text-[12px] text-[#687386]">Used for every new Price Quotation.</p></div><Button secondary onClick={() => setDefaultBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "", visible: true }])}><Plus size={13} /> Add bank</Button></div>
            <div className="mt-3 space-y-2">{defaultBankDetails.map((detail, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Default bank ${index + 1} name`} value={detail.bank_name} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bank_name: event.target.value } : item))} placeholder="Bank name" className="input mt-0" /><input aria-label={`Default bank ${index + 1} account name`} value={detail.account_name} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_name: event.target.value } : item))} placeholder="Account name" className="input mt-0" /><input aria-label={`Default bank ${index + 1} account number`} value={detail.account_number} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_number: event.target.value } : item))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label="Remove default bank" onClick={() => setDefaultBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
          </section>
        </Dialog>
      )}
      {projectManagerOpen && (
        <Dialog
          title="Create Sales Executive Account"
          fields={[
            { key: "full_name", label: "Full Name", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            {
              key: "password",
              label: "Temporary Password",
              type: "password",
              required: true,
              hint: "At least 6 characters. Share this securely with the Sales Executive.",
            },
          ]}
          values={projectManagerValues}
          setValues={setProjectManagerValues}
          save={() => void createProjectManager()}
          close={() => setProjectManagerOpen(false)}
          saving={creatingProjectManager}
          saveLabel="Create Sales Executive"
        />
      )}
      {profileOpen && (
        <Dialog
          title="Business profile"
          fields={[
            { key: "name", label: "Business name", required: true },
            { key: "legal_name", label: "Legal name" },
            { key: "address", label: "Business address", type: "textarea" },
            { key: "phone", label: "Contact phone" },
            { key: "email", label: "Email" },
          ]}
          values={profileValues}
          setValues={setProfileValues}
          save={() => void saveProfile()}
          close={() => setProfileOpen(false)}
          saving={false}
        />
      )}
    </div>
  );
}

export function HuswellWorkspace({
  organizationName,
  profileName,
  profileEmail,
  organizationId,
  role,
  initialView,
}: {
  organizationName: string;
  profileName: string;
  profileEmail: string;
  organizationId: string;
  role: string;
  initialView?: View;
}) {
  const defaultWorkspaceView: View = role === "accountant" ? "Finance" : "Dashboard";
  const requestedInitialView: View =
    initialView === "Costing Breakdown"
      ? "Price Quotations"
      : initialView === "Submissions"
        ? "Approvals"
        : initialView ?? defaultWorkspaceView;
  const [active, setActive] = useState<View>(
    isTemporarilyHiddenView(requestedInitialView)
      ? defaultWorkspaceView
      : requestedInitialView,
  );
  const [leadMode, setLeadMode] = useState<LeadWorkspaceMode>("leads");
  const [mobile, setMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [store, setStore] = useState<Store>(blank);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [policyAction, setPolicyAction] = useState<"announcement" | "policy" | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [navigationDate, setNavigationDate] = useState(() => new Date());
  const client = useMemo(() => createClient(), []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const workspaceRefreshTimer = useRef<number | null>(null);
  const tableRequestIds = useRef(new Map<TableName, number>());
  const loadedTables = useRef(new Set<TableName>());
  const initialViewLoaded = useRef(false);
  const pendingRealtimeTables = useRef(new Set<TableName>());
  const canEditOwnProfile = ["owner", "admin", "project_manager", "sales_pricing_officer"].includes(
    role,
  );
  const selectLeadWorkspaceMode = useCallback((mode: LeadWorkspaceMode) => {
    setLeadMode(mode);
    setActive(mode === "quotation" ? "Price Quotations" : "Leads");
  }, []);
  const navigate = useCallback((view: View) => {
    if (isTemporarilyHiddenView(view)) {
      setActive(defaultWorkspaceView);
      return;
    }
    if (view === "Costing Breakdown") return selectLeadWorkspaceMode("quotation");
    if (view === "Submissions") {
      setActive("Approvals");
      return;
    }
    if (view === "Price Quotations") {
      setLeadMode("quotation");
      setActive("Price Quotations");
      return;
    }
    if (view === "Projects") {
      setLeadMode("projects");
      setActive("Projects");
      return;
    }
    if (view === "Leads") setLeadMode("leads");
    setActive(view);
  }, [defaultWorkspaceView, selectLeadWorkspaceMode]);
  const fetchTable = useCallback(
    async (table: TableName) => {
      const childTables: TableName[] = [
        "profiles",
        "quotation_items",
        "invoice_items",
        "payroll_entries",
      ];
      return childTables.includes(table)
        ? client.from(table).select("*").order("created_at", { ascending: false })
        : client
            .from(table)
            .select("*")
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false });
    },
    [client, organizationId],
  );
  const refreshTables = useCallback(async (
    requestedTables: TableName[],
    showLoading = false,
  ) => {
    const tablesToRefresh = [...new Set(requestedTables)].filter((table) =>
      canReadTable(role, table),
    );
    if (!tablesToRefresh.length) {
      if (showLoading) setLoading(false);
      return;
    }
    const requestIds = new Map(
      tablesToRefresh.map((table) => {
        const requestId = (tableRequestIds.current.get(table) ?? 0) + 1;
        tableRequestIds.current.set(table, requestId);
        return [table, requestId];
      }),
    );
    if (showLoading) setLoading(true);
    const results = await Promise.all(
      tablesToRefresh
        .map(async (table) => ({
          table,
          result: await fetchTable(table),
        })),
    );
    const errors = results
      .filter((r) => r.result.error)
      .map((r) => `${r.table}: ${r.result.error?.message}`);
    const freshResults = results.filter(
      (result) =>
        tableRequestIds.current.get(result.table) === requestIds.get(result.table),
    );
    if (!freshResults.length) return;
    setStore((current) => {
      const next = { ...current };
      freshResults.forEach((result) => {
        if (!result.result.error) {
          next[result.table] = (result.result.data ?? []) as Row[];
          loadedTables.current.add(result.table);
        }
      });
      return next;
    });
    if (showLoading) setLoading(false);
    if (errors.length)
      setMessage(
        `Workspace data could not load: ${errors.join(" | ")}`,
      );
  }, [fetchTable, role]);
  const load = useCallback(
    async (showLoading = false) => refreshTables(tables, showLoading),
    [refreshTables],
  );
  const reload = useCallback(() => load(false), [load]);
  useEffect(() => {
    const neededTables = workspaceViewTables(active, leadMode, role).filter(
      (table) => !loadedTables.current.has(table),
    );
    if (!neededTables.length) return;
    const showLoading = !initialViewLoaded.current;
    void refreshTables(neededTables, showLoading).finally(() => {
      initialViewLoaded.current = true;
    });
  }, [active, leadMode, refreshTables, role]);
  useEffect(() => {
    const realtimeTables = tables.filter((table) => canReadTable(role, table));
    if (!realtimeTables.length) return;
    const pendingTables = pendingRealtimeTables.current;

    const refreshWorkspace = (table: TableName) => {
      pendingTables.add(table);
      if (workspaceRefreshTimer.current)
        window.clearTimeout(workspaceRefreshTimer.current);
      workspaceRefreshTimer.current = window.setTimeout(() => {
        workspaceRefreshTimer.current = null;
        const changedTables = [...pendingTables];
        pendingTables.clear();
        void refreshTables(changedTables);
      }, 250);
    };
    const channel = client.channel(`workspace-data:${organizationId}`);
    realtimeTables.forEach((table) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        () => refreshWorkspace(table),
      );
    });
    channel.subscribe();

    return () => {
      if (workspaceRefreshTimer.current) {
        window.clearTimeout(workspaceRefreshTimer.current);
        workspaceRefreshTimer.current = null;
      }
      pendingTables.clear();
      void client.removeChannel(channel);
    };
  }, [client, organizationId, refreshTables, role]);
  useEffect(() => {
    const refreshDate = () => setNavigationDate(new Date());
    refreshDate();
    const interval = window.setInterval(refreshDate, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const allowedViews: Record<string, View[]> = {
    super_admin: [
      "Dashboard",
      "Leads",
      "Projects",
      "Mockups",
      "Price Quotations",
      "Approvals",
      "Finance",
      "Policy",
      "Settings",
    ],
    owner: [
      "Dashboard",
      "Leads",
      "Projects",
      "Mockups",
      "Price Quotations",
      "Approvals",
      "Finance",
      "Policy",
      "Settings",
    ],
    admin: [
      "Dashboard",
      "Leads",
      "Projects",
      "Mockups",
      "Price Quotations",
      "Approvals",
      "Finance",
      "Policy",
      "Settings",
    ],
    project_manager: [
      "Dashboard",
      "Leads",
      "Projects",
      "Mockups",
      "Price Quotations",
      "Policy",
    ],
    sales_pricing_officer: [
      "Dashboard",
      "Leads",
      "Projects",
      "Mockups",
      "Price Quotations",
      "Price Quotation Review",
      "Quotation Costing Overview",
      "Policy",
    ],
    sales: ["Dashboard", "Quotations", "Catalog", "Sales", "Directory", "Policy"],
    warehouse: ["Dashboard", "Catalog", "Inventory", "Production", "Policy"],
    accountant: ["Finance", "Policy"],
    payroll: ["Dashboard", "Payroll & Leave", "Directory", "Policy"],
    production: ["Dashboard", "Production", "Inventory", "Policy"],
    viewer: [
      "Dashboard",
      "Quotations",
      "Production",
      "Catalog",
      "Inventory",
      "Sales",
      "Expenses",
      "Directory",
      "Targets",
      "Policy",
    ],
  };
  const isManagementRole = memberRole(role);
  const pendingManagementApprovalCount = isManagementRole
    ? store.quotations.filter(
        (quotation) =>
          text(quotation.status) === "pending_gm_approval" &&
          text(quotation.document_type) !== "costing_breakdown",
      ).length
      + store.quotations.filter(
        (quotation) => text(quotation.status) === "pending" && text(quotation.document_type) === "costing_breakdown",
      ).length
      + store.price_quotation_revision_requests.filter((request) => text(request.status) === "pending").length
      + store.quotation_revision_requests.filter((request) => text(request.status) === "pending").length
      + store.project_schedules.filter((schedule) => text(schedule.status) === "pending").length
      + store.project_schedule_revision_requests.filter((request) => text(request.status) === "pending").length
      + store.project_schedule_completion_requests.filter((request) => text(request.status) === "pending").length
      + store.project_edit_requests.filter((request) => text(request.status) === "pending").length
      + store.lead_change_requests.filter((request) => text(request.status) === "pending").length
      + store.approval_requests.filter((request) => text(request.status) === "pending" && text(request.resource_type) !== "quotation").length
    : 0;
  const assignedProjectTypes = new Set(
    store.pricing_officer_project_types
      .filter((assignment) => text(assignment.pricing_officer_user_id, "") === currentUserId)
      .map((assignment) => pricingProjectTypeKey(assignment.project_type)),
  );
  const pendingPricingReviewCount = isPricingOfficerRole(role)
    ? store.quotations.filter(
        (quotation) =>
          text(quotation.status) === "pending" &&
          text(quotation.document_type) === "price_quotation" &&
          !quotation.costing_source_id &&
          assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
      ).length
    : 0;
  const pendingMockupReviewCount = isPricingOfficerRole(role)
    ? store.quotations.filter(
        (quotation) =>
          text(quotation.status) === "pending" &&
          text(quotation.document_type) === "mockup_quotation" &&
          assignedProjectTypes.has(pricingProjectTypeKey(quotation.project_types)),
      ).length
    : 0;
  useEffect(() => {
    let active = true;
    void client.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [client]);
  const navBase: {
    label: string;
    items: { view: View; icon: typeof LayoutDashboard; badge?: number }[];
  }[] = isManagementRole ? [
    {
      label: "Management",
      items: [
        { view: "Dashboard", icon: LayoutDashboard },
        { view: "Approvals", icon: ClipboardCheck, badge: pendingManagementApprovalCount },
        { view: "Leads", icon: ClipboardCheck },
      ],
    },
    {
      label: "Operations",
      items: [
        { view: "Price Quotations", icon: FileText },
        { view: "Mockups", icon: ImageIcon },
        { view: "Quotation Costing Overview", icon: ReceiptText },
        { view: "Projects", icon: ClipboardCheck },
      ],
    },
    {
      label: "Business",
      items: [
        { view: "Finance", icon: Wallet },
        { view: "Policy", icon: ScrollText },
        { view: "Settings", icon: Settings },
      ],
    },
  ] : role === "sales_pricing_officer" ? [
    {
      label: "My Work",
      items: [
        { view: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "Sales & Pricing",
      items: [
        { view: "Leads", icon: ClipboardCheck },
        { view: "Price Quotations", icon: FileText },
        { view: "Price Quotation Review", icon: ClipboardCheck, badge: pendingPricingReviewCount + pendingMockupReviewCount },
        { view: "Mockups", icon: ImageIcon },
        { view: "Quotation Costing Overview", icon: ReceiptText },
      ],
    },
    {
      label: "Operations",
      items: [
        { view: "Projects", icon: ClipboardCheck },
      ],
    },
    {
      label: "Business",
      items: [
        { view: "Policy", icon: ScrollText },
      ],
    },
  ] : [
    {
      label: "Project operations",
      items: [
        { view: "Dashboard", icon: LayoutDashboard },
        { view: "Leads", icon: ClipboardCheck },
        { view: "Price Quotations", icon: FileText },
        { view: "Price Quotation Review", icon: ClipboardCheck },
        { view: "Mockups", icon: ImageIcon },
        { view: "Quotation Costing Overview", icon: ReceiptText },
        { view: "Projects", icon: ClipboardCheck },
        { view: "Suppliers & Materials", icon: UsersRound },
      ],
    },
    {
      label: "Finance",
      items: [{ view: "Finance", icon: Wallet }],
    },
    {
      label: "Control",
      items: [
        { view: "Submissions", icon: ClipboardCheck },
        { view: "Settings", icon: Settings },
      ],
    },
    {
      label: "Company",
      items: [{ view: "Policy", icon: ScrollText }],
    },
  ];
  const nav = navBase
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        (allowedViews[role] ?? allowedViews.viewer).includes(item.view),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const pageHeader: Record<View, { title: string; detail: string }> = {
    Dashboard: {
      title: isProjectOfficerRole(role) || role === "admin" ? "KPI Dashboard" : "Dashboard",
      detail:
        isProjectOfficerRole(role)
          ? "Track your lead, quotation, and supplier key performance indicators."
          : "Monitor business performance and current work.",
    },
    Leads: {
      title: isManagementRole ? "Lead management" : leads.title,
      detail: isManagementRole
        ? "Add and assign leads, then review officer-submitted lead changes from the Approval Center."
        : leads.detail,
    },
    Projects: {
      title: isManagementRole ? "Project oversight" : projects.title,
      detail: isManagementRole
        ? "Monitor all project schedules; management decisions are collected in the Approval Center."
        : "Select approved Price and Mockup Quotations, attach signed proof files, and request production.",
    },
    Mockups: {
      title: "Mockup Quotation",
      detail: isManagementRole
        ? "Review Mockup Quotation requests, pricing submissions, and approved documents."
        : "Request Mockup Quotations from approved Price Quotations and track their status.",
    },
    "Quotation Costing Overview": {
      title: "Quotation Costing Overview",
      detail: "Review Price Quotations and Mockup Quotations that you have costed and their current statuses.",
    },
    "Costing Breakdown": {
      title: "Costing Breakdown",
      detail:
        "Build material and production costs, then submit them for General Manager review.",
    },
    "Price Quotations": {
      title:
        role === "sales_pricing_officer"
            ? "Price Quotations"
            : "Price Quotations",
      detail:
        role === "sales_pricing_officer"
            ? "Prepare and manage your Price Quotations from assigned leads."
            : isManagementRole
            ? "View approved and historical quotation records. Management approval actions are collected in the Approval Center."
            : "Prepare quotations from leads, then submit them to the assigned Sales & Pricing Officer.",
    },
    "Price Quotation Review": {
      title: role === "sales_pricing_officer" ? "Quotation Review Queue" : "Price Quotation Review",
      detail: "Review submitted Price Quotations assigned to your project types, then return them or submit their costing for General Manager approval.",
    },
    "Materials List": {
      title: "Materials List",
      detail: "Maintain the material choices used in Price Quotations.",
    },
    "Suppliers & Materials": {
      title: "Suppliers & Materials",
      detail: "Maintain the vendors and materials used for Price Quotations.",
    },
    Suppliers: {
      title: "Suppliers",
      detail: supplierDirectory.detail,
    },
    Quotations: {
      title: "Quotation workflow moved",
      detail:
        "Use Price Quotations to prepare, submit, and manage client quotations.",
    },
    Production: {
      title: "Production jobs",
      detail:
        "Record material usage and delivery progress for approved quotations.",
    },
    Catalog: {
      title: catalog.title,
      detail: catalog.detail,
    },
    Inventory: {
      title: "Inventory",
      detail: "Track stock levels, movements, and finished product stock-ins.",
    },
    Sales: {
      title: "Sales",
      detail: "Manage customer invoices and payment collection.",
    },
    Expenses: {
      title: expenses.title,
      detail: expenses.detail,
    },
    Finance: {
      title: "Finance",
      detail: "Review receivables, payables, and financial performance.",
    },
    "Payroll & Leave": {
      title: "Payroll & Leave",
      detail: "Manage payroll periods, employee entries, and leave requests.",
    },
    Directory: {
      title: "Directory",
      detail: "Maintain your customer, supplier, and staff records.",
    },
    Targets: {
      title: targets.title,
      detail: targets.detail,
    },
    Approvals: {
      title: "Management Approval Center",
      detail: "Review every pending management decision from one queue.",
    },
    "Payment Monitoring": {
      title: "Payment Monitoring",
      detail: "Monitor quotation payment receipts and payment-review exceptions.",
    },
    "Payment Reviews": {
      title: "Payment Reviews",
      detail: "Verify client payment receipts assigned to you before they count as paid.",
    },
    Submissions: {
      title: "Management Approval Center",
      detail: "Review every pending management decision from one queue.",
    },
    Settings: {
      title: "Business settings",
      detail: "Manage business defaults, profile details, and staff access.",
    },
    Commissions: {
      title: isProjectOfficerRole(role) ? "My commissions" : "Sales Executive commissions",
      detail: "Track commission earned from actual customer payments.",
    },
    Policy: {
      title: "Announcements & Policy",
      detail: "Read General Manager announcements and company policy documents.",
    },
    Profile: {
      title: "Profile",
      detail: "Manage your account details.",
    },
  };
  const activePageHeader = pageHeader[active];
  const activeLeadWorkspaceMode: LeadWorkspaceMode =
    active === "Projects"
      ? "projects"
      : active === "Price Quotations"
          ? "quotation"
          : leadMode;
  const content =
    active === "Profile" ? (
      <AccountProfileDialog open embedded role={role} />
    ) : loading ? (
      <Panel
        title={
          active === "Leads" ? leads.title : active === "Projects" ? projects.title : active === "Mockups" ? "Mockup Quotation" : active === "Price Quotation Review" ? "Price Quotation Review" : active === "Approvals" || active === "Submissions" ? "Management Approval Center" : active === "Payment Monitoring" ? "Payment Monitoring" : active === "Payment Reviews" ? "Payment Reviews" : "Loading workspace"
        }
        detail={
          active === "Leads" || active === "Projects" || active === "Mockups" || active === "Price Quotation Review" || active === "Approvals" || active === "Submissions" || active === "Payment Monitoring" || active === "Payment Reviews"
            ? (active === "Projects" ? projects.detail : active === "Mockups" ? "Loading Mockup Quotation workflow." : active === "Price Quotation Review" ? "Loading Price Quotation review queue." : active === "Approvals" || active === "Submissions" ? "Loading management approval queue." : active === "Payment Monitoring" ? "Loading payment monitoring." : active === "Payment Reviews" ? "Loading assigned payment reviews." : leads.detail)
            : "Loading business data."
        }
      >
        <div
          className={
            active === "Leads" || active === "Projects" || active === "Mockups" || active === "Price Quotation Review" || active === "Approvals" || active === "Submissions" || active === "Payment Monitoring" || active === "Payment Reviews" ? "min-h-[280px]" : undefined
          }
        >
          <Empty>Loading records…</Empty>
        </div>
      </Panel>
    ) : active === "Dashboard" ? (
      <Dashboard store={store} go={navigate} role={role} orgId={organizationId} />
    ) : active === "Projects" ? (
      <ProjectCalendar
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Mockups" ? (
      <MockupQuotationWorkspace
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Quotation Costing Overview" ? (
      <QuotationCostingOverview
        store={store}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Price Quotation Review" ? (
      <PriceQuotationSubmissions
        store={store}
        reload={reload}
        notice={setMessage}
      />
    ) : active === "Price Quotations" ? (
        <PriceQuotationWorkspace
          store={store}
          orgId={organizationId}
          reload={reload}
          notice={setMessage}
          role={role}
          profileName={profileName}
        />
    ) : active === "Leads" ? (
        <Records
          module={leads}
          store={store}
          orgId={organizationId}
          reload={reload}
          notice={setMessage}
          role={role}
          leadMode={activeLeadWorkspaceMode}
          onLeadModeChange={selectLeadWorkspaceMode}
        />
    ) : active === "Suppliers & Materials" ? (
      <SupplierMaterials
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Quotations" ? (
      <Panel
        title="Quotation workflow moved"
        detail="Use Price Quotations to prepare, submit, and manage client quotations."
      >
        <Empty>Use Price Quotations to follow the current workflow.</Empty>
      </Panel>
    ) : active === "Production" ? (
      <Production
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Catalog" ? (
      <Records
        module={catalog}
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Inventory" ? (
      <Inventory
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Sales" ? (
      <Sales
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Expenses" ? (
      <Records
        module={expenses}
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Finance" ? (
      <FinanceReports
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Payroll & Leave" ? (
      <PayrollLeave
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Directory" ? (
      <Directory
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Targets" ? (
      <Records
        module={targets}
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    ) : active === "Approvals" || active === "Submissions" ? (
      <Submissions
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
      />
    ) : active === "Payment Monitoring" ? (
      <PaymentMonitoring
        store={store}
        orgId={organizationId}
        reload={reload}
        role={role}
      />
    ) : active === "Payment Reviews" ? (
      <PaymentMonitoring
        store={store}
        orgId={organizationId}
        reload={reload}
        role={role}
        assignedOnly
      />
    ) : active === "Policy" ? (
      <PolicyView
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
        policyAction={policyAction}
        onPolicyActionHandled={() => setPolicyAction(null)}
      />
    ) : active === "Commissions" ? (
      <CommissionsView store={store} role={role} />
    ) : (
      <SettingsView
        store={store}
        orgId={organizationId}
        reload={reload}
        notice={setMessage}
        role={role}
      />
    );
  return (
    <div className={`huswell-workspace compact-ui min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside
        className={`${mobile ? "translate-x-0" : "-translate-x-full"} sidebar-shell fixed inset-y-0 z-40 flex w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text-secondary)] transition-[transform,width,padding] lg:translate-x-0 ${sidebarCollapsed ? "lg:w-[72px] lg:px-2" : "lg:w-64"}`}
      >
        <button
          type="button"
          className="absolute -right-4 top-5 hidden size-8 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-none transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] lg:grid"
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>
        <div className="mb-4 flex items-center justify-between px-1">
          <div className="flex min-w-0 flex-1 justify-center">
            <Image
              src="https://huswelltrading.com/favicon.ico"
              alt="Huswell Trading"
              width={36}
              height={36}
              className={`hidden size-9 rounded-full ${sidebarCollapsed ? "lg:block" : ""}`}
            />
            <Image
              src="https://www.huswelltrading.com/logo/huswell-logo.png"
              alt="Huswell Trading"
              width={112}
              height={52}
              priority
              className={`huswell-sidebar-logo h-auto w-24 ${sidebarCollapsed ? "lg:hidden" : ""}`}
            />
          </div>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] lg:hidden"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-scroll flex-1 space-y-px overflow-y-auto">
          {nav.map((group) => (
            <div key={group.label}>
              <div className="space-y-px">
                {group.items.map(({ view, icon: Icon, badge }) => {
                  const navigationLabel =
                    view === "Dashboard" && (isProjectOfficerRole(role) || role === "admin")
                      ? "KPI"
                      : view === "Policy"
                        ? "Announcements & Policy"
                      : isManagementRole && view === "Leads"
                          ? "Generated Leads"
                      : view === "Projects"
                            ? "Production"
                            : view === "Mockups"
                              ? "Mockup Quotation"
                              : role === "sales_pricing_officer" && view === "Price Quotation Review"
                              ? "Quotation Review Queue"
                            : isManagementRole && view === "Price Quotations"
                              ? "Price Quotations"
                              : view === "Approvals"
                                ? "Approval Center"
                                : view === "Payment Monitoring"
                                  ? "Payment Monitoring"
                                : view === "Payment Reviews"
                                  ? "Payment Reviews"
                                : view;
                  return (
                    <button
                    key={view}
                    onClick={() => {
                      navigate(view);
                      setMobile(false);
                    }}
                    title={navigationLabel}
                    aria-label={navigationLabel}
                    style={{
                      fontSize: "var(--font-size-body)",
                      lineHeight: "var(--line-height-body)",
                    }}
                    aria-current={active === view ? "page" : undefined}
                    className={`${active === view ? "bg-[var(--color-accent)] font-medium text-[var(--color-on-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]"} sidebar-item group flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-1 text-left text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""}`}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={`${active === view ? "text-[var(--color-on-accent)]" : "text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-tertiary)]"} shrink-0 transition-colors`}
                    />
                    <span className={`min-w-0 flex-1 truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>{navigationLabel}</span>
                    {badge ? <span className={`sidebar-badge min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ${active === view ? "bg-white text-[var(--color-accent-text)]" : "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"}`}>{badge > 99 ? "99+" : badge}</span> : null}
                  </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          {canEditOwnProfile && !isManagementRole && (
            <a
              href="/profile"
              className={`sidebar-item mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-1.5 text-left text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""}`}
            >
              <UserRound size={16} strokeWidth={1.75} />
              <span className={sidebarCollapsed ? "lg:sr-only" : ""}>Profile</span>
            </a>
          )}
          <button
            onClick={() => setSignOutOpen(true)}
            className={`sidebar-item mt-3 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-1.5 text-left text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""}`}
          >
            <LogOut size={16} strokeWidth={1.75} />
            <span className={sidebarCollapsed ? "lg:sr-only" : ""}>Sign out</span>
          </button>
        </div>
      </aside>
      {signOutOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)] p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-none"
          >
            <h2 id="sign-out-title" className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Sign out?
            </h2>
            <p className="mt-1.5 text-[13px] text-[var(--color-text-secondary)]">
              You will be returned to the sign-in page.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                secondary
                disabled={signingOut}
                onClick={() => setSignOutOpen(false)}
              >
                Cancel
              </Button>
              <Button
                loading={signingOut}
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  const { error } = await client.auth.signOut();
                  if (error) {
                    setMessage(error.message);
                    setSigningOut(false);
                    return;
                  }
                  window.location.assign("/auth");
                }}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </section>
        </div>
      )}
      {mobile && (
        <button
          className="fixed inset-0 z-20 bg-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] lg:hidden"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <main className={`min-h-screen bg-[var(--color-bg)] transition-[padding] ${sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-30 flex min-h-[60px] items-center justify-between gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 sm:min-h-[64px] sm:px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] lg:hidden"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={16} strokeWidth={1.75} />
            </button>
            {active === "Policy" && role === "admin" && (
              <div className="flex min-w-0 items-center gap-1.5">
                <Button compact onClick={() => setPolicyAction("announcement")}>
                  <Plus size={13} /> <span className="hidden sm:inline">Add Announcement</span><span className="sm:hidden">Announcement</span>
                </Button>
                <Button compact onClick={() => setPolicyAction("policy")}>
                  <Plus size={13} /> Add Policy
                </Button>
              </div>
            )}
            <span className="sr-only">{activePageHeader.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[var(--color-text-secondary)]">
            <span className="hidden items-center gap-1.5 text-[11px] font-medium sm:flex">
              <CalendarDays size={16} strokeWidth={1.75} />
              {new Intl.DateTimeFormat("en-PH", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }).format(navigationDate)}
            </span>
            <span className="max-w-[150px] truncate text-[11px] font-medium sm:max-w-[220px]">
              {workspaceAccountLabel(role)}
            </span>
            {canEditOwnProfile && isManagementRole ? (
              <button
                type="button"
                onClick={() => navigate("Settings")}
                aria-label="Open settings"
                className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:border-[var(--color-border-strong)]"
              >
                {profileName.slice(0, 2).toUpperCase()}
              </button>
            ) : canEditOwnProfile ? (
              <a
                href="/profile"
                aria-label="Edit profile"
                className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:border-[var(--color-border-strong)]"
              >
                {profileName.slice(0, 2).toUpperCase()}
              </a>
            ) : (
              <span className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[11px] font-medium text-[var(--color-accent-text)]">
                {profileName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </header>
        <div className={`workspace-content ${(["Projects", "Price Quotations", "Price Quotation Review", "Approvals", "Payment Monitoring", "Payment Reviews"].includes(active) || active === "Policy") ? "p-0" : "p-2 sm:p-3 lg:p-4"}`}>
          {message && (
            <div className="fixed inset-0 z-[999] grid place-items-center bg-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)] p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="notification-title"
                className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-none"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2
                      id="notification-title"
                      className="text-[16px] font-semibold text-[var(--color-text-primary)]"
                    >
                      Notification
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
                      {message}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMessage(null)}
                    aria-label="Close notification"
                    className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
                  >
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => setMessage(null)}>Okay</Button>
                </div>
              </section>
            </div>
          )}
          {content}
        </div>
      </main>
    </div>
  );
}
