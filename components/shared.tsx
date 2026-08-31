/**
 * @file shared.tsx
 * @description Shared presentational components used across the app.
 * Includes the project logo and a dynamic user avatar.
 */

"use client";

/**
 * Renders the project logo mark and wordmark.
 */
export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="font-display text-lg font-semibold tracking-tight">
        echo
      </span>
    </div>
  );
}

function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "EC";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders a small circular avatar containing initials derived from the user's name.
 */
export function Avatar({
  size = 9,
  name,
}: {
  size?: number;
  name?: string;
}) {
  return (
    <div
      className="grid place-items-center rounded-full bg-surface-3 text-xs font-semibold text-foreground ring-1 ring-border"
      style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem` }}
    >
      {initialsFromName(name ?? "Echo")}
    </div>
  );
}
