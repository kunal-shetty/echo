import type { Category, Transaction } from "@/lib/schema";
import type { DbCategory } from "@/lib/server/categories";
import type { DbTransaction } from "@/lib/server/transactions";

const DEFAULT_TONE: Transaction["tone"] = "neutral";

const toneByCategory: Record<string, Transaction["tone"] | undefined> = {};

// Build a quick lookup from a list of system categories.
export function indexCategories(cats: DbCategory[] | Category[]): Map<
  string,
  DbCategory | Category
> {
  const m = new Map<string, DbCategory | Category>();
  for (const c of cats) m.set(c.id, c);
  return m;
}

/** DB row → UI Transaction. Picks icon/tone from category, falls back
 *  to merchant initial + neutral tone. Date is pre-formatted. */
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

/** Render "Today, 9:42 AM" / "Yesterday, 7:10 PM" / "Mon, 8:04 AM" etc. */
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
