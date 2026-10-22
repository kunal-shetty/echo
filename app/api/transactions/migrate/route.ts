/**
 * @file migrate/route.ts
 * @description One-time upload of transactions that older versions of Echo
 * kept in the browser's localStorage. Rows arrive in the UI (camelCase)
 * shape and go through the same validation as every other write.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { requireUserId } from "@/lib/server/user";
import {
  bulkCreateTransactions,
  type TransactionInsert,
} from "@/lib/server/transactions";
import { loadTxContext, validateTransactionInput } from "@/lib/server/transaction-input";
import { serverError } from "@/lib/server/http";

export const runtime = "nodejs";

const MAX_ROWS = 1000;

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  let body: { transactions?: unknown };
  try {
    body = (await req.json()) as { transactions?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const transactions = body?.transactions;
  if (!Array.isArray(transactions)) {
    return NextResponse.json(
      { error: "Invalid input: transactions must be an array." },
      { status: 400 },
    );
  }
  if (transactions.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (max ${MAX_ROWS})` },
      { status: 400 },
    );
  }

  try {
    const userId = await requireUserId();
    const ctx = await loadTxContext(userId);

    const valid: TransactionInsert[] = [];
    const failures: Array<{ rowIndex: number; error: string }> = [];
    transactions.forEach((t, idx) => {
      const tx = (t ?? {}) as Record<string, unknown>;
      const result = validateTransactionInput(
        {
          amount_minor: tx.amountMinor,
          currency: tx.currency,
          direction: tx.direction,
          merchant_raw: tx.merchantRaw,
          merchant_canonical: tx.merchantCanonical,
          // Local category ids may not exist server-side; fall back to name.
          category_id: ctx.categoryIds.has(tx.categoryId as string)
            ? tx.categoryId
            : undefined,
          category_name: tx.categoryName,
          note: tx.note,
          transacted_at: tx.transactedAt,
          source: tx.source,
          confidence: tx.confidence,
          raw_transcript: tx.rawTranscript,
        },
        ctx,
        { allowedSources: ["voice", "manual", "import"], defaultSource: "import" },
      );
      if (result.ok) valid.push(result.row);
      else failures.push({ rowIndex: idx, error: result.error });
    });

    const inserted = await bulkCreateTransactions(userId, valid);
    return NextResponse.json({
      success: true,
      inserted: inserted.length,
      failures,
    });
  } catch (e) {
    return serverError(e, "transactions/migrate");
  }
}
