/**
 * @file route.ts
 * @description Bulk transaction import API.
 * Provides an endpoint for importing multiple transactions at once,
 * handling default account resolution, currency normalization,
 * and best-effort insertion of valid rows.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  bulkCreateTransactions,
  type TransactionInsert,
} from "@/lib/server/transactions";
import { listCategoriesForUser } from "@/lib/server/categories";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { requireUserId } from "@/lib/server/user";
import { loadTxContext, validateTransactionInput } from "@/lib/server/transaction-input";
import { serverError } from "@/lib/server/http";
import type { Transaction } from "@/lib/schema";

export const runtime = "nodejs";

const MAX_ROWS = 500;

interface RowFailure {
  rowIndex: number;
  error: string;
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

  let body: { rows?: unknown };
  try {
    body = (await req.json()) as { rows?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (max ${MAX_ROWS})` },
      { status: 400 },
    );
  }

  try {
    const userId = await requireUserId();
    const ctx = await loadTxContext(userId);

    const valid: TransactionInsert[] = [];
    const failures: RowFailure[] = [];
    rows.forEach((r, idx) => {
      if (!r || typeof r !== "object") {
        failures.push({ rowIndex: idx, error: "Invalid row" });
        return;
      }
      const result = validateTransactionInput(r as Record<string, unknown>, ctx, {
        allowedSources: ["import"],
        defaultSource: "import",
      });
      if (result.ok) valid.push(result.row);
      else failures.push({ rowIndex: idx, error: result.error });
    });

    let inserted: Transaction[] = [];
    if (valid.length > 0) {
      const dbRows = await bulkCreateTransactions(userId, valid);
      const cats = await listCategoriesForUser(userId);
      const indexed = indexCategories(cats);
      inserted = dbRows.map((r) => toUiTransaction(r, indexed));
    }

    return NextResponse.json({
      inserted: inserted.length,
      transactions: inserted,
      failures,
    });
  } catch (e) {
    return serverError(e, "transactions/bulk");
  }
}
