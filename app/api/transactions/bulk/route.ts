/**
 * @file route.ts
 * @description Bulk transaction import API.
 * Provides an endpoint for importing multiple transactions at once,
 * handling default account resolution, currency normalization,
 * and best-effort insertion of valid rows.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";
import {
  bulkCreateTransactions,
  type BulkTransactionInsert,
} from "@/lib/server/transactions";
import {
  listCategoriesForUser,
} from "@/lib/server/categories";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { getCurrentUserId, getUserRow } from "@/lib/server/user";
import type { Transaction } from "@/lib/schema";

export const runtime = "nodejs";

const MAX_ROWS = 500;

interface BulkRowIn {
  date?: string | null;
  amount_minor?: number;
  currency?: string;
  merchant_raw?: string;
  merchant_canonical?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  note?: string | null;
  direction?: "expense" | "income" | "transfer";
}

interface BulkBody {
  rows?: BulkRowIn[];
}

interface ParsedRow extends BulkTransactionInsert {
  rowIndex: number;
}

interface RowFailure {
  rowIndex: number;
  error: string;
}

interface ValidatedRow {
  rowIndex: number;
  parsed: Omit<BulkTransactionInsert, "account_id" | "currency" | "category_id" | "merchant_canonical" | "note" | "confidence" | "raw_transcript" | "clarified" | "source" | "direction"> & {
    account_id: string;
    currency: string;
    category_id: string | null;
    merchant_canonical: string | null;
    note: string | null;
    confidence: number | null;
    raw_transcript: string | null;
    clarified: boolean;
    source: BulkTransactionInsert["source"];
    direction: BulkTransactionInsert["direction"];
  };
}

/**
 * Parses a date string into an ISO 8601 timestamp.
 * Accepts YYYY-MM-DD (normalized to midnight UTC) or any valid Date string.
 * @param s The date string to parse.
 * @returns ISO timestamp or null if invalid.
 */
function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * POST /api/transactions/bulk
 * Imports multiple transactions in a single request.
 * Resolves defaults (account, currency) and performs best-effort insertion,
 * returning both the inserted transactions and a list of row failures.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "No device identity." }, { status: 400 });
  }

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (max ${MAX_ROWS})` },  // fix 1
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  let accountId: string | null = null;
  let homeCurrency = "INR";
  let knownCategoryIds: Set<string> | null = null;
  let categoryNameByLower: Map<string, string> | null = null;
  try {
    const { data: def } = await supabase
      .from("accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle();
    accountId = (def?.id as string | undefined) ?? null;

    const u = await getUserRow();
    if (u?.home_currency) homeCurrency = u.home_currency;

    const cats = await listCategoriesForUser(userId);
    knownCategoryIds = new Set(cats.map((c) => c.id));
    categoryNameByLower = new Map(
      cats.map((c) => [c.name.trim().toLowerCase(), c.id] as const),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!accountId) {
    return NextResponse.json(
      { error: "No account found for user" },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const validated: ValidatedRow[] = [];
  const failures: RowFailure[] = [];

  rows.forEach((r, idx) => {
    const merchant = (r.merchant_raw ?? "").trim();
    if (merchant.length === 0) {
      failures.push({ rowIndex: idx, error: "Merchant is required" });
      return;
    }
    const amount =
      typeof r.amount_minor === "number" ? r.amount_minor : NaN;
    if (!(amount > 0)) {
      failures.push({ rowIndex: idx, error: "Amount must be > 0" });
      return;
    }
    const dateIso = parseDate(r.date) ?? nowIso;

    let categoryId: string | null = null;
    if (r.category_id && knownCategoryIds!.has(r.category_id)) {
      categoryId = r.category_id;
    } else if (r.category_name && categoryNameByLower!.has(r.category_name.trim().toLowerCase())) {
      categoryId = categoryNameByLower!.get(r.category_name.trim().toLowerCase())!;
    } else if (r.category_id) {
      failures.push({
        rowIndex: idx,
        error: `Unknown category id '${r.category_id}'`,  // fix 2
      });
      return;
    }

    const currency =
      typeof r.currency === "string" && r.currency.length === 3
        ? r.currency.toUpperCase()
        : homeCurrency;

    const direction: BulkTransactionInsert["direction"] =
      r.direction === "income" || r.direction === "transfer"
        ? r.direction
        : "expense";

    const note =
      r.note === undefined || r.note === null ? null : String(r.note).slice(0, 500);

    validated.push({
      rowIndex: idx,
      parsed: {
        account_id: accountId,
        category_id: categoryId,
        amount_minor: amount,
        currency,
        direction,
        merchant_raw: merchant,
        merchant_canonical:
          r.merchant_canonical === undefined
            ? merchant
            : r.merchant_canonical === null
              ? null
              : String(r.merchant_canonical).trim() || merchant,
        note,
        transacted_at: dateIso,
        source: "manual",
        confidence: null,
        raw_transcript: null,
        clarified: false,
      },
    });
  });

  let inserted: Transaction[] = [];
  if (validated.length > 0) {
    try {
      const rowsToInsert = validated.map((v) => v.parsed);
      const dbRows = await bulkCreateTransactions(userId, rowsToInsert);
      const cats = await listCategoriesForUser(userId);
      inserted = dbRows.map((r) =>
        toUiTransaction(r, indexCategories(cats)),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({
    inserted: inserted.length,
    transactions: inserted,
    failures,
  });
}