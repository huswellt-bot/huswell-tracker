"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Plus, Save, Send, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  areaFactor,
  calculateLeadCosting,
  calculateProductionReadiness,
  isPrintableLeadCostingMaterial,
  numberValue,
  printCostRateForUnit,
  type LeadCostingInventory,
  type LeadCostingLamination,
  type LeadCostingUnit,
} from "@/lib/lead-costing-calculator";

const SOURCE = "lead_costing_printing";
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `₱${(Number.isFinite(value) ? value : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inputClass = "mt-1 w-full rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[12px] text-[#202938] outline-none focus:border-[#1f4e79]";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#cfd8e3] bg-white px-3 py-2 text-[12px] font-medium text-[#1f4e79] hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#173b5c] disabled:cursor-not-allowed disabled:opacity-60";

export type LeadCostingQuotationMaterial = {
  id: string;
  name: string;
  supplier_source: string;
  cost_per_m2: number | null;
  roll_width_m: number | null;
  roll_length_m: number | null;
  is_sheet?: boolean | null;
  is_finishing?: boolean | null;
  is_active?: boolean | null;
};

type PrinterCost = { item: string; cost_per_unit: number | null };
type Lead = { id: string; lead_no?: string | null; project_name?: string | null; client_name?: string | null; contact_name?: string | null; phone?: string | null; email?: string | null; address?: string | null };
type Quote = { id: string; quotation_no: string; status: string; lead_id: string | null; project_name: string | null; issue_date: string; total_cost: number; subtotal: number; total_amount: number; revision_note: string | null; terms_conditions: string | null; created_by: string | null };
type QuoteItem = { id: string; quotation_id: string; description: string; quantity: number; unit_cost: number; costing_metadata: unknown };
type Inventory = LeadCostingInventory & { material_id: string };
type Item = { id: string; collateralType: string; materialId: string; materialName: string; printType: string; width: string; height: string; unit: LeadCostingUnit; dpi: string; location: string; quantity: string; mediaRate: string; inkRate: string; wasteRate: string; lamination: LeadCostingLamination; manualStockConfirmed?: boolean };

export type LeadCostingPrintingQuotationPrefill = Omit<Item, "id"> & {
  projectName?: string;
};

const defaultTerms = "• Quotation is subject to confirmation of final artwork, dimensions, material availability, and production requirements.\n• Production starts after artwork approval and confirmation of payment terms.\n• Changes after approval may affect the price and delivery schedule.\n• Delivery, installation, rush fees, and taxes are included only if stated in the quotation.\n• Final price and completion date are subject to Huswell Trading's written confirmation.";
const emptyItem = (materials: LeadCostingQuotationMaterial[], printerCosts: PrinterCost[]): Item => ({
  id: crypto.randomUUID(), collateralType: "", materialId: materials[0]?.id ?? "", materialName: materials[0]?.name ?? "", printType: "1 Side Print", width: "", height: "", unit: "m", dpi: "300", location: "", quantity: "1", mediaRate: materials[0]?.cost_per_m2 == null ? "0" : String(numberValue(materials[0].cost_per_m2)), inkRate: String(printCostRateForUnit(printerCosts, "m")), wasteRate: "0", lamination: "none", manualStockConfirmed: false,
});
const materialRate = (material: LeadCostingQuotationMaterial | undefined, unit: LeadCostingUnit) => {
  if (!material?.cost_per_m2) return "";
  return String(numberValue(material.cost_per_m2) / areaFactor(unit));
};
const formatSize = (item: Item) => item.width && item.height
  ? `${item.width} × ${item.height} ${item.unit}${item.unit === "px" && item.dpi ? ` @ ${item.dpi} DPI` : ""}`
  : "Size not entered";
const asMetadata = (value: unknown): Partial<Item> => value && typeof value === "object" ? value as Partial<Item> : {};

export function LeadCostingPrintingQuotation({ organizationId, materials, inventory, printerCosts, prefill, onPrefillConsumed }: { organizationId: string; materials: LeadCostingQuotationMaterial[]; inventory: Inventory[]; printerCosts: PrinterCost[]; prefill?: LeadCostingPrintingQuotationPrefill | null; onPrefillConsumed?: () => void }) {
  const client = useMemo(() => createClient(), []);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [leadId, setLeadId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [quoteDate, setQuoteDate] = useState(today);
  const [terms, setTerms] = useState(defaultTerms);
  const [draftItems, setDraftItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [leadResult, quoteResult] = await Promise.all([
        client.from("leads").select("id,lead_no,project_name,client_name,contact_name,phone,email,address").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        client.from("quotations").select("id,quotation_no,status,lead_id,project_name,issue_date,total_cost,subtotal,total_amount,revision_note,terms_conditions,created_by").eq("organization_id", organizationId).eq("quotation_source", SOURCE).order("created_at", { ascending: false }),
      ]);
      if (leadResult.error) throw leadResult.error;
      if (quoteResult.error) throw quoteResult.error;
      const loadedQuotes = (quoteResult.data ?? []) as Quote[];
      const itemResult = loadedQuotes.length ? await client.from("quotation_items").select("id,quotation_id,description,quantity,unit_cost,costing_metadata").in("quotation_id", loadedQuotes.map((quote) => quote.id)).order("sort_order", { ascending: true }) : { data: [], error: null };
      if (itemResult.error) throw itemResult.error;
      setLeads((leadResult.data ?? []) as Lead[]);
      setQuotes(loadedQuotes);
      setItems((itemResult.data ?? []) as QuoteItem[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Printing quotations could not load. Apply the printing quotation migration first.");
    } finally {
      setLoading(false);
    }
  }, [client, organizationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setLeadId("");
    setProjectName(prefill.projectName ?? prefill.collateralType ?? "");
    setQuoteDate(today());
    setTerms(defaultTerms);
    setDraftItems([{ ...prefill, id: crypto.randomUUID() }]);
    setMessage("Calculator values copied into a new Printing Quotation. Select the Lead before saving.");
    setError(null);
    onPrefillConsumed?.();
  }, [onPrefillConsumed, prefill]);
  useEffect(() => {
    const channel = client.channel(`lead-costing-printing-quotations:${organizationId}`);
    ["quotations", "quotation_items"].forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table, ...(table === "quotations" ? { filter: `organization_id=eq.${organizationId}` } : {}) }, () => void load()));
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, load, organizationId]);

  const printableMaterialRows = useMemo(() => materials.filter((material) => isPrintableLeadCostingMaterial(material)), [materials]);
  const inventoryByMaterial = useMemo(() => new Map(inventory.map((row) => [row.material_id, row])), [inventory]);
  const selectedLead = leads.find((lead) => lead.id === leadId);
  const calculations = useMemo(() => draftItems.map((item) => {
    const material = materials.find((row) => row.id === item.materialId);
    const input = { width: item.width, height: item.height, quantity: item.quantity, unit: item.unit, dpi: item.dpi, mediaRate: item.mediaRate, inkRate: item.inkRate, wasteRate: item.wasteRate, lamination: item.lamination };
    return { item, material, calculation: calculateLeadCosting(input, material), readiness: calculateProductionReadiness(input, material, inventoryByMaterial.get(item.materialId)) };
  }), [draftItems, inventoryByMaterial, materials]);
  const totalCost = calculations.reduce((sum, row) => sum + (row.calculation?.totalOrderCost ?? 0), 0);
  const allRowsReady = calculations.length > 0 && calculations.every((row) => row.calculation?.valid && (row.readiness.ready || (row.readiness.manualConfirmationAllowed && row.item.manualStockConfirmed === true)));
  const currentItems = (quoteId: string) => items.filter((item) => item.quotation_id === quoteId);

  const startNew = () => { setEditing(null); setLeadId(""); setProjectName(""); setQuoteDate(today()); setTerms(defaultTerms); setDraftItems([emptyItem(printableMaterialRows, printerCosts)]); setMessage(null); setError(null); };
  const editQuote = (quote: Quote) => {
    const quoteItems = currentItems(quote.id);
    setEditing(quote); setLeadId(quote.lead_id ?? ""); setProjectName(quote.project_name ?? ""); setQuoteDate(quote.issue_date || today());
    setTerms(quote.terms_conditions || defaultTerms);
    setDraftItems(quoteItems.map((row) => ({ ...emptyItem(printableMaterialRows, printerCosts), ...asMetadata(row.costing_metadata), id: row.id, quantity: String(row.quantity || 1) })));
    setMessage(null); setError(null);
  };
  const updateItem = (id: string, patch: Partial<Item>) => setDraftItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const selectMaterial = (id: string, item: Item) => {
    const material = printableMaterialRows.find((row) => row.id === id);
    updateItem(item.id, { materialId: id, materialName: material?.name ?? "", mediaRate: materialRate(material, item.unit) });
  };
  const changeUnit = (item: Item, unit: LeadCostingUnit) => updateItem(item.id, { unit, mediaRate: materialRate(printableMaterialRows.find((row) => row.id === item.materialId), unit), inkRate: String(printCostRateForUnit(printerCosts, unit)) });
  const save = async (submit: boolean) => {
    setSaving(true); setMessage(null); setError(null);
    try {
      if (!leadId || !selectedLead) throw new Error("Select the client Lead before saving the quotation.");
      if (!draftItems.length || draftItems.some((item) => !item.collateralType.trim() || !item.width || !item.height)) throw new Error("Each printing line needs a collateral type and size.");
      if (submit && !allRowsReady) throw new Error("Every submitted line needs a physical size, an active printable material, valid direct-cost inputs, and enough recorded inventory for the selected material.");
      const payload = draftItems.map((item, index) => {
        const result = calculations[index];
        const productionCost = result.calculation?.totalCostPerItem ?? 0;
        return { description: [item.collateralType.trim(), item.materialName.trim(), item.printType.trim(), formatSize(item), item.location.trim() ? `Location: ${item.location.trim()}` : ""].filter(Boolean).join(" · "), quantity: Math.max(1, Math.floor(numberValue(item.quantity) || 1)), production_cost: productionCost, costing_metadata: { ...item, manual_stock_confirmed: item.manualStockConfirmed === true, production_cost: productionCost } };
      });
      const { data, error: saveError } = await client.rpc("save_lead_costing_printing_quotation", { p_quotation_id: editing?.id ?? null, p_lead_id: leadId, p_project_name: projectName.trim() || selectedLead.project_name || "Printing collateral quotation", p_issue_date: quoteDate || today(), p_items: payload, p_terms_conditions: terms });
      if (saveError) throw saveError;
      const quotationId = String(data);
      if (submit) {
        const { error: submitError } = await client.rpc("submit_lead_costing_printing_quotation", { p_quotation_id: quotationId });
        if (submitError) throw submitError;
      }
      setMessage(submit ? "Printing quotation submitted to the General Manager for final pricing and approval." : "Printing quotation draft saved.");
      setEditing(null); setDraftItems([]); setLeadId(""); setProjectName(""); await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Printing quotation could not be saved.");
    } finally { setSaving(false); }
  };

  if (loading) return <section className="rounded-md border border-[#dfe5ed] bg-white p-5 text-[13px] text-[#687386]">Loading printing quotations…</section>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[15px] font-medium text-[#1f4e79]">Printing Quotations</h3><p className="mt-1 text-[12px] text-[#687386]">Build a multi-item collateral quotation from a Lead. Submit it to the General Manager for final selling prices and approval.</p></div><button type="button" className={primaryButton} onClick={startNew}><Plus size={14} /> New printing quotation</button></div>
    {message && <div className="rounded-md border border-[#b9dec9] bg-[#f0fbf4] px-3 py-2 text-[12px] text-[#17623b]" role="status">{message}</div>}{error && <div className="rounded-md border border-[#efc4c8] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#9d2831]" role="alert">{error}</div>}
    {draftItems.length > 0 && <div className="rounded-md border border-[#dfe5ed] bg-white p-4">
      <div className="grid gap-3 md:grid-cols-3"><label className="text-[12px] font-medium text-[#465a74] md:col-span-2">Lead / client<select className={inputClass} value={leadId} onChange={(event) => { const next = leads.find((lead) => lead.id === event.target.value); setLeadId(event.target.value); setProjectName(next?.project_name ?? ""); }}><option value="">Select Lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.lead_no ? `${lead.lead_no} · ` : ""}{lead.client_name || "Unnamed client"}{lead.project_name ? ` · ${lead.project_name}` : ""}</option>)}</select></label><label className="text-[12px] font-medium text-[#465a74]">Quotation date<input className={inputClass} type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} /></label><label className="text-[12px] font-medium text-[#465a74] md:col-span-3">Project / campaign name<input className={inputClass} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Printing collateral quotation" /></label></div>
      <div className="mt-4 overflow-x-auto"><table className="app-table w-full min-w-[1650px] text-left text-[11px]"><thead><tr><th>Collateral type</th><th>Material / substrate</th><th>Print</th><th>Width</th><th>Height</th><th>Unit</th><th>Location</th><th>Qty</th><th>Stock readiness</th><th>Media rate</th><th>Print cost rate</th><th>Cost / item</th><th /></tr></thead><tbody>{draftItems.map((item) => { const result = calculations.find((row) => row.item.id === item.id); return <tr key={item.id} className="align-top"><td><input className={inputClass} value={item.collateralType} onChange={(event) => updateItem(item.id, { collateralType: event.target.value })} placeholder="Horizontal Banner" /></td><td><select className={inputClass} value={item.materialId} onChange={(event) => selectMaterial(event.target.value, item)}><option value="">Select printable material</option>{printableMaterialRows.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select><input className={inputClass} value={item.materialName} onChange={(event) => updateItem(item.id, { materialName: event.target.value })} placeholder="Photo Paper / Sticker on Sintra" /></td><td><input className={inputClass} value={item.printType} onChange={(event) => updateItem(item.id, { printType: event.target.value })} placeholder="1 Side Print" /></td><td><input className={inputClass} type="number" min="0" step="any" value={item.width} onChange={(event) => updateItem(item.id, { width: event.target.value })} /></td><td><input className={inputClass} type="number" min="0" step="any" value={item.height} onChange={(event) => updateItem(item.id, { height: event.target.value })} /></td><td><select className={inputClass} value={item.unit} onChange={(event) => changeUnit(item, event.target.value as LeadCostingUnit)}><option value="m">meters</option><option value="in">inches</option><option value="ft">feet</option><option value="px">px</option></select></td><td><input className={inputClass} value={item.location} onChange={(event) => updateItem(item.id, { location: event.target.value })} placeholder="Escalator landing" /></td><td><input className={inputClass} type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} /></td><td className="min-w-[180px] px-3 py-3">{result?.readiness.ready ? <span className="text-[#13845a]">Ready</span> : result?.readiness.manualConfirmationAllowed ? <label className="flex gap-2 font-normal text-[#a76605]"><input type="checkbox" checked={item.manualStockConfirmed === true} onChange={(event) => updateItem(item.id, { manualStockConfirmed: event.target.checked })} /> Confirm sheet stock manually</label> : <span className="font-normal text-[#a76605]">{result?.readiness.reason || "Stock check needed"}</span>}</td><td><input className={inputClass} type="number" min="0" step="any" value={item.mediaRate} onChange={(event) => updateItem(item.id, { mediaRate: event.target.value })} /></td><td><input className={inputClass} type="number" min="0" step="any" value={item.inkRate} onChange={(event) => updateItem(item.id, { inkRate: event.target.value })} /></td><td className="whitespace-nowrap px-3 py-3 font-semibold text-[#202938]">{result?.calculation?.valid ? money(result.calculation.totalCostPerItem) : <span className="font-normal text-[#a76605]">Enter valid inputs</span>}</td><td className="px-3 py-3"><button type="button" className="text-[#a12d36]" onClick={() => setDraftItems((current) => current.filter((row) => row.id !== item.id))} aria-label="Remove printing line"><Trash2 size={14} /></button></td></tr>; })}</tbody></table></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button type="button" className={buttonClass} onClick={() => setDraftItems((current) => [...current, emptyItem(printableMaterialRows, printerCosts)])}><Plus size={14} /> Add collateral line</button><div className="text-right text-[12px] text-[#465a74]">Estimated production cost: <strong className="text-[16px] text-[#13845a]">{money(totalCost)}</strong></div></div>
      <label className="mt-4 block text-[12px] font-medium text-[#465a74]">Quotation terms<textarea className={`${inputClass} min-h-24`} value={terms} onChange={(event) => setTerms(event.target.value)} /></label>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#edf0f5] pt-3"><button type="button" className={buttonClass} onClick={() => { setDraftItems([]); setEditing(null); }}>Cancel</button><button type="button" className={buttonClass} disabled={saving} onClick={() => void save(false)}><Save size={14} /> Save draft</button><button type="button" className={primaryButton} disabled={saving || !allRowsReady} onClick={() => void save(true)}><Send size={14} /> Submit to GM</button></div>
    </div>}
    <div className="overflow-x-auto rounded-md border border-[#dfe5ed] bg-white"><table className="app-table w-full min-w-[900px] text-left text-[12px]"><thead><tr><th>Quotation</th><th>Lead / project</th><th>Status</th><th>Estimated cost</th><th>Total</th><th>Actions</th></tr></thead><tbody>{quotes.map((quote) => { const lead = leads.find((row) => row.id === quote.lead_id); const editable = ["draft", "needs_revision"].includes(quote.status); return <tr key={quote.id}><td className="px-3 py-3 font-medium">{quote.quotation_no}<div className="text-[10px] text-[#687386]">{quote.issue_date}</div></td><td className="px-3 py-3">{lead?.client_name || "—"}<div className="text-[10px] text-[#687386]">{quote.project_name || lead?.project_name || "—"}</div></td><td className="px-3 py-3"><span className={quote.status === "approved" ? "text-[#13845a]" : quote.status === "needs_revision" ? "text-[#a76605]" : "text-[#687386]"}>{quote.status.replaceAll("_", " ")}</span>{quote.revision_note && <div className="mt-1 max-w-[260px] text-[10px] text-[#a76605]">GM note: {quote.revision_note}</div>}</td><td className="px-3 py-3">{money(numberValue(quote.total_cost))}</td><td className="px-3 py-3 font-semibold">{quote.status === "approved" ? money(numberValue(quote.total_amount)) : "Pending GM pricing"}</td><td className="px-3 py-3"><span className="flex flex-wrap gap-2">{editable && <button type="button" className={buttonClass} onClick={() => editQuote(quote)}><FileText size={13} /> Edit</button>}{quote.status === "approved" && <button type="button" className={buttonClass} onClick={() => window.open(`/quotation-viewer?quotationId=${encodeURIComponent(quote.id)}`, "_blank", "noopener,noreferrer")}><ExternalLink size={13} /> PDF</button>}{quote.status === "pending_gm_approval" && <span className="inline-flex items-center gap-1 text-[11px] text-[#a76605]"><Check size={13} /> Awaiting GM</span>}</span></td></tr>; })}{!quotes.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#687386]">No printing quotations yet. Start one from the client Lead above.</td></tr>}</tbody></table></div>
  </section>;
}
