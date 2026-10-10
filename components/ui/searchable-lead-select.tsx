"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SearchableLeadOption = {
  value: string;
  label: string;
  searchText?: string;
};

type SearchableLeadSelectProps = {
  options: SearchableLeadOption[];
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

const optionIdentity = (value: string) => value.split("|")[0] || value;

const optionMatchesValue = (option: SearchableLeadOption, value: string) =>
  option.value === value || optionIdentity(option.value) === optionIdentity(value);

export function SearchableLeadSelect({
  options,
  value,
  onChange,
  placeholder = "Select a lead",
  searchPlaceholder = "Search leads",
  noResultsLabel = "No leads found.",
  clearLabel = "Clear selection",
  clearable = true,
  disabled = false,
  required = false,
  ariaLabel,
  className,
}: SearchableLeadSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replaceAll(":", "");
  const listboxId = `${generatedId}-lead-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = useMemo(
    () => options.find((option) => optionMatchesValue(option, value)) ?? null,
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
    const selectedIndex = filteredOptions.findIndex((option) => optionMatchesValue(option, value));
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : filteredOptions.length ? 0 : -1);
    setQuery("");
    setOpen(true);
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectOption = (option: SearchableLeadOption) => {
    onChange(option.value);
    closeMenu(true);
  };

  const clearSelection = () => {
    onChange("");
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
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "input !flex w-full !items-center justify-between gap-2 text-left",
          className,
          !selectedOption && "text-[#8b92a1]",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-[#8b92a1] transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-lg border border-[#d9e0e9] bg-white shadow-xl">
          <div className="border-b border-[#edf0f5] p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 z-10 text-[#8b92a1]" aria-hidden="true" />
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
                className="searchable-lead-search input mt-0 h-9 w-full !pl-8 !pr-3 text-[12px]"
              />
            </div>
          </div>
          <div id={listboxId} role="listbox" className="max-h-60 overflow-y-auto p-1">
            {clearable && value && (
              <button
                type="button"
                onClick={clearSelection}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] text-[#687386] hover:bg-[#f6f8fb] focus-visible:bg-[#f6f8fb] focus-visible:outline-none"
              >
                <X size={13} aria-hidden="true" />
                {clearLabel}
              </button>
            )}
            {filteredOptions.map((option, index) => {
              const selected = optionMatchesValue(option, value);
              const active = index === activeIndex;
              return (
                <button
                  key={`${option.value}-${index}`}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[11px] text-[#202938] focus-visible:outline-none",
                    active ? "bg-[#f6f8fb]" : "hover:bg-[#f6f8fb]",
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {selected && <Check size={14} className="shrink-0 text-[#c43b43]" aria-hidden="true" />}
                </button>
              );
            })}
            {!filteredOptions.length && <p className="px-2.5 py-3 text-[11px] text-[#7d8797]">{noResultsLabel}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
