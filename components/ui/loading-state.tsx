import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type LoadingStateProps = {
  label?: ReactNode;
  detail?: ReactNode;
  variant?: "inline" | "section" | "page" | "bar";
  className?: string;
};

const variantClasses: Record<NonNullable<LoadingStateProps["variant"]>, string> = {
  inline: "inline-flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]",
  section: "flex min-h-[160px] items-center justify-center gap-2 px-4 py-10 text-[12px] text-[var(--color-text-secondary)]",
  page: "flex min-h-[280px] items-center justify-center gap-2 px-4 py-12 text-[12px] text-[var(--color-text-secondary)]",
  bar: "flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]",
};

export function LoadingState({
  label = "Loading data...",
  detail,
  variant = "inline",
  className = "",
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${variantClasses[variant]} ${className}`.trim()}
    >
      <LoaderCircle
        className="size-4 shrink-0 animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail ? (
          <span className="ml-1 text-[var(--color-text-tertiary)]">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
