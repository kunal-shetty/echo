"use client";

import { motion, LayoutGroup } from "motion/react";
import { NAV_PILL } from "@/lib/motion";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional icon — a small SVG. */
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  ariaLabel?: string;
  /** Smaller variant for inline use. */
  size?: "default" | "sm";
}

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
