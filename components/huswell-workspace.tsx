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
  CircleDollarSign,
  Eye,
  EyeOff,
  FileText,
  Goal,
  ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
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
import { LoadingModal } from "@/components/loading-modal";

PdfFont.register({
  family: "SF Pro Display",
  fonts: [
    { src: "/font/SFPRODISPLAYREGULAR.OTF", fontWeight: 400 },
    { src: "/font/SFPRODISPLAYMEDIUM.OTF", fontWeight: 500 },
    { src: "/font/SFPRODISPLAYBOLD.OTF", fontWeight: 700 },
  ],
});

type View =
  | "Dashboard"
  | "Leads"
  | "Projects"
  | "Costing Breakdown"
  | "Price Quotations"
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
  | "Submissions"
  | "Settings"
  | "Profile";
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
  | "activity_log"
  | "leads"
  | "supplier_payables"
  | "organization_members";
type Row = { id?: string; [key: string]: unknown };
type Store = Record<TableName, Row[]>;
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
const n = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value: unknown, fallback = "—") =>
  value === null || value === undefined || value === ""
    ? fallback
    : String(value);
const titleCase = (value: string) =>
  value.replace(
    /(^|[^A-Za-z])([a-z])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );
const titleCaseEntry = (value: string, key = "") =>
  /(?:email|url|phone|tin|sku|(?:^|_)no$|number|password|id)/i.test(key)
    ? value
    : titleCase(value);
const leadClientLabel = (lead: Row) => {
  const clientName = text(lead.contact_name, "").trim();
  const companyName = text(lead.client_name, "").trim();
  if (clientName && companyName) return `${clientName} - ${companyName}`;
  return clientName || companyName || "Client";
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
const ref = (prefix: string) =>
  `${prefix}-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
const DEFAULT_QUOTATION_TERMS = [
  "Production Lead Time: 2-4 weeks upon receipt of the approved artwork and downpayment.",
  "Prices: All prices quoted are VAT INCLUSIVE.",
  "Delivery: Pickup or delivery via a third-party courier. Delivery charges shall be shouldered by the client.",
  "Payment Terms: 50% downpayment is required upon approval of the quotation. The remaining 50% balance must be paid prior to release or delivery.",
  "Validity: This quotation is valid for 7 days from the date of issuance.",
  "Cancellations: Orders cannot be cancelled once production has started",
  "Artwork Revisions: Any revisions or changes requested after the artwork has been approved may result in an adjustment of the production lead time. The revised delivery schedule will be based on the scope and timing of the requested changes.",
].join("\n");

type BankDetail = {
  bank_name: string;
  account_name: string;
  account_number: string;
};

const DEFAULT_QUOTATION_BANK_DETAILS: BankDetail[] = [
  { bank_name: "Chinabank", account_name: "Huswell Trading", account_number: "133300003109" },
  { bank_name: "Unionbank", account_name: "Huswell Trading", account_number: "002300008069" },
];

const quotationBankDetails = (value: unknown): BankDetail[] => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }
  }
  if (parsed === null || parsed === undefined) return DEFAULT_QUOTATION_BANK_DETAILS;
  if (!Array.isArray(parsed)) return DEFAULT_QUOTATION_BANK_DETAILS;
  return parsed.map((detail) => ({
    bank_name: text((detail as Record<string, unknown>)?.bank_name, ""),
    account_name: text((detail as Record<string, unknown>)?.account_name, ""),
    account_number: text((detail as Record<string, unknown>)?.account_number, ""),
  })).filter((detail) => detail.bank_name || detail.account_name || detail.account_number);
};
const statusStyle = (value: unknown) => {
  const v = text(value, "draft").toLowerCase();
  return v.includes("paid") ||
    v.includes("approved") ||
    v.includes("completed") ||
    v.includes("delivered")
    ? "bg-[#edf9f2] text-[#218b55]"
    : v.includes("rejected") || v.includes("cancelled") || v.includes("void")
      ? "bg-[#fef3f2] text-[#b42318]"
      : v.includes("pending") || v.includes("partial") || v.includes("review")
        ? "bg-[#fff8e9] text-[#a76605]"
        : "bg-[#f1f4f8] text-[#626b7a]";
};
const Status = ({ value }: { value: unknown }) => (
  <span
    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusStyle(value)}`}
  >
    {text(value, "draft").replaceAll("_", " ")}
  </span>
);
const evaluationStatuses = [
  "1|New Client",
  "2|Repeat Client",
  "3|Follow-Up Due",
  "4|Qualified Lead",
  "5|Quotation Sent",
  "6|Negotiation Stage",
  "7|Done Deal",
  "8|Lost Sale",
  "9|Last Contact Date",
] as const;
const doneDealStatuses = [
  "1|Layout & Design",
  "2|Materials Buying",
  "3|Mock Up",
  "4|Ongoing Mass Production",
  "5|Quality Control",
  "6|Repacking",
  "7|Invoicing",
  "8|Delivery",
  "9|After Sales",
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
};
const canAccess = (role: string, resource: string, action: AccessAction) =>
  memberRole(role) ||
  (rolePermissions[role]?.[action] ?? []).includes(resource);
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
    "project_edit_requests",
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
  ],
  warehouse: [
    "customers",
    "employees",
    "inventory_items",
    "inventory_movements",
    "production_jobs",
    "production_material_usage",
    "production_job_activity",
    "finished_product_stock_ins",
  ],
  accountant: [
    "customers",
    "suppliers",
    "employees",
    "inventory_items",
    "invoices",
    "invoice_items",
    "payments",
    "expenses",
    "cash_flow_entries",
    "supplier_payables",
  ],
  payroll: [
    "employees",
    "payroll_periods",
    "payroll_entries",
    "leave_requests",
  ],
  production: [
    "customers",
    "employees",
    "inventory_items",
    "inventory_movements",
    "production_jobs",
    "production_material_usage",
    "production_job_activity",
    "finished_product_stock_ins",
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
  ],
};
const canReadTable = (role: string, table: TableName) =>
  memberRole(role) ||
  (roleReadableTables[role] ?? roleReadableTables.viewer).includes(table);

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
      value: (r) => (
        <>
          <b>{text(r.company_name)}</b>
          <small>{text(r.contact_name)}</small>
        </>
      ),
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
const leads: Module = {
  table: "leads",
  title: "Leads",
  detail:
    "Register outbound client contacts using the same fields as the outbound tracker.",
  add: "Add lead / project",
  fields: [
    { key: "date_sent", label: "Date sent", type: "date" },
    { key: "contact_name", label: "Client name", required: true },
    { key: "client_name", label: "Company Name (Optional)" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Viber" },
    { key: "date_contacted", label: "Date contacted", type: "date" },
    {
      key: "contact_method",
      label: "Outbound method",
      type: "select",
      options: ["Viber", "WhatsApp", "Messenger", "Phone Call", "Email"],
    },
    {
      key: "evaluation_number",
      label: "Evaluation status",
      type: "select",
      required: true,
      options: [...evaluationStatuses],
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
      value: (r) => (
        <>
          <b>{text(r.project_name)}</b>
          <small>
            {text(r.lead_no)} · {text(r.client_name)}
          </small>
        </>
      ),
    },
    { label: "Contact", value: (r) => text(r.contact_name, "—") },
    { label: "Company name", value: (r) => text(r.client_name, "—") },
    { label: "Email", value: (r) => text(r.email, "—") },
    { label: "Contact number", value: (r) => text(r.phone, "—") },
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
    { label: "Date sent", value: (r) => day(r.date_sent) },
    {
      label: "Evaluation status",
      value: (r) => evaluationLabel(r.evaluation_number),
    },
  ],
};
const supplierDirectory: Module = {
  table: "suppliers",
  title: "Suppliers",
  detail: "Maintain the vendors used for materials, costing, and quotations.",
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
          <b>{text(r.company_name)}</b>
          <small>{text(r.contact_name)}</small>
        </>
      ),
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
      value: (r, s) => (
        <>
          <b>{text(r.payable_no)}</b>
          <small>
            {text(
              s.suppliers.find((supplier) => supplier.id === r.supplier_id)
                ?.company_name,
            )}
          </small>
        </>
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
      value: (r) => (
        <>
          <b>{text(r.name)}</b>
          <small>{text(r.sku)}</small>
        </>
      ),
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
      value: (r) => (
        <>
          <b>{text(r.name)}</b>
          <small>{text(r.sku)}</small>
        </>
      ),
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
      value: (r) => (
        <>
          <b>{text(r.description)}</b>
          <small>{text(r.entry_type).replaceAll("_", " ")}</small>
        </>
      ),
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
  confirm = false,
  confirmationText,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  tone?: "blue" | "green";
  compact?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
        onClick={trigger}
        style={{ fontSize: "14px", lineHeight: "20px" }}
        className={`${secondary ? "border border-[#cfd8e3] bg-white text-[#151922] hover:bg-[#f5f7fa]" : tone === "green" ? "bg-[#218b55] text-white hover:bg-[#176d42]" : "bg-[#c43b43] text-white hover:bg-[#ab3038]"} inline-flex ${compact ? "min-h-7 py-0.5" : "min-h-9"} items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50`}
      >
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
      className="fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        className="w-full max-w-sm rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"
      >
        <h2
          id="confirmation-title"
          className="text-[16px] font-semibold text-[#202938]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[#626b7a]">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button secondary onClick={onCancel}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-9 items-center rounded-lg bg-[#c43b43] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#ab3038]"
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
  tone = "primary",
  confirm = true,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "green" | "amber" | "red";
  confirm?: boolean;
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
          disabled={disabled}
          aria-label={label}
          className={`disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]}`}
        >
          {children}
        </button>
      </FixedIconTooltip>
      {confirm && <ConfirmationDialog
        open={confirmOpen}
        title="Confirm action"
        description={`Are you sure you want to ${label.charAt(0).toLowerCase()}${label.slice(1)}?`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onClick();
        }}
      />}
    </>
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
  bankTable: { width: 340, alignSelf: "center", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#111", marginTop: 5, marginBottom: 5 },
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

function PriceQuotationPdf({ quote, store, origin }: { quote: Row; store: Store; origin: string }) {
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const totalAmount = n(quote.total_amount);
  const totalCost = n(quote.total_cost);
  const issueDate = quote.issue_date ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${quote.issue_date}T00:00:00`)) : "—";
  const terms = text(quote.terms_conditions, DEFAULT_QUOTATION_TERMS).split(/\r?\n+/).map((item) => item.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean);
  const bankDetails = quotationBankDetails(quote.bank_details);
  const paymentTermIndex = terms.findIndex((term) => /^payment terms:/i.test(term));
  const termsBeforeBank = paymentTermIndex < 0 ? terms : terms.slice(0, paymentTermIndex + 1);
  const termsAfterBank = paymentTermIndex < 0 ? [] : terms.slice(paymentTermIndex + 1);
  const currency = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
  const approvedByName = text(quote.approved_by_name, "Marvin S. Tavarez");
  const approvedBySignature = text(quote.approved_by_signature_url, "") || (quote.approved_by_name ? undefined : `${origin}/marvin-tavarez-signature.png`);
  const approvedByRole = quote.approved_by_name ? "General Manager" : "Proprietor";
  return <PdfDocument title={`Price Quotation ${text(quote.quotation_no)}`}>
    <PdfPage size={[612, 936]} style={generatedPdfStyles.page}>
      <PdfView style={generatedPdfStyles.header}>
        <PdfView><PdfImage src={`${origin}/huswell-quotation-logo.png`} style={generatedPdfStyles.logo} /><PdfText>72 Adrian St. North Fairview Park Subd.</PdfText><PdfText>Brgy. North Fairview, Quezon City</PdfText><PdfText>09171697153</PdfText><PdfText>saleshuswell@gmail.com</PdfText></PdfView>
        <PdfView style={generatedPdfStyles.quotationHeader}><PdfText style={generatedPdfStyles.quotationTitle}>PRICE QUOTATION</PdfText><PdfView style={generatedPdfStyles.quotationDetails}><PdfText style={generatedPdfStyles.quotationDetail}>Quotation No.: {text(quote.quotation_no)}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Quotation Date: {issueDate}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Prepared For: {text(customer?.company_name ?? lead?.client_name ?? quote.client_name, "—")}</PdfText><PdfText style={generatedPdfStyles.quotationDetail}>Attention: {text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name, "—")}</PdfText></PdfView></PdfView>
      </PdfView>
      <PdfText style={generatedPdfStyles.sectionTitle}>OPTION 1</PdfText>
      <PdfView style={generatedPdfStyles.table} wrap>
        <PdfView style={generatedPdfStyles.row}><PdfCell width="19%" header>ITEM</PdfCell><PdfCell width="36%" header>DESCRIPTION</PdfCell><PdfCell width="14%" header>QUANTITY</PdfCell><PdfCell width="17%" header>SELLING PRICE / UNIT</PdfCell><PdfCell width="14%" header>AMOUNT</PdfCell></PdfView>
        {lines.map((line, index) => { const quantity = n(line.quantity); const amount = quantity && totalCost ? Math.round(quantity * n(line.unit_cost) * (totalAmount / totalCost) * 100) / 100 : n(line.line_total); const imageUrl = text(line.image_url, ""); const source = imageUrl.startsWith("/") ? `${origin}${imageUrl}` : imageUrl; return <PdfView key={text(line.id, String(index))} style={generatedPdfStyles.row} wrap={false}><PdfCell width="19%">{source ? <PdfImage src={source} style={{ width: "100%", height: 54, objectFit: "contain" }} /> : <PdfText>{index + 1}</PdfText>}</PdfCell><PdfCell width="36%" description><PdfText style={{ fontWeight: 700 }}>{text(line.description).split(/\r?\n/)[0]}</PdfText><PdfText>{text(line.details, "") || text(line.description).split(/\r?\n/).slice(1).join("\n")}</PdfText></PdfCell><PdfCell width="14%">{`${quantity} ${quantity === 1 ? "pc" : "pcs"}`}</PdfCell><PdfCell width="17%">{currency(quantity ? amount / quantity : 0)}</PdfCell><PdfCell width="14%">{currency(amount)}</PdfCell></PdfView>; })}
        <PdfView style={generatedPdfStyles.row}><PdfCell width="86%" total>TOTAL ESTIMATED COGS</PdfCell><PdfCell width="14%" total>{currency(totalAmount)}</PdfCell></PdfView>
      </PdfView>
      <PdfText style={generatedPdfStyles.sectionTitle}>TERMS AND CONDITIONS</PdfText>
      <PdfText style={generatedPdfStyles.terms}>{termsBeforeBank.map((term, index) => `${index + 1}. ${term}`).join("\n")}</PdfText>
      <PdfBankDetails details={bankDetails} />
      {termsAfterBank.length > 0 && <PdfText style={generatedPdfStyles.terms}>{termsAfterBank.map((term, index) => `${index + termsBeforeBank.length + 1}. ${term}`).join("\n")}</PdfText>}
      <PdfView style={generatedPdfStyles.signatureRow}><PdfSignatureBlock label="Prepared by:" name={text(quote.representative)} role="Sales Project Officer" signatureSource={text(quote.prepared_by_signature_url, "") || undefined} /><PdfSignatureBlock label="Approved by:" name={approvedByName} role={approvedByRole} signatureSource={approvedBySignature} /></PdfView>
    </PdfPage>
  </PdfDocument>;
}

function CostingBreakdownPdf({ quote, store, origin }: { quote: Row; store: Store; origin: string }) {
  const lines = store.quotation_items.filter((item) => item.quotation_id === quote.id);
  const customer = store.customers.find((item) => item.id === quote.customer_id);
  const lead = store.leads.find((item) => item.id === quote.lead_id);
  const cogs = n(quote.total_cost); const sellingExVat = cogs + cogs * n(quote.profit_margin_rate) / 100 + cogs * n(quote.overhead_rate) / 100 + cogs * n(quote.buffer_margin_rate) / 100 + cogs * n(quote.commission_rate) / 100; const currency = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
  const approvedByName = text(quote.approved_by_name, "Marvin S. Tavarez");
  const approvedBySignature = text(quote.approved_by_signature_url, "") || (quote.approved_by_name ? undefined : `${origin}/marvin-tavarez-signature.png`);
  const approvedByRole = quote.approved_by_name ? "General Manager" : "Proprietor";
  return <PdfDocument title={`Costing Breakdown ${text(quote.quotation_no)}`}><PdfPage size={[612, 936]} style={generatedPdfStyles.page}>
    <PdfView style={{ alignItems: "center" }}><PdfImage src={`${origin}/huswell-quotation-logo.png`} style={generatedPdfStyles.logo} /><PdfText style={generatedPdfStyles.title}>COSTING BREAKDOWN / PRICE QUOTE</PdfText></PdfView>
    <PdfText style={generatedPdfStyles.sectionTitle}>CLIENT INFORMATION</PdfText>
    {[["Company Name", text(customer?.company_name ?? lead?.client_name ?? quote.client_name)], ["Client Name", text(customer?.contact_name ?? lead?.contact_name ?? quote.client_contact_name)], ["Phone / Email", text(quote.client_phone)], ["Date", day(quote.issue_date)]].map(([label, value]) => <PdfView key={label} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{label}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{value}</PdfText></PdfView>)}
    <PdfText style={generatedPdfStyles.sectionTitle}>DETAILS</PdfText>
    {[["Size", text(quote.size_details)], ["Quantity", text(quote.project_quantity)], ["Project Type", text(quote.project_types)], ["Delivery Date", day(quote.delivery_date)]].map(([label, value]) => <PdfView key={label} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{label}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{value}</PdfText></PdfView>)}
    <PdfView style={[generatedPdfStyles.table, { marginTop: 15 }]}><PdfView style={generatedPdfStyles.row}><PdfCell width="52%" header>Materials and Production</PdfCell><PdfCell width="14%" header>Quantity</PdfCell><PdfCell width="17%" header>Unit Cost</PdfCell><PdfCell width="17%" header>Subtotal</PdfCell></PdfView>{lines.map((line, index) => <PdfView key={text(line.id, String(index))} style={generatedPdfStyles.row} wrap={false}><PdfCell width="52%">{text(line.description)}</PdfCell><PdfCell width="14%">{n(line.quantity)}</PdfCell><PdfCell width="17%">{currency(n(line.unit_cost))}</PdfCell><PdfCell width="17%">{currency(n(line.line_total))}</PdfCell></PdfView>)}<PdfView style={generatedPdfStyles.row}><PdfCell width="83%" total>TOTAL ESTIMATED COGS</PdfCell><PdfCell width="17%" total>{currency(cogs)}</PdfCell></PdfView></PdfView>
    <PdfText style={generatedPdfStyles.sectionTitle}>MARKUP, VAT, EXPENSES</PdfText>
    {[["Declared Markup", cogs * n(quote.profit_margin_rate) / 100], ["Overhead Allocation", cogs * n(quote.overhead_rate) / 100], ["Buffer Margin", cogs * n(quote.buffer_margin_rate) / 100], ["Production Commission", cogs * n(quote.commission_rate) / 100], ["VAT", n(quote.vat_amount)], ["SELLING PRICE VAT EX.", sellingExVat], ["SELLING PRICE VAT INC.", n(quote.total_amount)]].map(([label, value]) => <PdfView key={String(label)} style={generatedPdfStyles.infoRow}><PdfText style={generatedPdfStyles.infoLabel}>{String(label)}:</PdfText><PdfText style={generatedPdfStyles.infoValue}>{currency(Number(value))}</PdfText></PdfView>)}
    <PdfView style={generatedPdfStyles.signatureRow}><PdfSignatureBlock label="Prepared by:" name={text(quote.representative)} role="Sales Project Officer" signatureSource={text(quote.prepared_by_signature_url, "") || undefined} /><PdfSignatureBlock label="Approved by:" name={approvedByName} role={approvedByRole} signatureSource={approvedBySignature} /></PdfView>
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
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  children: ReactNode;
  variant?: "card" | "page";
}) {
  return (
    <section
      className={
        variant === "page"
          ? "min-h-full overflow-hidden bg-white"
          : "overflow-hidden rounded-[14px] border border-[#dfe5ed] bg-white"
      }
    >
      <header
        className={`flex flex-wrap items-start justify-between gap-3 ${variant === "page" ? "border-b border-[#e9edf2] px-4 py-3 sm:px-6 lg:px-7" : "p-4 sm:p-5"}`}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p
            className={`${variant === "page" ? "mt-0.5" : "mt-1"} text-[12px] text-[#8b92a1]`}
          >
            {detail}
          </p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-[#e4e8ef] px-5 py-12 text-center text-[13px] text-[#8b92a1]">
      {children}
    </div>
  );
}
function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return (
    <div className="min-w-28">
      <div className="mb-1 flex justify-between text-[11px] text-[#626b7a]">
        <span>{value.toLocaleString()}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#edf0f5]">
        <div className="h-full bg-[#1769e8]" style={{ width: `${pct}%` }} />
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
}: {
  data: MonthlyPerformancePoint[];
}) {
  const max = Math.max(
    1,
    ...data.flatMap((point) => [point.revenue, point.expense]),
  );
  const compact = new Intl.NumberFormat("en-PH", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const chartHeight = 150;
  const baseline = 178;
  const left = 42;
  const plotWidth = 654;
  const slot = plotWidth / data.length;
  const barWidth = Math.max(4, Math.min(16, (slot - 8) / 2));

  return (
    <div className="px-5 pb-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#626b7a]">
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-sm bg-[#1769e8]" /> Invoiced revenue
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-sm bg-[#f0a348]" /> Recorded expenses
        </span>
      </div>
      <svg
        viewBox="0 0 720 218"
        className="h-auto w-full"
        role="img"
        aria-label="Monthly invoiced revenue and recorded expenses"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = baseline - chartHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={left} x2="704" y1={y} y2={y} stroke="#edf0f5" />
              <text x="0" y={y + 4} fill="#8b92a1" fontSize="10">
                {compact.format(max * ratio)}
              </text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const center = left + slot * index + slot / 2;
          const revenueHeight = (point.revenue / max) * chartHeight;
          const expenseHeight = (point.expense / max) * chartHeight;
          return (
            <g key={point.label}>
              <title>{`${point.label}: ${peso.format(point.revenue)} invoiced revenue, ${peso.format(point.expense)} expenses`}</title>
              <rect
                x={center - barWidth - 2}
                y={baseline - revenueHeight}
                width={barWidth}
                height={revenueHeight}
                rx="2"
                fill="#1769e8"
              />
              <rect
                x={center + 2}
                y={baseline - expenseHeight}
                width={barWidth}
                height={expenseHeight}
                rx="2"
                fill="#f0a348"
              />
              <text
                x={center}
                y="202"
                textAnchor="middle"
                fill="#8b92a1"
                fontSize="10"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
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
  scrollable = false,
}: {
  labels: string[];
  children: ReactNode;
  minWidth?: number;
  className?: string;
  scrollable?: boolean;
}) {
  return (
    <div
      className={`max-w-full overflow-x-auto overscroll-x-contain ${scrollable ? "max-h-[656px] overflow-y-auto" : ""}`}
    >
      <table
        className={`app-table w-full text-left text-[12px] ${className ?? ""}`}
        style={{ minWidth }}
      >
        <thead
          className={`border-y border-[#edf0f5] bg-[#f8faff] text-[11px] font-semibold text-[#626b7a] ${scrollable ? "sticky top-0 z-10" : ""}`}
        >
          <tr>
            {labels.map((l) => (
              <th
                key={l}
                scope="col"
                className={`whitespace-nowrap px-5 py-3 ${l.toLowerCase() === "actions" ? "text-center" : ""}`}
              >
                {titleCase(l)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf0f5]">{children}</tbody>
      </table>
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
        className={`max-h-[90vh] w-full overflow-y-auto rounded-[14px] border border-[#d9e0e9] bg-white p-4 sm:p-5 ${className}`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938]">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <label
              key={f.key}
              className={`block text-[12px] font-medium ${f.type === "textarea" || f.type === "terms" ? "sm:col-span-2" : ""}`}
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
                  className={`input ${f.readOnly ? "bg-[#f6f8fb] text-[#687386]" : ""}`}
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
        <div className="mt-6 flex justify-end gap-2">
          <Button secondary onClick={close}>
            Cancel
          </Button>
          <button
            disabled={saving}
            style={{ fontSize: "14px", lineHeight: "20px" }}
            className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[13px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-50"
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </form>
      <LoadingModal open={saving} />
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
}: {
  module: Module;
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
  onPrint?: (r: Row) => void;
  leadMode?: "leads" | "projects";
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<"all" | "mine">("all");
  const [evaluationFilter, setEvaluationFilter] = useState("all");
  const [doneDealStatusFilter, setDoneDealStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("");
  const isProjectsPage = module.table === "leads" && leadMode === "projects";
  const canCreate =
    !isProjectsPage && canAccess(role, module.table, "create");
  const canUpdate = canAccess(role, module.table, "update");
  const canArchive = canAccess(role, module.table, "archive");
  const totalLeadCount = store.leads.filter(
    (lead) => n(lead.evaluation_number) !== 7,
  ).length;
  const ownProjectEditRequests =
    isProjectsPage && role === "project_manager"
      ? store.project_edit_requests.filter(
          (request) => text(request.submitted_by, "") === currentUserId,
        )
      : [];
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
            leadFilter === "all" ||
            text(r.created_by, "") === currentUserId,
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
            text(r.evaluation_number, "") === evaluationFilter,
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
      leadFilter,
      currentUserId,
      isProjectsPage,
      evaluationFilter,
      doneDealStatusFilter,
      monthFilter,
    ],
  );
  const shown =
    module.table === "leads" ? rows : rows.slice(page * 10, page * 10 + 10);
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
      ? module.columns.map((column) =>
          column.label === "Lead / project"
            ? {
                label: "Lead ID",
                value: (row: Row) => text(row.lead_no, "—"),
              }
            : column,
        )
      : module.columns;
  const columns =
    module.table === "leads" && isProjectsPage
      ? leadColumns.map((column) =>
          column.label === "Evaluation status"
            ? {
                label: "Done Deal Status",
                value: (row: Row) => doneDealStatusLabel(row.done_deal_status),
              }
            : column,
        )
      : leadColumns;
  const visibleFields =
    module.table === "leads" &&
    text(values.evaluation_number, "").split("|")[0] !== "7"
      ? fields.filter((field) => field.key !== "done_deal_status")
      : fields;
  const initial = (row?: Row) =>
    Object.fromEntries(
      module.fields.map((f) => [
        f.key,
        row ? text(row[f.key], "") : f.type === "date" ? isoToday() : "",
      ]),
    );
  const save = async () => {
    setSaving(true);
    const client = createClient();
    const payload: Record<string, unknown> = { ...values };
    module.fields
      .filter((f) => f.type === "number")
      .forEach((f) => (payload[f.key] = n(payload[f.key])));
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
    if (module.table === "leads" && !payload.assigned_to)
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
      isProjectsPage &&
      role === "project_manager"
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
    const { error } = await createClient()
      .from("leads")
      .delete()
      .eq("id", row.id)
      .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    notice("Lead / project deleted.");
    await reload();
  };
  const canDeleteLead = (row: Row) =>
    module.table === "leads" &&
    memberRole(role);
  const canEditRow = (row: Row) =>
    canUpdate &&
    (module.table !== "leads" ||
      memberRole(role) ||
      text(row.created_by, "") === currentUserId);
  const isPageLayout = module.table === "leads";
  const contentPadding = isPageLayout ? "px-4 sm:px-6 lg:px-7" : "px-4 sm:px-5";
  return (
    <div
      className={
        isPageLayout
          ? "-m-3 min-h-[calc(100vh-76px)] bg-white sm:-m-4 sm:min-h-[calc(100vh-84px)] lg:-m-5"
          : "space-y-5"
      }
    >
      {isProjectsPage && role === "project_manager" && ownProjectEditRequests.length > 0 && (
        <Panel title="My Project Edit Requests" detail="Project changes take effect only after General Manager approval.">
          <Table labels={["Project", "Submitted", "Status", "General Manager note"]} minWidth={640}>
            {ownProjectEditRequests.map((request) => (
              <tr key={text(request.id)}>
                <td className="px-4 py-3">{text(store.leads.find((lead) => lead.id === request.project_id)?.project_name)}</td>
                <td className="px-4 py-3">{day(request.submitted_at)}</td>
                <td className="px-4 py-3"><Status value={request.status} /></td>
                <td className="px-4 py-3">{text(request.decision_note)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
      <Panel
        title={module.title}
        detail={module.detail}
        variant={isPageLayout ? "page" : "card"}
        action={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(null);
                setValues({
                  ...initial(),
                  ...(module.table === "leads" && currentUserId
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
              <select
                aria-label="Filter lead ownership"
                value={leadFilter}
                onChange={(event) => {
                  setLeadFilter(event.target.value as "all" | "mine");
                  setPage(0);
                }}
                className="min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium text-[#202938] outline-none focus:border-[#c43b43]"
              >
                <option value="all">All {isProjectsPage ? "projects" : "leads"}</option>
                <option value="mine">My {isProjectsPage ? "projects" : "leads"}</option>
              </select>
              {!isProjectsPage ? (
                <select
                  aria-label="Filter evaluation status"
                  value={evaluationFilter}
                  onChange={(event) => {
                    setEvaluationFilter(event.target.value);
                    setPage(0);
                  }}
                  className={`lead-filter-select min-h-9 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#c43b43] ${evaluationFilter === "all" ? "text-[#8b92a1]" : "text-[#202938]"}`}
                >
                  <option value="all">Filter By Evaluation Status</option>
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
            </>
          ) : (
            <Button secondary onClick={() => setPage(0)}>
              <SlidersHorizontal size={14} />
              All records
            </Button>
          )}
        </div>
        {shown.length ? (
          <>
            <div className={isPageLayout ? "modern-table-shell" : undefined}>
              <Table
                labels={[...columns.map((c) => c.label), "Actions"]}
                minWidth={module.table === "leads" ? 2155 : 680}
                scrollable={isPageLayout}
                className={
                  module.table === "leads"
                    ? "leads-table modern-page-table"
                    : undefined
                }
              >
                {shown.map((row) => (
                  <tr key={text(row.id)} className="hover:bg-[#fbfcff]">
                    {columns.map((c) => (
                      <td key={c.label} className="px-5 py-3 align-middle">
                        {c.value(row, store)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-5 py-3">
                      <div className="flex gap-2">
                        {canEditRow(row) && (
                          <ActionIcon
                            onClick={() => {
                              setEditing(row);
                              setValues(initial(row));
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
                        {canDeleteLead(row) && (
                          <ActionIcon
                            disabled={saving}
                            onClick={() => void deleteLead(row)}
                            label="Delete lead / project"
                            tone="red"
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
          fields={visibleFields}
          values={values}
          setValues={setValues}
          save={() => void save()}
          close={() => {
            setOpen(false);
            setEditing(null);
          }}
          saving={saving}
        />
      )}
    </div>
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
      detail="Maintain the available material choices used in Costing Breakdowns. Click Edit to change a row."
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
      detail="Maintain the vendors used for materials, costing, and quotations."
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
      <div className="flex gap-1 border-b border-[#e4e8ef] px-1">
        <button type="button" onClick={() => setTab("suppliers")} className={`px-3 py-2 text-[12px] font-medium ${tab === "suppliers" ? "border-b-2 border-[#c43b43] text-[#151922]" : "text-[#8b92a1]"}`}>Suppliers</button>
        <button type="button" onClick={() => setTab("materials")} className={`px-3 py-2 text-[12px] font-medium ${tab === "materials" ? "border-b-2 border-[#c43b43] text-[#151922]" : "text-[#8b92a1]"}`}>Materials List</button>
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
}: {
  quote: Row;
  store: Store;
  close: () => void;
  onPdfError?: (message: string) => void;
  autoExportPdf?: boolean;
  pdfWindow?: Window | null;
  printAfterOpen?: boolean;
  hidden?: boolean;
}) {
  const documentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoExportPdf || !documentRef.current) return;
    let cancelled = false;
    const exportPdf = async () => {
      const quotationPrintStyles = `
        @page { size: 8.5in 13in; margin: 0.48in 0.42in 0.6in; }
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
        <PriceQuotationPdf quote={quote} store={store} origin={window.location.origin} />,
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
  const validityDays =
    quote.valid_until && quote.issue_date
      ? Math.max(
          1,
          Math.round(
            (new Date(`${quote.valid_until}T00:00:00`).getTime() -
              new Date(`${quote.issue_date}T00:00:00`).getTime()) /
              86_400_000,
          ),
        )
      : 7;
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
                PRICE QUOTATION
              </h1>
              <div style={{ fontWeight: 500, lineHeight: 1.32 }}>
                <p>Quotation No.: {text(quote.quotation_no)}</p>
                <p>Quotation Date: {fullIssueDate}</p>
                <p>Validity: {validityDays} Days</p>
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
                    fontWeight: 500,
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
            <p>Sales Project Officer</p>
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
            style={{ width: "210mm" }}
          >
            <section
              className="quotation-print-page relative min-h-[297mm] w-[210mm] px-[12mm] pb-[15mm] pt-[11mm]"
              style={{
                position: "relative",
                width: "210mm",
                minHeight: "297mm",
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
                <thead style={{ display: "table-header-group" }}>
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
              className="quotation-print-page relative min-h-[297mm] w-[210mm] px-[12mm] pb-[15mm] pt-[12.5mm] text-[12px] leading-[1.4]"
              style={{
                position: "relative",
                width: "210mm",
                minHeight: "297mm",
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
              className="quotation-print-page relative min-h-[297mm] w-[210mm] px-[12mm] pb-[15mm] pt-[12.5mm] text-[12px] leading-[1.4]"
              style={{
                position: "relative",
                width: "210mm",
                minHeight: "297mm",
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
                Sales Project Officer
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
        @page { size: 8.5in 13in; margin: 0.48in 0.42in 0.6in; }
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
  const sellingExVat = cogs + profit + overhead + buffer + commission;
  const projectTypeOptions = [
    "Premium Rigid Box",
    "Regular Rigid Box",
    "Corrugated",
    "Offset",
    "Digital",
    "Mock Up",
  ];
  return (
    <div className="hidden">
        <article ref={documentRef} data-pdf-document className="mx-auto max-w-[8.5in] border border-[#d5dbe5] bg-white p-8 text-[12px] text-[#202938] print:border-0 print:p-0" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
          <header className="border-b-2 border-[#c43b43] pb-4 text-center">
            <Image src="/huswell-quotation-logo.png" alt="Huswell Trading" width={489} height={153} className="mx-auto h-auto w-56" />
            <h1 className="mt-3 text-lg font-medium text-[#c43b43]">COSTING BREAKDOWN / PRICE QUOTE</h1>
          </header>
          <section className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-10"><div className="min-w-0"><h2 className="font-medium text-[#a22d35]">CLIENT INFORMATION</h2><dl className="mt-2 grid grid-cols-[150px_minmax(180px,1fr)] gap-y-1"><dt>Company Name:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{companyName}</dd><dt>Client Name:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{clientName}</dd><dt>Phone / Email:</dt><dd className="min-w-0 border border-[#d5dbe5] px-2 py-1">{text(quote.client_phone)}</dd></dl></div><div className="pt-7"><span>Date: </span><span className="inline-block min-w-36 border border-[#d5dbe5] px-2 py-1 text-center">{day(quote.issue_date)}</span></div></section>
          <section className="mt-5 grid grid-cols-2 gap-7 border-y border-[#111] py-3"><div><b>DETAILS</b><dl className="mt-2 grid grid-cols-[145px_1fr] gap-y-1"><dt>Size: L x W x H (in./cm.):</dt><dd className="border-b border-[#777] px-1">{text(quote.size_details)}</dd><dt>Quantity:</dt><dd className="border-b border-[#777] px-1">{text(quote.project_quantity)}</dd><dt>Delivery Date:</dt><dd className="border-b border-[#777] px-1">{day(quote.delivery_date)}</dd></dl></div><div><b>PROJECT TYPE</b><div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">{projectTypeOptions.map((type) => <div key={type} className="flex items-center gap-2"><span className="inline-grid size-4 place-items-center border border-[#111] text-[11px]">{text(quote.project_types, "") === type ? "✓" : ""}</span><span>{type}</span></div>)}</div></div></section>
          <table className="pdf-fixed-table mt-6 w-full border-collapse text-sm"><thead><tr className="bg-[#c43b43] text-white"><th className="w-[52%] border border-[#c43b43] p-2 text-left">Materials and Production</th><th className="w-[14%] border border-[#c43b43] p-2">Quantity</th><th className="w-[17%] border border-[#c43b43] p-2">Unit Cost</th><th className="w-[17%] border border-[#c43b43] p-2">Subtotal</th></tr></thead><tbody>{lines.map((line) => <tr key={text(line.id)}><td className="border border-[#d5dbe5] p-2">{text(line.description)}</td><td className="border border-[#d5dbe5] p-2 text-center">{n(line.quantity)}</td><td className="border border-[#d5dbe5] p-2 text-right">{peso.format(n(line.unit_cost))}</td><td className="border border-[#d5dbe5] p-2 text-right">{peso.format(n(line.line_total))}</td></tr>)}<tr className="font-medium"><td colSpan={3} className="border border-[#d5dbe5] bg-[#fff7f7] p-2">TOTAL ESTIMATED COGS</td><td className="border border-[#d5dbe5] bg-[#fff7f7] p-2 text-right">{peso.format(cogs)}</td></tr></tbody></table>
          <section className="mt-7 max-w-sm border border-[#d5dbe5]"><h2 className="border-b border-[#d5dbe5] bg-[#fff7f7] px-3 py-2 font-medium text-[#a22d35]">MARKUP, VAT, EXPENSES</h2><Cost label={`Declared Markup (${n(quote.profit_margin_rate)}%)`} value={profit} /><Cost label={`Overhead Allocation (${n(quote.overhead_rate)}%)`} value={overhead} /><Cost label={`Buffer Margin (${n(quote.buffer_margin_rate)}%)`} value={buffer} /><Cost label={`Production Commission (${n(quote.commission_rate)}%)`} value={commission} /><Cost label={`VAT (${n(quote.vat_rate)}%)`} value={n(quote.vat_amount)} /><Cost label="SELLING PRICE VAT INC." value={n(quote.total_amount)} strong /><Cost label="SELLING PRICE VAT EX." value={sellingExVat} strong /></section>
          <section className="mt-12 flex items-end justify-between"><div className="w-56 text-center"><div className="h-14" /><div className="mx-auto w-52 border-b border-[#111] pb-1 font-semibold">{text(quote.representative)}</div><div>Sales Project Officer</div></div><div className="w-56 text-center"><div className="h-14">{approved && <img src="/marvin-tavarez-signature.png" alt="Signature of Mr. Marvin S. Tavarez" className="mx-auto h-14 max-w-full object-contain" />}</div><div className="mx-auto w-52 border-b border-[#111] pb-1 font-semibold">{approved ? "Mr. Marvin S. Tavarez" : "Pending approval"}</div><div>{approved ? `Approved and Signed By · ${day(quote.approved_at)}` : "Approved and Signed By"}</div></div></section>
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
            <thead>
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
}: {
  store: Store;
  orgId: string;
  reload: () => Promise<void>;
  notice: (m: string) => void;
  role: string;
  profileName: string;
  mode?: "quotation" | "costing";
  pageLayout?: boolean;
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
  const openPdf = (quote: Row, isCosting: boolean, shouldPrint: boolean) => {
    setPdfWindow(null);
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
  const canGenerateCostingPdf = ["owner", "admin"].includes(role);
  const canDeleteQuote = ["owner", "admin"].includes(role);
  const canCreateQuote = mode === "costing"
    ? role === "project_manager" || isGeneralManager
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
    { key: "representative", label: "Sales Project Officer" },
    { key: "valid_until", label: "Validity date", type: "date" },
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
      options: [
        "Premium Rigid Box",
        "Offset",
        "Regular Rigid Box",
        "Digital",
        "Corrugated",
        "Mock Up",
      ],
    },
    {
      key: "representative",
      label: "Sales Project Officer",
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
      bank_details: quotationBankDetails(store.business_settings[0]?.default_bank_details),
      prepared_by_user_id: user.user.id,
      prepared_by_signature_url: text(profile?.signature_url, "") || null,
      organization_id: orgId,
      quotation_no: ref("QT"),
      document_type: "costing_breakdown",
      status: "draft",
      issue_date: values.issue_date || isoToday(),
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
  const deleteQuote = async (quote: Row) => {
    if (!quote.id || !canDeleteQuote) return;
    const hasGeneratedPriceQuotation =
      text(quote.document_type) === "costing_breakdown" &&
      store.quotations.some(
        (item) =>
          item.costing_source_id === quote.id &&
          text(item.document_type) === "price_quotation",
      );
    if (hasGeneratedPriceQuotation) {
      notice("Delete the linked Price Quotation before deleting this Costing Breakdown.");
      return;
    }
    setSaving(true);
    const { error } = await createClient()
      .from("quotations")
      .delete()
      .eq("id", quote.id)
      .eq("organization_id", orgId);
    setSaving(false);
    if (error) return notice(error.message);
    notice(`${text(quote.document_type) === "costing_breakdown" ? "Costing Breakdown" : "Price Quotation"} deleted.`);
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
  );
  return (
    <div
      className={
        pageLayout
          ? "-m-4 min-h-[calc(100vh-84px)] bg-white lg:-m-5"
          : "space-y-5"
      }
    >
      <LoadingModal open={generatingPdf !== null} title={generatingPdf === "costing" ? "Generating Costing Breakdown PDF" : "Generating quotation PDF"} message="Please wait a moment." />
      <Panel
        title={mode === "costing" ? "Costing breakdown" : "Price quotations"}
        detail={
          mode === "costing"
            ? "Build material and production costs, then submit them for General Manager review."
            : "Generated after General Manager approval. View or print the client Price Quotation."
        }
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
                      ? "New costing breakdown"
                      : "New price quotation"}
                  </Button>
                </>
              )}
            </div>
          ) : undefined
        }
        variant={pageLayout ? "page" : "card"}
      >
        <div className="flex border-t border-[#edf0f5] px-4 py-2.5 sm:px-5">
          <label className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-md">
            <Search className="absolute left-3 top-2.5 text-[#8b92a1]" size={15} />
            <input
              value={quoteQuery}
              onChange={(event) => setQuoteQuery(event.target.value)}
              className="w-full rounded-lg border border-[#d9e0e9] py-2 pl-9 pr-3 text-[12px] outline-none focus:border-[#c43b43]"
              placeholder="Search quotation, project, company, or client"
            />
          </label>
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
                "Customer / project",
                "Estimated COGS",
                isCosting ? "VAT incl." : "Selling price VAT inc.",
                "Submitted by",
                isCosting ? "Approval" : "GM approval",
                isCosting ? "Approval date" : "GM approval date",
                "Actions",
              ]}
            >
              {quoteRows.map((q) => {
                const sourceCosting = !isCosting
                  ? store.quotations.find((item) => item.id === q.costing_source_id)
                  : null;
                const submittedById = isCosting
                  ? q.submitted_by ?? q.created_by
                  : sourceCosting?.submitted_by ?? sourceCosting?.created_by;
                const submittedBy = text(
                  store.profiles.find((profile) => profile.id === submittedById)
                    ?.full_name,
                  "Project Officer",
                );
                return (
                <tr key={text(q.id)}>
                  <td className="px-5 py-3">
                    <b>{text(q.quotation_no)}</b>
                    <small>
                      v{text(q.version, "1")} · {day(q.issue_date)}
                    </small>
                  </td>
                  <td className="px-5 py-3">
                    <b>{text(q.project_name)}</b>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {peso.format(n(q.total_cost))}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {peso.format(n(q.total_amount))}
                  </td>
                  <td className="px-5 py-3 text-center text-[12px]">
                    {submittedBy}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Status value={isCosting ? q.status : sourceCosting?.status ?? "approved"} />
                      {isCosting && text(q.status) === "needs_revision" && text(q.revision_note, "") && (
                        <ActionIcon
                          label="View revision note"
                          tone="amber"
                          confirm={false}
                          onClick={() => setRevisionNoteQuote(q)}
                        >
                          <MessageSquareText size={15} />
                        </ActionIcon>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center text-[12px]">
                    {day(isCosting ? q.approved_at : sourceCosting?.approved_at)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {isCosting ? (
                        canGenerateCostingPdf ? (
                          <ActionIcon
                            label="View Costing Breakdown PDF"
                            onClick={() => openPdf(q, true, false)}
                          >
                            <FileText size={15} />
                          </ActionIcon>
                        ) : (
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
                        )
                      ) : <>
                        <ActionIcon
                          label="View Price Quotation PDF"
                          onClick={() => openPdf(q, false, false)}
                        >
                          <FileText size={15} />
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
                          onClick={() => void change(q, "pending")}
                        >
                          <Send size={15} />
                        </ActionIcon>}
                      {canDeleteQuote && (
                        <ActionIcon
                          label={`Delete ${isCosting ? "Costing Breakdown" : "Price Quotation"}`}
                          tone="red"
                          disabled={saving}
                          onClick={() => void deleteQuote(q)}
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
                        <label className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium text-[#b5323a] transition hover:bg-[#fff0f1]">
                          Replace
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
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setCostingImage(null);
                            setImageInputKey((key) => key + 1);
                          }}
                          className="grid size-8 place-items-center rounded-md text-[#8a95a6] transition hover:bg-[#fff0f1] hover:text-[#c43b43]"
                          title="Remove selected image"
                          aria-label="Remove selected image"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="mt-1 flex min-h-[72px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#c7d0de] bg-[#fafbfe] px-4 text-center transition hover:border-[#c43b43] hover:bg-[#fff8f8]">
                      <ImageIcon size={17} className="text-[#c43b43]" />
                      <span>
                        <span className="block text-[13px] font-medium text-[#313b4b]">
                          Upload Product Image
                        </span>
                        <span className="block text-[11px] font-normal text-[#7d8797]">
                          PNG, JPG or WebP · Images are optimized automatically
                        </span>
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
      {revisionNoteQuote && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRevisionNoteQuote(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="revision-note-title"
            className="w-full max-w-lg rounded-[14px] border border-[#d9e0e9] bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2
                  id="revision-note-title"
                  className="text-[16px] font-semibold text-[#202938]"
                >
                  General Manager revision note
                </h2>
                <p className="mt-1 text-[12px] text-[#687386]">
                  {text(revisionNoteQuote.quotation_no, "Costing breakdown")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevisionNoteQuote(null)}
                aria-label="Close revision note"
                className="rounded-md p-1 text-[#687386] transition-colors hover:bg-[#f0f3f7] hover:text-[#202938] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c43b43]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-[13px] leading-5 text-[#303949]">
              {text(revisionNoteQuote.revision_note, "No revision note was provided.")}
            </div>
            <div className="mt-5 flex justify-end">
              <Button secondary onClick={() => setRevisionNoteQuote(null)}>
                Close
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
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
    vat_rate: text(quotation.vat_rate, "12"),
  });
  const [terms, setTerms] = useState(
    text(quotation.terms_conditions, DEFAULT_QUOTATION_TERMS)
      .split(/\r?\n+/)
      .filter(Boolean),
  );
  const [bankDetails, setBankDetails] = useState<BankDetail[]>(() =>
    quotationBankDetails(quotation.bank_details),
  );
  const [revisionNote, setRevisionNote] = useState("");
  const lines = store.quotation_items.filter(
    (line) => line.quotation_id === quotation.id,
  );
  const cogs = lines.reduce((sum, line) => sum + n(line.line_total), 0);
  const profit = (cogs * n(rates.profit_margin_rate)) / 100;
  const overhead = (cogs * n(rates.overhead_rate)) / 100;
  const buffer = (cogs * n(rates.buffer_margin_rate)) / 100;
  const commission = (cogs * n(rates.commission_rate)) / 100;
  const sellingExVat = cogs + profit + overhead + buffer + commission;
  const vat = (sellingExVat * n(rates.vat_rate)) / 100;
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
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.45fr_.75fr]">
          <div>
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
            <section className="mt-5 rounded-xl border border-[#e1e6ee] p-4">
              <div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Terms and Conditions</h3><Button secondary onClick={() => setTerms((current) => [...current, ""])}><Plus size={13} /> Add term</Button></div>
              <div className="mt-3 space-y-2">{terms.map((term, index) => <div key={index} className="flex gap-2"><span className="pt-2 text-[12px] text-[#7d8797]">{index + 1}.</span><input value={term} onChange={(event) => setTerms((current) => current.map((value, itemIndex) => itemIndex === index ? titleCaseEntry(event.target.value, "term") : value))} className="input mt-0 flex-1" /><button type="button" aria-label="Remove term" onClick={() => setTerms((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
            </section>
            <section className="mt-4 rounded-xl border border-[#e1e6ee] p-4">
              <div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Bank Details</h3><Button secondary onClick={() => setBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div>
              <div className="mt-3 space-y-2">{bankDetails.map((detail, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Bank ${index + 1} name`} value={detail.bank_name} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bank_name: event.target.value } : item))} placeholder="Bank name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account name`} value={detail.account_name} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_name: event.target.value } : item))} placeholder="Account name" className="input mt-0" /><input aria-label={`Bank ${index + 1} account number`} value={detail.account_number} onChange={(event) => setBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_number: event.target.value } : item))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label="Remove bank" onClick={() => setBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
            </section>
            <label className="mt-4 block text-[12px] font-medium text-[#202938]">
              Revision notes for Project Officer
              <textarea
                rows={3}
                value={revisionNote}
                onChange={(event) => setRevisionNote(titleCaseEntry(event.target.value, "revision_note"))}
                placeholder="Required only when returning this Costing Breakdown for revision."
                className="input mt-1 min-h-[78px] resize-y"
              />
            </label>
          </div>
          <aside className="space-y-4">
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
          <Button secondary disabled={saving} onClick={() => decide("needs_revision", changes, revisionNote)}><RotateCcw size={14} /> Return for revision</Button>
          <Button tone="green" disabled={saving} onClick={() => decide("approved", changes)}><Check size={14} /> Approve & Create Price Quotation</Button>
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
            <span className="text-[#8b92a1]">Project Officer</span>
            <p className="mt-1 font-medium">{officer}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Submitted</span>
            <p className="mt-1 font-medium">{day(quotation.submitted_at)}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Sales Project Officer</span>
            <p className="mt-1 font-medium">{text(quotation.representative)}</p>
          </div>
          <div>
            <span className="text-[#8b92a1]">Validity date</span>
            <p className="mt-1 font-medium">{day(quotation.valid_until)}</p>
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
            label={`VAT (${n(quotation.vat_rate)}%)`}
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
  decide: (decision: "approved" | "rejected", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const project = store.leads.find((item) => item.id === request.project_id);
  const changes =
    request.proposed_changes && typeof request.proposed_changes === "object"
      ? (request.proposed_changes as Record<string, unknown>)
      : {};
  const labels: Record<string, string> = {
    project_name: "Project name",
    contact_name: "Client name",
    client_name: "Company name",
    email: "Email",
    phone: "Phone",
    date_sent: "Date sent",
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
          Decision note
          <textarea rows={3} value={note} onChange={(event) => setNote(titleCaseEntry(event.target.value, "note"))} className="input mt-1 min-h-[76px] resize-y" placeholder="Optional note for the Project Officer" />
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-4">
          <Button secondary onClick={close}>Close</Button>
          <Button secondary disabled={saving} onClick={() => decide("rejected", note)}><X size={14} /> Reject</Button>
          <Button tone="green" disabled={saving} onClick={() => decide("approved", note)}><Check size={14} /> Approve edit</Button>
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
  const [tab, setTab] = useState<"costings" | "projects">("costings");
  const [selectedProjectEdit, setSelectedProjectEdit] = useState<Row | null>(null);
  const pendingCostings = store.quotations.filter(
    (quotation) =>
      text(quotation.status) === "pending" &&
      text(quotation.document_type) === "costing_breakdown",
  );
  const officerName = (quotation: Row) =>
    text(
      store.profiles.find(
        (profile) =>
          profile.id === (quotation.submitted_by ?? quotation.created_by),
      )?.full_name,
      "Project Officer",
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
      p_vat_rate: n(reviewChanges.vat_rate ?? quotation.vat_rate),
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
    notice(
      status === "approved"
        ? "Costing Breakdown approved and Price Quotation created."
        : "Returned to the Project Officer for re-evaluation.",
    );
    await reload();
  };
  const decideProjectEdit = async (
    request: Row,
    decision: "approved" | "rejected",
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
    notice(decision === "approved" ? "Project edit approved." : "Project edit rejected.");
    await reload();
  };
  const pendingProjectEdits = store.project_edit_requests.filter(
    (request) => text(request.status) === "pending",
  );
  const projectOfficerName = (request: Row) =>
    text(
      store.profiles.find((profile) => profile.id === request.submitted_by)
        ?.full_name,
      "Project Officer",
    );
  return (
    <Panel
      title="General Manager Submissions"
      detail="Review Costing Breakdowns and Project Officer project edit requests."
    >
      <div className="flex gap-1 border-b border-[#e4e8ef] px-5">
        <button type="button" onClick={() => setTab("costings")} className={`px-3 py-2 text-[12px] font-medium ${tab === "costings" ? "border-b-2 border-[#c43b43] text-[#151922]" : "text-[#8b92a1]"}`}>Costing Reviews ({pendingCostings.length})</button>
        <button type="button" onClick={() => setTab("projects")} className={`px-3 py-2 text-[12px] font-medium ${tab === "projects" ? "border-b-2 border-[#c43b43] text-[#151922]" : "text-[#8b92a1]"}`}>Project Edits ({pendingProjectEdits.length})</button>
      </div>
      {tab === "costings" && (pendingCostings.length ? (
        <Table
          labels={[
            "Costing Breakdown",
            "Client",
            "Project Officer",
            "Submitted",
            "Estimated COGS",
            "Review",
          ]}
        >
          {pendingCostings.map((quotation) => {
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
      {tab === "projects" && (pendingProjectEdits.length ? (
        <Table labels={["Project", "Project Officer", "Submitted", "Requested changes", "Review"]}>
          {pendingProjectEdits.map((request) => {
            const project = store.leads.find((lead) => lead.id === request.project_id);
            const changes = request.proposed_changes && typeof request.proposed_changes === "object" ? Object.keys(request.proposed_changes as Record<string, unknown>) : [];
            return <tr key={text(request.id)}>
              <td className="px-5 py-3"><b>{text(project?.project_name)}</b><small>{text(project?.client_name)} · {text(project?.contact_name)}</small></td>
              <td className="px-5 py-3">{projectOfficerName(request)}</td>
              <td className="px-5 py-3">{day(request.submitted_at)}</td>
              <td className="px-5 py-3">{changes.map((change) => change.replaceAll("_", " ")).join(", ")}</td>
              <td className="px-5 py-3"><ActionIcon label="Review project edit" confirm={false} onClick={() => setSelectedProjectEdit(request)}><FileText size={15} /></ActionIcon></td>
            </tr>;
          })}
        </Table>
      ) : <Empty>No project edits are awaiting review.</Empty>)}
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
      {selectedProjectEdit && (
        <ProjectEditRequestReview
          request={selectedProjectEdit}
          store={store}
          saving={savingId === selectedProjectEdit.id}
          close={() => setSelectedProjectEdit(null)}
          decide={(decision, note) => void decideProjectEdit(selectedProjectEdit, decision, note)}
        />
      )}
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
              "Material use",
              "Actions",
            ]}
          >
            {store.production_jobs.map((job) => {
              const used = store.production_material_usage.filter(
                (u) => u.production_job_id === job.id,
              ).length;
              const late =
                job.due_date &&
                new Date(String(job.due_date)) < new Date() &&
                !["completed", "delivered", "cancelled"].includes(
                  text(job.status),
                );
              return (
                <tr key={text(job.id)}>
                  <td className="px-5 py-3">
                    <b className="text-[#1769e8]">{text(job.job_no)}</b>
                    <small>{text(job.title)}</small>
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
                  <td className="px-5 py-3">
                    {used} line{used === 1 ? "" : "s"}
                  </td>
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
                <td className="px-5 py-3">{text(activity.note)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No production activity recorded yet.</Empty>
        )}
      </Panel>
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
                    <b>
                      {text(
                        store.customers.find(
                          (customer) => customer.id === invoice.customer_id,
                        )?.company_name,
                        "Walk-in client",
                      )}
                    </b>
                    <small>{text(invoice.invoice_no)}</small>
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
                    <b>
                      {text(
                        store.suppliers.find(
                          (supplier) => supplier.id === payable.supplier_id,
                        )?.company_name,
                      )}
                    </b>
                    <small>{text(payable.payable_no)}</small>
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

function Dashboard({
  store,
  go,
  role,
}: {
  store: Store;
  go: (view: View) => void;
  role: string;
}) {
  const year = String(new Date().getFullYear());
  const month = "all";
  const matchesPeriod = (value: unknown) => {
    const dateValue = new Date(String(value));
    return (
      (!year || String(dateValue.getFullYear()) === year) &&
      (month === "all" ||
        String(dateValue.getMonth() + 1).padStart(2, "0") === month)
    );
  };
  const invoices = store.invoices.filter(
    (i) => i.status !== "void" && matchesPeriod(i.issue_date),
  );
  const revenue = invoices.reduce((sum, i) => sum + n(i.total_amount), 0);
  const expense = store.expenses
    .filter(
      (e) =>
        !e.archived_at &&
        !["rejected", "cancelled"].includes(text(e.status)) &&
        matchesPeriod(e.expense_date),
    )
    .reduce((sum, e) => sum + n(e.amount), 0);
  const available = store.inventory_items.filter(
    (i) => i.item_type === "material",
  );
  const low = available.filter(
    (i) => n(i.quantity_on_hand) <= n(i.reorder_level),
  );
  const cashReceived = store.payments
    .filter((payment) => matchesPeriod(payment.paid_at))
    .reduce((sum, payment) => sum + n(payment.amount), 0);
  const activeProduction = store.production_jobs.filter(
    (job) =>
      !["completed", "delivered", "cancelled"].includes(text(job.status)),
  ).length;
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const jobsDueThisWeek = store.production_jobs.filter((job) => {
    const due = new Date(text(job.due_date, ""));
    return (
      !["completed", "delivered", "cancelled"].includes(text(job.status)) &&
      !Number.isNaN(due.getTime()) &&
      due >= new Date(new Date().toDateString()) &&
      due <= weekFromNow
    );
  }).length;
  const chartYear = year ? Number(year) : new Date().getFullYear();
  const monthlyPerformance = Array.from({ length: 12 }, (_, month) => {
    const inChartMonth = (value: unknown) => {
      const date = new Date(String(value));
      return date.getFullYear() === chartYear && date.getMonth() === month;
    };
    return {
      label: new Intl.DateTimeFormat("en-PH", { month: "short" }).format(
        new Date(chartYear, month, 1),
      ),
      revenue: store.invoices
        .filter(
          (invoice) =>
            invoice.status !== "void" && inChartMonth(invoice.issue_date),
        )
        .reduce((sum, invoice) => sum + n(invoice.total_amount), 0),
      expense: store.expenses
        .filter(
          (entry) =>
            !entry.archived_at &&
            !["rejected", "cancelled"].includes(text(entry.status)) &&
            inChartMonth(entry.expense_date),
        )
        .reduce((sum, entry) => sum + n(entry.amount), 0),
    };
  });
  const quotationStatuses = Object.entries(
    store.quotations
      .filter(
        (quotation) =>
          text(quotation.document_type) === "price_quotation" &&
          matchesPeriod(quotation.issue_date),
      )
      .reduce<Record<string, number>>(
        (groups, quotation) => ({
          ...groups,
          [text(quotation.status, "draft")]:
            (groups[text(quotation.status, "draft")] ?? 0) + 1,
        }),
        {},
      ),
  ).sort(([, left], [, right]) => right - left);
  const operationalPulse: {
    label: string;
    value: number;
    detail: string;
    view: View;
  }[] = [
    {
      label: "Open costings",
      value: store.quotations.filter(
        (quotation) =>
          text(quotation.document_type) === "costing_breakdown" &&
          ["draft", "needs_revision", "pending"].includes(text(quotation.status)),
      ).length,
      detail: "Draft, returned, or awaiting GM review",
      view: "Costing Breakdown",
    },
    {
      label: "Active leads",
      value: store.leads.filter(
        (lead) => !["won", "lost"].includes(text(lead.status)),
      ).length,
      detail: "Projects being qualified or quoted",
      view: "Leads",
    },
    {
      label: "Costing materials",
      value: low.length,
      detail: "Materials at or below reorder level",
      view: "Costing Breakdown",
    },
    ...(memberRole(role)
      ? [
          {
            label: "Costing reviews",
            value: store.quotations.filter(
              (quotation) =>
                text(quotation.document_type) === "costing_breakdown" &&
                text(quotation.status) === "pending",
            ).length,
            detail: "Awaiting General Manager review",
            view: "Submissions" as View,
          },
        ]
      : []),
  ];
  const metrics =
    role === "project_manager"
      ? [
          {
            name: "Active leads",
            value: store.leads
              .filter((lead) => !["won", "lost"].includes(text(lead.status)))
              .length.toString(),
            hint: "Projects being qualified or costed",
            hintClass: "text-[#2168d6]",
            icon: ClipboardCheck,
            iconClass: "bg-[#2168d6] text-white",
          },
          {
            name: "Costing in progress",
            value: store.quotations
              .filter(
                (quotation) =>
                  text(quotation.document_type) === "costing_breakdown" &&
                  ["draft", "needs_revision"].includes(text(quotation.status)),
              )
              .length.toString(),
            hint: "Draft cost breakdowns",
            hintClass: "text-[#a76605]",
            icon: ReceiptText,
            iconClass: "bg-[#de8a00] text-white",
          },
          {
            name: "Client quotations",
            value: store.quotations
              .filter(
                (quotation) =>
                  text(quotation.document_type) === "price_quotation",
              )
              .length.toString(),
            hint: "Generated and ready to print",
            hintClass: "text-[#2168d6]",
            icon: FileText,
            iconClass: "bg-[#7445d6] text-white",
          },
          {
            name: "Active suppliers",
            value: store.suppliers
              .filter((supplier) => supplier.is_active !== false)
              .length.toString(),
            hint: "Available for costing",
            hintClass: "text-[#159957]",
            icon: UsersRound,
            iconClass: "bg-[#159957] text-white",
          },
        ]
      : [
          {
            name: "Invoiced revenue",
            value: peso.format(revenue),
            hint: `${invoices.length} issued invoices`,
            hintClass: "text-[#159957]",
            icon: TrendingUp,
            iconClass: "bg-[#159957] text-white",
          },
          {
            name: "Cash received",
            value: peso.format(cashReceived),
            hint: "Payments received",
            hintClass: "text-[#2168d6]",
            icon: CircleDollarSign,
            iconClass: "bg-[#2168d6] text-white",
          },
          {
            name: "Expenses",
            value: peso.format(expense),
            hint: "Recorded costs",
            hintClass: "text-[#b42318]",
            icon: ReceiptText,
            iconClass: "bg-[#b42318] text-white",
          },
          {
            name: "Net operating result",
            value: peso.format(revenue - expense),
            hint: "Revenue less expenses",
            hintClass:
              revenue - expense > 0
                ? "text-[#159957]"
                : revenue - expense < 0
                  ? "text-[#b42318]"
                  : "text-[#626b7a]",
            icon: Wallet,
            iconClass: "bg-[#7445d6] text-white",
          },
        ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(
          ({ name, value, hint, hintClass, icon: Icon, iconClass }) => (
            <div
              key={name}
              className="dashboard-metric h-[108px] rounded-[14px] border border-[#dfe5ed] bg-white px-4 py-3 lg:px-5 lg:py-3"
            >
              <div className="grid h-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3">
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-full ${iconClass}`}
                >
                  <Icon size={21} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p
                    title={name}
                    className="dashboard-metric-label truncate font-semibold uppercase tracking-[.08em] text-[#626b7a]"
                  >
                    {name}
                  </p>
                  <p
                    title={value}
                    className="dashboard-metric-value mt-1 truncate font-semibold tracking-tight text-[#151922]"
                  >
                    {value}
                  </p>
                  <p
                    title={hint}
                    className={`dashboard-metric-hint mt-1 truncate font-medium ${hintClass}`}
                  >
                    {hint}
                  </p>
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {role === "project_manager" ? (
            <Panel
              title="Project pipeline"
              detail="Current leads and projects requiring your next action."
            >
              {store.leads.length ? (
                <Table labels={["Project", "Client", "Target date", "Stage"]}>
                  {store.leads.slice(0, 6).map((lead) => (
                    <tr key={text(lead.id)}>
                      <td className="px-5 py-3 font-medium">
                        {text(lead.project_name)}
                      </td>
                      <td className="px-5 py-3">{text(lead.client_name)}</td>
                      <td className="px-5 py-3">{day(lead.due_date)}</td>
                      <td className="px-5 py-3">
                        <Status value={lead.status} />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>No leads or projects recorded yet.</Empty>
              )}
            </Panel>
          ) : (
            <Panel
              title="Financial performance"
              detail={`Monthly invoiced revenue and expenses for ${chartYear}.`}
            >
              <MonthlyPerformanceChart data={monthlyPerformance} />
            </Panel>
          )}
        </div>
        <div className="xl:col-span-2">
          <Panel title="Operations pulse" detail="Work requiring attention.">
            <div className="divide-y divide-[#edf0f5] border-t border-[#edf0f5]">
              {operationalPulse.map((item) => (
                <button
                  key={item.label}
                  onClick={() => go(item.view)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-[#f8faff]"
                >
                  <span>
                    <b className="block text-[14px]">{item.label}</b>
                    <span className="mt-0.5 block text-[12px] text-[#8b92a1]">
                      {item.detail}
                    </span>
                  </span>
                  <span className="text-[20px] font-semibold tracking-tight">
                    {item.value}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <Panel
        title="Cumulative operating result"
        detail={`Cumulative invoiced revenue less expenses for ${chartYear}.`}
      >
        <CumulativePerformanceChart data={monthlyPerformance} />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Price Quotation distribution"
          detail="Generated Price Quotations for the selected period."
        >
          {quotationStatuses.length ? (
            <QuotationStatusPie data={quotationStatuses} />
          ) : (
            <Empty>No quotations in the selected period.</Empty>
          )}
        </Panel>
        <Panel
          title="Low stock"
          detail="Materials at or below their reorder level."
        >
          {low.length ? (
            <div className="divide-y divide-[#edf0f5] border-t border-[#edf0f5]">
              {low.slice(0, 5).map((i) => (
                <div
                  key={text(i.id)}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <span>
                    <b className="block text-[12px]">{text(i.name)}</b>
                    <small>
                      {n(i.quantity_on_hand)} {text(i.unit)} on hand
                    </small>
                  </span>
                  <Status
                    value={
                      n(i.quantity_on_hand) <= 0 ? "out of stock" : "low stock"
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty>All raw supplies are above their alert level.</Empty>
          )}
        </Panel>
      </div>
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
              <b>{text(r.company_name)}</b>
              <small>{text(r.contact_name)}</small>
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
              <b>{text(r.full_name)}</b>
              <small>{text(r.employee_no)}</small>
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
      <div className="flex gap-1 border-b border-[#e4e8ef]">
        {(Object.keys(modules) as (typeof tab)[]).map((k) => (
          <button
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-[12px] font-medium capitalize ${tab === k ? "border-b-2 border-[#c43b43] text-[#151922]" : "text-[#8b92a1]"}`}
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
  const decide = async (r: Row, status: "approved" | "rejected") => {
    const client = createClient();
    const { data: user } = await client.auth.getUser();
    const { error } = await client
      .from("approval_requests")
      .update({
        status,
        decided_by: user.user?.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", r.id)
      .eq("organization_id", orgId);
    if (error) return notice(error.message);
    if (r.resource_type === "quotation")
      await client
        .from("quotations")
        .update({
          status,
          approved_by: user.user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
    if (r.resource_type === "expense")
      await client
        .from("expenses")
        .update({ status: status === "approved" ? "approved" : "rejected" })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
    if (r.resource_type === "cash_flow")
      await client
        .from("cash_flow_entries")
        .update({
          status,
          approved_by: user.user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
    if (r.resource_type === "payroll")
      await client
        .from("payroll_periods")
        .update({
          status,
          approved_by: user.user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
    if (r.resource_type === "invoice_void" && status === "approved")
      await client
        .from("invoices")
        .update({
          status: "void",
          voided_by: user.user?.id,
          voided_at: new Date().toISOString(),
        })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
    if (r.resource_type === "payment_reversal" && status === "approved")
      await client
        .from("payments")
        .update({
          reversed_at: new Date().toISOString(),
          reversed_by: user.user?.id,
        })
        .eq("id", r.resource_id)
        .eq("organization_id", orgId);
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
                {admin && r.status === "pending" ? (
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
                  text(r.decision_note)
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
    </Panel>
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
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [defaultBankDetails, setDefaultBankDetails] = useState<BankDetail[]>([]);
  const [saving, setSaving] = useState(false);
  const setting = store.business_settings[0];
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
      .select("name,legal_name,address,phone,email,tin,logo_url")
      .eq("id", orgId)
      .single();
    if (error) return notice(error.message);
    setProfileValues({
      name: text(data?.name, ""),
      legal_name: text(data?.legal_name, ""),
      address: text(data?.address, ""),
      phone: text(data?.phone, ""),
      email: text(data?.email, ""),
      tin: text(data?.tin, ""),
      logo_url: text(data?.logo_url, ""),
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
        result.error ?? "Unable to create the Project Manager account.",
      );
    setProjectManagerOpen(false);
    setProjectManagerValues({});
    notice("Project Manager account created.");
    await reload();
  };
  const save = async () => {
    setSaving(true);
    const fields = [
      "vat_rate",
      "default_profit_margin",
      "default_overhead_rate",
      "default_buffer_margin",
      "production_commission",
      "sales_target_monthly",
      "sales_target_annual",
      "expense_approval_threshold",
    ];
    const payload: Record<string, unknown> = { ...values };
    payload.default_bank_details = defaultBankDetails.filter((detail) => detail.bank_name || detail.account_name || detail.account_number);
    fields.forEach((f) => (payload[f] = n(payload[f])));
    const { error } = await createClient()
      .from("business_settings")
      .upsert({ ...payload, organization_id: orgId });
    setSaving(false);
    if (error) return notice(error.message);
    setOpen(false);
    notice("Business settings saved.");
    await reload();
  };
  return (
    <div className="space-y-5">
      <Panel
        title="Business settings"
        detail="Default rates and terms for quotations, invoices, reports, and targets."
        action={
          <Button
            onClick={() => {
              setValues({
                vat_rate: text(setting?.vat_rate, "12"),
                default_profit_margin: text(
                  setting?.default_profit_margin,
                  "75",
                ),
                default_overhead_rate: text(
                  setting?.default_overhead_rate,
                  "0",
                ),
                default_buffer_margin: text(
                  setting?.default_buffer_margin,
                  "20",
                ),
                production_commission: text(
                  setting?.production_commission,
                  "5",
                ),
                quotation_prefix: text(setting?.quotation_prefix, "QT"),
                invoice_prefix: text(setting?.invoice_prefix, "INV"),
                sales_target_monthly: text(setting?.sales_target_monthly, "0"),
                sales_target_annual: text(setting?.sales_target_annual, "0"),
                expense_approval_threshold: text(
                  setting?.expense_approval_threshold,
                  "5000",
                ),
                company_policies: text(setting?.company_policies, ""),
              });
              setDefaultBankDetails(quotationBankDetails(setting?.default_bank_details));
              setOpen(true);
            }}
          >
            <Settings size={14} />
            Edit settings
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-px border-t border-[#edf0f5] bg-[#edf0f5] sm:grid-cols-4">
          {[
            ["VAT", `${n(setting?.vat_rate)}%`],
            ["Markup", `${n(setting?.default_profit_margin)}%`],
            ["Buffer", `${n(setting?.default_buffer_margin)}%`],
            ["Commission", `${n(setting?.production_commission)}%`],
          ].map(([label, value]) => (
            <div key={label} className="bg-white p-5">
              <p className="text-[11px] text-[#8b92a1]">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
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
          Business identity, address, contact details, TIN, and logo are managed
          here.
        </div>
      </Panel>
      <Panel
        title="Staff access"
        detail="Each person uses their own account; assign every Project Officer and Accountant separately."
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
                      : text(m.role) === "project_manager"
                        ? "Projects & quotations"
                        : "Scoped access"}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      {isSuperAdmin && (
        <Panel
          title="Project Manager Accounts"
          detail="Create the secure sign-in accounts used by Project Managers."
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
              Create Project Manager
            </Button>
          }
        >
          {store.organization_members.some(
            (member) => text(member.role) === "project_manager",
          ) ? (
            <Table labels={["Project Manager", "Account Status"]}>
              {store.organization_members
                .filter((member) => text(member.role) === "project_manager")
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
            <Empty>No Project Manager accounts have been created yet.</Empty>
          )}
        </Panel>
      )}
      {open && (
        <Dialog
          title="Business defaults"
          fields={[
            { key: "vat_rate", label: "VAT rate %", type: "number" },
            {
              key: "default_profit_margin",
              label: "Default markup %",
              type: "number",
            },
            {
              key: "default_overhead_rate",
              label: "Default overhead %",
              type: "number",
            },
            {
              key: "default_buffer_margin",
              label: "Default buffer %",
              type: "number",
            },
            {
              key: "production_commission",
              label: "Production commission %",
              type: "number",
            },
            { key: "quotation_prefix", label: "Quotation prefix" },
            { key: "invoice_prefix", label: "Invoice prefix" },
            {
              key: "sales_target_monthly",
              label: "Monthly sales target",
              type: "number",
            },
            {
              key: "sales_target_annual",
              label: "Annual sales target",
              type: "number",
            },
            {
              key: "expense_approval_threshold",
              label: "Expense approval threshold",
              type: "number",
            },
            {
              key: "company_policies",
              label: "Company policies",
              type: "textarea",
              hint: "Internal policies shown in the Company Profile settings.",
            },
          ]}
          values={values}
          setValues={setValues}
          save={() => void save()}
          close={() => setOpen(false)}
          saving={saving}
        >
          <section className="mt-5 border-t border-[#edf0f5] pt-5">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-[14px] font-semibold text-[#202938]">Default Bank Details</h3><p className="mt-0.5 text-[12px] text-[#687386]">Used for every new Costing Breakdown and Price Quotation.</p></div><Button secondary onClick={() => setDefaultBankDetails((current) => [...current, { bank_name: "", account_name: "", account_number: "" }])}><Plus size={13} /> Add bank</Button></div>
            <div className="mt-3 space-y-2">{defaultBankDetails.map((detail, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.8fr_1fr_1fr_auto]"><input aria-label={`Default bank ${index + 1} name`} value={detail.bank_name} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bank_name: event.target.value } : item))} placeholder="Bank name" className="input mt-0" /><input aria-label={`Default bank ${index + 1} account name`} value={detail.account_name} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_name: event.target.value } : item))} placeholder="Account name" className="input mt-0" /><input aria-label={`Default bank ${index + 1} account number`} value={detail.account_number} onChange={(event) => setDefaultBankDetails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, account_number: event.target.value } : item))} placeholder="Account number" className="input mt-0" /><button type="button" aria-label="Remove default bank" onClick={() => setDefaultBankDetails((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-9 place-items-center rounded text-[#8a95a6] transition-colors hover:bg-[#fff1f1] hover:text-[#b42318]"><Trash2 size={15} /></button></div>)}</div>
          </section>
        </Dialog>
      )}
      {projectManagerOpen && (
        <Dialog
          title="Create Project Manager Account"
          fields={[
            { key: "full_name", label: "Full Name", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            {
              key: "password",
              label: "Temporary Password",
              type: "password",
              required: true,
              hint: "At least 6 characters. Share this securely with the Project Manager.",
            },
          ]}
          values={projectManagerValues}
          setValues={setProjectManagerValues}
          save={() => void createProjectManager()}
          close={() => setProjectManagerOpen(false)}
          saving={creatingProjectManager}
          saveLabel="Create Project Manager"
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
            { key: "tin", label: "TIN" },
            { key: "logo_url", label: "Logo URL" },
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
  const [active, setActive] = useState<View>(
    initialView ?? (role === "accountant" ? "Finance" : "Dashboard"),
  );
  const [mobile, setMobile] = useState(false);
  const [store, setStore] = useState<Store>(blank);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [navigationDate, setNavigationDate] = useState(() => new Date());
  const client = useMemo(() => createClient(), []);
  const canEditOwnProfile = ["owner", "admin", "project_manager"].includes(
    role,
  );
  const load = useCallback(async () => {
    setLoading(true);
    const childTables: TableName[] = [
      "profiles",
      "quotation_items",
      "invoice_items",
      "payroll_entries",
    ];
    const results = await Promise.all(
      tables
        .filter((table) => canReadTable(role, table))
        .map(async (table) => ({
          table,
          result: childTables.includes(table)
            ? await client
                .from(table)
                .select("*")
                .order("created_at", { ascending: false })
            : await client
                .from(table)
                .select("*")
                .eq("organization_id", organizationId)
                .order("created_at", { ascending: false }),
        })),
    );
    const next = blank();
    const errors = results
      .filter((r) => r.result.error)
      .map((r) => `${r.table}: ${r.result.error?.message}`);
    results.forEach((r) => (next[r.table] = (r.result.data ?? []) as Row[]));
    setStore(next);
    setLoading(false);
    if (errors.length)
      setMessage(
        `Workspace data could not load: ${errors.join(" | ")}`,
      );
  }, [client, organizationId, role]);
  useEffect(() => {
    void load();
  }, [load]);
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
      "Costing Breakdown",
      "Price Quotations",
      "Suppliers & Materials",
      "Finance",
      "Submissions",
      "Settings",
    ],
    owner: [
      "Dashboard",
      "Leads",
      "Projects",
      "Costing Breakdown",
      "Price Quotations",
      "Suppliers & Materials",
      "Finance",
      "Submissions",
      "Settings",
    ],
    admin: [
      "Dashboard",
      "Leads",
      "Projects",
      "Costing Breakdown",
      "Price Quotations",
      "Suppliers & Materials",
      "Finance",
      "Submissions",
      "Settings",
    ],
    project_manager: [
      "Dashboard",
      "Leads",
      "Projects",
      "Costing Breakdown",
      "Price Quotations",
      "Suppliers & Materials",
    ],
    sales: ["Dashboard", "Quotations", "Catalog", "Sales", "Directory"],
    warehouse: ["Dashboard", "Catalog", "Inventory", "Production"],
    accountant: ["Finance"],
    payroll: ["Dashboard", "Payroll & Leave", "Directory"],
    production: ["Dashboard", "Production", "Inventory"],
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
    ],
  };
  const navBase: {
    label: string;
    items: { view: View; icon: typeof LayoutDashboard }[];
  }[] = [
    {
      label: "Project operations",
      items: [
        { view: "Dashboard", icon: LayoutDashboard },
        { view: "Leads", icon: ClipboardCheck },
        { view: "Costing Breakdown", icon: ReceiptText },
        { view: "Price Quotations", icon: FileText },
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
  ];
  const nav = navBase
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        (allowedViews[role] ?? allowedViews.viewer).includes(item.view),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const content =
    active === "Profile" ? (
      <AccountProfileDialog open embedded role={role} />
    ) : loading ? (
      <Panel
        title={
          active === "Leads" ? leads.title : active === "Projects" ? projects.title : "Loading workspace"
        }
        detail={
          active === "Leads" || active === "Projects"
            ? (active === "Projects" ? projects.detail : leads.detail)
            : "Loading business data."
        }
      >
        <div
          className={
            active === "Leads" || active === "Projects" ? "min-h-[280px]" : undefined
          }
        >
          <Empty>Loading records…</Empty>
        </div>
      </Panel>
    ) : active === "Dashboard" ? (
      <Dashboard store={store} go={setActive} role={role} />
    ) : active === "Leads" ? (
      <Records
        module={leads}
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
        leadMode="leads"
      />
    ) : active === "Projects" ? (
      <Records
        module={projects}
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
        leadMode="projects"
      />
    ) : active === "Costing Breakdown" ? (
      <Quotations
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
        profileName={profileName}
        mode="costing"
        pageLayout
      />
    ) : active === "Price Quotations" ? (
      <Quotations
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
        profileName={profileName}
        mode="quotation"
        pageLayout
      />
    ) : active === "Suppliers & Materials" ? (
      <SupplierMaterials
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Quotations" ? (
      <Panel
        title="Quotation workflow moved"
        detail="Price Quotations are generated only after General Manager approval of a Costing Breakdown."
      >
        <Empty>Use Costing Breakdown and Price Quotations to follow the current workflow.</Empty>
      </Panel>
    ) : active === "Production" ? (
      <Production
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Catalog" ? (
      <Records
        module={catalog}
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Inventory" ? (
      <Inventory
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Sales" ? (
      <Sales
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Expenses" ? (
      <Records
        module={expenses}
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Finance" ? (
      <FinanceReports
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Payroll & Leave" ? (
      <PayrollLeave
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Directory" ? (
      <Directory
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Targets" ? (
      <Records
        module={targets}
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    ) : active === "Approvals" ? (
      <Panel
        title="Approvals moved"
        detail="Costing Breakdowns are reviewed from Submissions so pricing, terms, and the generated Price Quotation remain together."
      >
        <Empty>Use Submissions to review Costing Breakdowns.</Empty>
      </Panel>
    ) : active === "Submissions" ? (
      <Submissions
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
      />
    ) : (
      <SettingsView
        store={store}
        orgId={organizationId}
        reload={load}
        notice={setMessage}
        role={role}
      />
    );
  return (
    <div className="huswell-workspace min-h-screen bg-[#fafafa] text-[#151922]">
      <LoadingModal open={loading} title="Loading workspace" message="Please wait a moment." />
      <aside
        className={`${mobile ? "translate-x-0" : "-translate-x-full"} sidebar-shell fixed inset-y-0 z-30 flex w-64 flex-col border-r border-[#e2e7ef] bg-white p-4 text-[#475467] transition-transform lg:translate-x-0`}
      >
        <div className="mb-7 flex flex-col items-center px-1">
          <Image
            src="https://www.huswelltrading.com/logo/huswell-logo.png"
            alt="Huswell Trading"
            width={112}
            height={52}
            priority
            className="huswell-sidebar-logo h-auto w-24"
          />
        </div>
        <nav className="sidebar-scroll flex-1 space-y-2 overflow-y-auto">
          {nav.map((group) => (
            <div key={group.label}>
              <div className="space-y-1">
                {group.items.map(({ view, icon: Icon }) => (
                  <button
                    key={view}
                    onClick={() => {
                      setActive(view);
                      setMobile(false);
                    }}
                    style={{
                      fontSize: "14px",
                      lineHeight: "20px",
                    }}
                    aria-current={active === view ? "page" : undefined}
                    className={`${active === view ? "bg-[#c43b43] font-medium text-white" : "text-[#475467] hover:bg-[#f7f7f8] hover:text-[#151922]"} group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2 focus-visible:ring-offset-white`}
                  >
                    <Icon
                      size={17}
                      className={`${active === view ? "text-white" : "text-[#626b7a] group-hover:text-[#151922] group-focus-visible:text-[#151922]"} shrink-0 transition-colors`}
                    />
                    <span className="min-w-0 flex-1 truncate">{view}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 border-t border-[#e2e7ef] pt-4">
          <div className="flex items-center px-2">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#151922]">
              {profileEmail}
            </span>
          </div>
          {canEditOwnProfile && (
            <a
              href="/profile"
              className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#475467] transition-colors hover:bg-[#f7f7f8] hover:text-[#151922]"
            >
              <UserRound size={17} />
              Profile
            </a>
          )}
          <button
            onClick={() => setSignOutOpen(true)}
            className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#475467] transition-colors hover:bg-[#f7f7f8] hover:text-[#151922]"
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      {signOutOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/30 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            className="w-full max-w-sm rounded-[14px] border border-[#d9e0e9] bg-white p-5"
          >
            <h2 id="sign-out-title" className="text-[16px] font-semibold">
              Sign out?
            </h2>
            <p className="mt-2 text-[13px] text-[#626b7a]">
              You will be returned to the sign-in page.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                secondary
                disabled={signingOut}
                onClick={() => setSignOutOpen(false)}
              >
                Cancel
              </Button>
              <Button
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
          className="fixed inset-0 z-20 bg-[#151922]/20 lg:hidden"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="min-h-screen bg-[#fafafa] lg:pl-64">
        <header className="flex min-h-[64px] items-center justify-between gap-3 border-b border-[#dfe5ed] bg-white px-4 py-3 sm:min-h-[72px] sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid size-10 shrink-0 place-items-center rounded-lg text-[#151922] hover:bg-[#f7f7f8] lg:hidden"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#151922] sm:text-[21px] lg:text-[23px]">
                {active === "Dashboard"
                  ? "Good morning, Huswell Team!"
                  : active}
              </h1>
              <p className="mt-1 truncate text-[12px] text-[#8b92a1]">
                Huswell Trading ·{" "}
                <span className="capitalize">
                  {role === "super_admin"
                    ? "Super Admin"
                    : role === "owner"
                      ? "Owner / General Manager"
                      : role === "admin"
                        ? "Administrator"
                        : role === "project_manager"
                          ? "Project Officer"
                          : role.replaceAll("_", " ")}
                </span>{" "}
                workspace
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[#626b7a]">
            <span className="hidden items-center gap-2 text-[12px] font-medium sm:flex">
              <CalendarDays size={17} />
              {new Intl.DateTimeFormat("en-PH", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }).format(navigationDate)}
            </span>
            {canEditOwnProfile ? (
              <a
                href="/profile"
                aria-label="Edit profile"
                className="grid size-9 place-items-center rounded-full bg-[#fceced] text-[11px] font-semibold text-[#ab3038] transition-colors hover:bg-[#f6d8da]"
              >
                {profileName.slice(0, 2).toUpperCase()}
              </a>
            ) : (
              <span className="grid size-9 place-items-center rounded-full bg-[#fceced] text-[11px] font-semibold text-[#ab3038]">
                {profileName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </header>
        <div className="workspace-content p-3 sm:p-4 lg:p-5">
          {message && (
            <div className="fixed inset-0 z-[60] grid place-items-center bg-[#061426]/30 p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="notification-title"
                className="w-full max-w-sm rounded-[14px] border border-[#dfe5ed] bg-white p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2
                      id="notification-title"
                      className="text-[16px] font-semibold text-[#151922]"
                    >
                      Notification
                    </h2>
                    <p className="mt-2 text-[13px] leading-5 text-[#626b7a]">
                      {message}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMessage(null)}
                    aria-label="Close notification"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-[#626b7a] hover:bg-[#f7f7f8]"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
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
