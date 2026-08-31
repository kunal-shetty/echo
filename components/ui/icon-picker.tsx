/**
 * @file icon-picker.tsx
 * @description UI component for selecting a category icon and color tone.
 * Uses a grid of available Lucide icons and a segmented control for colors.
 */

"use client";

import { icons, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/schema";
import { ICON_VOCAB, type IconName } from "@/lib/icon-vocab";
import { Segmented } from "@/components/ui/segmented";

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "violet", label: "Violet" },
  { value: "orange", label: "Orange" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "pink", label: "Pink" },
  { value: "red", label: "Red" },
  { value: "neutral", label: "Neutral" },
];

const TONE_CLASSES: Record<Tone, string> = {
  violet: "text-violet",
  orange: "text-orange",
  blue: "text-blue",
  green: "text-green",
  pink: "text-pink",
  red: "text-red",
  neutral: "text-muted-foreground",
};

const TONE_RING: Record<Tone, string> = {
  violet: "ring-2 ring-violet",
  orange: "ring-2 ring-orange",
  blue: "ring-2 ring-blue",
  green: "ring-2 ring-emerald",
  pink: "ring-2 ring-pink",
  red: "ring-2 ring-red",
  neutral: "ring-2 ring-muted-foreground",
};

/**
 * Resolve a stored icon-name string to a Lucide component.
 * Falls back to the Package icon for unknown or null values.
 * @param name The icon name from the vocabulary.
 * @returns A Lucide icon component.
 */
export function resolveLucide(name: string | null | undefined): LucideIcon {
  if (!name) return Package;
  return (icons as Record<string, LucideIcon>)[name] ?? Package;
}

interface IconPickerProps {
  /** The currently selected icon name. */
  icon: IconName | null;
  /** The currently selected visual tone. */
  tone: Tone;
  /** Callback when either the icon or tone is changed. */
  onChange: (next: { icon: IconName | null; tone: Tone }) => void;
  /** Optional label for the picker group. */
  label?: string;
}

/**
 * A visual selector for picking a category's icon and color tone.
 * Renders a grid of icons and a segmented control for tones.
 */
export function IconPicker({ icon, tone, onChange, label }: IconPickerProps) {
  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="grid grid-cols-5 gap-2 rounded-2xl border border-border bg-surface-2 p-3">
        {ICON_VOCAB.map((name) => {
          const Lucide = resolveLucide(name);
          const active = name === icon;
          return (
            <button
              key={name}
              type="button"
              aria-label={`Icon ${name}`}
              aria-pressed={active}
              onClick={() => onChange({ icon: name, tone })}
              className={`grid aspect-square place-items-center rounded-xl border bg-surface-1 transition ${
                active
                  ? `${TONE_RING[tone]} border-transparent`
                  : "border-border hover:bg-surface-3"
              }`}
            >
              <Lucide
                size={18}
                className={active ? TONE_CLASSES[tone] : "text-muted-foreground"}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <Segmented<Tone>
          ariaLabel="Category tone"
          size="sm"
          value={tone}
          onChange={(next) => onChange({ icon, tone: next })}
          options={TONE_OPTIONS}
        />
      </div>
    </div>
  );
}
