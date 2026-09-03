"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage("");
    const supabase = createClient();
    let signedIn = false;

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setMessage(error.message);
        return;
      }

      signedIn = true;
      router.replace("/");
    } catch {
      setMessage("Unable to sign in. Please try again.");
    } finally {
      if (!signedIn) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <main className="auth-page compact-ui grid min-h-screen w-full min-w-0 max-w-[100vw] place-items-center overflow-x-hidden bg-[#182334] p-4 text-[12px] leading-[16px] text-[#151922]">
      <section className="auth-card w-full min-w-0 max-w-sm rounded-[14px] border border-white/15 bg-white p-5 shadow-2xl shadow-black/25 sm:p-6">
        <div className="w-full min-w-0 max-w-full">
          <div className="mb-5 flex justify-center">
            <Image
              src="/huswell-quotation-logo.png"
              alt="Huswell Trading"
              width={489}
              height={153}
              priority
              className="h-auto w-44"
            />
          </div>
          <h1 className="mb-1 border-t border-[#dfe5ed] pt-4 text-center text-[20px] font-semibold tracking-tight text-[#182334]">
            Welcome back
          </h1>
          <p className="mb-5 text-center text-[11px] text-[#626b7a]">
            Sign in to Huswell Virtual Office
          </p>
          <form onSubmit={submit} className="space-y-3" aria-busy={submitting}>
            <label className="block text-[13px] font-medium">
              Email
              <input
                required
                disabled={submitting}
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] bg-white px-2.5 py-2 text-[13px] outline-none transition focus:border-[#d42027] focus:ring-[3px] focus:ring-[#d42027]/15"
              />
            </label>
            <label className="block text-[13px] font-medium">
              Password
              <span className="relative mt-1.5 block">
                <input
                  required
                  disabled={submitting}
                  minLength={6}
                  type={passwordVisible ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-[#cfd8e3] bg-white px-2.5 py-2 pr-9 text-[13px] outline-none transition focus:border-[#d42027] focus:ring-[3px] focus:ring-[#d42027]/15"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#8b92a1] hover:text-[#626b7a]"
                >
                  {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            {message && (
              <p className="rounded-lg bg-[#fef3f2] px-2.5 py-1.5 text-[11px] text-[#b42318]">
                {message}
              </p>
            )}
            <div className="pt-1">
              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#c43b43] px-2.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#ab3038] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
