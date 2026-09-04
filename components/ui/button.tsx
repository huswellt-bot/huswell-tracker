import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--color-danger)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]",
        outline:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)] aria-expanded:bg-[var(--color-surface-subtle)]",
        secondary:
          "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] aria-expanded:bg-[var(--color-surface-subtle)]",
        destructive:
          "bg-[var(--color-danger)] text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,black)] focus-visible:border-[var(--color-danger)] focus-visible:outline-[var(--color-danger)]",
        link: "text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-7 gap-1 px-2 text-[12px] in-data-[slot=button-group]:rounded-[var(--radius-control)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[13px] in-data-[slot=button-group]:rounded-[var(--radius-control)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-7 in-data-[slot=button-group]:rounded-[var(--radius-control)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 in-data-[slot=button-group]:rounded-[var(--radius-control)]",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
