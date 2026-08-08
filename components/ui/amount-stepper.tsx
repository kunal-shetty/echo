"use client";

import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface AmountStepperProps {
  value: number;
  onChange: (value: number) => void;
  currency?: string;
  /** Step for the + / - buttons. */
  step?: number;
  /** Min/max bound, optional. */
  min?: number;
  max?: number;
  label?: string;
}

/**
 * Large currency input. Looks like Apple Wallet's amount field.
 * The numeric value is animated with motion's `animate()` so changes feel
 * smooth rather than jump-cutting.
 */
export function AmountStepper({
  value,
  onChange,
  currency = "INR",
  step = 10,
  min,
  max,
  label,
}: AmountStepperProps) {
  const [draft, setDraft] = useState(() => value.toString());
  const display = useMotionValue(value);
  const rounded = useTransform(display, (v) =>
    v.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
  );
  const lastExternal = useRef(value);

  // Sync external value → draft (for confirm-step "show 150 vs 115")
  useEffect(() => {
    if (value !== lastExternal.current) {
      setDraft(value.toString());
      lastExternal.current = value;
    }
  }, [value]);

  // Animate the displayed number toward the live numeric value.
  useEffect(() => {
    const controls = animate(display, value, {
      duration: 0.32,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, display]);

  const commit = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    const next = clean === "" ? 0 : Number(clean);
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? 0, Number.isFinite(next) ? next : 0),
    );
    if (clamped !== value) {
      lastExternal.current = clamped;
      onChange(clamped);
    }
  };

  const bump = (delta: number) => {
    const next = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? 0, value + delta),
    );
    setDraft(next.toString());
    lastExternal.current = next;
    onChange(next);
  };

  const symbol = currency === "INR" ? "₹" : currency;

  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4">
      {label && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Decrease amount"
          onClick={() => bump(-step)}
          className="grid size-11 place-items-center rounded-full border border-border bg-surface-1 text-muted-foreground transition active:scale-95"
        >
          <MinusIcon />
        </button>
        <div className="flex flex-1 items-center justify-center gap-1 px-4">
          <span className="text-2xl font-semibold text-muted-foreground">
            {symbol}
          </span>
          <motion.span className="text-4xl font-semibold tabular-nums tracking-tight">
            {rounded}
          </motion.span>
        </div>
        <button
          type="button"
          aria-label="Increase amount"
          onClick={() => bump(step)}
          className="grid size-11 place-items-center rounded-full border border-border bg-surface-1 text-muted-foreground transition active:scale-95"
        >
          <PlusIcon />
        </button>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="mt-3 w-full rounded-xl border border-border bg-surface-1 px-3.5 py-2.5 text-center text-sm text-foreground outline-none focus:border-emerald/60"
        aria-label="Amount value"
      />
    </div>
  );
}

function MinusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
