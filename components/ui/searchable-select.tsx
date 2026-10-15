"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  searchText?: string;
  groupLabel?: string;
};

type SearchableSelectProps = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  clearLabel?: string;
  clearable?: boolean;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search options",
  noResultsLabel = "No options found.",
  clearLabel = "Clear selection",
  clearable = true,
  disabled = false,
  required = false,
  ariaLabel,
  className,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replaceAll(":", "");
  const listboxId = `${generatedId}-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      [option.label, option.searchText, option.value]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : filteredOptions.length ? 0 : -1);
    setQuery("");
    setOpen(true);
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectOption = (option: SearchableOption) => {
    onChange(option.value);
    closeMenu(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => filteredOptions.length ? (current + 1 + filteredOptions.length) % filteredOptions.length : -1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => filteredOptions.length ? (current < 0 ? filteredOptions.length - 1 : (current - 1 + filteredOptions.length) % filteredOptions.length) : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[activeIndex] ?? filteredOptions[0];
      if (option) selectOption(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "input !flex w-full !items-center justify-between gap-2 text-left",
          className,
          !selectedOption && "text-[var(--color-text-tertiary)]",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--card-shadow)]">
          <div className="border-b border-[var(--color-border)] p-2">
            <div className="relative">
              <Search size={15} className="search-icon pointer-events-none absolute left-3 z-10 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                role="combobox"
                aria-label={ariaLabel ? `Search ${ariaLabel.toLowerCase()}` : searchPlaceholder}
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded="true"
                aria-required={required || undefined}
                aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="searchable-lead-search input mt-0 h-9 w-full search-input !pr-3 text-[12px]"
              />
            </div>
          </div>
          <div id={listboxId} role="listbox" className="max-h-60 overflow-y-auto p-1">
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  closeMenu(true);
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] focus-visible:bg-[var(--color-surface-subtle)] focus-visible:outline-none"
              >
                <X size={13} aria-hidden="true" />
                {clearLabel}
              </button>
            )}
            {filteredOptions.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              const previousOption = filteredOptions[index - 1];
              const startsGroup = option.groupLabel && option.groupLabel !== previousOption?.groupLabel;
              return (
                <div key={`${option.value}-${index}`} role="presentation">
                  {startsGroup && (
                    <div role="presentation" className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
                      {option.groupLabel}
                    </div>
                  )}
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[11px] text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]",
                      active ? "bg-[var(--color-surface-subtle)]" : "hover:bg-[var(--color-surface-subtle)]",
                    )}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {selected && <Check size={14} className="shrink-0 text-[#c43b43]" aria-hidden="true" />}
                  </button>
                </div>
              );
            })}
            {!filteredOptions.length && <p className="px-2.5 py-3 text-[11px] text-[var(--color-text-tertiary)]">{noResultsLabel}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
