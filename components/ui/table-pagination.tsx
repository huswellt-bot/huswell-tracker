"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export const TABLE_PAGE_SIZE = 10;

export function TablePagination({
  page,
  pageCount,
  total,
  onPageChange,
  pageSize = TABLE_PAGE_SIZE,
  className,
  label = "Table pagination",
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  className?: string;
  label?: string;
}) {
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const firstRow = total ? (safePage - 1) * pageSize + 1 : 0;
  const lastRow = total ? Math.min(safePage * pageSize, total) : 0;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f5] bg-white px-4 py-3 text-[11px] text-[#687386] ${className ?? ""}`}
      aria-label={label}
    >
      <span>{total ? `Showing ${firstRow}-${lastRow} of ${total}` : "No records to display"}</span>
      {safePageCount > 1 ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            className="button-secondary text-[11px]"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            Previous
          </button>
          <span aria-live="polite">Page {safePage} of {safePageCount}</span>
          <button
            type="button"
            disabled={safePage >= safePageCount}
            onClick={() => onPageChange(safePage + 1)}
            className="button-secondary text-[11px]"
          >
            Next
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
