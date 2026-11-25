"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace route error", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fc] px-4 py-10 text-[#202938]">
      <section
        role="alert"
        className="w-full max-w-lg rounded-[14px] border border-[#dfe5ed] bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-[18px] font-semibold">This workspace page could not load</h1>
        <p className="mt-2 text-[13px] leading-5 text-[#687386]">
          A temporary loading problem occurred. Try the page again, or return to the workspace.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-[#c43b43] px-4 py-2 text-[12px] font-medium text-white transition hover:bg-[#a92f37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-[#d9e0e9] px-4 py-2 text-[12px] font-medium text-[#344054] transition hover:bg-[#f6f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
          >
            Back to workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
