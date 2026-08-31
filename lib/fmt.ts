/**
 * @file fmt.ts
 * @description Formatting helpers for currency, dates, and transcripts.
 * Centralizes locale-specific formatting (en-IN) to ensure consistency
 * between the server and client.
 */

const INDIAN = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Formats a numeric value as a currency string.
 * @param value The amount in major units.
 * @param currency ISO currency code. Defaults to 'INR'.
 * @returns Formatted currency string (e.g., "₹1,200.00").
 */
export function money(value: number, currency = "INR"): string {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a numeric value as a compact currency string.
 * Used for charts and dashboards where space is limited.
 * @param value The amount in major units.
 * @returns Compact formatted string (e.g., "₹1.2L", "₹1.5K").
 */
export function moneyShort(value: number): string {
  if (Math.abs(value) >= 100000) {
    return `₹${COMPACT.format(value / 100000)}L`;
  }
  if (Math.abs(value) >= 1000) {
    return `₹${COMPACT.format(value / 1000)}K`;
  }
  return INDIAN.format(value);
}

/**
 * Formats a timestamp into a human-readable relative date.
 * Examples: "Just now", "5m ago", "Today, 9:42 AM", "Yesterday, 7:10 PM".
 * @param timestamp ISO string, number, or Date object.
 * @returns Relative date string.
 */
export function formatDate(timestamp: string | number | Date): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 6) return `${diffHr}h ago`;
  if (isSameDay(d, now)) return `Today, ${formatTime(d)}`;
  if (isYesterday(d, now)) return `Yesterday, ${formatTime(d)}`;
  if (diffMs < 7 * 86400000) return `${formatWeekday(d)}, ${formatTime(d)}`;
  return formatShortDate(d);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isYesterday(d: Date, now: Date): boolean {
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return isSameDay(d, y);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatWeekday(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Returns a time-of-day greeting.
 * @param name The user's display name.
 * @returns "Good morning, Name", etc.
 */
export function greeting(name: string): string {
  const h = new Date().getHours();
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

/**
 * Returns a formatted string of today's date.
 * Example: "Monday, August 31".
 */
export function todayEyebrow(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Returns the 3-letter abbreviation of a month.
 * @param month The month string (e.g., "2026-08").
 * @returns Abbreviated month (e.g., "Aug").
 */
export function shortMonth(month: string): string {
  return month.slice(0, 3);
}

/**
 * Normalizes currency references in transcripts.
 * Replaces "$" or "USD" with "₹" to ensure the UI remains INR-consistent.
 * @param text The raw transcript text.
 * @returns Normalized text.
 */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\$([0-9][\d,.]*)/g, "₹$1")
    .replace(/\bUSD\b/g, "₹")
    .replace(/\bdollars?\b/gi, "rupees")
    .replace(/\bRs\.?\s*([0-9][\d,.]*)/gi, "₹$1");
}
