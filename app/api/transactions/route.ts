/**
 * @file route.ts
 * @description Transactions API.
 * Handles retrieving the user's transaction history and manually creating
 * new transactions.
 */

import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  createTransaction,
  listTransactions,
  type TransactionInsert,
} from "@/lib/server/transactions";
import { listSystemCategories } from "@/lib/server/categories";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { getCurrentUserId } from "@/lib/server/user";
import { getSupabaseAdmin } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * GET /api/transactions
 * Retrieves all transactions for the current user, along with the
 * available categories for UI resolution.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      transactions: [],
      categories: [],
      configured: false,
    });
  }
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({
        transactions: [],
        categories: [],
        configured: false,
      });
    }

    const [rows, cats] = await Promise.all([
      listTransactions(userId),
      listSystemCategories(),
    ]);
    const indexed = indexCategories(cats);
    return NextResponse.json({
      transactions: rows.map((r) => toUiTransaction(r, indexed)),
      categories: cats,
      configured: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/transactions
 * Manually creates a new transaction.
 * Validates amount and merchant before resolving the account and persisting to DB.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  let body: TransactionInsert;
  try {
    body = (await req.json()) as TransactionInsert;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const amount = Number(body.amount_minor ?? 0);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  }
  const merchant = body.merchant_raw?.trim();
  if (!merchant) {
    return NextResponse.json(
      { error: "Merchant is required" },
      { status: 400 },
    );
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "No device identity." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    let accountId = body.account_id;
    if (!accountId) {
      const { data: def } = await supabase
        .from("accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("is_default", true)
        .maybeSingle();
      accountId = (def?.id as string | undefined) ?? null;
    }
    if (!accountId) {
      return NextResponse.json(
        { error: "No account found for user." },
        { status: 500 },
      );
    }

    const row = await createTransaction({
      account_id: accountId,
      category_id: body.category_id ?? null,
      amount_minor: amount,
      currency: (body.currency ?? "INR").slice(0, 3).toUpperCase(),
      direction: body.direction ?? "expense",
      merchant_raw: merchant,
      merchant_canonical: body.merchant_canonical ?? merchant,
      note: body.note ?? null,
      source: body.source ?? "manual",
      confidence: body.confidence ?? null,
      raw_transcript: body.raw_transcript ?? null,
      transacted_at: body.transacted_at ?? new Date().toISOString(),
      clarified: false,
    });

    const cats = await listSystemCategories();
    return NextResponse.json({
      transaction: toUiTransaction(row, indexCategories(cats)),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
