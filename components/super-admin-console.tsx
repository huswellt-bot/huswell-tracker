"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AccountProfileDialog } from "@/components/account-profile-dialog";
import { FixedIconTooltip } from "@/components/fixed-icon-tooltip";
import { LoadingModal } from "@/components/loading-modal";
import { createClient } from "@/lib/supabase/client";

type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  banned: boolean;
  signature_url: string | null;
};
type PendingAction = { user: ManagedUser; action: "ban" | "unban" | "delete" };
type UserFormValues = {
  full_name: string;
  email: string;
  password: string;
  role: string;
};

const displayRole = (role: string) =>
  role === "admin" ? "General Manager" : "Sales Project Officer";
const titleCase = (value: string) =>
  value.replace(
    /(^|[^A-Za-z])([a-z])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );
const signatureFileName = (url: string) =>
  url.split("?")[0].split("/").pop() || "signature image";

export function SuperAdminConsole({
  organizationName,
}: {
  organizationName: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<UserFormValues>({
    full_name: "",
    email: "",
    password: "",
    role: "project_manager",
  });
  const [editValues, setEditValues] = useState<UserFormValues>({
    full_name: "",
    email: "",
    password: "",
    role: "project_manager",
  });
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [editSignatureFile, setEditSignatureFile] = useState<File | null>(
    null,
  );

  const load = useCallback(async () => {
    const response = await fetch("/api/super-admin/users", {
      cache: "no-store",
    });
    const result = (await response.json().catch(() => ({}))) as {
      users?: ManagedUser[];
      error?: string;
    };
    if (!response.ok) setMessage(result.error ?? "Unable to load users.");
    else setUsers(result.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfirmCreate(true);
  };

  const uploadOfficerSignature = async (userId: string, file: File) => {
    const form = new FormData();
    form.set("user_id", userId);
    form.set("signature", file);
    const response = await fetch("/api/super-admin/users/signature", {
      method: "POST",
      body: form,
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return response.ok ? null : result.error ?? "Unable to save the signature.";
  };

  const createUser = async () => {
    setConfirmCreate(false);
    setSaving(true);
    const response = await fetch("/api/super-admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      user_id?: string;
    };
    if (!response.ok) {
      setSaving(false);
      return setMessage(result.error ?? "Unable to create the user account.");
    }
    const signatureError =
      ["project_manager", "admin"].includes(values.role) && signatureFile && result.user_id
        ? await uploadOfficerSignature(result.user_id, signatureFile)
        : null;
    setSaving(false);
    setOpen(false);
    setShowTemporaryPassword(false);
    setValues({
      full_name: "",
      email: "",
      password: "",
      role: "project_manager",
    });
    setSignatureFile(null);
    setMessage(
      signatureError
        ? `User account created, but the signature could not be saved: ${signatureError}`
        : "User account created.",
    );
    await load();
  };

  const openEdit = (user: ManagedUser) => {
    setEditingUser(user);
    setEditValues({
      full_name: user.full_name,
      email: user.email,
      password: "",
      role: user.role,
    });
    setEditSignatureFile(null);
    setShowNewPassword(false);
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfirmEdit(true);
  };

  const updateUser = async () => {
    if (!editingUser) return;
    setConfirmEdit(false);
    setSaving(true);
    const response = await fetch("/api/super-admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: editingUser.id,
        action: "update",
        ...editValues,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      setSaving(false);
      return setMessage(result.error ?? "Unable to update the user account.");
    }
    const signatureError =
      ["project_manager", "admin"].includes(editValues.role) && editSignatureFile
        ? await uploadOfficerSignature(editingUser.id, editSignatureFile)
        : null;
    setSaving(false);
    setEditingUser(null);
    setEditSignatureFile(null);
    setMessage(
      signatureError
        ? `User account updated, but the signature could not be saved: ${signatureError}`
        : result.message ?? "User account updated.",
    );
    await load();
  };

  const manageUser = async () => {
    if (!pendingAction) return;
    const { user, action } = pendingAction;
    setPendingAction(null);
    setSaving(true);
    const response = await fetch("/api/super-admin/users", {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "delete"
          ? { user_id: user.id }
          : { user_id: user.id, action },
      ),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    setSaving(false);
    if (!response.ok)
      return setMessage(result.error ?? "Unable to update the user account.");
    setMessage(result.message ?? "User account updated.");
    await load();
  };

  const signOut = async () => {
    setSigningOut(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setMessage(error.message);
      setSigningOut(false);
      return;
    }
    router.replace("/auth");
    router.refresh();
  };
  const actionCopy =
    pendingAction?.action === "delete"
      ? `Delete ${pendingAction.user.full_name}'s account permanently? This cannot be undone.`
      : pendingAction?.action === "ban"
        ? `Ban ${pendingAction?.user.full_name}? They will no longer be able to sign in.`
        : `Unban ${pendingAction?.user.full_name}? They will be able to sign in again.`;

  return (
    <main className="min-h-screen bg-[#fafafa] text-[14px] text-[#151922]">
      <LoadingModal open={loading || saving} title={saving ? "Saving user changes" : "Loading users"} />
      <header className="border-b border-[#dfe5ed] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <Image
              src="/huswell-quotation-logo.png"
              alt="Huswell Trading"
              width={489}
              height={153}
              priority
              className="h-auto w-28"
            />
            <span className="hidden h-8 w-px bg-[#dfe5ed] sm:block" />
            <div>
              <h1 className="text-[16px] font-semibold">Super Admin</h1>
              <p className="text-[14px] text-[#7d8797]">
                {organizationName} · User Management
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d8dee8] px-3 font-semibold text-[#344054] transition-colors hover:bg-[#f7f7f8]"
            >
              <UserRound size={15} />
              Profile
            </button>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => setConfirmSignOut(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d8dee8] px-3 font-semibold text-[#344054] transition-colors hover:bg-[#f7f7f8] disabled:opacity-60"
            >
              <LogOut size={15} />
              {signingOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-8">
        <section className="overflow-hidden rounded-2xl border border-[#dfe5ed] bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#edf0f5] p-5">
            <div>
              <h2 className="flex items-center gap-2 text-[16px] font-semibold">
                <UsersRound size={18} className="text-[#c43b43]" />
                Users
              </h2>
              <p className="mt-1 text-[14px] text-[#7d8797]">
                Accounts currently assigned to this workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#c43b43] px-3 font-semibold text-white transition-colors hover:bg-[#ab3038]"
            >
              <Plus size={15} />
              Add User
            </button>
          </div>
          <div className="max-h-[460px] overflow-auto">
            <table className="app-table w-full min-w-[760px] text-left text-[14px]">
              <thead className="sticky top-0 z-10 border-b border-[#edf0f5] bg-[#f8faff] text-[14px] font-bold text-[#4b5565]">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">User Type</th>
                  <th className="px-5 py-3">Account Status</th>
                  <th className="px-5 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f5]">
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-10 text-center text-[#7d8797]"
                    >
                      Loading Users…
                    </td>
                  </tr>
                ) : users.length ? (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-5 py-4 font-medium">
                        {user.full_name}
                      </td>
                      <td className="px-5 py-4 text-[#475467]">{user.email}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[#fceced] px-2.5 py-1 text-[12px] font-semibold text-[#a82e35]">
                          {displayRole(user.role)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {user.banned ? (
                          <span className="inline-flex items-center gap-1.5 text-[#b42318]">
                            <span className="size-1.5 rounded-full bg-[#b42318]" />
                            Banned
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[#218b55]">
                            <span className="size-1.5 rounded-full bg-[#218b55]" />
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-center gap-2">
                          <FixedIconTooltip label="Edit account">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => openEdit(user)}
                              aria-label={`Edit ${user.full_name}`}
                              className="table-action disabled:opacity-50"
                            >
                              <Pencil size={16} />
                            </button>
                          </FixedIconTooltip>
                          {user.banned ? (
                            <FixedIconTooltip label="Unban account">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  setPendingAction({ user, action: "unban" })
                                }
                                aria-label={`Unban ${user.full_name}`}
                                className="table-action table-action--success disabled:opacity-50"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                            </FixedIconTooltip>
                          ) : (
                            <FixedIconTooltip label="Ban account">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  setPendingAction({ user, action: "ban" })
                                }
                                aria-label={`Ban ${user.full_name}`}
                                className="table-action table-action--warning disabled:opacity-50"
                              >
                                <Ban size={16} />
                              </button>
                            </FixedIconTooltip>
                          )}
                          <FixedIconTooltip label="Delete account">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() =>
                                setPendingAction({ user, action: "delete" })
                              }
                              aria-label={`Delete ${user.full_name}`}
                              className="table-action table-action--danger disabled:opacity-50"
                            >
                              <Trash2 size={16} />
                            </button>
                          </FixedIconTooltip>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-10 text-center text-[#7d8797]"
                    >
                      No Users Found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {message && (
        <div className="fixed bottom-5 right-5 z-40 flex max-w-sm items-start gap-3 rounded-xl border border-[#d9e0e9] bg-white p-4 shadow-xl">
          <ShieldCheck size={18} className="mt-0.5 text-[#c43b43]" />
          <p className="flex-1 text-[14px] text-[#344054]">{message}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Close Message"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <AccountProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={(fullName) => setMessage(`Profile updated for ${fullName}.`)}
      />
      {editingUser && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4">
          <form
            onSubmit={submitEdit}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold">Edit User</h2>
                <p className="mt-1 text-[14px] text-[#7d8797]">
                  Update this account&apos;s details and access level.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-[14px] font-semibold">
                Full Name
                <input
                  required
                  value={editValues.full_name}
                  onChange={(event) =>
                    setEditValues({
                      ...editValues,
                      full_name: titleCase(event.target.value),
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                />
              </label>
              <label className="block text-[14px] font-semibold">
                Email
                <input
                  required
                  type="email"
                  value={editValues.email}
                  onChange={(event) =>
                    setEditValues({ ...editValues, email: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                />
              </label>
              <label className="block text-[14px] font-semibold">
                User Type
                <select
                  value={editValues.role}
                  onChange={(event) =>
                    setEditValues({ ...editValues, role: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                >
                  <option value="project_manager">Sales Project Officer</option>
                  <option value="admin">General Manager</option>
                </select>
              </label>
              {["project_manager", "admin"].includes(editValues.role) && (
                <label className="block text-[14px] font-semibold">
                  Signature image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setEditSignatureFile(event.target.files?.[0] ?? null)
                    }
                    className="mt-1.5 block w-full text-[13px] font-normal text-[#475467] file:mr-3 file:rounded-md file:border-0 file:bg-[#f0f3f7] file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-[#344054] hover:file:bg-[#e6ebf1]"
                  />
                  {editSignatureFile ? (
                    <span className="mt-2 block truncate rounded-md border border-[#cce8d9] bg-[#f0fbf5] px-3 py-2 text-[12px] font-normal text-[#127543]" title={editSignatureFile.name}>
                      New image selected: {editSignatureFile.name}
                    </span>
                  ) : editingUser.signature_url ? (
                    <span className="mt-2 flex items-center gap-3 rounded-md border border-[#dfe5ed] bg-[#f8faff] p-2 font-normal">
                      {/* Supabase Storage signature URLs are dynamic. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={editingUser.signature_url}
                        alt="Current saved signature"
                        className="h-10 w-20 shrink-0 rounded border border-[#e4e8ef] bg-white object-contain"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-[#202938]">Current signature uploaded</span>
                        <span className="block truncate text-[11px] text-[#778195]" title={signatureFileName(editingUser.signature_url)}>
                          {signatureFileName(editingUser.signature_url)}
                        </span>
                      </span>
                    </span>
                  ) : null}
                  <span className="mt-1 block text-[12px] font-normal text-[#7d8797]">
                    {editingUser.signature_url
                      ? "A signature is saved. Choose a new image to replace it."
                      : `Optional. PNG, JPG, or WebP, up to 2 MB. It will be used automatically when this ${editValues.role === "admin" ? "General Manager approves a PDF" : "officer prepares a PDF"}.`}
                  </span>
                </label>
              )}
              <label className="block text-[14px] font-semibold">
                New Password{" "}
                <span className="font-normal text-[#7d8797]">(optional)</span>
                <div className="relative mt-1.5">
                  <input
                    minLength={6}
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={editValues.password}
                    onChange={(event) =>
                      setEditValues({
                        ...editValues,
                        password: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-[#cfd8e3] px-3 py-2 pr-10 text-[14px] outline-none focus:border-[#c43b43]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((visible) => !visible)}
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                    title={showNewPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#7d8797] hover:text-[#151922]"
                  >
                    {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditingUser(null)}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[14px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-50"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#151922]/40 p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold">Add User</h2>
                <p className="mt-1 text-[14px] text-[#7d8797]">
                  Create a Sales Project Officer or General Manager login.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShowTemporaryPassword(false);
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-[14px] font-semibold">
                Full Name
                <input
                  required
                  value={values.full_name}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      full_name: titleCase(event.target.value),
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                />
              </label>
              <label className="block text-[14px] font-semibold">
                Email
                <input
                  required
                  type="email"
                  value={values.email}
                  onChange={(event) =>
                    setValues({ ...values, email: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                />
              </label>
              <label className="block text-[14px] font-semibold">
                User Type
                <select
                  value={values.role}
                  onChange={(event) =>
                    setValues({ ...values, role: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#c43b43]"
                >
                  <option value="project_manager">Sales Project Officer</option>
                  <option value="admin">General Manager</option>
                </select>
              </label>
              {["project_manager", "admin"].includes(values.role) && (
                <label className="block text-[14px] font-semibold">
                  Signature image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setSignatureFile(event.target.files?.[0] ?? null)
                    }
                    className="mt-1.5 block w-full text-[13px] font-normal text-[#475467] file:mr-3 file:rounded-md file:border-0 file:bg-[#f0f3f7] file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-[#344054] hover:file:bg-[#e6ebf1]"
                  />
                  {signatureFile && (
                    <span className="mt-2 block truncate rounded-md border border-[#cce8d9] bg-[#f0fbf5] px-3 py-2 text-[12px] font-normal text-[#127543]" title={signatureFile.name}>
                      Image selected: {signatureFile.name}
                    </span>
                  )}
                  <span className="mt-1 block text-[12px] font-normal text-[#7d8797]">
                    Optional. PNG, JPG, or WebP, up to 2 MB. It will be used automatically {values.role === "admin" ? "when this General Manager approves a PDF." : "on this officer&apos;s PDFs."}
                  </span>
                </label>
              )}
              <label className="block text-[14px] font-semibold">
                Temporary Password
                <div className="relative mt-1.5">
                  <input
                    required
                    minLength={6}
                    type={showTemporaryPassword ? "text" : "password"}
                    value={values.password}
                    onChange={(event) =>
                      setValues({ ...values, password: event.target.value })
                    }
                    className="w-full rounded-lg border border-[#cfd8e3] px-3 py-2 pr-10 text-[14px] outline-none focus:border-[#c43b43]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTemporaryPassword((visible) => !visible)}
                    aria-label={showTemporaryPassword ? "Hide password" : "Show password"}
                    title={showTemporaryPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#7d8797] hover:text-[#151922]"
                  >
                    {showTemporaryPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShowTemporaryPassword(false);
                }}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[14px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
        </div>
      )}
      {confirmCreate && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#151922]/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 className="text-[16px] font-semibold">Confirm User Creation</h2>
            <p className="mt-2 text-[14px] leading-5 text-[#667085]">
              Create this{" "}
              {values.role === "admin" ? "General Manager" : "Sales Project Officer"}{" "}
              account?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCreate(false)}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createUser()}
                className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[14px] font-semibold text-white"
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmEdit && editingUser && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#151922]/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 className="text-[16px] font-semibold">Save User Changes?</h2>
            <p className="mt-2 text-[14px] leading-5 text-[#667085]">
              Update the account details for {editingUser.full_name}?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEdit(false)}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void updateUser()}
                className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[14px] font-semibold text-white hover:bg-[#ab3038]"
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmSignOut && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#151922]/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-confirmation-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2
              id="sign-out-confirmation-title"
              className="text-[16px] font-semibold"
            >
              Sign Out?
            </h2>
            <p className="mt-2 text-[14px] leading-5 text-[#667085]">
              Are you sure you want to sign out of this account?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={signingOut}
                onClick={() => setConfirmSignOut(false)}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
                className="min-h-9 rounded-lg bg-[#c43b43] px-3 text-[14px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-60"
              >
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingAction && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#151922]/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 className="text-[16px] font-semibold">
              Confirm Account Action
            </h2>
            <p className="mt-2 text-[14px] leading-5 text-[#667085]">
              {actionCopy}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="min-h-9 rounded-lg border border-[#cfd8e3] px-3 text-[14px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void manageUser()}
                className={`min-h-9 rounded-lg px-3 text-[14px] font-semibold text-white ${pendingAction.action === "delete" ? "bg-[#b42318] hover:bg-[#8f1c13]" : pendingAction.action === "ban" ? "bg-[#b96c00] hover:bg-[#925500]" : "bg-[#218b55] hover:bg-[#176d42]"}`}
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
