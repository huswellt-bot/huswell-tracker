"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

export type NotificationTone = "error" | "success" | "warning" | "info";

type NotificationDialogProps = {
  message: string;
  close: () => void;
  title?: string;
  tone?: NotificationTone;
  primaryLabel?: string;
  retry?: () => void;
  retrying?: boolean;
};

const toneStyles: Record<
  NotificationTone,
  {
    icon: typeof AlertCircle;
    iconClass: string;
    iconBackground: string;
    buttonVariant: "default" | "destructive";
  }
> = {
  error: {
    icon: AlertCircle,
    iconClass: "text-[var(--color-danger-text)]",
    iconBackground: "bg-[var(--color-danger-subtle)]",
    buttonVariant: "destructive",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-[var(--color-success-text)]",
    iconBackground: "bg-[var(--color-success-subtle)]",
    buttonVariant: "default",
  },
  warning: {
    icon: AlertCircle,
    iconClass: "text-[var(--color-warning-text)]",
    iconBackground: "bg-[var(--color-warning-subtle)]",
    buttonVariant: "default",
  },
  info: {
    icon: Info,
    iconClass: "text-[var(--color-accent-text)]",
    iconBackground: "bg-[var(--color-accent-subtle)]",
    buttonVariant: "default",
  },
};

export function NotificationDialog({
  message,
  close,
  title = "Notification",
  tone = "info",
  primaryLabel = "Okay",
  retry,
  retrying = false,
}: NotificationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const closeRef = useRef(close);
  const style = toneStyles[tone];
  const Icon = style.icon;

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-[var(--color-overlay)] p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`grid size-8 shrink-0 place-items-center rounded-full ${style.iconBackground}`}>
              <Icon size={17} className={style.iconClass} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {title}
              </h2>
              <p id={messageId} className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
                {message}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close notification"
            className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {retry && (
            <Button variant="outline" onClick={retry} disabled={retrying}>
              {retrying ? "Retrying..." : "Retry"}
            </Button>
          )}
          <Button variant={style.buttonVariant} onClick={close}>
            {primaryLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function NotificationToast({
  message,
  close,
  tone = "info",
}: Pick<NotificationDialogProps, "message" | "close" | "tone">) {
  const closeRef = useRef(close);
  const style = toneStyles[tone];
  const Icon = style.icon;

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    const timeout = window.setTimeout(() => closeRef.current(), 5000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="fixed right-4 top-4 z-[1000] w-[min(24rem,calc(100vw-2rem))]" role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-lg">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${style.iconBackground}`}>
          <Icon size={17} className={style.iconClass} aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1 text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
          {message}
        </p>
        <button
          type="button"
          onClick={close}
          aria-label="Close notification"
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
