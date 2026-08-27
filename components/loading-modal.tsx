"use client";

export function LoadingModal({
  open,
  title = "Saving changes",
  message = "Please wait a moment.",
}: {
  open: boolean;
  title?: string;
  message?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#151922]/35 p-4">
      <div role="status" aria-live="polite" className="w-full max-w-[280px] rounded-xl border border-[#e6eaf0] bg-white px-6 py-7 text-center shadow-[0_18px_45px_rgba(21,25,34,0.18)]">
        <span className="mx-auto block size-9 animate-spin rounded-full border-[3px] border-[#f3d4d7] border-t-[#c43b43]" />
        <h3 className="mt-4 text-[15px] font-semibold text-[#202938]">{title}</h3>
        <p className="mt-1 text-[12px] text-[#7d8797]">{message}</p>
      </div>
    </div>
  );
}
