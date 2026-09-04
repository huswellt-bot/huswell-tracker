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
    <main className="quotation-pdf-viewer grid min-h-screen place-items-center bg-[var(--color-bg)] p-3 font-sans text-[var(--color-text-primary)] sm:p-5">
      <section className="flex min-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-none sm:min-h-[calc(100vh-2.5rem)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <div>
            <h1 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              {quote.document_type === "mockup_quotation"
                ? "Mockup Quotation"
                : "Price Quotation"}
            </h1>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
              {String(quote.quotation_no ?? "Quotation")}
            </p>
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download={`${quote.quotation_no ?? "quotation"}.pdf`}
              className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
            >
              Download PDF
            </a>
          )}
        </header>
        {error ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
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
              <div className="mx-auto size-7 animate-spin rounded-[var(--radius-card)] border-[3px] border-[var(--color-accent-subtle)] border-t-[var(--color-accent)]" />
              <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
                Generating quotation PDF…
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
