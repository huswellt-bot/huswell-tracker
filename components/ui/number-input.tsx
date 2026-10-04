"use client";

import { useRef, type FocusEvent, type InputHTMLAttributes } from "react";

type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value?: string | number | null;
  onChange?: (value: string) => void;
  /** Keep the empty state visible as zero for editable numeric fields. */
  zeroWhenEmpty?: boolean;
  /** Preserve the existing password-style masking used for sensitive pricing fields. */
  masked?: boolean;
};

const isZeroValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed !== "" && Number.isFinite(Number(trimmed)) && Number(trimmed) === 0;
};

export function NumberInput({
  value,
  onChange,
  onFocus,
  onBlur,
  zeroWhenEmpty = true,
  masked = false,
  ...props
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const empty = value === null || value === undefined || value === "";
  const displayValue = zeroWhenEmpty && empty ? "0" : value ?? "";

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (zeroWhenEmpty && !props.readOnly && !props.disabled && isZeroValue(event.currentTarget.value)) {
      event.currentTarget.select();
    }
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (zeroWhenEmpty && !props.readOnly && !props.disabled && event.currentTarget.value === "") {
      onChange?.("0");
    }
    onBlur?.(event);
  };

  return (
    <input
      {...props}
      ref={inputRef}
      type={masked ? "password" : "number"}
      value={displayValue}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  );
}
