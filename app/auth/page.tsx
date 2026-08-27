"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setMessage(error.message);
    else router.replace("/");

    setSubmitting(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#182334] p-5 text-[14px] leading-5 text-[#151922]">
      <section className="auth-card w-full max-w-sm rounded-[14px] border border-white/15 bg-white p-6 shadow-2xl shadow-black/25 sm:p-7">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex justify-center">
            <Image
              src="/huswell-quotation-logo.png"
              alt="Huswell Trading"
              width={489}
              height={153}
              priority
              className="h-auto w-48"
            />
          </div>
          <h1 className="mb-1 border-t border-[#dfe5ed] pt-5 text-center text-[22px] font-semibold tracking-tight text-[#182334]">
            Welcome back
          </h1>
          <p className="mb-6 text-center text-[12px] text-[#626b7a]">
            Sign in to Huswell Command Center
          </p>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-[14px] font-medium">
              Email
              <input
                required
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#cfd8e3] bg-white px-3 py-2.5 text-[14px] outline-none transition focus:border-[#d42027] focus:ring-[3px] focus:ring-[#d42027]/15"
              />
            </label>
            <label className="block text-[14px] font-medium">
              Password
              <span className="relative mt-1.5 block">
                <input
                  required
                  minLength={6}
                  type={passwordVisible ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-[#cfd8e3] bg-white px-3 py-2.5 pr-10 text-[14px] outline-none transition focus:border-[#d42027] focus:ring-[3px] focus:ring-[#d42027]/15"
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#8b92a1] hover:text-[#626b7a]"
                >
                  {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            {message && (
              <p className="rounded-lg bg-[#fef3f2] px-3 py-2 text-[12px] text-[#b42318]">
                {message}
              </p>
            )}
            <div className="pt-2">
              <button
                disabled={submitting}
                className="w-full rounded-lg bg-[#c43b43] px-3 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#ab3038] disabled:opacity-60"
              >
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
