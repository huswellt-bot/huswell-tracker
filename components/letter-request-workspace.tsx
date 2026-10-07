"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Ban,
  Check,
  FileText,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  Send,
  X,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Store } from "@/components/huswell-workspace";

const ATTACHMENT_BUCKET = "employee-request-attachments";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

type RequestType = "work_from_home" | "leave_of_absence";
type RequestStatus = "draft" | "pending" | "approved" | "rejected" | "withdrawn";
type Decision = "approved" | "rejected";

type FormState = {
  requestType: RequestType;
  startDate: string;
  endDate: string;
  reason: string;
  workPlan: string;
  leaveType: string;
  attachmentPath: string;
  attachmentName: string;
  attachmentMimeType: string;
  attachmentSize: string;
};

type RequestRow = Store["employee_requests"][number];
type EventRow = Store["employee_request_events"][number];

const emptyForm = (): FormState => ({
  requestType: "work_from_home",
  startDate: "",
  endDate: "",
  reason: "",
  workPlan: "",
  leaveType: "vacation",
  attachmentPath: "",
  attachmentName: "",
  attachmentMimeType: "",
  attachmentSize: "",
});

const value = (input: unknown, fallback = "") =>
  input === null || input === undefined ? fallback : String(input);

const requestTypeLabel = (requestType: unknown) =>
  value(requestType) === "leave_of_absence" ? "Leave of Absence" : "Work From Home";

const leaveTypeLabel = (leaveType: unknown) => {
  const labels: Record<string, string> = {
    vacation: "Vacation",
    sick: "Sick",
    personal: "Personal",
    other: "Other",
  };
  return labels[value(leaveType)] ?? value(leaveType, "Leave");
};

const statusLabel = (status: unknown) =>
  value(status, "draft").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const statusVariant = (status: unknown): "default" | "success" | "warning" | "muted" => {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected" || status === "withdrawn") return "muted";
  return "default";
};

const formatDate = (input: unknown) => {
  const raw = value(input);
  if (!raw) return "—";
  const date = new Date(`${raw.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
};

const formatDateTime = (input: unknown) => {
  const raw = value(input);
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const attachmentExtension = (file: File) => {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  return "jpg";
};

const eventLabel = (eventType: unknown) => {
  const labels: Record<string, string> = {
    created: "Draft created",
    saved: "Draft saved",
    edited_pending: "Pending request edited and returned to draft",
    submitted: "Submitted for approval",
    approved: "Approved",
    rejected: "Rejected",
    withdrawn: "Cancelled",
  };
  return labels[value(eventType)] ?? statusLabel(eventType);
};

function StatusBadge({ status }: { status: unknown }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
}

function FieldLabel({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block text-[12px] font-medium text-[var(--color-text-primary)]">
      {label}
      {required ? <span className="ml-1 text-[var(--color-danger-text)]">*</span> : null}
      {children}
    </label>
  );
}

export function LetterRequestWorkspace({
  store,
  organizationId,
  role,
  currentUserId,
  loading,
  reload,
  notice,
}: {
  store: Store;
  organizationId: string;
  role: string;
  currentUserId: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const client = useMemo(() => createClient(), []);
  const isReviewer = ["owner", "admin", "payroll"].includes(role);
  const canSubmit = role === "sales_pricing_officer";
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachmentRemoved, setAttachmentRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [reviewDialog, setReviewDialog] = useState<{
    request: RequestRow;
    decision: Decision;
  } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requests = useMemo(() => {
    return [...store.employee_requests]
      .filter((request) =>
        isReviewer ? true : value(request.requested_by) === value(currentUserId),
      )
      .sort((left, right) =>
        value(right.updated_at, value(right.created_at)).localeCompare(
          value(left.updated_at, value(left.created_at)),
        ),
      );
  }, [currentUserId, isReviewer, store.employee_requests]);

  const selectedEvents = useMemo(
    () =>
      store.employee_request_events
        .filter((event) => value(event.request_id) === selectedRequestId)
        .sort((left, right) => value(left.created_at).localeCompare(value(right.created_at))),
    [selectedRequestId, store.employee_request_events],
  );

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setEditingId(null);
    setSelectedFile(null);
    setAttachmentRemoved(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const closeForm = useCallback(() => {
    if (saving) return;
    resetForm();
    setFormOpen(false);
  }, [resetForm, saving]);

  const openNewForm = useCallback(() => {
    resetForm();
    setFormOpen(true);
  }, [resetForm]);

  useEffect(() => {
    if (!formOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) closeForm();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeForm, formOpen, saving]);

  const startEdit = (request: RequestRow) => {
    setEditingId(value(request.id));
    setForm({
      requestType: value(request.request_type) === "leave_of_absence" ? "leave_of_absence" : "work_from_home",
      startDate: value(request.start_date),
      endDate: value(request.end_date),
      reason: value(request.reason),
      workPlan: value(request.work_plan),
      leaveType: value(request.leave_type, "vacation"),
      attachmentPath: value(request.attachment_storage_path),
      attachmentName: value(request.attachment_file_name),
      attachmentMimeType: value(request.attachment_mime_type),
      attachmentSize: value(request.attachment_file_size),
    });
    setSelectedFile(null);
    setAttachmentRemoved(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFormOpen(true);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (!allowedAttachmentTypes.has(file.type)) {
      notice("Attach a PDF, JPG, or PNG file.");
      return;
    }
    if (file.size < 1 || file.size > MAX_ATTACHMENT_SIZE) {
      notice("The supporting file must be 10 MB or smaller.");
      return;
    }
    setSelectedFile(file);
    setAttachmentRemoved(false);
  };

  const validateForm = () => {
    if (!form.startDate || !form.endDate) return "Choose a start date and end date.";
    if (form.endDate < form.startDate) return "The end date cannot be before the start date.";
    if (!form.reason.trim()) return "Enter a reason for the request.";
    if (form.requestType === "work_from_home" && !form.workPlan.trim()) {
      return "Enter the work plan for Work From Home.";
    }
    if (form.requestType === "leave_of_absence" && !form.leaveType) {
      return "Choose a Leave of Absence type.";
    }
    return null;
  };

  const saveRequest = async (requestId: string | null, attachmentPath: string | null) => {
    const { data, error } = await client.rpc("save_employee_request", {
      p_request_id: requestId,
      p_request_type: form.requestType,
      p_start_date: form.startDate,
      p_end_date: form.endDate,
      p_reason: form.reason.trim(),
      p_work_plan: form.requestType === "work_from_home" ? form.workPlan.trim() : null,
      p_leave_type: form.requestType === "leave_of_absence" ? form.leaveType : null,
      p_attachment_storage_path: attachmentPath,
      p_attachment_file_name: attachmentPath ? (selectedFile?.name || form.attachmentName || null) : null,
      p_attachment_mime_type: attachmentPath ? (selectedFile?.type || form.attachmentMimeType || null) : null,
      p_attachment_file_size: attachmentPath
        ? selectedFile?.size ?? (Number(form.attachmentSize) || null)
        : null,
    });
    if (error) throw new Error(error.message);
    const savedId = value(data);
    if (!savedId) throw new Error("The Letter Request could not be saved.");
    return savedId;
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      notice(validationError);
      return;
    }
    setSaving(true);
    let uploadedPath: string | null = null;
    let attachmentLinked = false;
    const oldAttachmentPath = form.attachmentPath || null;
    try {
      const initialPath = attachmentRemoved ? null : oldAttachmentPath;
      const requestId = await saveRequest(editingId, initialPath);
      let finalPath = initialPath;

      if (selectedFile) {
        uploadedPath = `${organizationId}/${requestId}/${crypto.randomUUID()}.${attachmentExtension(selectedFile)}`;
        const { error: uploadError } = await client.storage
          .from(ATTACHMENT_BUCKET)
          .upload(uploadedPath, selectedFile, {
            contentType: selectedFile.type,
            upsert: false,
          });
        if (uploadError) throw new Error(uploadError.message);
        finalPath = uploadedPath;
        await saveRequest(requestId, finalPath);
        attachmentLinked = true;
      }

      const { error: submitError } = await client.rpc("submit_employee_request", {
        p_request_id: requestId,
      });
      if (submitError) throw new Error(submitError.message);

      const replacedAttachment = oldAttachmentPath && oldAttachmentPath !== finalPath;
      if (replacedAttachment) {
        await client.storage.from(ATTACHMENT_BUCKET).remove([oldAttachmentPath]);
      }
      notice(editingId ? "Letter Request updated and submitted." : "Letter Request submitted for approval.");
      resetForm();
      setFormOpen(false);
      await reload();
    } catch (error) {
      if (uploadedPath && !attachmentLinked) {
        await client.storage.from(ATTACHMENT_BUCKET).remove([uploadedPath]);
      }
      notice(error instanceof Error ? error.message : "The Letter Request could not be submitted.");
    } finally {
      setSaving(false);
    }
  };

  const withdrawRequest = async () => {
    if (!withdrawId) return;
    setSaving(true);
    const { error } = await client.rpc("withdraw_employee_request", {
      p_request_id: withdrawId,
    });
    setSaving(false);
    setWithdrawId(null);
    if (error) {
      notice(error.message);
      return;
    }
    notice("Letter Request cancelled.");
    await reload();
  };

  const submitReview = async () => {
    if (!reviewDialog || !reviewNote.trim()) {
      notice("Enter a note before deciding the request.");
      return;
    }
    setSaving(true);
    const { error } = await client.rpc("review_employee_request", {
      p_request_id: reviewDialog.request.id,
      p_decision: reviewDialog.decision,
      p_note: reviewNote.trim(),
    });
    setSaving(false);
    if (error) {
      notice(error.message);
      return;
    }
    const decisionLabel = reviewDialog.decision === "approved" ? "approved" : "rejected";
    setReviewDialog(null);
    setReviewNote("");
    notice(`Letter Request ${decisionLabel}.`);
    await reload();
  };

  const openAttachment = async (request: RequestRow) => {
    const path = value(request.attachment_storage_path);
    if (!path) return;
    const { data, error } = await client.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(path, 5 * 60);
    if (error || !data?.signedUrl) {
      notice(error?.message ?? "The supporting file could not be opened.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5">
      {canSubmit && formOpen ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[var(--color-overlay)] px-3 py-4 sm:px-5 sm:py-7" role="presentation">
          <section
            className="my-0 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl sm:my-2"
            role="dialog"
            aria-modal="true"
            aria-labelledby="letter-request-dialog-title"
            aria-describedby="letter-request-dialog-description"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-4 sm:px-5">
              <div>
                <h2 id="letter-request-dialog-title" className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                  {editingId ? "Edit Letter Request" : "New Letter Request"}
                </h2>
                <p id="letter-request-dialog-description" className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                  Request permission to work from home or take a leave of absence.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close Letter Request form"
              >
                <X size={18} />
              </button>
            </header>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitForm}>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Request type" required>
                <select
                  className="input mt-1"
                  value={form.requestType}
                  onChange={(event) => {
                    const nextType = event.target.value as RequestType;
                    setForm((current) => ({
                      ...current,
                      requestType: nextType,
                      workPlan: nextType === "work_from_home" ? current.workPlan : "",
                      leaveType: nextType === "leave_of_absence" ? current.leaveType || "vacation" : "",
                    }));
                  }}
                  disabled={saving}
                >
                  <option value="work_from_home">Work From Home</option>
                  <option value="leave_of_absence">Leave of Absence</option>
                </select>
              </FieldLabel>
              {form.requestType === "leave_of_absence" ? (
                <FieldLabel label="Leave type" required>
                  <select
                    className="input mt-1"
                    value={form.leaveType}
                    onChange={(event) => setForm((current) => ({ ...current, leaveType: event.target.value }))}
                    disabled={saving}
                  >
                    <option value="vacation">Vacation</option>
                    <option value="sick">Sick</option>
                    <option value="personal">Personal</option>
                    <option value="other">Other</option>
                  </select>
                </FieldLabel>
              ) : (
                <div aria-hidden="true" />
              )}
              <FieldLabel label="Start date" required>
                <input
                  className="input mt-1"
                  type="date"
                  value={form.startDate}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
                  disabled={saving}
                  required
                />
              </FieldLabel>
              <FieldLabel label="End date" required>
                <input
                  className="input mt-1"
                  type="date"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
                  disabled={saving}
                  required
                />
              </FieldLabel>
              <FieldLabel label="Reason" required>
                <textarea
                  className="input mt-1 min-h-24 resize-y sm:col-span-2"
                  value={form.reason}
                  onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                  disabled={saving}
                  required
                  placeholder="Explain why you are requesting this permission."
                />
              </FieldLabel>
              {form.requestType === "work_from_home" ? (
                <FieldLabel label="Work plan" required>
                  <textarea
                    className="input mt-1 min-h-24 resize-y sm:col-span-2"
                    value={form.workPlan}
                    onChange={(event) => setForm((current) => ({ ...current, workPlan: event.target.value }))}
                    disabled={saving}
                    required
                    placeholder="List the work or deliverables you will complete."
                  />
                </FieldLabel>
              ) : null}
              <div className="sm:col-span-2">
                <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">Supporting file</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="sr-only"
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                    disabled={saving}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                  >
                    <Paperclip />
                    Attach file
                  </Button>
                  {selectedFile ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                      {selectedFile.name}
                      <button
                        type="button"
                        className="rounded-[var(--radius-control)] p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]"
                        onClick={() => {
                          setSelectedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        aria-label="Remove selected file"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ) : form.attachmentPath && !attachmentRemoved ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                      {form.attachmentName || "Existing attachment"}
                      <button
                        type="button"
                        className="rounded-[var(--radius-control)] p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]"
                        onClick={() => {
                          setAttachmentRemoved(true);
                        }}
                        aria-label="Remove existing attachment"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ) : (
                    <span className="text-[12px] text-[var(--color-text-tertiary)]">Optional PDF, JPG, or PNG up to 10 MB.</span>
                  )}
                </div>
              </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 sm:px-5">
                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <LoaderCircle className="animate-spin" /> : <Send />}
                  {editingId ? "Save and resubmit" : "Submit request"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                {isReviewer ? "Letter Requests" : "My Letter Requests"}
              </h2>
              <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                {isReviewer
                  ? "Review pending Work From Home and Leave of Absence requests. Either General Manager or Payroll can decide each request."
                  : "Track your submitted requests and the decision notes from General Manager or Payroll."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canSubmit ? (
                <Button type="button" size="sm" onClick={openNewForm} disabled={saving}>
                  <Plus />
                  New Letter Request
                </Button>
              ) : null}
              <span className="text-[12px] text-[var(--color-text-tertiary)]">
                {requests.length} request{requests.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="border-t border-[var(--color-border)] p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-[var(--color-text-secondary)]">
              <LoaderCircle className="size-4 animate-spin" /> Loading Letter Requests…
            </div>
          ) : requests.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-tertiary)]">
                    {isReviewer ? <th className="px-4 py-3">Requester</th> : null}
                    <th className="px-4 py-3">Request</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Note</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => {
                    const requestId = value(request.id);
                    const status = value(request.status, "draft") as RequestStatus;
                    const requester = value(request.requester_name, "Pricing Officer");
                    const canEdit = canSubmit && value(request.requested_by) === value(currentUserId) && ["draft", "pending"].includes(status);
                    const canWithdraw = canEdit;
                    const isSelected = selectedRequestId === requestId;
                    return (
                      <tr key={requestId} className="border-b border-[var(--color-border)] last:border-0 align-top">
                        {isReviewer ? <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{requester}</td> : null}
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--color-text-primary)]">{requestTypeLabel(request.request_type)}</div>
                          <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{value(request.request_no, "Letter Request")}</div>
                          {request.request_type === "leave_of_absence" ? <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{leaveTypeLabel(request.leave_type)}</div> : null}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">
                          {formatDate(request.start_date)} – {formatDate(request.end_date)}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={status} /></td>
                        <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDateTime(request.updated_at ?? request.created_at)}</td>
                        <td className="max-w-[220px] px-4 py-3 text-[var(--color-text-secondary)]">
                          <span className="line-clamp-2">{value(request.decision_note, "—")}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="xs" onClick={() => setSelectedRequestId(isSelected ? null : requestId)}>
                              {isSelected ? "Hide history" : "History"}
                            </Button>
                            {value(request.attachment_storage_path) ? (
                              <Button type="button" variant="ghost" size="icon-xs" onClick={() => void openAttachment(request)} aria-label="Open supporting file">
                                <FileText />
                              </Button>
                            ) : null}
                            {canEdit ? (
                              <Button type="button" variant="ghost" size="icon-xs" onClick={() => startEdit(request)} aria-label="Edit Letter Request">
                                <Pencil />
                              </Button>
                            ) : null}
                            {canWithdraw ? (
                              <Button type="button" variant="ghost" size="icon-xs" onClick={() => setWithdrawId(requestId)} aria-label="Cancel Letter Request">
                                <Ban />
                              </Button>
                            ) : null}
                            {isReviewer && status === "pending" ? (
                              <>
                                <Button type="button" variant="ghost" size="icon-xs" onClick={() => { setReviewNote(""); setReviewDialog({ request, decision: "approved" }); }} aria-label="Approve Letter Request">
                                  <Check />
                                </Button>
                                <Button type="button" variant="ghost" size="icon-xs" onClick={() => { setReviewNote(""); setReviewDialog({ request, decision: "rejected" }); }} aria-label="Reject Letter Request">
                                  <XCircle />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {selectedRequestId ? (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-4">
                  <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">Request history</h3>
                  {selectedEvents.length ? (
                    <ol className="mt-3 space-y-2">
                      {selectedEvents.map((event: EventRow) => (
                        <li key={value(event.id)} className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
                          <span className="text-[var(--color-text-primary)]">{eventLabel(event.event_type)}</span>
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">{formatDateTime(event.created_at)}</span>
                          {value(event.note) ? <p className="basis-full text-[var(--color-text-secondary)]">{value(event.note)}</p> : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">No history is available for this request.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-[12px] text-[var(--color-text-secondary)]">
              {isReviewer ? "No Letter Requests have been submitted." : "You have not submitted a Letter Request yet."}
            </div>
          )}
        </CardContent>
      </Card>

      {reviewDialog ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[var(--color-overlay)] p-4" role="presentation">
          <form
            className="w-full max-w-lg rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            onSubmit={(event) => { event.preventDefault(); void submitReview(); }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                  {reviewDialog.decision === "approved" ? "Approve Letter Request" : "Reject Letter Request"}
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                  {requestTypeLabel(reviewDialog.request.request_type)} for {value(reviewDialog.request.requester_name, "Pricing Officer")}.
                </p>
              </div>
              <button type="button" onClick={() => setReviewDialog(null)} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]" aria-label="Close decision dialog">
                <X size={18} />
              </button>
            </div>
            <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-primary)]">
              Decision note<span className="ml-1 text-[var(--color-danger-text)]">*</span>
              <textarea
                autoFocus
                className="input mt-1 min-h-24 resize-y"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                required
                disabled={saving}
                placeholder="Explain the approval or rejection."
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReviewDialog(null)} disabled={saving}>Cancel</Button>
              <Button type="submit" variant={reviewDialog.decision === "approved" ? "default" : "destructive"} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : reviewDialog.decision === "approved" ? <Check /> : <XCircle />}
                {reviewDialog.decision === "approved" ? "Approve" : "Reject"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {withdrawId ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[var(--color-overlay)] p-4" role="presentation">
          <section className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" role="dialog" aria-modal="true" aria-labelledby="withdraw-letter-request-title">
            <h2 id="withdraw-letter-request-title" className="text-[16px] font-semibold text-[var(--color-text-primary)]">Cancel Letter Request?</h2>
            <p className="mt-1.5 text-[13px] text-[var(--color-text-secondary)]">This request will be closed. You can create a new request later.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setWithdrawId(null)} disabled={saving}>Keep request</Button>
              <Button type="button" variant="destructive" onClick={() => void withdrawRequest()} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Ban />}
                Cancel request
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
