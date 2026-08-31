/**
 * @file segmented.tsx
 * @description A segmented control component for picking a single option from a set.
 * Features a sliding animated thumb using Framer Motion's LayoutGroup.
 */

"use client";

import { motion, LayoutGroup } from "motion/react";
import { NAV_PILL } from "@/lib/motion";

export interface SegmentOption<T extends string> {
  /** The value associated with this option. */
  value: T;
  /** The label displayed in the UI. */
  label: string;
  /** Optional icon — a small SVG. */
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  /** The currently selected value. */
  value: T;
  /** Callback triggered when a different option is selected. */
  onChange: (value: T) => void;
  /** The list of options to display. */
  options: SegmentOption<T>[];
  /** Accessible label for the tablist. */
  ariaLabel?: string;
  /** Smaller variant for inline use. */
  size?: "default" | "sm";
}

/**
 * A segmented picker component that allows selecting one option from a group.
 * Provides a smooth sliding transition between active items.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "default",
}: SegmentedProps<T>) {
  const padClass = size === "sm" ? "py-1.5 text-[0.72rem]" : "py-2.5 text-[0.78rem]";
  return (
    <LayoutGroup id={`segmented-${ariaLabel ?? "default"}`}>
      <div className="segmented" role="tablist" aria-label={ariaLabel}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              className={`segmented-item ${padClass}`}
              onClick={() => onChange(opt.value)}
            >
              {active && (
                <motion.span
                  layoutId="segmented-thumb"
                  className="segmented-thumb"
                  transition={NAV_PILL}
                />
              )}
              <span className="relative z-[1] flex items-center justify-center gap-1.5">
                {opt.icon}
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
