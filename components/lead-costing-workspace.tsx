"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Download, Pencil, Save, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Service = {
  id: string;
  name: string;
  examples: string | null;
  material_guidance: string | null;
  pricing_basis: string | null;
  notes: string | null;
};

type Material = {
  id: string;
  supplier_source: string;
  name: string;
  product_code: string | null;
  roll_width_m: number | null;
  roll_length_m: number | null;
  roll_price: number | null;
  cost_per_m2: number | null;
  source_note: string | null;
};

type Inventory = {
  id: string;
  material_id: string;
  full_rolls_on_hand: number | null;
  remaining_meters: number | null;
};

type PrinterCost = {
  id: string;
  item: string;
  unit: string | null;
  listed_cost: number | null;
  cost_per_unit: number | null;
  notes: string | null;
};

type Customer = {
  id: string;
  name: string;
  contact_details: string | null;
  inquiry: string | null;
  inquiry_status: string;
  follow_up_date: string | null;
  notes: string | null;
};

type Order = {
  id: string;
  order_no: string;
  order_date: string;
  customer_name: string;
  order_description: string;
  service_id: string | null;
  material_id: string | null;
  quantity: number;
  payment_mode: string;
  payment_status: string;
  amount_paid: number;
  balance_due: number;
  total_production_cost: number;
  total_quotation: number;
  estimated_profit: number;
};

type Tab = "calculator" | "services" | "materials" | "inventory" | "sales" | "customers" | "printer";
type Unit = "ft" | "in" | "m";
type Lamination = "none" | "matte" | "glossy";

type CalculatorForm = {
  serviceId: string;
  materialId: string;
  customerName: string;
  orderDescription: string;
  paymentMode: string;
  orderDate: string;
  amountPaid: string;
  width: string;
  height: string;
  unit: Unit;
  quantity: string;
  mediaRate: string;
  inkRate: string;
  lamination: Lamination;
  labor: string;
  otherCosts: string;
  margin: string;
  policyText: string;
};

type CustomerForm = {
  id: string | null;
  name: string;
  contactDetails: string;
  inquiry: string;
  status: string;
  followUpDate: string;
  notes: string;
};

const inquiryStatuses = [
  "New inquiry",
  "Replied",
  "Awaiting customer",
  "Follow-up needed",
  "Quoted",
  "Confirmed order",
  "In production",
  "Ready for pickup",
  "Completed",
  "Cancelled / lost",
];

const money = (value: number) =>
  `PHP ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString("en-PH")}`;
const numberValue = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const areaFactor = (unit: Unit) => (unit === "m" ? 1 : unit === "in" ? 1550.0031 : 10.7639104167);
const unitLabel = (unit: Unit) => (unit === "m" ? "sq m" : unit === "in" ? "sq in" : "sq ft");
const unitRate = (costPerM2: number, unit: Unit) => costPerM2 / areaFactor(unit);
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const blankCalculator = (): CalculatorForm => ({
  serviceId: "",
  materialId: "",
  customerName: "",
  orderDescription: "",
  paymentMode: "Cash",
  orderDate: new Date().toISOString().slice(0, 10),
  amountPaid: "0",
  width: "",
  height: "",
  unit: "ft",
  quantity: "1",
  mediaRate: "0",
  inkRate: "9.27",
  lamination: "none",
  labor: "0",
  otherCosts: "0",
  margin: "30",
  policyText: "Please confirm payment terms and order policies with Huswell Trading.",
});

const blankCustomer = (): CustomerForm => ({
  id: null,
  name: "",
  contactDetails: "",
  inquiry: "",
  status: "New inquiry",
  followUpDate: "",
  notes: "",
});

const calculate = (form: CalculatorForm, material: Material | undefined) => {
  const width = Math.max(0, numberValue(form.width));
  const height = Math.max(0, numberValue(form.height));
  const quantity = Math.max(1, Math.floor(numberValue(form.quantity) || 1));
  const unit = form.unit;
  const widthM = width * (unit === "ft" ? 0.3048 : unit === "in" ? 0.0254 : 1);
  const heightM = height * (unit === "ft" ? 0.3048 : unit === "in" ? 0.0254 : 1);
  const printedAreaM2 = widthM * heightM * quantity;
  const rollWidth = numberValue(material?.roll_width_m);
  const rollLength = numberValue(material?.roll_length_m);
  const candidates = rollWidth > 0 && rollLength > 0 && widthM > 0 && heightM > 0
    ? [[widthM, heightM], [heightM, widthM]]
      .map(([acrossWidth, alongLength]) => {
        const across = Math.floor((rollWidth + 0.000000001) / acrossWidth);
        if (across < 1) return null;
        const rows = Math.ceil(quantity / across);
        return { length: rows * alongLength, usedArea: rollWidth * rows * alongLength };
      })
      .filter((candidate): candidate is { length: number; usedArea: number } => Boolean(candidate))
    : [];
  const best = candidates.sort((left, right) => left.length - right.length)[0];
  const wasteArea = best ? Math.max(0, best.usedArea - printedAreaM2) : 0;
  const wastePercent = best?.usedArea ? (wasteArea / best.usedArea) * 100 : 0;
  const costAllowancePercent = printedAreaM2 ? (wasteArea / printedAreaM2) * 100 : 0;
  const areaPerItem = width * height;
  const mediaPerItem = areaPerItem * Math.max(0, numberValue(form.mediaRate));
  const inkPerItem = areaPerItem * Math.max(0, numberValue(form.inkRate));
  const areaIn2 = (widthM / 0.0254) * (heightM / 0.0254);
  const laminationPerItem = areaIn2 * (form.lamination === "matte" ? 0.008 : form.lamination === "glossy" ? 0.0755 : 0);
  const variablePerItem = mediaPerItem + inkPerItem + laminationPerItem;
  const wasteOrder = variablePerItem * quantity * (costAllowancePercent / 100);
  const fixedOrder = Math.max(0, numberValue(form.labor)) + Math.max(0, numberValue(form.otherCosts));
  const totalCost = variablePerItem * quantity + wasteOrder + fixedOrder;
  const costPerItem = totalCost / quantity;
  const margin = Math.min(95, Math.max(0, numberValue(form.margin))) / 100;
  const sellingPerItem = margin < 1 ? costPerItem / (1 - margin) : 0;
  const totalQuotation = sellingPerItem * quantity;
  const amountPaid = Math.min(totalQuotation, Math.max(0, numberValue(form.amountPaid)));
  const balance = Math.max(0, totalQuotation - amountPaid);
  const paymentStatus = balance <= 0.009 ? "Paid in full" : amountPaid > 0 ? "Partially paid" : "Unpaid";
  return {
    valid: width > 0 && height > 0 && Boolean(material),
    width,
    height,
    quantity,
    areaPerItem,
    printedAreaM2,
    requiredLength: best?.length ?? 0,
    rollLength,
    wastePercent,
    costAllowancePercent,
    mediaPerItem,
    inkPerItem,
    laminationPerItem,
    directPerItem: variablePerItem + fixedOrder / quantity,
    wastePerItem: wasteOrder / quantity,
    totalCost,
    costPerItem,
    sellingPerItem,
    totalQuotation,
    profit: totalQuotation - totalCost,
    amountPaid,
    balance,
    paymentStatus,
    stockFit: best ? "Calculated" : material ? "Material roll dimensions unavailable" : "Select a material",
  };
};

const inputClass = "mt-1 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[13px] text-[#202938] outline-none focus:border-[#1f4e79]";
const compactButton = "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[12px] font-medium text-[#1f4e79] hover:bg-[#f4f7fb]";
const primaryButton = "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#173b5c] disabled:cursor-not-allowed disabled:opacity-60";

export function LeadCostingWorkspace({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("calculator");
  const [services, setServices] = useState<Service[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [printerCosts, setPrinterCosts] = useState<PrinterCost[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [form, setForm] = useState<CalculatorForm>(blankCalculator);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(blankCustomer);
  const [newMaterial, setNewMaterial] = useState({ supplier: "", name: "", code: "", width: "", length: "", price: "", cost: "" });
  const [newService, setNewService] = useState({ name: "", examples: "", guidance: "", basis: "", notes: "" });
  const [mediaSearch, setMediaSearch] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [salesSearch, setSalesSearch] = useState("");
  const [salesStatus, setSalesStatus] = useState("All statuses");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerStatus, setCustomerStatus] = useState("All statuses");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const read = async <T,>(table: string, order = "created_at") => {
      const { data, error: readError } = await client.from(table).select("*").eq("organization_id", organizationId).order(order, { ascending: false });
      if (readError) throw readError;
      return (data ?? []) as T[];
    };
    try {
      const [loadedServices, loadedMaterials, loadedInventory, loadedPrinterCosts, loadedCustomers, loadedOrders] = await Promise.all([
        read<Service>("lead_costing_services", "name"),
        read<Material>("lead_costing_materials", "name"),
        read<Inventory>("lead_costing_inventory", "updated_at"),
        read<PrinterCost>("lead_costing_printer_costs", "item"),
        read<Customer>("lead_costing_customers", "updated_at"),
        read<Order>("lead_costing_orders", "order_date"),
      ]);
      setServices(loadedServices);
      setMaterials(loadedMaterials);
      setInventory(loadedInventory);
      setPrinterCosts(loadedPrinterCosts);
      setCustomers(loadedCustomers);
      setOrders(loadedOrders);
      setForm((current) => ({ ...current, serviceId: current.serviceId || loadedServices[0]?.id || "", materialId: current.materialId || loadedMaterials[0]?.id || "" }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Lead costing data could not load. Apply the lead costing migration first.");
    } finally {
      setLoading(false);
    }
  }, [client, organizationId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = client.channel(`lead-costing-data:${organizationId}`);
    ["lead_costing_services", "lead_costing_materials", "lead_costing_inventory", "lead_costing_printer_costs", "lead_costing_customers", "lead_costing_orders"].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` }, () => void load());
    });
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, load, organizationId]);

  const selectedMaterial = materials.find((material) => material.id === form.materialId);
  const selectedService = services.find((service) => service.id === form.serviceId);
  const result = useMemo(() => calculate(form, selectedMaterial), [form, selectedMaterial]);
  const inventoryByMaterial = useMemo(() => new Map(inventory.map((row) => [row.material_id, row])), [inventory]);
  const filteredMaterials = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    return query
      ? materials.filter((row) => [row.supplier_source, row.name, row.product_code].some((value) => value?.toLowerCase().includes(query)))
      : materials;
  }, [materials, mediaSearch]);
  const filteredInventoryMaterials = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return query
      ? materials.filter((row) => [row.supplier_source, row.name, row.product_code].some((value) => value?.toLowerCase().includes(query)))
      : materials;
  }, [materials, inventorySearch]);
  const filteredOrders = useMemo(() => {
    const query = salesSearch.trim().toLowerCase();
    return orders.filter((row) => {
      const matchesQuery = !query || [row.order_no, row.customer_name, row.order_description].some((value) => value.toLowerCase().includes(query));
      return matchesQuery && (salesStatus === "All statuses" || row.payment_status === salesStatus);
    });
  }, [orders, salesSearch, salesStatus]);
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    return customers.filter((row) => {
      const matchesQuery = !query || [row.name, row.contact_details, row.inquiry, row.notes].some((value) => value?.toLowerCase().includes(query));
      return matchesQuery && (customerStatus === "All statuses" || row.inquiry_status === customerStatus);
    });
  }, [customers, customerSearch, customerStatus]);
  const dashboard = useMemo(() => ({
    revenue: orders.reduce((sum, row) => sum + numberValue(row.total_quotation), 0),
    cost: orders.reduce((sum, row) => sum + numberValue(row.total_production_cost), 0),
    profit: orders.reduce((sum, row) => sum + numberValue(row.estimated_profit), 0),
    paid: orders.filter((row) => row.payment_status === "Paid in full").reduce((sum, row) => sum + numberValue(row.total_quotation), 0),
    paidAmount: orders.reduce((sum, row) => sum + numberValue(row.amount_paid), 0),
    unpaidBalance: orders.reduce((sum, row) => sum + numberValue(row.balance_due), 0),
  }), [orders]);
  const mediaSupplierCount = useMemo(() => new Set(materials.map((row) => row.supplier_source)).size, [materials]);
  const inventorySummary = useMemo(() => {
    let stocked = 0;
    let lowStock = 0;
    materials.forEach((material) => {
      const stock = inventoryByMaterial.get(material.id);
      const available = material.roll_length_m == null ? null : numberValue(stock?.full_rolls_on_hand) * material.roll_length_m + numberValue(stock?.remaining_meters);
      if (available != null && available > 0) stocked += 1;
      if (available != null && available <= 0) lowStock += 1;
    });
    return { stocked, lowStock };
  }, [inventoryByMaterial, materials]);
  const stockCheck = useMemo(() => {
    if (!selectedMaterial || !result.requiredLength || !selectedMaterial.roll_length_m) {
      return { requiredRolls: 0, availableMeters: null as number | null, status: result.stockFit };
    }
    const reserveLength = result.requiredLength * 1.1;
    const stock = inventoryByMaterial.get(selectedMaterial.id);
    const availableMeters = stock
      ? numberValue(stock.full_rolls_on_hand) * selectedMaterial.roll_length_m + numberValue(stock.remaining_meters)
      : 0;
    const requiredRolls = Math.ceil(reserveLength / selectedMaterial.roll_length_m);
    return {
      requiredRolls,
      availableMeters,
      status: availableMeters >= reserveLength ? "In stock" : stock ? "Insufficient stock" : "Stock not entered",
    };
  }, [inventoryByMaterial, result.requiredLength, result.stockFit, selectedMaterial]);
  const pickupEstimate = stockCheck.status === "In stock"
    ? "Estimated pickup: Today (tentative; subject to production and machine checks)"
    : stockCheck.status === "Insufficient stock"
      ? "To be confirmed - material shortage"
      : stockCheck.status === "Material roll dimensions unavailable"
        ? "To be confirmed - size/layout check needed"
        : "To be confirmed after stock and production check";

  const setField = <K extends keyof CalculatorForm>(key: K, value: CalculatorForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const saveOrder = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!result.valid || !selectedMaterial || !selectedService) throw new Error("Enter dimensions and select a service and material before saving.");
      const { data: userData } = await client.auth.getUser();
      if (!userData.user) throw new Error("Sign in again before saving a costing order.");
      let customerId = customers.find((customer) => customer.name.trim().toLowerCase() === form.customerName.trim().toLowerCase())?.id ?? null;
      if (!customerId && form.customerName.trim()) {
        const { data: createdCustomer, error: customerError } = await client.from("lead_costing_customers").insert({
          organization_id: organizationId,
          name: form.customerName.trim(),
          inquiry: `${form.orderDescription.trim() || selectedService.name} - ${result.width} x ${result.height} ${form.unit} - Qty ${result.quantity}`,
          inquiry_status: "Quoted",
          created_by: userData.user.id,
        }).select("id").single();
        if (customerError) throw customerError;
        customerId = createdCustomer?.id ?? null;
      }
      const { error: orderError } = await client.rpc("create_lead_costing_order", {
        p_organization_id: organizationId,
        p_customer_id: customerId,
        p_service_id: selectedService.id,
        p_material_id: selectedMaterial.id,
        p_order_date: form.orderDate || null,
        p_customer_name: form.customerName.trim() || "Walk-in / not specified",
        p_order_description: form.orderDescription.trim() || selectedService.name,
        p_payment_mode: form.paymentMode,
        p_amount_paid: result.amountPaid,
        p_width: result.width,
        p_height: result.height,
        p_measurement_unit: form.unit,
        p_quantity: result.quantity,
        p_media_rate: numberValue(form.mediaRate),
        p_ink_rate: numberValue(form.inkRate),
        p_lamination_type: form.lamination,
        p_labor_per_order: numberValue(form.labor),
        p_other_costs_per_order: numberValue(form.otherCosts),
        p_target_margin: numberValue(form.margin),
        p_policy_text: form.policyText,
      });
      if (orderError) throw orderError;
      setMessage("Costing order saved to Huswell records.");
      setTab("sales");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The costing order could not be saved.");
    } finally { setSaving(false); }
  };

  const saveCustomer = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!customerForm.name.trim()) throw new Error("Enter a customer name before saving.");
      const { data: userData } = await client.auth.getUser();
      if (!userData.user) throw new Error("Sign in again before saving a customer.");
      const payload = {
        organization_id: organizationId,
        name: customerForm.name.trim(),
        contact_details: customerForm.contactDetails.trim() || null,
        inquiry: customerForm.inquiry.trim() || null,
        inquiry_status: customerForm.status,
        follow_up_date: customerForm.followUpDate || null,
        notes: customerForm.notes.trim() || null,
        created_by: userData.user.id,
      };
      const query = customerForm.id
        ? client.from("lead_costing_customers").update(payload).eq("id", customerForm.id).eq("organization_id", organizationId)
        : client.from("lead_costing_customers").insert(payload);
      const { error: customerError } = await query;
      if (customerError) throw customerError;
      setCustomerForm(blankCustomer()); setMessage("Customer record saved."); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Customer record could not be saved."); }
    finally { setSaving(false); }
  };

  const saveMaterial = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!newMaterial.supplier.trim() || !newMaterial.name.trim()) throw new Error("Supplier and material name are required.");
      const { data: userData } = await client.auth.getUser();
      if (!userData.user) throw new Error("Sign in again before saving a material.");
      const { error: materialError } = await client.from("lead_costing_materials").insert({
        organization_id: organizationId,
        supplier_source: newMaterial.supplier.trim(),
        name: newMaterial.name.trim(),
        product_code: newMaterial.code.trim() || null,
        roll_width_m: newMaterial.width ? numberValue(newMaterial.width) : null,
        roll_length_m: newMaterial.length ? numberValue(newMaterial.length) : null,
        roll_price: newMaterial.price ? numberValue(newMaterial.price) : null,
        cost_per_m2: newMaterial.cost ? numberValue(newMaterial.cost) : null,
        created_by: userData.user.id,
      });
      if (materialError) throw materialError;
      setNewMaterial({ supplier: "", name: "", code: "", width: "", length: "", price: "", cost: "" }); setMessage("Material saved."); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Material could not be saved."); }
    finally { setSaving(false); }
  };

  const saveService = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!newService.name.trim()) throw new Error("Service name is required.");
      const { error: serviceError } = await client.from("lead_costing_services").insert({ organization_id: organizationId, name: newService.name.trim(), examples: newService.examples.trim() || null, material_guidance: newService.guidance.trim() || null, pricing_basis: newService.basis.trim() || null, notes: newService.notes.trim() || null });
      if (serviceError) throw serviceError;
      setNewService({ name: "", examples: "", guidance: "", basis: "", notes: "" }); setMessage("Service saved."); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Service could not be saved."); }
    finally { setSaving(false); }
  };

  const updatePrinterCost = async (row: PrinterCost, value: string) => {
    const { error: updateError } = await client.from("lead_costing_printer_costs").update({ cost_per_unit: value === "" ? null : Math.max(0, numberValue(value)) }).eq("id", row.id).eq("organization_id", organizationId);
    if (updateError) setError(updateError.message); else await load();
  };

  const updateInventory = async (materialId: string, key: "full_rolls_on_hand" | "remaining_meters", value: string) => {
    const current = inventoryByMaterial.get(materialId);
    const payload = { organization_id: organizationId, material_id: materialId, full_rolls_on_hand: current?.full_rolls_on_hand ?? null, remaining_meters: current?.remaining_meters ?? null };
    const nextValue = value === "" ? null : Math.max(0, numberValue(value));
    const nextPayload = key === "full_rolls_on_hand"
      ? { ...payload, full_rolls_on_hand: nextValue }
      : { ...payload, remaining_meters: nextValue };
    const { data: userData } = await client.auth.getUser();
    const { error: updateError } = await client.from("lead_costing_inventory").upsert({ ...nextPayload, updated_by: userData.user?.id ?? null }, { onConflict: "organization_id,material_id" });
    if (updateError) setError(updateError.message); else await load();
  };

  const updateOrderStatus = async (order: Order, status: string) => {
    const total = numberValue(order.total_quotation);
    const paid = status === "Paid in full" ? total : status === "Unpaid" ? 0 : Math.min(total, numberValue(order.amount_paid));
    const { error: updateError } = await client.from("lead_costing_orders").update({ payment_status: status, amount_paid: paid, balance_due: Math.max(0, total - paid) }).eq("id", order.id).eq("organization_id", organizationId);
    if (updateError) setError(updateError.message); else await load();
  };

  const deleteRow = async (table: string, id: string, label: string) => {
    if (!window.confirm(`Delete this ${label}?`)) return;
    const { error: deleteError } = await client.from(table).delete().eq("id", id).eq("organization_id", organizationId);
    if (deleteError) setError(deleteError.message); else { setMessage(`${label} deleted.`); await load(); }
  };

  const exportOrders = () => {
    const headers = ["Order", "Date", "Customer", "Description", "Quantity", "Payment status", "Total quotation", "Production cost", "Estimated profit"];
    const rows = orders.map((row) => [row.order_no, row.order_date, row.customer_name, row.order_description, row.quantity, row.payment_status, row.total_quotation, row.total_production_cost, row.estimated_profit]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "Huswell_Lead_Costing_Sales.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const exportCustomers = () => {
    const headers = ["Customer", "Contact details", "Inquiry", "Status", "Follow-up date", "Notes"];
    const rows = customers.map((row) => [row.name, row.contact_details, row.inquiry, row.inquiry_status, row.follow_up_date, row.notes]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "Huswell_Lead_Costing_Customers.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const clearSales = async () => {
    if (!window.confirm("Delete all saved Lead & Costing orders for this organization?")) return;
    setSaving(true); setError(null); setMessage(null);
    const { error: deleteError } = await client.from("lead_costing_orders").delete().eq("organization_id", organizationId);
    if (deleteError) setError(deleteError.message); else { setMessage("Saved sales records cleared."); await load(); }
    setSaving(false);
  };

  const quoteText = [
    "Huswell Trading costing quote",
    `Customer: ${form.customerName || "Walk-in / not specified"}`,
    `Service: ${selectedService?.name || "Not selected"}`,
    `Material: ${selectedMaterial?.name || "Not selected"}`,
    `Description: ${form.orderDescription || selectedService?.name || "Not specified"}`,
    `Size: ${result.width} x ${result.height} ${form.unit}; quantity ${result.quantity}`,
    `Total quotation: ${money(result.totalQuotation)}`,
    `Amount paid: ${money(result.amountPaid)}; balance: ${money(result.balance)}`,
    `Payment status: ${result.paymentStatus}`,
    form.policyText ? `Policies: ${form.policyText}` : "",
  ].filter(Boolean).join("\n");

  const copyQuote = async () => {
    try {
      await navigator.clipboard.writeText(quoteText);
      setMessage("Quote copied to the clipboard.");
    } catch {
      setError("The quote could not be copied. Check browser clipboard permissions.");
    }
  };

  const printQuote = () => {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setError("The print window was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>Huswell Costing Quote</title><style>body{font:14px Arial,sans-serif;color:#202938;padding:32px}h1{color:#1f4e79;font-size:22px}h2{font-size:16px;border-bottom:1px solid #dfe5ed;padding-bottom:6px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #edf0f5;padding:8px 0}.total{font-size:18px;font-weight:bold;color:#13845a}.note{margin-top:24px;color:#687386;font-size:12px;white-space:pre-wrap}@media print{body{padding:0}}</style></head><body><h1>Huswell Trading</h1><div>${escapeHtml(form.orderDate)}</div><h2>Quotation</h2><div class="row"><span>Customer</span><strong>${escapeHtml(form.customerName || "Walk-in / not specified")}</strong></div><div class="row"><span>Service</span><strong>${escapeHtml(selectedService?.name || "Not selected")}</strong></div><div class="row"><span>Material</span><strong>${escapeHtml(selectedMaterial?.name || "Not selected")}</strong></div><div class="row"><span>Description</span><strong>${escapeHtml(form.orderDescription || selectedService?.name || "Not specified")}</strong></div><div class="row"><span>Size / quantity</span><strong>${escapeHtml(`${result.width} x ${result.height} ${form.unit}; ${result.quantity}`)}</strong></div><div class="row total"><span>Total quotation</span><strong>${escapeHtml(money(result.totalQuotation))}</strong></div><div class="row"><span>Paid / balance</span><strong>${escapeHtml(`${money(result.amountPaid)} / ${money(result.balance)}`)}</strong></div><div class="note">${escapeHtml(form.policyText)}</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  };

  const printOrder = (order: Order, copy: "customer" | "admin") => {
    const title = copy === "customer" ? "Customer Costing Copy" : "Admin Costing Copy";
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setError("The print window was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(title)} - ${escapeHtml(order.order_no)}</title><style>body{font:14px Arial,sans-serif;color:#202938;padding:32px}h1{color:#1f4e79;font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #dfe5ed;padding-bottom:6px}.meta{color:#687386;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #edf0f5;padding:8px 0}.total{font-size:18px;font-weight:bold;color:#13845a;margin-top:16px}.note{margin-top:28px;color:#687386;font-size:12px}@media print{body{padding:0}}</style></head><body><h1>Huswell Trading</h1><div class="meta">${escapeHtml(title)} | ${escapeHtml(order.order_no)} | ${escapeHtml(order.order_date)}</div><div class="grid"><div><strong>Customer</strong><br>${escapeHtml(order.customer_name)}</div><div><strong>Description</strong><br>${escapeHtml(order.order_description)}</div><div><strong>Quantity</strong><br>${escapeHtml(order.quantity)}</div><div><strong>Payment</strong><br>${escapeHtml(order.payment_status)}</div></div><h2>Costing summary</h2><div class="row"><span>Production cost</span><strong>${escapeHtml(money(numberValue(order.total_production_cost)))}</strong></div><div class="row"><span>Estimated profit</span><strong>${escapeHtml(money(numberValue(order.estimated_profit)))}</strong></div><div class="row total"><span>Total quotation</span><strong>${escapeHtml(money(numberValue(order.total_quotation)))}</strong></div><div class="note">This copy was generated from the Huswell Lead &amp; Costing records.</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "calculator", label: "Live calculator" },
    { id: "services", label: "Service menu" },
    { id: "materials", label: "Media price list" },
    { id: "inventory", label: "Material inventory" },
    { id: "sales", label: "Sales dashboard" },
    { id: "customers", label: "Customer records" },
    { id: "printer", label: "Printer costs" },
  ];

  if (loading) return <div className="rounded-md border border-[#dfe5ed] bg-white p-6 text-[13px] text-[#687386]">Loading Lead &amp; Costing Coordinator data...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] pb-3">
        <div><h2 className="text-[18px] font-medium text-[#1f4e79]">Lead &amp; Costing Coordinator</h2><p className="mt-1 text-[12px] text-[#687386]">HP Latex service costing, materials, inventory, sales, and customer follow-up.</p></div>
        <div className="text-right text-[11px] text-[#687386]">{materials.length} materials - {orders.length} saved orders</div>
      </div>
      {message && <div className="rounded-md border border-[#b9dec9] bg-[#f0fbf4] px-3 py-2 text-[12px] text-[#17623b]">{message}</div>}
      {error && <div className="rounded-md border border-[#efc4c8] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#9d2831]">{error}</div>}
      <div className="flex flex-wrap gap-1 border-b border-[#e4e8ef] pb-2">
        {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={tab === item.id ? "rounded-md bg-[#1f4e79] px-3 py-2 text-[12px] font-medium text-white" : compactButton}>{item.label}</button>)}
      </div>

      {tab === "calculator" && <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
        <section className="rounded-md border border-[#dfe5ed] bg-white p-4">
          <div className="mb-3 flex items-center gap-2"><Calculator size={17} className="text-[#1f4e79]" /><h3 className="text-[15px] font-medium text-[#1f4e79]">Order details &amp; production costs</h3></div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[12px] font-medium text-[#465a74]">Service type<select className={inputClass} value={form.serviceId} onChange={(event) => setField("serviceId", event.target.value)}><option value="">Select service</option>{services.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="text-[12px] font-medium text-[#465a74]">Media / material<select className={inputClass} value={form.materialId} onChange={(event) => { const material = materials.find((row) => row.id === event.target.value); setForm((current) => ({ ...current, materialId: event.target.value, mediaRate: material?.cost_per_m2 == null ? current.mediaRate : String(unitRate(numberValue(material.cost_per_m2), current.unit)) })); }}><option value="">Select material</option>{materials.map((row) => <option key={row.id} value={row.id}>{row.name} — {row.supplier_source}</option>)}</select></label>
            <label className="text-[12px] font-medium text-[#465a74]">Customer name<input className={inputClass} value={form.customerName} onChange={(event) => setField("customerName", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Order description<input className={inputClass} value={form.orderDescription} onChange={(event) => setField("orderDescription", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Width<input className={inputClass} type="number" min="0" step="any" value={form.width} onChange={(event) => setField("width", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Height<input className={inputClass} type="number" min="0" step="any" value={form.height} onChange={(event) => setField("height", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Measurement unit<select className={inputClass} value={form.unit} onChange={(event) => { const next = event.target.value as Unit; const currentRate = numberValue(form.inkRate); const previous = form.unit; const converted = currentRate * areaFactor(previous) / areaFactor(next); const material = materials.find((row) => row.id === form.materialId); setForm((current) => ({ ...current, unit: next, inkRate: String(converted), mediaRate: material?.cost_per_m2 == null ? current.mediaRate : String(unitRate(numberValue(material.cost_per_m2), next)) })); }}><option value="ft">Feet (ft)</option><option value="in">Inches (in)</option><option value="m">Meters (m)</option></select></label>
            <label className="text-[12px] font-medium text-[#465a74]">Quantity<input className={inputClass} type="number" min="1" step="1" value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Media cost (₱ / {unitLabel(form.unit)})<input className={inputClass} type="number" min="0" step="any" value={form.mediaRate} onChange={(event) => setField("mediaRate", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Ink (₱ / {unitLabel(form.unit)})<input className={inputClass} type="number" min="0" step="any" value={form.inkRate} onChange={(event) => setField("inkRate", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Lamination / finishing<select className={inputClass} value={form.lamination} onChange={(event) => setField("lamination", event.target.value as Lamination)}><option value="none">No lamination</option><option value="matte">Matte</option><option value="glossy">Glossy</option></select></label>
            <label className="text-[12px] font-medium text-[#465a74]">Labor / machine setup per order<input className={inputClass} type="number" min="0" step="any" value={form.labor} onChange={(event) => setField("labor", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Other costs per order<input className={inputClass} type="number" min="0" step="any" value={form.otherCosts} onChange={(event) => setField("otherCosts", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Target gross profit margin (%)<input className={inputClass} type="number" min="0" max="95" step="any" value={form.margin} onChange={(event) => setField("margin", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Quotation date<input className={inputClass} type="date" value={form.orderDate} onChange={(event) => setField("orderDate", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74]">Mode of payment<select className={inputClass} value={form.paymentMode} onChange={(event) => setField("paymentMode", event.target.value)}><option>Cash</option><option>GCash</option><option>Bank transfer</option><option>Credit / terms</option><option>Other / to be agreed</option></select></label>
            <label className="text-[12px] font-medium text-[#465a74]">Amount paid so far<input className={inputClass} type="number" min="0" step="any" value={form.amountPaid} onChange={(event) => setField("amountPaid", event.target.value)} /></label>
            <label className="text-[12px] font-medium text-[#465a74] md:col-span-2">Customer policies / terms<textarea className={`${inputClass} min-h-20`} value={form.policyText} onChange={(event) => setField("policyText", event.target.value)} /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={saving || !materials.length} onClick={() => void saveOrder()}><Save size={14} />{saving ? "Saving..." : "Save order to Sales"}</button><button type="button" className={compactButton} onClick={() => void copyQuote()}>Copy quote</button><button type="button" className={compactButton} onClick={printQuote}>Print quote</button><button type="button" className={compactButton} onClick={() => setForm({ ...blankCalculator(), serviceId: services[0]?.id ?? "", materialId: materials[0]?.id ?? "" })}>Reset calculator</button></div>
        </section>
        <section className="space-y-3">
          <div className="rounded-md border border-[#dfe5ed] bg-white p-4"><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Automatic costing results</h3><div className="grid gap-2 text-[13px]">{[["Printed area", `${result.areaPerItem.toFixed(4)} ${unitLabel(form.unit)} / item`], ["Material cost", money(result.mediaPerItem)], ["Ink cost", money(result.inkPerItem)], ["Lamination", money(result.laminationPerItem)], ["Direct cost / item", money(result.directPerItem)], ["Estimated wastage", `${result.wastePercent.toFixed(2)}%`], ["Wastage cost / item", money(result.wastePerItem)], ["Production cost / item", money(result.costPerItem)], ["Production cost / quantity", money(result.totalCost)]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 border-b border-[#edf0f5] py-2"><span className="text-[#687386]">{label}</span><strong className="text-right text-[#202938]">{value}</strong></div>)}</div><div className="mt-3 rounded-md bg-[#13845a] p-4 text-white"><div className="text-[11px] opacity-80">Suggested selling price / item</div><div className="text-[26px] font-medium">{money(result.sellingPerItem)}</div><div className="text-[12px]">Total quotation: {money(result.totalQuotation)} · Estimated gross profit: {money(result.profit)}</div><div className="mt-2 text-[12px] opacity-90">{result.paymentStatus} · Paid: {money(result.amountPaid)} · Balance: {money(result.balance)}</div></div></div>
          <div className="rounded-md border border-[#dfe5ed] bg-white p-4"><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Material quantity check</h3><div className="grid gap-2 text-[13px]"><div className="flex justify-between"><span className="text-[#687386]">Required length</span><strong>{result.requiredLength ? `${(result.requiredLength * 1.1).toFixed(2)} m incl. 10% reserve` : "Cannot estimate"}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Required rolls</span><strong>{stockCheck.requiredRolls || "Cannot estimate"}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Available meters</span><strong>{stockCheck.availableMeters == null ? "Not entered" : `${stockCheck.availableMeters.toFixed(2)} m`}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Stock status</span><strong>{stockCheck.status}</strong></div></div><p className="mt-3 text-[12px] text-[#687386]">{pickupEstimate}</p><button type="button" className={`${compactButton} mt-2`} onClick={() => setTab("inventory")}>Open inventory</button></div>
        </section>
      </div>}

      {tab === "services" && <section className="space-y-3"><div className="rounded-md border border-[#dfe5ed] bg-white p-4"><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Add service</h3><div className="grid gap-2 md:grid-cols-5">{[["name", "Service name"], ["examples", "Examples"], ["guidance", "Suggested media"], ["basis", "Pricing basis"], ["notes", "Notes"]].map(([key, label]) => <input key={key} className={inputClass} placeholder={label} value={newService[key as keyof typeof newService]} onChange={(event) => setNewService((current) => ({ ...current, [key]: event.target.value }))} />)}</div><button type="button" className={`${primaryButton} mt-3`} disabled={saving} onClick={() => void saveService()}><Save size={14} />Save service</button></div><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[760px] text-[12px]"><thead><tr><th>Service</th><th>Examples</th><th>Suggested media</th><th>Pricing basis</th><th>Notes</th></tr></thead><tbody>{services.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.examples}</td><td>{row.material_guidance}</td><td>{row.pricing_basis}</td><td>{row.notes}</td></tr>)}</tbody></table></div></section>}

      {tab === "materials" && <section className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border border-[#dfe5ed] bg-white p-3"><div className="text-[11px] text-[#687386]">Media records</div><strong className="text-[18px] text-[#1f4e79]">{materials.length}</strong></div><div className="rounded-md border border-[#dfe5ed] bg-white p-3"><div className="text-[11px] text-[#687386]">Suppliers / sources</div><strong className="text-[18px] text-[#1f4e79]">{mediaSupplierCount}</strong></div></div><div className="rounded-md border border-[#dfe5ed] bg-white p-4"><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Add media / material</h3><div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7">{[["supplier", "Supplier / source"], ["name", "Material"], ["code", "Product code"], ["width", "Roll width (m)"], ["length", "Roll length (m)"], ["price", "Roll price"], ["cost", "Cost / m²"]].map(([key, label]) => <input key={key} className={inputClass} placeholder={label} type={(["width", "length", "price", "cost"].includes(key) ? "number" : "text")} value={newMaterial[key as keyof typeof newMaterial]} onChange={(event) => setNewMaterial((current) => ({ ...current, [key]: event.target.value }))} />)}</div><button type="button" className={`${primaryButton} mt-3`} disabled={saving} onClick={() => void saveMaterial()}><Save size={14} />Save material</button></div><label className="block text-[12px] font-medium text-[#465a74]">Search media list<input className={inputClass} value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} placeholder="Search supplier, material, or product code" /></label><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[900px] text-[12px]"><thead><tr><th>Supplier/source</th><th>Material</th><th>Code</th><th>Roll</th><th>Roll price</th><th>Cost / m²</th><th>Actions</th></tr></thead><tbody>{filteredMaterials.map((row) => <tr key={row.id}><td>{row.supplier_source}</td><td>{row.name}</td><td>{row.product_code || "—"}</td><td>{row.roll_width_m && row.roll_length_m ? `${row.roll_width_m} × ${row.roll_length_m} m` : "—"}</td><td>{row.roll_price == null ? "—" : money(row.roll_price)}</td><td>{row.cost_per_m2 == null ? "—" : money(row.cost_per_m2)}</td><td><button type="button" className="text-[#a12d36]" onClick={() => void deleteRow("lead_costing_materials", row.id, "material")}>Delete</button></td></tr>)}</tbody></table></div></section>}

      {tab === "inventory" && <section className="table-shell overflow-x-auto"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md border border-[#dfe5ed] bg-white p-3"><div className="text-[11px] text-[#687386]">Materials</div><strong className="text-[18px] text-[#1f4e79]">{materials.length}</strong></div><div className="rounded-md border border-[#dfe5ed] bg-white p-3"><div className="text-[11px] text-[#687386]">Stocked</div><strong className="text-[18px] text-[#13845a]">{inventorySummary.stocked}</strong></div><div className="rounded-md border border-[#dfe5ed] bg-white p-3"><div className="text-[11px] text-[#687386]">Low / empty</div><strong className="text-[18px] text-[#a12d36]">{inventorySummary.lowStock}</strong></div></div><div className="border-b border-[#dfe5ed] bg-white p-3"><label className="block text-[12px] font-medium text-[#465a74]">Search inventory<input className={inputClass} value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search supplier, material, or product code" /></label></div><div className="flex items-center justify-between gap-3 border-b border-[#dfe5ed] bg-white p-4"><div><h3 className="text-[15px] font-medium text-[#1f4e79]">Material inventory &amp; order fit checker</h3><p className="mt-1 text-[12px] text-[#687386]">Enter full rolls and remaining meters for the stock calculation.</p></div><button type="button" className={compactButton} onClick={() => { const rows = materials.map((material) => { const row = inventoryByMaterial.get(material.id); return [material.supplier_source, material.name, material.product_code, row?.full_rolls_on_hand ?? "", row?.remaining_meters ?? ""]; }); const csv = [["Supplier", "Material", "Product code", "Full rolls", "Remaining meters"], ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = "Huswell_Lead_Costing_Inventory.csv"; link.click(); URL.revokeObjectURL(url); }}><Download size={14} />Export CSV</button></div><table className="app-table w-full min-w-[820px] text-[12px]"><thead><tr><th>Supplier/source</th><th>Material</th><th>Roll</th><th>Full rolls</th><th>Remaining meters</th><th>Available meters</th><th>Status</th></tr></thead><tbody>{filteredInventoryMaterials.map((material) => { const row = inventoryByMaterial.get(material.id); const available = material.roll_length_m ? numberValue(row?.full_rolls_on_hand) * material.roll_length_m + numberValue(row?.remaining_meters) : null; return <tr key={material.id}><td>{material.supplier_source}</td><td>{material.name}</td><td>{material.roll_width_m && material.roll_length_m ? `${material.roll_width_m} × ${material.roll_length_m} m` : "—"}</td><td><input className="w-24 rounded border border-[#cfd8e3] px-2 py-1" type="number" min="0" step="1" value={row?.full_rolls_on_hand ?? ""} onChange={(event) => void updateInventory(material.id, "full_rolls_on_hand", event.target.value)} /></td><td><input className="w-24 rounded border border-[#cfd8e3] px-2 py-1" type="number" min="0" step="0.01" value={row?.remaining_meters ?? ""} onChange={(event) => void updateInventory(material.id, "remaining_meters", event.target.value)} /></td><td>{available == null ? "—" : `${available.toFixed(2)} m`}</td><td>{available == null ? "Not entered" : available > 0 ? "In stock" : "Out of stock"}</td></tr>; })}</tbody></table></section>}

      {tab === "sales" && <section className="space-y-3"><div className="flex flex-wrap items-end gap-2"><label className="min-w-64 flex-1 text-[12px] font-medium text-[#465a74]">Search sales<input className={inputClass} value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder="Search order, customer, or description" /></label><label className="text-[12px] font-medium text-[#465a74]">Payment status<select className={inputClass} value={salesStatus} onChange={(event) => setSalesStatus(event.target.value)}><option>All statuses</option><option>Unpaid</option><option>Deposit paid</option><option>Partially paid</option><option>Paid in full</option></select></label></div><div className="grid gap-3 md:grid-cols-4">{[["Revenue", dashboard.revenue], ["Production cost", dashboard.cost], ["Estimated profit", dashboard.profit], ["Paid in full", dashboard.paid], ["Paid amount", dashboard.paidAmount], ["Unpaid balance", dashboard.unpaidBalance], ["Saved orders", orders.length]].map(([label, value]) => <div key={label as string} className="rounded-md border border-[#dfe5ed] bg-white p-4"><div className="text-[11px] text-[#687386]">{label}</div><strong className="mt-1 block text-[20px] font-medium text-[#1f4e79]">{money(numberValue(value as number))}</strong></div>)}</div><div className="table-shell overflow-x-auto"><div className="flex justify-end border-b border-[#dfe5ed] bg-white p-3"><div className="flex flex-wrap gap-2"><button type="button" className={compactButton} onClick={exportOrders}><Download size={14} />Export sales CSV</button><button type="button" className={compactButton} disabled={saving || !orders.length} onClick={() => void clearSales()}>Clear saved sales</button></div></div><table className="app-table w-full min-w-[1180px] text-[12px]"><thead><tr><th>Date</th><th>Customer</th><th>Order</th><th>Qty</th><th>Payment</th><th>Total</th><th>Cost</th><th>Profit</th><th>Print</th><th>Action</th></tr></thead><tbody>{filteredOrders.map((row) => <tr key={row.id}><td>{row.order_date}</td><td>{row.customer_name}</td><td>{row.order_description}<div className="text-[10px] text-[#687386]">{row.order_no}</div></td><td>{row.quantity}</td><td><select className="rounded border border-[#cfd8e3] px-2 py-1" value={row.payment_status} onChange={(event) => void updateOrderStatus(row, event.target.value)}><option>Unpaid</option><option>Deposit paid</option><option>Partially paid</option><option>Paid in full</option></select></td><td>{money(row.total_quotation)}</td><td>{money(row.total_production_cost)}</td><td>{money(row.estimated_profit)}</td><td className="whitespace-nowrap"><button type="button" className="mr-2 text-[#1f4e79]" onClick={() => printOrder(row, "customer")}>Customer</button><button type="button" className="text-[#1f4e79]" onClick={() => printOrder(row, "admin")}>Admin</button></td><td><button type="button" className="text-[#a12d36]" onClick={() => void deleteRow("lead_costing_orders", row.id, "order")}>Delete</button></td></tr>)}</tbody></table></div></section>}

      {tab === "customers" && <section className="space-y-3"><div className="flex flex-wrap items-end gap-2"><label className="min-w-64 flex-1 text-[12px] font-medium text-[#465a74]">Search customers<input className={inputClass} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search name, contact, inquiry, or notes" /></label><label className="text-[12px] font-medium text-[#465a74]">Inquiry status<select className={inputClass} value={customerStatus} onChange={(event) => setCustomerStatus(event.target.value)}><option>All statuses</option>{inquiryStatuses.map((status) => <option key={status}>{status}</option>)}</select></label><button type="button" className={compactButton} onClick={exportCustomers}><Download size={14} />Export customers CSV</button></div><div className="rounded-md border border-[#dfe5ed] bg-white p-4"><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Customer records &amp; inquiry follow-up</h3><div className="grid gap-2 md:grid-cols-3">{[["name", "Customer name"], ["contactDetails", "Contact details"], ["inquiry", "Inquiry / requested service"], ["followUpDate", "Follow-up date"], ["notes", "Notes"]].map(([key, label]) => <input key={key} className={inputClass} placeholder={label} type={key === "followUpDate" ? "date" : "text"} value={customerForm[key as keyof CustomerForm] as string} onChange={(event) => setCustomerForm((current) => ({ ...current, [key]: event.target.value }))} />)}<select className={inputClass} value={customerForm.status} onChange={(event) => setCustomerForm((current) => ({ ...current, status: event.target.value }))}>{inquiryStatuses.map((status) => <option key={status}>{status}</option>)}</select></div><div className="mt-3 flex gap-2"><button type="button" className={primaryButton} disabled={saving} onClick={() => void saveCustomer()}><Save size={14} />{customerForm.id ? "Update customer" : "Save customer"}</button>{customerForm.id && <button type="button" className={compactButton} onClick={() => setCustomerForm(blankCustomer())}>Cancel edit</button>}</div></div><div className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[950px] text-[12px]"><thead><tr><th>Customer</th><th>Contact</th><th>Inquiry</th><th>Status</th><th>Follow-up</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{filteredCustomers.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.contact_details || "—"}</td><td>{row.inquiry || "—"}</td><td>{row.inquiry_status}</td><td>{row.follow_up_date || "—"}</td><td>{row.notes || "—"}</td><td className="whitespace-nowrap"><button type="button" className="mr-2 text-[#1f4e79]" onClick={() => setCustomerForm({ id: row.id, name: row.name, contactDetails: row.contact_details || "", inquiry: row.inquiry || "", status: row.inquiry_status, followUpDate: row.follow_up_date || "", notes: row.notes || "" })}><Pencil size={14} /></button><button type="button" className="text-[#a12d36]" onClick={() => void deleteRow("lead_costing_customers", row.id, "customer") }><Trash2 size={14} /></button></td></tr>)}</tbody></table></div></section>}

      {tab === "printer" && <section className="table-shell overflow-x-auto"><table className="app-table w-full min-w-[720px] text-[12px]"><thead><tr><th>Cost item</th><th>Unit</th><th>Listed cost</th><th>Cost per unit</th><th>Notes</th></tr></thead><tbody>{printerCosts.map((row) => <tr key={row.id}><td>{row.item}</td><td>{row.unit || "—"}</td><td>{row.listed_cost == null ? "—" : money(row.listed_cost)}</td><td><input className="w-28 rounded border border-[#cfd8e3] px-2 py-1" type="number" min="0" step="any" defaultValue={row.cost_per_unit ?? ""} onBlur={(event) => void updatePrinterCost(row, event.target.value)} /></td><td>{row.notes || "—"}</td></tr>)}</tbody></table></section>}
    </div>
  );
}
