"use client";

import { useRef, type KeyboardEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type FileUploadControlProps = {
  accept?: string;
  actionLabel?: string;
  ariaLabel?: string;
  busy?: boolean;
  busyActionLabel?: string;
  busyLabel?: string;
  className?: string;
  disabled?: boolean;
  displayName?: string | null;
  emptyLabel?: string;
  files?: File[] | null;
  inputKey?: string | number;
  multiple?: boolean;
  onFilesSelected: (files: File[]) => void;
  selectedActionLabel?: string;
  selectedLabel?: string;
  size?: "default" | "compact";
};

export function FileUploadControl({
  accept,
  actionLabel = "Browse",
  ariaLabel,
  busy = false,
  busyActionLabel = "Working...",
  busyLabel = "Processing file...",
  className,
  disabled = false,
  displayName,
  emptyLabel = "Choose a file",
  files,
  inputKey,
  multiple = false,
  onFilesSelected,
  selectedActionLabel,
  selectedLabel,
  size = "default",
}: FileUploadControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedFiles = files ?? [];
  const hasSelection = selectedFiles.length > 0 || Boolean(displayName);
  const defaultSelectedLabel = multiple
    ? `${selectedFiles.length || 1} file${selectedFiles.length === 1 ? "" : "s"} selected`
    : selectedFiles[0]?.name ?? displayName ?? "File selected";
  const visibleLabel = busy
    ? busyLabel
    : hasSelection
      ? selectedLabel ?? displayName ?? defaultSelectedLabel
      : emptyLabel;
  const visibleAction = busy
    ? busyActionLabel
    : hasSelection
      ? selectedActionLabel ?? (multiple ? "Add more" : "Change file")
      : actionLabel;

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openPicker();
  };

  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.preventDefault();
        openPicker();
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        "group/file-upload flex w-full items-center gap-2 rounded-[var(--radius-control)] border bg-[var(--color-surface)] text-[12px] font-medium text-[var(--color-text-primary)] transition-colors focus-within:border-[var(--color-accent)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--color-accent)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]",
        size === "compact" ? "min-h-8 px-2.5" : "min-h-10 px-3",
        hasSelection
          ? "border-[var(--color-success-border)] bg-[var(--color-success-subtle)]"
          : "border-[var(--color-border)]",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className={cn(
        "grid shrink-0 place-items-center rounded-[var(--radius-control)]",
        size === "compact" ? "size-6" : "size-7",
        hasSelection
          ? "bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
          : "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]",
      )}>
        <Upload size={size === "compact" ? 14 : 15} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{visibleLabel}</span>
      <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent-text)]">{visibleAction}</span>
      <input
        key={inputKey}
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const nextFiles = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          if (nextFiles.length) onFilesSelected(nextFiles);
        }}
      />
    </span>
  );
}
