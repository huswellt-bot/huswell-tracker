import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex rounded-[var(--radius-control)] border px-2 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      default: "border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]",
      success: "border-[var(--color-success-border)] bg-[var(--color-success-subtle)] text-[var(--color-success-text)]",
      warning: "border-[var(--color-warning-border)] bg-[var(--color-warning-subtle)] text-[var(--color-warning-text)]",
      muted: "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
