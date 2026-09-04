"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, LoaderCircle, Pencil, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProfileValues = { fullName: string; email: string; password: string };

const emptyValues: ProfileValues = { fullName: "", email: "", password: "" };
const titleCase = (value: string) =>
  value.replace(
    /(^|[^A-Za-z])([a-z])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );

export function AccountProfileDialog({
  open,
  onClose = () => undefined,
  onSaved = () => undefined,
  page = false,
  embedded = false,
  fullWidth = false,
  role = "",
  backHref = "/",
}: {
  open: boolean;
  onClose?: () => void;
  onSaved?: (fullName: string) => void;
  page?: boolean;
  embedded?: boolean;
  fullWidth?: boolean;
  role?: string;
  backHref?: string;
}) {
  const client = useMemo(() => createClient(), []);
  const [values, setValues] = useState<ProfileValues>(emptyValues);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!embedded);
  const [showPassword, setShowPassword] = useState(false);
  const accountType =
    role === "owner"
      ? "Owner / General Manager"
      : role === "admin"
        ? "General Manager"
        : role === "project_manager"
          ? "Sales Executive"
          : role === "sales_pricing_officer"
            ? "Sales & Pricing Officer"
            : role.replaceAll("_", " ");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setConfirmOpen(false);
    void client.auth.getUser().then(({ data, error: userError }) => {
      if (!active) return;
      if (userError || !data.user) {
        setError(userError?.message ?? "Unable to load your profile.");
      } else {
        setUserId(data.user.id);
        setValues({
          fullName:
            typeof data.user.user_metadata.full_name === "string"
              ? data.user.user_metadata.full_name
              : "",
          email: data.user.email ?? "",
          password: "",
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) setConfirmOpen(true);
  };

  const closeEmbeddedEditor = () => {
    setEditing(false);
    setError(null);
    setShowPassword(false);
    setValues((current) => ({ ...current, password: "" }));
  };

  const save = async () => {
    if (!userId) return;
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    const fullName = values.fullName.trim();
    const { data: current } = await client.auth.getUser();
    const { error: authError } = await client.auth.updateUser({
      data: { ...current.user?.user_metadata, full_name: fullName },
      ...(values.email.trim() !== current.user?.email
        ? { email: values.email.trim().toLowerCase() }
        : {}),
      ...(values.password ? { password: values.password } : {}),
    });
    if (authError) {
      setError(authError.message);
      setSaving(false);
      return;
    }
    const { error: profileError } = await client
      .from("profiles")
      .upsert({ id: userId, full_name: fullName });
    if (profileError) {
      setError(profileError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    if (embedded) closeEmbeddedEditor();
    onSaved(fullName);
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className={`account-profile-dialog compact-ui ${
        embedded
          ? editing
            ? "fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4"
            : "w-full"
          : page
            ? "min-h-screen bg-[#fafafa] p-4 sm:p-6"
            : "fixed inset-0 z-[70] grid place-items-center bg-[#151922]/40 p-4"
      }`}
    >
      <form
        onSubmit={submit}
        className={
          embedded
            ? editing
              ? "w-full max-w-md rounded-2xl border border-[#dfe5ed] bg-white p-4 shadow-2xl"
              : `w-full rounded-2xl border border-[#dfe5ed] bg-white p-4 shadow-none ${fullWidth ? "" : "mx-auto max-w-2xl"}`
            : `w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl ${page ? "mx-auto border border-[#dfe5ed]" : ""}`
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">My Profile</h2>
            <p className="mt-1 text-[12px] text-[#7d8797]">
              {embedded && !editing
                ? "View your account information and keep it up to date."
                : "Update your personal account details."}
            </p>
          </div>
          {page ? (
            <a
              href={backHref}
              className="text-[13px] font-semibold text-[#2168d6]"
            >
              Back
            </a>
          ) : !embedded || editing ? (
            <button
              type="button"
              onClick={embedded ? closeEmbeddedEditor : onClose}
              aria-label="Close profile editor"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
        {embedded && !editing ? (
          <div className="mt-4 divide-y divide-[#edf0f5] border-y border-[#edf0f5]">
            <div className="grid gap-1 py-2 sm:grid-cols-3">
              <span className="text-[11px] font-medium text-[#7d8797]">
                Full Name
              </span>
              <span className="text-[12px] font-medium sm:col-span-2">
                {values.fullName || "Not Set"}
              </span>
            </div>
            <div className="grid gap-1 py-2 sm:grid-cols-3">
              <span className="text-[11px] font-medium text-[#7d8797]">
                Email
              </span>
              <span className="break-all text-[12px] font-medium sm:col-span-2">
                {values.email || "Not Set"}
              </span>
            </div>
            <div className="grid gap-1 py-2 sm:grid-cols-3">
              <span className="text-[11px] font-medium text-[#7d8797]">
                Account Type
              </span>
              <span className="capitalize text-[12px] font-medium sm:col-span-2">
                {accountType || "User"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-[13px] font-semibold">
              Full Name
              <input
                required
                disabled={loading || saving}
                value={values.fullName}
                onChange={(event) =>
                  setValues({
                    ...values,
                    fullName: titleCase(event.target.value),
                  })
                }
                className="profile-field mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#c43b43] disabled:bg-[#f7f7f8]"
              />
            </label>
            <label className="block text-[13px] font-semibold">
              Email
              <input
                required
                disabled={loading || saving}
                type="email"
                value={values.email}
                onChange={(event) =>
                  setValues({ ...values, email: event.target.value })
                }
                className="profile-field mt-1.5 w-full rounded-lg border border-[#cfd8e3] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#c43b43] disabled:bg-[#f7f7f8]"
              />
            </label>
            <label className="block text-[13px] font-semibold">
              New Password{" "}
              <span className="font-normal text-[#7d8797]">(optional)</span>
              <div className="relative mt-1.5">
                <input
                  disabled={loading || saving}
                  minLength={6}
                  type="text"
                  autoComplete="new-password"
                  value={values.password}
                  onChange={(event) =>
                    setValues({ ...values, password: event.target.value })
                  }
                  className={`profile-field w-full rounded-lg border border-[#cfd8e3] px-2.5 py-1.5 pr-9 text-[13px] outline-none focus:border-[#c43b43] disabled:bg-[#f7f7f8] ${showPassword ? "" : "password-input--masked"}`}
                />
                {!showPassword && values.password && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-[13px] tracking-[0.08em] text-[#151922]"
                  >
                    {"●".repeat(values.password.length)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#7d8797] hover:text-[#151922]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && <p className="text-[12px] text-[#b42318]">{error}</p>}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {embedded && !editing ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setEditing(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#c43b43] px-2.5 text-[13px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-50"
            >
              <Pencil size={15} />
              Edit Profile
            </button>
          ) : (
            <>
              {!embedded && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onClose}
                  className="min-h-8 rounded-lg border border-[#cfd8e3] px-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              {embedded && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeEmbeddedEditor}
                  className="min-h-8 rounded-lg border border-[#cfd8e3] px-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              <button
                disabled={loading || saving}
                aria-busy={loading || saving || undefined}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#c43b43] px-2.5 text-[13px] font-semibold text-white hover:bg-[#ab3038] disabled:opacity-50"
              >
                {(loading || saving) && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {saving ? "Saving..." : loading ? "Loading..." : "Save Changes"}
              </button>
            </>
          )}
        </div>
      </form>
      {confirmOpen && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[#151922]/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold">Save Profile Changes?</h2>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#667085]">
              Your personal account details will be updated.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="min-h-8 rounded-lg border border-[#cfd8e3] px-2.5 text-[13px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="min-h-8 rounded-lg bg-[#c43b43] px-2.5 text-[13px] font-semibold text-white hover:bg-[#ab3038]"
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
