/**
 * @file route.ts
 * @description Transactions API.
 * Handles retrieving the user's transaction history and manually creating
 * new transactions.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { createTransaction, listTransactions } from "@/lib/server/transactions";
import { listCategoriesForUser } from "@/lib/server/categories";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { getCurrentUserId, requireUserId } from "@/lib/server/user";
import { loadTxContext, validateTransactionInput } from "@/lib/server/transaction-input";
import { serverError } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * GET /api/transactions
 * Retrieves the current user's transactions. A request with no session
 * simply has no transactions yet.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ transactions: [], configured: false });
  }
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ transactions: [], configured: true });
    }

    const [rows, cats] = await Promise.all([
      listTransactions(userId, 500),
      listCategoriesForUser(userId),
    ]);
    const indexed = indexCategories(cats);
    return NextResponse.json({
      transactions: rows.map((r) => toUiTransaction(r, indexed)),
      configured: true,
    });
  } catch (e) {
    return serverError(e, "transactions/GET");
  }
}

/**
 * POST /api/transactions
 * Manually creates a new transaction for the current user (creating a
 * guest account on first use). The account is always the user's default;
 * every other field is validated server-side.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const ctx = await loadTxContext(userId);
    const result = validateTransactionInput(body, ctx, {
      allowedSources: ["manual", "voice"],
      defaultSource: "manual",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const row = await createTransaction(userId, result.row);
    const cats = await listCategoriesForUser(userId);
    return NextResponse.json({
      transaction: toUiTransaction(row, indexCategories(cats)),
    });
  } catch (e) {
    return serverError(e, "transactions/POST");
  }
}
