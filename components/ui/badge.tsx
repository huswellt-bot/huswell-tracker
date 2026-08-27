import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", {
  variants: { variant: { default: "bg-[#eef5ff] text-[#1769e8]", success: "bg-[#edf9f2] text-[#208c52]", warning: "bg-[#fff6e6] text-[#c77b12]", muted: "bg-[#f5f6f8] text-[#626b7a]" } },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
