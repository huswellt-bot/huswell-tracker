"use client";

import { useEffect, useRef, useState, type FocusEvent, type InputHTMLAttributes } from "react";

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
  /** Coalesce parent updates while typing; the current value is committed on blur. */
  deferCommitMs?: number;
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
  deferCommitMs = 80,
  ...props
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const empty = value === null || value === undefined || value === "";
  const displayValue = zeroWhenEmpty && empty ? "0" : value ?? "";
  const [draftValue, setDraftValue] = useState(String(displayValue));

  useEffect(() => {
    if (!focusedRef.current) setDraftValue(String(displayValue));
  }, [displayValue]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const commit = (nextValue: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onChange?.(nextValue);
  };

  const scheduleCommit = (nextValue: string) => {
    if (deferCommitMs <= 0) {
      commit(nextValue);
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onChange?.(nextValue);
    }, deferCommitMs);
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    focusedRef.current = true;
    if (zeroWhenEmpty && !props.readOnly && !props.disabled && isZeroValue(event.currentTarget.value)) {
      event.currentTarget.select();
    }
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focusedRef.current = false;
    const nextValue = zeroWhenEmpty && !props.readOnly && !props.disabled && event.currentTarget.value === ""
      ? "0"
      : event.currentTarget.value;
    if (deferCommitMs > 0 && !props.readOnly && !props.disabled) commit(nextValue);
    if (zeroWhenEmpty && !props.readOnly && !props.disabled && event.currentTarget.value === "") {
      if (deferCommitMs <= 0) onChange?.("0");
    }
    onBlur?.(event);
  };

  return (
    <input
      {...props}
      ref={inputRef}
      type={masked ? "password" : "number"}
      value={deferCommitMs > 0 ? draftValue : displayValue}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        if (deferCommitMs > 0) {
          setDraftValue(nextValue);
          scheduleCommit(nextValue);
        } else {
          onChange?.(nextValue);
        }
      }}
    />
  );
}
