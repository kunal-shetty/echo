/**
 * @file transaction-shape.ts
 * @description Translation layer that transforms database rows (DbTransaction)
 * into UI-ready objects (Transaction). Handles category resolution, icon
 * mapping, and date formatting.
 */

import type { Category, Transaction } from "@/lib/schema";
import type { DbCategory } from "@/lib/server/categories";
import type { DbTransaction } from "@/lib/server/transactions";

const DEFAULT_TONE: Transaction["tone"] = "neutral";

const toneByCategory: Record<string, Transaction["tone"] | undefined> = {};

/**
 * Creates a fast lookup map from a list of categories.
 * @param cats List of system or user categories.
 * @returns A map indexed by category ID.
 */
export function indexCategories(cats: DbCategory[] | Category[]): Map<
  string,
  DbCategory | Category
> {
  const m = new Map<string, DbCategory | Category>();
  for (const c of cats) m.set(c.id, c);
  return m;
}

/**
 * Transforms a DB transaction row into a UI-ready Transaction object.
 * Resolves category metadata (icon, tone, name) and pre-formats the date.
 * @param row The raw database row.
 * @param categories A map of categories for metadata lookup.
 * @returns A formatted Transaction object for use in components.
 */
export function toUiTransaction(
  row: DbTransaction,
  categories: Map<string, DbCategory | Category>,
): Transaction {
  const cat = row.category_id ? categories.get(row.category_id) : null;
  const tone = (cat?.tone ?? DEFAULT_TONE) as Transaction["tone"];
  const merchant = row.merchant_raw || "Expense";
  const icon = (cat?.icon?.toString?.().charAt(0) ?? merchant.charAt(0)).toUpperCase();
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    categoryId: row.category_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    direction: row.direction,
    merchantRaw: merchant,
    merchantCanonical: row.merchant_canonical,
    note: row.note ?? undefined,
    transactedAt: row.transacted_at,
    createdAt: row.created_at,
    source: row.source,
    confidence: row.confidence == null ? null : Number(row.confidence),
    rawTranscript: row.raw_transcript,
    clarified: row.clarified,
    icon,
    tone,
    date: formatRelative(row.transacted_at),
    categoryName: cat?.name ?? null,
  };
}

/**
 * Formats an ISO timestamp into a human-readable relative date.
 * Examples: "Today, 9:42 AM", "Yesterday, 7:10 PM", "Mon, 8:04 AM".
 * @param iso ISO 8601 timestamp.
 * @returns Relative date string.
 */
export function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today, ${time}`;
  if (wasYesterday) return `Yesterday, ${time}`;
  const wkday = d.toLocaleDateString([], { weekday: "short" });
  return `${wkday}, ${time}`;
}

export { toneByCategory };
