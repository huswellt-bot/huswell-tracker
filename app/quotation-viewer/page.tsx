import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Quotation",
};

export default function Page() {
  return (
    <main className="compact-ui grid min-h-screen place-items-center bg-[#f6f8fc] p-4 font-sans text-[12px] text-[#202938]">
      <section className="w-full max-w-xs rounded-xl border border-[#dfe5ed] bg-white px-5 py-5 text-center shadow-xl">
        <div className="mx-auto size-7 animate-spin rounded-full border-[3px] border-[#f6d9db] border-t-[#c43b43]" />
        <h1 className="mt-3 text-[14px] font-semibold">Generating quotation PDF</h1>
        <p className="mt-1 text-[11px] text-[#7c8594]">Please wait a moment.</p>
      </section>
    </main>
  );
}
