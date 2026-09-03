"use client";

import { ReactNode, useRef, useState } from "react";

type TooltipPosition = { left: number; top: number; above: boolean };

const compactTooltip = (label: string) => {
  const action = [
    "Add",
    "Approve",
    "Archive",
    "Ban",
    "Cancel",
    "Close",
    "Create",
    "Delete",
    "Download",
    "Edit",
    "Print",
    "Remove",
    "Restore",
    "Save",
    "Send",
    "Submit",
    "Unban",
    "Update",
    "Upload",
    "View",
  ].find((word) => label.toLowerCase().startsWith(word.toLowerCase()));

  return action ?? label.trim().split(/\s+/)[0] ?? label;
};

export function FixedIconTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.top > 48;
    setPosition({
      left: Math.max(
        72,
        Math.min(window.innerWidth - 72, rect.left + rect.width / 2),
      ),
      top: above ? rect.top - 8 : rect.bottom + 8,
      above,
    });
  };

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setPosition(null)}
      onFocus={show}
      onBlur={() => setPosition(null)}
    >
      {children}
      {position && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-[#182334] px-2 py-1 text-[11px] font-medium text-white shadow-md"
          style={{
            left: position.left,
            top: position.top,
            transform: position.above
              ? "translate(-50%, -100%)"
              : "translate(-50%, 0)",
          }}
        >
          {compactTooltip(label)}
        </span>
      )}
    </span>
  );
}
