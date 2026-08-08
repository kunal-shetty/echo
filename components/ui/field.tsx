"use client";

import { type ReactNode, forwardRef } from "react";

interface FieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  /** Marks the field as invalid (used for amount > 0 etc.). */
  invalid?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, leadingIcon, trailing, invalid, className = "", ...props },
  ref,
) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <span
        className={`flex items-center gap-2 rounded-xl border bg-surface-2 px-3.5 py-3 transition-colors focus-within:border-emerald/60 ${
          invalid ? "border-red/60" : "border-border"
        } ${className}`}
      >
        {leadingIcon && (
          <span className="grid size-5 place-items-center text-muted-foreground">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          {...props}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {trailing && (
          <span className="text-xs text-muted-foreground">{trailing}</span>
        )}
      </span>
      {hint && (
        <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
});
