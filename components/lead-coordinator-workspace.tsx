"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { Check, LoaderCircle, Plus, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id?: string; [key: string]: unknown };

const value = (row: Row | null | undefined, key: string, fallback = "") => {
  const item = row?.[key];
  return item === null || item === undefined ? fallback : String(item);
};

const dateLabel = (raw: unknown) => {
  const text = String(raw ?? "");
  if (!text) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
};

const primaryButton = "inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#c43b43] px-3 text-[11px] font-semibold text-white hover:bg-[#ab3038] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#d9e0e9] bg-white px-3 text-[11px] font-semibold text-[#344054] hover:bg-[#f8faff] disabled:cursor-not-allowed disabled:opacity-50";

export function LeadCoordinatorWorkspace({
  organizationId,
}: {
  organizationId: string;
}) {
  const client = useMemo(() => createClient(), []);
  const [leads, setLeads] = useState<Row[]>([]);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transferLead, setTransferLead] = useState<Row | null>(null);
  const [recipient, setRecipient] = useState("");
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadValues, setLeadValues] = useState({
    client_name: "",
    contact_name: "",
    project_name: "",
    email: "",
    phone: "",
    date_sent: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [leadResult, memberResult, profileResult] = await Promise.all([
      client.from("leads").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      client.from("organization_members").select("user_id,role").eq("organization_id", organizationId).eq("role", "sales_pricing_officer"),
      client.from("profiles").select("id,full_name"),
    ]);
    const error = leadResult.error ?? memberResult.error ?? profileResult.error;
    if (error) setMessage(`Lead data could not load: ${error.message}`);
    setLeads((leadResult.data ?? []) as Row[]);
    setOfficers((memberResult.data ?? []) as Row[]);
    setProfiles((profileResult.data ?? []) as Row[]);
    setLoading(false);
  }, [client, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const officerName = (userId: unknown) => value(profiles.find((profile) => profile.id === userId), "full_name", "Sales & Pricing Officer");

  const addLead = async () => {
    if (!leadValues.client_name.trim() && !leadValues.contact_name.trim()) return setMessage("Enter a Name / Company or contact name.");
    setSaving(true);
    const { error } = await client.from("leads").insert({
      organization_id: organizationId,
      client_name: leadValues.client_name.trim() || leadValues.contact_name.trim(),
      contact_name: leadValues.contact_name.trim() || null,
      project_name: leadValues.project_name.trim() || null,
      email: leadValues.email.trim() || null,
      phone: leadValues.phone.trim() || null,
      date_sent: leadValues.date_sent || null,
      notes: leadValues.notes.trim() || null,
      evaluation_number: 4,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setLeadOpen(false);
    setLeadValues({ client_name: "", contact_name: "", project_name: "", email: "", phone: "", date_sent: "", notes: "" });
    setMessage("Lead received and assigned to you.");
    await load();
  };

  const transfer = async () => {
    if (!transferLead?.id || !recipient) return setMessage("Choose a Sales & Pricing Officer.");
    setSaving(true);
    const { error } = await client.rpc("transfer_lead_to_pricing_officer", {
      p_lead_id: transferLead.id,
      p_recipient_user_id: recipient,
      p_note: null,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setTransferLead(null);
    setRecipient("");
    setMessage("Lead transferred. The Sales & Pricing Officer is now the owner.");
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[14px] border border-[#d9e0e9] bg-white p-4 sm:p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-[#202938]">Lead intake and transfer</h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#7d8797]">Receive leads, then transfer ownership to a Sales &amp; Pricing Officer. After transfer, that officer receives the lead&apos;s full quotation and pricing workflow access.</p>
        </div>
        <button type="button" onClick={() => setLeadOpen(true)} className={primaryButton}><Plus size={13} /> Receive lead</button>
      </div>

      {message && <div className="flex items-start justify-between gap-3 rounded-lg border border-[#d9e0e9] bg-white px-3 py-2.5 text-[12px] text-[#344054]"><span>{message}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

      <section className="rounded-[14px] border border-[#d9e0e9] bg-white">
        <div className="border-b border-[#edf0f5] px-4 py-4"><h2 className="text-[14px] font-semibold text-[#202938]">My leads</h2><p className="mt-1 text-[11px] text-[#7d8797]">Transferred leads leave this list because ownership moves to the selected officer.</p></div>
        <div className="overflow-x-auto"><table className="app-table min-w-[920px]"><thead><tr><th>Name / Company</th><th>Contact</th><th>Project</th><th>Recorded</th><th>Status</th><th>Action</th></tr></thead><tbody>{leads.map((lead) => <tr key={String(lead.id)}><td><b>{value(lead, "client_name", "—")}</b><small>{value(lead, "lead_no")}</small></td><td>{value(lead, "contact_name", "—")}<small>{value(lead, "phone", "—")}</small></td><td>{value(lead, "project_name", "—")}</td><td>{dateLabel(lead.date_sent ?? lead.created_at)}</td><td>{value(lead, "evaluation_number", "—")}</td><td><button type="button" onClick={() => setTransferLead(lead)} className={secondaryButton}><Send size={13} /> Transfer</button></td></tr>)}{!leads.length && <tr><td colSpan={6} className="text-center text-[#7d8797]">{loading ? "Loading leads…" : "No leads are currently assigned to you."}</td></tr>}</tbody></table></div>
      </section>

      {leadOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4"><div className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">Receive lead</h2><p className="mt-1 text-[12px] text-[#7d8797]">The new lead will be assigned to you until transferred.</p></div><button type="button" onClick={() => setLeadOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[12px] font-medium text-[#202938]">Name / Company<input value={leadValues.client_name} onChange={(event) => setLeadValues((current) => ({ ...current, client_name: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938]">Contact person<input value={leadValues.contact_name} onChange={(event) => setLeadValues((current) => ({ ...current, contact_name: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938]">Project<input value={leadValues.project_name} onChange={(event) => setLeadValues((current) => ({ ...current, project_name: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938]">Date received<input type="date" value={leadValues.date_sent} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setLeadValues((current) => ({ ...current, date_sent: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938]">Email<input type="email" value={leadValues.email} onChange={(event) => setLeadValues((current) => ({ ...current, email: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938]">Phone<input value={leadValues.phone} onChange={(event) => setLeadValues((current) => ({ ...current, phone: event.target.value }))} className="input mt-1" /></label><label className="text-[12px] font-medium text-[#202938] sm:col-span-2">Note<textarea value={leadValues.notes} onChange={(event) => setLeadValues((current) => ({ ...current, notes: event.target.value }))} className="input mt-1 min-h-20" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setLeadOpen(false)} className={secondaryButton}>Cancel</button><button type="button" disabled={saving} onClick={() => void addLead()} className={primaryButton}>{saving && <LoaderCircle size={14} className="animate-spin" />} Save lead</button></div></div></div>}

      {transferLead && <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-[17px] font-semibold text-[#202938]">Transfer lead ownership</h2><p className="mt-1 text-[12px] text-[#7d8797]">{value(transferLead, "client_name", "This lead")} will be owned by the selected officer.</p></div><button type="button" onClick={() => setTransferLead(null)} aria-label="Close"><X size={18} /></button></div><label className="mt-5 block text-[12px] font-medium text-[#202938]">Sales &amp; Pricing Officer<select value={recipient} onChange={(event) => setRecipient(event.target.value)} className="input mt-1"><option value="">Choose officer</option>{officers.map((officer) => <option key={String(officer.user_id)} value={String(officer.user_id)}>{officerName(officer.user_id)}</option>)}</select></label><p className="mt-3 rounded-lg border border-[#d9e0e9] bg-[#fafbfc] p-3 text-[11px] leading-5 text-[#687386]">This is a true owner transfer, not an endorsement. The receiving officer will use the lead for the full quotation and pricing workflow.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTransferLead(null)} className={secondaryButton}>Cancel</button><button type="button" disabled={saving} onClick={() => void transfer()} className={primaryButton}>{saving && <LoaderCircle size={14} className="animate-spin" />}<Check size={13} /> Transfer ownership</button></div></div></div>}
    </div>
  );
}
