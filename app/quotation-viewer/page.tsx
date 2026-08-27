import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Quotation",
};

export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6 font-sans text-[#202938]">
      <section className="w-full max-w-xs rounded-xl border border-[#dfe5ed] bg-white px-7 py-6 text-center shadow-xl">
        <div className="mx-auto size-7 animate-spin rounded-full border-[3px] border-[#f6d9db] border-t-[#c43b43]" />
        <h1 className="mt-3 text-[15px] font-semibold">Generating quotation PDF</h1>
        <p className="mt-1 text-[12px] text-[#7c8594]">Please wait a moment.</p>
      </section>
    </main>
  );
}
