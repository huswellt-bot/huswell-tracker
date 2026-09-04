"use client";

import { useEffect, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import {
  PriceQuotationPdf,
  type QuotationPdfRow,
  type QuotationPdfStore,
} from "@/components/huswell-workspace";

export function QuotationPdfViewer({
  quote,
  store,
}: {
  quote: QuotationPdfRow;
  store: QuotationPdfStore;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | null = null;

    void pdf(
      <PriceQuotationPdf
        quote={quote}
        store={store}
        origin={window.location.origin}
      />,
    )
      .toBlob()
      .then((blob) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob);
        setError(null);
        setPdfUrl(nextUrl);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to generate the quotation PDF.",
        );
      });

    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [quote, store]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-3 font-sans text-[#202938] sm:p-5">
      <section className="flex min-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#dfe5ed] bg-white shadow-xl sm:min-h-[calc(100vh-2.5rem)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e9edf2] px-4 py-3 sm:px-5">
          <div>
            <h1 className="text-[14px] font-semibold">
              {quote.document_type === "mockup_quotation"
                ? "Mockup Quotation"
                : "Price Quotation"}
            </h1>
            <p className="mt-0.5 text-[11px] text-[#7c8594]">
              {String(quote.quotation_no ?? "Quotation")}
            </p>
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download={`${quote.quotation_no ?? "quotation"}.pdf`}
              className="rounded-lg border border-[#d9e0e9] px-3 py-2 text-[11px] font-medium text-[#4b5565] hover:bg-[#f6f8fc]"
            >
              Download PDF
            </a>
          )}
        </header>
        {error ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <p className="text-[12px] text-[#b4232d]">{error}</p>
          </div>
        ) : pdfUrl ? (
          <iframe
            title={`${String(quote.quotation_no ?? "Quotation")} PDF`}
            src={pdfUrl}
            className="min-h-0 flex-1 border-0"
          />
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div>
              <div className="mx-auto size-7 animate-spin rounded-full border-[3px] border-[#f6d9db] border-t-[#c43b43]" />
              <p className="mt-3 text-[12px] text-[#687386]">
                Generating quotation PDF…
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
