"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Download, Plus, Save, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  areaFactor,
  calculateLeadCosting,
  calculateStockFit,
  DEFAULT_PRINT_COST_PER_SQ_FT,
  isPrintableLeadCostingMaterial,
  numberValue,
  printCostRateForUnit,
  unitLabel,
  type LeadCostingLamination,
  type LeadCostingUnit,
} from "@/lib/lead-costing-calculator";
import { LeadCostingPrintingQuotation, type LeadCostingPrintingQuotationPrefill } from "@/components/lead-costing-printing-quotation";

type Service = { id: string; name: string; examples: string | null; material_guidance: string | null; pricing_basis: string | null; notes: string | null };
type Material = { id: string; supplier_source: string; name: string; product_code: string | null; roll_description: string | null; roll_width_m: number | null; roll_length_m: number | null; roll_area_m2: number | null; roll_price: number | null; cost_per_m2: number | null; supplier_cost_per_m2: number | null; supplier_cost_per_sq_ft: number | null; source_note: string | null; is_sheet: boolean; is_finishing: boolean; is_active: boolean };
type Inventory = { id: string; material_id: string; full_rolls_on_hand: number | null; remaining_meters: number | null; available_sheets: number | null };
type PrinterCost = { id: string; item: string; unit: string | null; listed_cost: number | null; cost_per_unit: number | null; notes: string | null };
type Customer = { id: string; name: string; contact_details: string | null; inquiry: string | null; inquiry_status: string; follow_up_date: string | null; notes: string | null };
type Costing = { id: string; order_no: string; order_date: string; customer_name: string; order_description: string; service_id: string | null; material_id: string | null; quantity: number; width: number; height: number; measurement_unit: LeadCostingUnit; resolution_dpi: number | null; total_production_cost: number; stock_fit_status: string | null };
type Tab = "calculator" | "printing-quotations" | "saved-costings" | "services" | "materials" | "inventory" | "customers" | "printer";
type CalculatorForm = { serviceId: string; customServiceName: string; materialId: string; customerName: string; orderDescription: string; orderDate: string; width: string; height: string; unit: LeadCostingUnit; dpi: string; quantity: string; mediaRate: string; inkRate: string; wasteRate: string; lamination: LeadCostingLamination };
type CustomerForm = { id: string | null; name: string; contactDetails: string; inquiry: string; status: string; followUpDate: string; notes: string };

const inquiryStatuses = ["New inquiry", "Replied", "Awaiting customer", "Follow-up needed", "Quoted", "Confirmed order", "In production", "Ready for pickup", "Completed", "Cancelled / lost"];
const money = (value: number) => "₱" + (Number.isFinite(value) ? value : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (value: unknown) => "\"" + String(value ?? "").replaceAll("\"", "\"\"") + "\"";
const today = () => new Date().toISOString().slice(0, 10);
const blankCalculator = (): CalculatorForm => ({ serviceId: "", customServiceName: "", materialId: "", customerName: "", orderDescription: "", orderDate: today(), width: "3", height: "5", unit: "ft", dpi: "300", quantity: "1", mediaRate: "4.48", inkRate: String(DEFAULT_PRINT_COST_PER_SQ_FT), wasteRate: "0", lamination: "none" });
const blankCustomer = (): CustomerForm => ({ id: null, name: "", contactDetails: "", inquiry: "", status: "New inquiry", followUpDate: "", notes: "" });
const inputClass = "mt-1 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[13px] text-[#202938] outline-none focus:border-[#1f4e79]";
const compactButton = "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[12px] font-medium text-[#1f4e79] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#173b5c] disabled:cursor-not-allowed disabled:opacity-60";
const tableClass = "app-table w-full min-w-[900px] text-[12px]";
const costPerUnit = (costPerM2: number | null | undefined, unit: LeadCostingUnit) => numberValue(costPerM2) / areaFactor(unit);
const printableMaterials = (rows: Material[]) => rows.filter((material) => isPrintableLeadCostingMaterial(material));
const preferredPrintableMaterial = (rows: Material[]) => printableMaterials(rows).find((material) => !material.is_sheet && material.roll_width_m && material.roll_length_m) ?? printableMaterials(rows)[0];

export function LeadCostingIndexWorkspace({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("calculator");
  const [services, setServices] = useState<Service[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [printerCosts, setPrinterCosts] = useState<PrinterCost[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [costings, setCostings] = useState<Costing[]>([]);
  const [form, setForm] = useState<CalculatorForm>(blankCalculator);
  const [quotationPrefill, setQuotationPrefill] = useState<LeadCostingPrintingQuotationPrefill | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(blankCustomer);
  const [mediaSearch, setMediaSearch] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [costingSearch, setCostingSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerStatus, setCustomerStatus] = useState("All inquiry statuses");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const read = async <T,>(table: string, order: string) => {
      const result = await client.from(table).select("*").eq("organization_id", organizationId).order(order, { ascending: true });
      if (result.error) throw result.error;
      return (result.data ?? []) as T[];
    };
    try {
      const values = await Promise.all([
        read<Service>("lead_costing_services", "name"),
        read<Material>("lead_costing_materials", "name"),
        read<Inventory>("lead_costing_inventory", "updated_at"),
        read<PrinterCost>("lead_costing_printer_costs", "item"),
        read<Customer>("lead_costing_customers", "updated_at"),
        read<Costing>("lead_costing_orders", "order_date"),
      ]);
      setServices(values[0]);
      setMaterials(values[1]);
      setInventory(values[2]);
      setPrinterCosts(values[3]);
      setCustomers(values[4]);
      setCostings(values[5]);
      const defaultMaterial = preferredPrintableMaterial(values[1]);
      setForm((current) => ({
        ...current,
        serviceId: current.serviceId || values[0][0]?.id || "",
        materialId: current.materialId && values[1].some((material) => material.id === current.materialId && isPrintableLeadCostingMaterial(material))
          ? current.materialId
          : defaultMaterial?.id || "",
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Lead costing data could not load.");
    } finally {
      setLoading(false);
    }
  }, [client, organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const channel = client.channel("lead-costing-data-" + organizationId);
    ["lead_costing_services", "lead_costing_materials", "lead_costing_inventory", "lead_costing_printer_costs", "lead_costing_customers", "lead_costing_orders"].forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table, filter: "organization_id=eq." + organizationId }, () => void load()));
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, load, organizationId]);

  const printableMaterialRows = useMemo(() => printableMaterials(materials), [materials]);
  const selectedMaterial = materials.find((material) => material.id === form.materialId);
  const selectedService = services.find((service) => service.id === form.serviceId);
  const serviceName = form.serviceId === "__custom__" ? form.customServiceName.trim() || "Custom service" : selectedService?.name || "Print service";
  const inventoryByMaterial = useMemo(() => new Map(inventory.map((row) => [row.material_id, row])), [inventory]);
  const calculation = useMemo(() => calculateLeadCosting(form, selectedMaterial), [form, selectedMaterial]);
  const stockCheck = useMemo(() => {
    const stock = selectedMaterial ? inventoryByMaterial.get(selectedMaterial.id) : undefined;
    return calculateStockFit({ input: form, material: selectedMaterial, fullRolls: stock?.full_rolls_on_hand, remainingMeters: stock?.remaining_meters, availableSheets: stock?.available_sheets });
  }, [form, inventoryByMaterial, selectedMaterial]);
  const filteredMaterials = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    return materials.filter((material) => !query || [material.supplier_source, material.name, material.product_code, material.roll_description].map((value) => String(value ?? "").toLowerCase()).join(" ").includes(query));
  }, [materials, mediaSearch]);
  const filteredCostings = useMemo(() => {
    const query = costingSearch.trim().toLowerCase();
    return costings.filter((costing) => !query || [costing.order_no, costing.customer_name, costing.order_description].map((value) => String(value ?? "").toLowerCase()).join(" ").includes(query));
  }, [costings, costingSearch]);
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => (!query || [customer.name, customer.contact_details, customer.inquiry, customer.notes].map((value) => String(value ?? "").toLowerCase()).join(" ").includes(query)) && (customerStatus === "All inquiry statuses" || customer.inquiry_status === customerStatus));
  }, [customerSearch, customerStatus, customers]);
  const filteredInventory = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return materials.filter((material) => !query || [material.supplier_source, material.name, material.product_code, material.roll_description].map((value) => String(value ?? "").toLowerCase()).join(" ").includes(query));
  }, [inventorySearch, materials]);
  const setField = <K extends keyof CalculatorForm>(key: K, value: CalculatorForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const handleUnitChange = (unit: LeadCostingUnit) => setForm((current) => ({ ...current, unit, mediaRate: selectedMaterial ? String(costPerUnit(selectedMaterial.cost_per_m2, unit)) : current.mediaRate, inkRate: String(printCostRateForUnit(printerCosts, unit)) }));
  const handleMaterialChange = (materialId: string) => {
    const material = printableMaterialRows.find((row) => row.id === materialId);
    setForm((current) => ({ ...current, materialId, mediaRate: material ? String(costPerUnit(material.cost_per_m2, current.unit)) : current.mediaRate }));
  };

  const saveCosting = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!calculation.valid || !selectedMaterial || (!selectedService && form.serviceId !== "__custom__") || (form.serviceId === "__custom__" && !form.customServiceName.trim())) throw new Error("Enter valid dimensions, a service, and a material before saving the direct costing.");
      const userResult = await client.auth.getUser();
      if (!userResult.data.user) throw new Error("Sign in again before saving a direct costing.");
      let serviceId = selectedService?.id ?? null;
      if (form.serviceId === "__custom__") {
        const existing = services.find((service) => service.name.trim().toLowerCase() === form.customServiceName.trim().toLowerCase());
        if (existing) serviceId = existing.id;
        else {
          const created = await client.from("lead_costing_services").insert({ organization_id: organizationId, name: form.customServiceName.trim(), pricing_basis: "Direct costing", notes: "Created from the Lead Costing calculator.", created_by: userResult.data.user.id }).select("id").single();
          if (created.error) throw created.error;
          serviceId = created.data.id;
        }
      }
      let customerId = customers.find((customer) => customer.name.trim().toLowerCase() === form.customerName.trim().toLowerCase())?.id ?? null;
      if (!customerId && form.customerName.trim()) {
        const created = await client.from("lead_costing_customers").insert({ organization_id: organizationId, name: form.customerName.trim(), inquiry: [form.orderDescription.trim() || serviceName, "Qty " + calculation.quantity].join(" - "), inquiry_status: "New inquiry", created_by: userResult.data.user.id }).select("id").single();
        if (created.error) throw created.error;
        customerId = created.data.id;
      }
      const result = await client.rpc("create_lead_costing_order_from_index_direct", {
        p_organization_id: organizationId,
        p_customer_id: customerId,
        p_service_id: serviceId,
        p_material_id: selectedMaterial.id,
        p_order_date: form.orderDate || null,
        p_customer_name: form.customerName.trim() || "Walk-in / not specified",
        p_order_description: form.orderDescription.trim() || serviceName,
        p_width: calculation.width,
        p_height: calculation.height,
        p_measurement_unit: form.unit,
        p_resolution_dpi: form.unit === "px" ? Math.max(1, numberValue(form.dpi) || 300) : null,
        p_quantity: calculation.quantity,
        p_media_rate: numberValue(form.mediaRate),
        p_print_rate: numberValue(form.inkRate),
        p_waste_allowance_per_project: calculation.wasteProject,
        p_lamination_type: form.lamination,
      });
      if (result.error) throw result.error;
      setMessage("Direct print costing saved. Create a Printing Quotation when you are ready to submit it to the GM.");
      setTab("saved-costings");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Direct costing could not be saved.");
    } finally { setSaving(false); }
  };

  const deleteRow = async (table: string, id: string, label: string) => {
    if (!window.confirm("Delete this " + label + "?")) return;
    const result = await client.from(table).delete().eq("id", id).eq("organization_id", organizationId);
    if (result.error) setError(result.error.message); else { setMessage(label + " deleted."); await load(); }
  };
  const saveService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const data = new FormData(event.currentTarget); const name = String(data.get("serviceName") ?? "").trim();
      if (!name) throw new Error("Service name is required.");
      const userResult = await client.auth.getUser(); if (!userResult.data.user) throw new Error("Sign in again before saving a service.");
      const result = await client.from("lead_costing_services").insert({ organization_id: organizationId, name, examples: String(data.get("examples") ?? "").trim() || null, material_guidance: String(data.get("materials") ?? "").trim() || null, pricing_basis: String(data.get("basis") ?? "").trim() || null, notes: String(data.get("notes") ?? "").trim() || null, created_by: userResult.data.user.id });
      if (result.error) throw result.error;
      event.currentTarget.reset(); setMessage("Service saved."); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Service could not be saved."); } finally { setSaving(false); }
  };
  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      if (!customerForm.name.trim()) throw new Error("Enter a customer name before saving.");
      const userResult = await client.auth.getUser(); if (!userResult.data.user) throw new Error("Sign in again before saving a customer.");
      const payload = { organization_id: organizationId, name: customerForm.name.trim(), contact_details: customerForm.contactDetails.trim() || null, inquiry: customerForm.inquiry.trim() || null, inquiry_status: customerForm.status, follow_up_date: customerForm.followUpDate || null, notes: customerForm.notes.trim() || null, created_by: userResult.data.user.id };
      const result = customerForm.id ? await client.from("lead_costing_customers").update(payload).eq("id", customerForm.id).eq("organization_id", organizationId) : await client.from("lead_costing_customers").insert(payload);
      if (result.error) throw result.error;
      setCustomerForm(blankCustomer()); setMessage("Customer record saved."); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Customer record could not be saved."); } finally { setSaving(false); }
  };
  const updateInventory = async (material: Material, fullRolls: string, remainingMeters: string, availableSheets: string) => {
    const optionalNumber = (value: string) => value.trim() === "" ? null : Math.max(0, numberValue(value));
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) { setError("Sign in again before saving inventory."); return; }
    const result = await client.from("lead_costing_inventory").upsert({
      organization_id: organizationId,
      material_id: material.id,
      full_rolls_on_hand: material.is_sheet ? null : optionalNumber(fullRolls),
      remaining_meters: material.is_sheet ? null : optionalNumber(remainingMeters),
      available_sheets: material.is_sheet ? optionalNumber(availableSheets) : null,
      updated_by: userData.user.id,
    }, { onConflict: "organization_id,material_id" });
    if (result.error) setError(result.error.message); else { setMessage("Inventory saved."); await load(); }
  };
  const updateMaterialCost = async (material: Material, value: string) => {
    const result = await client.from("lead_costing_materials").update({ cost_per_m2: Math.max(0, numberValue(value)) }).eq("id", material.id).eq("organization_id", organizationId);
    if (result.error) setError(result.error.message); else { setMessage("Material direct-cost rate updated."); await load(); }
  };
  const saveMaterial = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const supplierSource = String(data.get("supplierSource") ?? "").trim();
      const name = String(data.get("materialName") ?? "").trim();
      if (!supplierSource || !name) throw new Error("Supplier and material name are required.");
      const userResult = await client.auth.getUser();
      if (!userResult.data.user) throw new Error("Sign in again before saving a material.");
      const result = await client.from("lead_costing_materials").insert({
        organization_id: organizationId,
        supplier_source: supplierSource,
        name,
        product_code: String(data.get("productCode") ?? "").trim() || null,
        roll_description: String(data.get("rollDescription") ?? "").trim() || null,
        roll_width_m: numberValue(String(data.get("rollWidthM") ?? "")) || null,
        roll_length_m: numberValue(String(data.get("rollLengthM") ?? "")) || null,
        roll_price: numberValue(String(data.get("rollPrice") ?? "")) || null,
        cost_per_m2: Math.max(0, numberValue(String(data.get("costPerM2") ?? ""))),
        source_note: String(data.get("sourceNote") ?? "").trim() || null,
        created_by: userResult.data.user.id,
      });
      if (result.error) throw result.error;
      event.currentTarget.reset(); setMessage("Material saved."); await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Material could not be saved.");
    } finally { setSaving(false); }
  };
  const createPrintingQuotationFromCalculator = () => {
    if (!calculation.valid || !selectedMaterial) {
      setError("Enter valid dimensions and select a material before creating a Printing Quotation.");
      return;
    }
    setMessage(null); setError(null);
    setQuotationPrefill({
      collateralType: serviceName,
      materialId: selectedMaterial.id,
      materialName: selectedMaterial.name,
      printType: "1 Side Print",
      width: form.width,
      height: form.height,
      unit: form.unit,
      dpi: form.dpi,
      location: "",
      quantity: form.quantity,
      mediaRate: form.mediaRate,
      inkRate: form.inkRate,
      wasteRate: form.wasteRate,
      lamination: form.lamination,
      projectName: form.orderDescription.trim() || serviceName,
    });
    setTab("printing-quotations");
  };

  if (loading) return <section className="rounded-md border border-[#dfe5ed] bg-white p-5 text-[13px] text-[#687386]">Loading Lead &amp; Costing…</section>;
  return (
    <div className="lead-costing-workspace space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] pb-3">
        <div><h2 className="text-[18px] font-medium text-[#1f4e79]">Lead &amp; Costing Coordinator</h2><p className="mt-1 text-[12px] text-[#687386]">Prepare direct printing costings and submit customer Printing Quotations to the General Manager.</p></div>
        <div className="text-right text-[11px] text-[#687386]">{materials.length} materials · {costings.length} saved direct costings</div>
      </header>
      {message && <div className="rounded-md border border-[#b9dec9] bg-[#f0fbf4] px-3 py-2 text-[12px] text-[#17623b]" role="status">{message}</div>}
      {error && <div className="rounded-md border border-[#efc4c8] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#9d2831]" role="alert">{error}</div>}
      <nav className="lead-costing-tabs app-tabs overflow-x-auto">{([
        ["calculator", "Direct Cost Calculator"], ["printing-quotations", "Printing Quotations"], ["saved-costings", "Saved Costings"],
        ["services", "Service Menu"], ["materials", "Media Price List"], ["inventory", "Material Inventory"], ["customers", "Customer Records"], ["printer", "Print Rates"],
      ] as [Tab, string][]).map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)} className="app-tab" data-active={tab === id ? "true" : "false"}>{label}</button>)}</nav>

      {tab === "printing-quotations" && <LeadCostingPrintingQuotation organizationId={organizationId} materials={materials} printerCosts={printerCosts} prefill={quotationPrefill} onPrefillConsumed={() => setQuotationPrefill(null)} />}

      {tab === "calculator" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
          <section className="rounded-md border border-[#dfe5ed] bg-white p-4">
            <h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Direct production costing</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[12px] font-medium text-[#465a74] md:col-span-2">Service type<select className={inputClass} value={form.serviceId} onChange={(event) => setField("serviceId", event.target.value)}><option value="">Select service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}<option value="__custom__">＋ Manual type / Custom service</option></select>{form.serviceId === "__custom__" && <input className={inputClass} value={form.customServiceName} onChange={(event) => setField("customServiceName", event.target.value)} placeholder="Type service / collateral name" />}</label>
              <label className="text-[12px] font-medium text-[#465a74] md:col-span-2">Media / material<select className={inputClass} value={form.materialId} onChange={(event) => handleMaterialChange(event.target.value)}><option value="">Select material</option>{printableMaterialRows.map((material) => <option key={material.id} value={material.id}>{material.name} — {material.supplier_source}</option>)}</select>{selectedMaterial && <span className="mt-1 block text-[11px] font-normal text-[#687386]">{selectedMaterial.supplier_source} · {selectedMaterial.product_code || "No product code"} · {selectedMaterial.roll_description || "Dimensions unavailable"}</span>}</label>
              <div className="border-b border-[#e4e8ef] pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#2378d4] md:col-span-2">Lead / job details</div>
              <label className="text-[12px] font-medium text-[#465a74]">Customer name<input className={inputClass} value={form.customerName} onChange={(event) => setField("customerName", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Job description<input className={inputClass} value={form.orderDescription} onChange={(event) => setField("orderDescription", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Costing date<input className={inputClass} type="date" value={form.orderDate} onChange={(event) => setField("orderDate", event.target.value)} /></label>
              <div className="rounded-md border border-[#dfe5ed] bg-[#f8fafc] px-3 py-2 text-[11px] text-[#687386] md:col-span-2">This page calculates direct production cost only. GM markup, selling price, profit, payment, and customer PDF are handled in Printing Quotations.</div>
              <div className="border-b border-[#e4e8ef] pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#2378d4] md:col-span-2">Job dimensions</div>
              <label className="text-[12px] font-medium text-[#465a74]">Width<input className={inputClass} type="number" min="0" step="any" value={form.width} onChange={(event) => setField("width", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Height<input className={inputClass} type="number" min="0" step="any" value={form.height} onChange={(event) => setField("height", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Measurement unit<select className={inputClass} value={form.unit} onChange={(event) => handleUnitChange(event.target.value as LeadCostingUnit)}><option value="ft">Feet (ft)</option><option value="in">Inches (in)</option><option value="m">Meters (m)</option><option value="px">Pixels (px)</option></select></label>
              {form.unit === "px" && <label className="text-[12px] font-medium text-[#465a74]">Resolution (DPI)<input className={inputClass} type="number" min="1" step="1" value={form.dpi} onChange={(event) => setField("dpi", event.target.value)} /><span className="mt-1 block text-[11px] font-normal text-[#687386]">Required for pixel dimensions.</span></label>}
              <label className="text-[12px] font-medium text-[#465a74]">Quantity<input className={inputClass} type="number" min="1" step="1" value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} /></label>
              <div className="border-b border-[#e4e8ef] pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#2378d4] md:col-span-2">Direct-cost inputs</div>
              <label className="text-[12px] font-medium text-[#465a74]">Media cost (₱ / {unitLabel(form.unit)})<input className={inputClass} type="number" min="0" step="any" value={form.mediaRate} onChange={(event) => setField("mediaRate", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Print operating cost (₱ / {unitLabel(form.unit)})<input className={inputClass} type="number" min="0" step="any" value={form.inkRate} onChange={(event) => setField("inkRate", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Media wastage allowance (₱ per project)<input className={inputClass} type="number" min="0" step="0.01" value={form.wasteRate} onChange={(event) => setField("wasteRate", event.target.value)} /></label>
              <label className="text-[12px] font-medium text-[#465a74]">Lamination finish<select className={inputClass} value={form.lamination} onChange={(event) => setField("lamination", event.target.value as LeadCostingLamination)}><option value="none">No lamination</option><option value="matte">Matte</option><option value="glossy">Glossy</option></select></label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={saving || !calculation.valid} onClick={() => void saveCosting()}><Save size={14} />{saving ? "Saving…" : "Save direct costing"}</button>
              <button type="button" className={compactButton} onClick={() => { void navigator.clipboard.writeText(["Customer: " + (form.customerName || "Not specified"), "Service: " + serviceName, "Direct production cost: " + money(calculation.totalOrderCost)].join("\\n")); setMessage("Direct-cost summary copied."); }}>Copy direct-cost summary</button>
              <button type="button" className={compactButton} onClick={createPrintingQuotationFromCalculator}>Create Printing Quotation</button>
              <button type="button" className={compactButton} onClick={() => { const defaultMaterial = preferredPrintableMaterial(materials); setForm({ ...blankCalculator(), serviceId: services[0]?.id || "", materialId: defaultMaterial?.id || "", mediaRate: defaultMaterial ? String(costPerUnit(defaultMaterial.cost_per_m2, "ft")) : blankCalculator().mediaRate, inkRate: String(printCostRateForUnit(printerCosts, "ft")) }); }}>Reset</button>
            </div>
          </section>
          <section className="space-y-3">
            <div className="rounded-md border border-[#dfe5ed] bg-white p-4">
              <h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Direct-cost result</h3>
              <div className="grid gap-2 text-[13px]">
                {[
                  ["Print area", calculation.areaPerItem.toLocaleString("en-PH", { maximumFractionDigits: 4 }) + " " + (form.unit === "px" ? "px²" : unitLabel(form.unit))],
                  ["Equivalent area (m²)", calculation.areaM2PerItem.toLocaleString("en-PH", { maximumFractionDigits: 4 }) + " m²"],
                  ["Media cost / item", money(calculation.mediaPerItem)],
                  ["Media wastage / item", money(calculation.wastePerItem)],
                   ["Print cost / item", money(calculation.inkPerItem)],
                  ["Lamination / item", money(calculation.laminationPerItem)],
                  ["Direct cost / item", money(calculation.totalCostPerItem)],
                  ["Direct cost (quantity)", money(calculation.totalOrderCost)],
                ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 border-b border-[#edf0f5] py-2"><span className="text-[#687386]">{label}</span><strong className="text-right text-[#202938]">{value}</strong></div>)}
              </div>
              <div className="mt-3 rounded-md bg-[#1f4e79] p-4 text-white"><div className="text-[11px] opacity-80">Total direct production cost</div><div className="text-[26px] font-medium">{money(calculation.totalOrderCost)}</div></div>
            </div>
            <div className="rounded-md border border-[#dfe5ed] bg-white p-4">
              <h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Material quantity check</h3>
              <div className="grid gap-2 text-[13px]">{selectedMaterial?.is_sheet ? <><div className="flex justify-between"><span className="text-[#687386]">Available sheets</span><strong>{stockCheck.availableSheets == null ? "Not entered" : stockCheck.availableSheets}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Stock check</span><strong>{stockCheck.status}</strong></div></> : <><div className="flex justify-between"><span className="text-[#687386]">Selected roll width</span><strong>{stockCheck.plan.rollWidthM ? stockCheck.plan.rollWidthM.toFixed(2) + " m" : "Not available"}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Estimated length required</span><strong>{stockCheck.requiredLength ? stockCheck.requiredLength.toFixed(2) + " m incl. 10% reserve" : "Cannot estimate"}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Estimated rolls required</span><strong>{stockCheck.requiredRolls || "—"}</strong></div><div className="flex justify-between"><span className="text-[#687386]">Stock check</span><strong>{stockCheck.status}</strong></div></>}</div>
              <button type="button" className={compactButton + " mt-3"} onClick={() => setTab("inventory")}>Update material inventory</button>
            </div>
          </section>
        </div>
      )}

      {tab === "saved-costings" && <SavedCostings costings={filteredCostings} services={services} materials={materials} search={costingSearch} setSearch={setCostingSearch} onExport={() => exportCostings(filteredCostings, services, materials)} onDelete={(id) => void deleteRow("lead_costing_orders", id, "costing")} />}
      {tab === "services" && <ServiceMenu services={services} onSave={saveService} saving={saving} onDelete={(id) => void deleteRow("lead_costing_services", id, "service")} />}
      {tab === "materials" && <MaterialList materials={filteredMaterials} search={mediaSearch} setSearch={setMediaSearch} onSave={saveMaterial} saving={saving} onUpdate={updateMaterialCost} onDelete={(id) => void deleteRow("lead_costing_materials", id, "material")} />}
      {tab === "inventory" && <InventoryList materials={filteredInventory} inventoryByMaterial={inventoryByMaterial} search={inventorySearch} setSearch={setInventorySearch} onSave={updateInventory} />}
      {tab === "customers" && <CustomerList customers={filteredCustomers} search={customerSearch} setSearch={setCustomerSearch} status={customerStatus} setStatus={setCustomerStatus} form={customerForm} setForm={setCustomerForm} onSave={saveCustomer} saving={saving} onDelete={(id) => void deleteRow("lead_costing_customers", id, "customer")} />}
      {tab === "printer" && <section className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass}><thead><tr><th>Print cost reference</th><th>Unit</th><th>Cost / unit</th><th>Notes</th></tr></thead><tbody>{printerCosts.map((row) => <tr key={row.id}><td className="font-medium">{row.item}</td><td>{row.unit || "—"}</td><td>{row.cost_per_unit == null ? "—" : money(numberValue(row.cost_per_unit))}</td><td>{row.notes || "—"}</td></tr>)}</tbody></table></section>}
    </div>
  );
}
function exportCostings(costings: Costing[], services: Service[], materials: Material[]) {
  const rows = [["Costing ID", "Date", "Customer", "Description", "Service", "Material", "Size", "Quantity", "Direct Cost"]];
  costings.forEach((costing) => rows.push([costing.order_no, costing.order_date, costing.customer_name, costing.order_description, services.find((service) => service.id === costing.service_id)?.name || "", materials.find((material) => material.id === costing.material_id)?.name || "", costing.width + " × " + costing.height + " " + costing.measurement_unit, String(costing.quantity), String(costing.total_production_cost)]));
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "Huswell_Print_Costings.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function SavedCostings({ costings, services, materials, search, setSearch, onExport, onDelete }: { costings: Costing[]; services: Service[]; materials: Material[]; search: string; setSearch: (value: string) => void; onExport: () => void; onDelete: (id: string) => void }) {
  return <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><input className={inputClass + " mt-0 max-w-[360px]"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved costings" /><button type="button" className={compactButton} onClick={onExport}><Download size={14} />Export costings CSV</button></div><div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass + " min-w-[1100px]"}><thead><tr><th>Date</th><th>Costing</th><th>Customer</th><th>Description</th><th>Service / material</th><th>Size</th><th>Qty</th><th>Direct cost</th><th>Action</th></tr></thead><tbody>{costings.map((costing) => <tr key={costing.id}><td>{costing.order_date}</td><td className="font-medium">{costing.order_no}</td><td>{costing.customer_name}</td><td>{costing.order_description}</td><td>{services.find((service) => service.id === costing.service_id)?.name || "—"}<div className="text-[10px] text-[#687386]">{materials.find((material) => material.id === costing.material_id)?.name || "—"}</div></td><td>{costing.width} × {costing.height} {costing.measurement_unit}{costing.measurement_unit === "px" && costing.resolution_dpi ? " @ " + costing.resolution_dpi + " DPI" : ""}</td><td>{costing.quantity}</td><td className="font-semibold">{money(numberValue(costing.total_production_cost))}</td><td><button type="button" className="text-[#a12d36]" onClick={() => onDelete(costing.id)}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>{!costings.length && <div className="rounded-md border border-[#dfe5ed] bg-white p-8 text-center text-[12px] text-[#687386]">No saved direct costings yet.</div>}</section>;
}

function ServiceMenu({ services, onSave, saving, onDelete }: { services: Service[]; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>; saving: boolean; onDelete: (id: string) => void }) {
  return <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><form className="rounded-md border border-[#dfe5ed] bg-white p-4" onSubmit={(event) => void onSave(event)}><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">Add service</h3><label className="text-[12px] font-medium text-[#465a74]">Name<input className={inputClass} name="serviceName" required /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Examples<textarea className={inputClass} name="examples" /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Material guidance<textarea className={inputClass} name="materials" /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Pricing basis<input className={inputClass} name="basis" /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Notes<textarea className={inputClass} name="notes" /></label><button type="submit" className={primaryButton + " mt-4"} disabled={saving}><Plus size={14} />Save service</button></form><div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass}><thead><tr><th>Service</th><th>Examples</th><th>Pricing basis</th><th /></tr></thead><tbody>{services.map((service) => <tr key={service.id}><td className="font-medium">{service.name}</td><td>{service.examples || "—"}</td><td>{service.pricing_basis || "—"}</td><td><button type="button" className="text-[#a12d36]" onClick={() => onDelete(service.id)}>Delete</button></td></tr>)}</tbody></table></div></section>;
}

function MaterialList({ materials, search, setSearch, onSave, saving, onUpdate, onDelete }: { materials: Material[]; search: string; setSearch: (value: string) => void; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>; saving: boolean; onUpdate: (material: Material, value: string) => Promise<void>; onDelete: (id: string) => void }) {
  return <section className="space-y-3"><form className="grid gap-3 rounded-md border border-[#dfe5ed] bg-white p-4 md:grid-cols-4" onSubmit={(event) => void onSave(event)}><div className="md:col-span-4"><h3 className="text-[15px] font-medium text-[#1f4e79]">Add media / material</h3><p className="mt-1 text-[11px] text-[#687386]">Rates here feed direct production cost only.</p></div><label className="text-[12px] font-medium text-[#465a74]">Supplier<input className={inputClass} name="supplierSource" required /></label><label className="text-[12px] font-medium text-[#465a74]">Material name<input className={inputClass} name="materialName" required /></label><label className="text-[12px] font-medium text-[#465a74]">Product code<input className={inputClass} name="productCode" /></label><label className="text-[12px] font-medium text-[#465a74]">Cost / m²<input className={inputClass} name="costPerM2" type="number" min="0" step="any" defaultValue="0" /></label><label className="text-[12px] font-medium text-[#465a74]">Roll description<input className={inputClass} name="rollDescription" placeholder="1.37 × 50 m / Sheet 4 × 8 ft" /></label><label className="text-[12px] font-medium text-[#465a74]">Roll width (m)<input className={inputClass} name="rollWidthM" type="number" min="0" step="any" /></label><label className="text-[12px] font-medium text-[#465a74]">Roll length (m)<input className={inputClass} name="rollLengthM" type="number" min="0" step="any" /></label><label className="text-[12px] font-medium text-[#465a74]">Roll price<input className={inputClass} name="rollPrice" type="number" min="0" step="any" /></label><label className="text-[12px] font-medium text-[#465a74] md:col-span-3">Source note<input className={inputClass} name="sourceNote" /></label><div className="flex items-end"><button type="submit" className={primaryButton + " w-full"} disabled={saving}><Plus size={14} />Save material</button></div></form><div className="flex flex-wrap items-center justify-between gap-2"><input className={inputClass + " mt-0 max-w-[360px]"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media, code, supplier" /><span className="text-[11px] text-[#687386]">{materials.length} materials</span></div><div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass + " min-w-[1250px]"}><thead><tr><th>Supplier</th><th>Material</th><th>Code</th><th>Roll</th><th>Cost / m²</th><th>Type</th><th>Action</th></tr></thead><tbody>{materials.map((material) => <tr key={material.id}><td>{material.supplier_source}</td><td className="font-medium">{material.name}</td><td>{material.product_code || "—"}</td><td>{material.roll_description || "—"}</td><td><input className="input mt-0 w-28" type="number" min="0" step="any" defaultValue={material.cost_per_m2 ?? 0} onBlur={(event) => void onUpdate(material, event.target.value)} /></td><td>{material.is_finishing ? "Finishing" : material.is_sheet ? "Sheet" : "Roll"}</td><td><button type="button" className="text-[#a12d36]" onClick={() => onDelete(material.id)}>Delete</button></td></tr>)}</tbody></table></div></section>;
}

function InventoryList({ materials, inventoryByMaterial, search, setSearch, onSave }: { materials: Material[]; inventoryByMaterial: Map<string, Inventory>; search: string; setSearch: (value: string) => void; onSave: (material: Material, fullRolls: string, remainingMeters: string, availableSheets: string) => Promise<void> }) {
  return <section className="space-y-3"><p className="text-[12px] text-[#687386]">Roll materials use full rolls and remaining meters. Sheet materials use available sheets; remaining meters does not apply.</p><input className={inputClass + " mt-0 max-w-[360px]"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search material, code, supplier" /><div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass + " min-w-[1150px]"}><thead><tr><th>Material</th><th>Pack / sheet size</th><th>Stock quantity</th><th>Remaining meters</th><th>Action</th></tr></thead><tbody>{materials.map((material) => <InventoryRow key={material.id} material={material} row={inventoryByMaterial.get(material.id)} onSave={onSave} />)}</tbody></table></div></section>;
}

function InventoryRow({ material, row, onSave }: { material: Material; row: Inventory | undefined; onSave: (material: Material, fullRolls: string, remainingMeters: string, availableSheets: string) => Promise<void> }) {
  const [fullRolls, setFullRolls] = useState(row?.full_rolls_on_hand == null ? "" : String(row.full_rolls_on_hand));
  const [remainingMeters, setRemainingMeters] = useState(row?.remaining_meters == null ? "" : String(row.remaining_meters));
  const [availableSheets, setAvailableSheets] = useState(row?.available_sheets == null ? "" : String(row.available_sheets));
  const isSheet = material.is_sheet;
  return <tr><td className="font-medium">{material.name}<div className="text-[10px] text-[#687386]">{material.supplier_source}</div>{!row && <div className="text-[10px] font-normal text-[#a76605]">Not recorded yet</div>}</td><td>{material.roll_description || "—"}</td><td><div className="mb-1 text-[10px] text-[#687386]">{isSheet ? "Available sheets" : "Full rolls"}</div>{isSheet ? <input aria-label={`Available sheets for ${material.name}`} className="input mt-0 w-28" type="number" min="0" step="1" value={availableSheets} onChange={(event) => setAvailableSheets(event.target.value)} /> : <input aria-label={`Full rolls for ${material.name}`} className="input mt-0 w-28" type="number" min="0" step="1" value={fullRolls} onChange={(event) => setFullRolls(event.target.value)} />}</td><td>{isSheet ? <span className="text-[#687386]">Not applicable</span> : <><div className="mb-1 text-[10px] text-[#687386]">Remaining meters</div><input aria-label={`Remaining meters for ${material.name}`} className="input mt-0 w-28" type="number" min="0" step="0.01" value={remainingMeters} onChange={(event) => setRemainingMeters(event.target.value)} /></>}</td><td><button type="button" className={compactButton} onClick={() => void onSave(material, fullRolls, remainingMeters, availableSheets)}>Save</button></td></tr>;
}

function CustomerList({ customers, search, setSearch, status, setStatus, form, setForm, onSave, saving, onDelete }: { customers: Customer[]; search: string; setSearch: (value: string) => void; status: string; setStatus: (value: string) => void; form: CustomerForm; setForm: Dispatch<SetStateAction<CustomerForm>>; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>; saving: boolean; onDelete: (id: string) => void }) {
  return <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><form className="rounded-md border border-[#dfe5ed] bg-white p-4" onSubmit={(event) => { event.preventDefault(); void onSave(event); }}><h3 className="mb-3 text-[15px] font-medium text-[#1f4e79]">{form.id ? "Edit customer" : "Add customer"}</h3><label className="text-[12px] font-medium text-[#465a74]">Name<input className={inputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Contact details<input className={inputClass} value={form.contactDetails} onChange={(event) => setForm((current) => ({ ...current, contactDetails: event.target.value }))} /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Inquiry<textarea className={inputClass} value={form.inquiry} onChange={(event) => setForm((current) => ({ ...current, inquiry: event.target.value }))} /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Status<select className={inputClass} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{inquiryStatuses.map((value) => <option key={value}>{value}</option>)}</select></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Follow-up date<input className={inputClass} type="date" value={form.followUpDate} onChange={(event) => setForm((current) => ({ ...current, followUpDate: event.target.value }))} /></label><label className="mt-3 block text-[12px] font-medium text-[#465a74]">Notes<textarea className={inputClass} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label><div className="mt-4 flex gap-2"><button type="submit" className={primaryButton} disabled={saving}><Save size={14} />Save</button><button type="button" className={compactButton} onClick={() => setForm(blankCustomer())}>Clear</button></div></form><div className="space-y-3"><div className="flex flex-wrap gap-2"><input className={inputClass + " mt-0 max-w-[360px]"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, contact, inquiry" /><select className="rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[12px]" value={status} onChange={(event) => setStatus(event.target.value)}><option>All inquiry statuses</option>{inquiryStatuses.map((value) => <option key={value}>{value}</option>)}</select></div><div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className={tableClass}><thead><tr><th>Customer</th><th>Contact</th><th>Inquiry</th><th>Status</th><th>Action</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td className="font-medium">{customer.name}</td><td>{customer.contact_details || "—"}</td><td>{customer.inquiry || "—"}</td><td>{customer.inquiry_status}</td><td><button type="button" className="mr-2 text-[#1f4e79]" onClick={() => setForm({ id: customer.id, name: customer.name, contactDetails: customer.contact_details || "", inquiry: customer.inquiry || "", status: customer.inquiry_status, followUpDate: customer.follow_up_date || "", notes: customer.notes || "" })}>Edit</button><button type="button" className="text-[#a12d36]" onClick={() => onDelete(customer.id)}>Delete</button></td></tr>)}</tbody></table></div></div></section>;
}
