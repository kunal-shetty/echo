/**
 * @file queries.ts
 * @description Server-side query engine for financial transactions.
 * Handles the resolution of relative date ranges, merchant/category filtering,
 * and the generation of conversational headlines for the Voice AI.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";
import type { QueryKind, QueryRange } from "@/lib/parse";
import type { Transaction } from "@/lib/schema";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { listSystemCategories } from "@/lib/server/categories";
import { money } from "@/lib/fmt";

export interface QueryFilters {
  /** The type of aggregation: "sum", "biggest", or "list". */
  kind: QueryKind;
  /** The relative date range (e.g., "today", "this_month"). */
  range: QueryRange | null;
  /** Filter by category name (resolved server-side). */
  categoryName: string | null;
  /** Filter by merchant name (fuzzy match). */
  merchant: string | null;
  /** Maximum number of rows to return (relevant for "list"). */
  limit: number | null;
  /** Restrict to a specific direction. Null = both. */
  direction: "expense" | "income" | null;
}

/** The structured result of a financial query, including conversational summaries. */
export interface QueryResult {
  /** The original query kind. */
  kind: QueryKind;
  /** The resolved range used for the query. */
  range: QueryRange;
  /** Human-readable headline ("Spent ₹3,420 on food this month.") */
  headline: string;
  /** Spoken-back version (slightly shorter for TTS). */
  spoken: string;
  /** For sum: the total in major units. For biggest: same. Null for list. */
  total: number | null;
  /** Matching transactions to render. Always populated (up to limit). */
  rows: Transaction[];
  /** Echo's understanding of the filter, for debugging. */
  filters: {
    categoryName: string | null;
    merchant: string | null;
  };
}

/** Resolve a [start, end) UTC range for the named period. */
function rangeBounds(range: QueryRange, now: Date): [Date, Date] | null {
  // Work in user's home timezone if we can — for Echo, "today" means
  // IST-day boundaries regardless of where the server runs. Cheap heuristic
  // using Asia/Kolkata offset (+5:30, no DST).
  const istOffsetMin = 5 * 60 + 30;
  const utcMs = now.getTime();
  const istMs = utcMs + istOffsetMin * 60_000;

  const istNow = new Date(istMs);
  const istStartOfDay = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()),
  );
  // istStartOfDay is actually "midnight IST expressed as a UTC timestamp";
  // subtract the offset to get the real UTC instant.
  const istMidnightUtcMs = istStartOfDay.getTime() - istOffsetMin * 60_000;
  const dayStartUtc = (offsetDays: number): Date =>
    new Date(istMidnightUtcMs + offsetDays * 86_400_000);

  switch (range) {
    case "today": {
      const start = dayStartUtc(0);
      const end = dayStartUtc(1);
      return [start, end];
    }
    case "yesterday": {
      const start = dayStartUtc(-1);
      const end = dayStartUtc(0);
      return [start, end];
    }
    case "this_week": {
      // en-IN week starts Monday.
      const dow = istNow.getUTCDay(); // 0 = Sun … 6 = Sat
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const start = dayStartUtc(mondayOffset);
      const end = dayStartUtc(1);
      return [start, end];
    }
    case "this_month": {
      const startIst = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1),
      );
      const start = new Date(startIst.getTime() - istOffsetMin * 60_000);
      const end = dayStartUtc(1);
      return [start, end];
    }
    case "last_month": {
      const startIst = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - 1, 1),
      );
      const endIst = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1),
      );
      return [
        new Date(startIst.getTime() - istOffsetMin * 60_000),
        new Date(endIst.getTime() - istOffsetMin * 60_000),
      ];
    }
    case "all":
    case null:
      return null;
  }
}

function rangeLabel(range: QueryRange | null): string {
  switch (range) {
    case "today":
      return "today";
    case "yesterday":
      return "yesterday";
    case "this_week":
      return "this week";
    case "this_month":
      return "this month";
    case "last_month":
      return "last month";
    case "all":
    case null:
      return "so far";
  }
}

function merchantFilterLabel(merchant: string | null): string {
  if (!merchant) return "";
  return ` on ${merchant}`;
}

function categoryFilterLabel(category: string | null): string {
  if (!category) return "";
  return ` on ${category.toLowerCase()}`;
}

/**
 * Executes a financial query against the database based on the provided filters.
 * Resolves date ranges to UTC timestamps, maps category names to IDs, and
 * computes the total or finds the biggest transaction.
 * @param filters The query constraints.
 * @returns A QueryResult containing the data and human-readable summaries.
 * @throws Error if no device identity is found.
 */
export async function runQuery(
  filters: QueryFilters,
): Promise<QueryResult> {
  const userId = await getDeviceUserId();
  if (!userId) {
    throw new Error("No device identity.");
  }

  const supabase = getSupabaseAdmin();
  const range = filters.range ?? "all";
  const bounds = rangeBounds(range, new Date());

  // Resolve category name → id if provided.
  let categoryId: string | null = null;
  if (filters.categoryName) {
    const cats = await listSystemCategories().catch(() => []);
    const match = cats.find(
      (c) => c.name.toLowerCase() === filters.categoryName!.toLowerCase(),
    );
    categoryId = match?.id ?? null;
  }

  // Build the query.
  let q = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("transacted_at", { ascending: false });
  if (bounds) {
    q = q
      .gte("transacted_at", bounds[0].toISOString())
      .lt("transacted_at", bounds[1].toISOString());
  }
  if (categoryId) q = q.eq("category_id", categoryId);
  if (filters.direction) q = q.eq("direction", filters.direction);
  if (filters.merchant) {
    // Match canonical OR raw; case-insensitive ilike for fuzzy-ish behavior.
    q = q.or(
      `merchant_canonical.ilike.%${filters.merchant}%,merchant_raw.ilike.%${filters.merchant}%`,
    );
  }
  // Cap the underlying fetch so a "list all" doesn't pull thousands of rows.
  const fetchLimit = 200;
  q = q.limit(fetchLimit);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Parameters<typeof toUiTransaction>[0][];

  // For biggest: re-sort ascending by amount, take top 1.
  let top = [...rows];
  if (filters.kind === "biggest") {
    top.sort(
      (a, b) => Number(b.amount_minor) - Number(a.amount_minor),
    );
    top = top.slice(0, 1);
  } else if (filters.kind === "list") {
    const limit = filters.limit ?? 5;
    top = top.slice(0, limit);
  }

  const sysCats = await listSystemCategories().catch(() => []);
  const uiCats = indexCategories(sysCats);
  const uiRows = top.map((r) => toUiTransaction(r, uiCats));

  const total =
    filters.kind === "biggest"
      ? uiRows[0]
        ? Number(uiRows[0].amountMinor)
        : null
      : top.reduce((acc, r) => acc + Number(r.amount_minor), 0);

  const headline = buildHeadline(filters, total ?? 0, uiRows.length);
  const spoken = buildSpoken(filters, total ?? 0, uiRows.length);

  return {
    kind: filters.kind,
    range,
    headline,
    spoken,
    total: filters.kind === "list" ? null : total,
    rows: uiRows,
    filters: {
      categoryName: filters.categoryName,
      merchant: filters.merchant,
    },
  };
}

function verbFor(direction: QueryFilters["direction"]): {
  past: string;
  noun: string;
} {
  if (direction === "income") return { past: "earned", noun: "income" };
  return { past: "spent", noun: "expense" };
}

function buildHeadline(
  f: QueryFilters,
  total: number,
  rowCount: number,
): string {
  const range = rangeLabel(f.range);
  const where =
    categoryFilterLabel(f.categoryName) + merchantFilterLabel(f.merchant);
  const verb = verbFor(f.direction);

  if (f.kind === "biggest") {
    if (rowCount === 0 || total === null) {
      return `No ${verb.noun}s found${where ? ` ${where.trim()}` : ""} ${range}.`;
    }
    return `Biggest ${range}: ${money(total)}${where} — ${rowCount === 1 ? `1 ${verb.noun}` : `${rowCount} ${verb.noun}s`}.`;
  }
  if (f.kind === "list") {
    const limit = f.limit ?? rowCount;
    if (rowCount === 0) {
      return `No ${verb.noun}s found${where ? ` ${where.trim()}` : ""} ${range}.`;
    }
    return `Last ${Math.min(limit, rowCount)} ${verb.noun}s${where} ${range}.`;
  }
  // sum
  if (rowCount === 0) {
    return `You haven't ${verb.past} anything${where ? ` ${where.trim()}` : ""} ${range}.`;
  }
  return `You ${verb.past} ${money(total)}${where} ${range}.`;
}

function buildSpoken(
  f: QueryFilters,
  total: number,
  rowCount: number,
): string {
  const range = rangeLabel(f.range);
  const where =
    categoryFilterLabel(f.categoryName) + merchantFilterLabel(f.merchant);
  const verb = verbFor(f.direction);

  if (f.kind === "biggest") {
    if (rowCount === 0 || total === null) {
      return `You have no ${verb.noun}s${where} ${range}.`;
    }
    return `Your biggest ${verb.noun}${where} ${range} was ${money(total)}.`;
  }
  if (f.kind === "list") {
    return `${rowCount} ${verb.noun}s${where} ${range}. Want details?`;
  }
  if (rowCount === 0) {
    return `You haven't ${verb.past} anything${where} ${range}.`;
  }
  return `You ${verb.past} ${money(total)}${where} ${range}.`;
}
