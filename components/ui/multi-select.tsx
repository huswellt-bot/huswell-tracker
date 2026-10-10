"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type MultiSelectProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export const parseMultiSelectValue = (value: string | null | undefined) =>
  Array.from(
    new Set(
      (value ?? "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

export const serializeMultiSelectValue = (values: readonly string[]) =>
  Array.from(
    new Set(values.map((entry) => entry.trim()).filter(Boolean)),
  ).join("\n");

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select options",
  clearLabel = "Clear all selections",
  required = false,
  disabled = false,
  ariaLabel,
  className,
}: MultiSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId().replaceAll(":", "");
  const listboxId = `${generatedId}-multi-options`;
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
    width: 260,
    maxHeight: 320,
  });

  const optionList = useMemo(
    () => Array.from(new Set(options.map((option) => option.trim()).filter(Boolean))),
    [options],
  );
  const selected = useMemo(() => parseMultiSelectValue(value), [value]);
  const selectedOptions = useMemo(
    () => [
      ...optionList.filter((option) => selected.includes(option)),
      ...selected.filter((option) => !optionList.includes(option)),
    ],
    [optionList, selected],
  );

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gutter = 8;
      const width = Math.min(
        Math.max(rect.width, 260),
        Math.max(180, window.innerWidth - gutter * 2),
      );
      const left = Math.min(
        Math.max(gutter, rect.left),
        Math.max(gutter, window.innerWidth - width - gutter),
      );
      const below = Math.max(150, window.innerHeight - rect.bottom - gutter * 2);
      const above = Math.max(150, rect.top - gutter * 2);
      const openAbove = below < 280 && above > below;
      const maxHeight = Math.min(320, openAbove ? above : below);
      setMenuPosition({
        left,
        top: openAbove ? Math.max(gutter, rect.top - maxHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => firstOptionRef.current?.focus());
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, optionList.length]);

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const toggleOption = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((entry) => entry !== option)
      : [...selected, option];
    onChange(serializeMultiSelectValue(next));
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  if (disabled) {
    return (
      <div
        className={cn(
          "input mt-0 min-h-9 whitespace-normal break-words bg-[#f6f8fb] text-[#687386]",
          className,
        )}
        title={selectedOptions.join(", ") || "No selections"}
      >
        {selectedOptions.join(", ") || "No selections"}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ? `${ariaLabel}${required ? ", required" : ""}` : `${placeholder}${required ? ", required" : ""}`}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "input !flex !min-h-9 w-full !items-center justify-between gap-2 !px-2.5 !py-1.5 text-left",
          className,
          !selectedOptions.length && "text-[#8b92a1]",
        )}
        title={selectedOptions.join(", ") || placeholder}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {!selectedOptions.length ? (
            <span className="truncate">{placeholder}</span>
          ) : selectedOptions.length <= 2 ? (
            selectedOptions.map((option) => (
              <span
                key={option}
                className="max-w-full truncate rounded-md bg-[#f6f8fb] px-1.5 py-0.5 text-[10px] font-medium text-[#344054]"
              >
                {option}
              </span>
            ))
          ) : (
            <span className="rounded-md bg-[#f6f8fb] px-1.5 py-0.5 text-[10px] font-semibold text-[#344054]">
              {selectedOptions.length} selected
            </span>
          )}
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-[#8b92a1] transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ? `${ariaLabel} options` : "Options"}
          aria-multiselectable="true"
          className="fixed z-[120] overflow-y-auto rounded-lg border border-[#d9e0e9] bg-white p-1 shadow-xl"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#edf0f5] px-2 py-1.5">
            <span className="text-[11px] text-[#7d8797]">Select one or more</span>
            {selectedOptions.length > 0 && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="rounded px-1.5 py-1 text-[10px] font-semibold text-[#687386] hover:bg-[#f6f8fb] hover:text-[#202938] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43]"
              >
                {clearLabel}
              </button>
            )}
          </div>
          {optionList.map((option, index) => {
            const checked = selected.includes(option);
            return (
              <button
                key={option}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggleOption(option)}
                onKeyDown={handleOptionKeyDown}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-[#202938] hover:bg-[#f6f8fb] focus-visible:bg-[#f6f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#c43b43]",
                  checked && "bg-[#fff7f7]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    checked
                      ? "border-[#c43b43] bg-[#c43b43] text-white"
                      : "border-[#b8c0cc] bg-white",
                  )}
                >
                  {checked && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 truncate">{option}</span>
              </button>
            );
          })}
          {!optionList.length && (
            <p className="px-2 py-3 text-[11px] text-[#7d8797]">No options available.</p>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-[#edf0f5] px-2 pt-1.5">
            <span className="text-[10px] text-[#7d8797]">
              {selectedOptions.length ? `${selectedOptions.length} selected` : "None selected"}
            </span>
            <button
              type="button"
              onClick={() => closeMenu(true)}
              className="rounded px-2 py-1 text-[11px] font-semibold text-[#c43b43] hover:bg-[#fff7f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
