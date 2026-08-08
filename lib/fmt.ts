// Formatting helpers. Keep all currency / date logic here so the UI stays
// declarative and the data model stays currency-agnostic.

const INDIAN = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: number, currency = "INR"): string {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function moneyShort(value: number): string {
  if (Math.abs(value) >= 100000) {
    return `₹${COMPACT.format(value / 100000)}L`;
  }
  if (Math.abs(value) >= 1000) {
    return `₹${COMPACT.format(value / 1000)}K`;
  }
  return INDIAN.format(value);
}

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

export function greeting(name: string): string {
  const h = new Date().getHours();
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

export function todayEyebrow(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function shortMonth(month: string): string {
  return month.slice(0, 3);
}
