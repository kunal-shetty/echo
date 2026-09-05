import { NextResponse } from "next/server.js";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";
import { getCurrentUserId } from "@/lib/server/user";
import { bulkCreateTransactions } from "@/lib/server/transactions";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Backend not configured." }, { status: 503 });
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const transactions = body.transactions;

    if (!Array.isArray(transactions)) {
      return NextResponse.json({ error: "Invalid input: transactions must be an array." }, { status: 400 });
    }

    // We use the existing bulkCreateTransactions, but we must ensure it's
    // adapted to accept a userId since it usually gets it from the session.
    // If bulkCreateTransactions uses getSessionUserId internally, we're good.

    const result = await bulkCreateTransactions(transactions);

    return NextResponse.json({
      success: true,
      inserted: result.transactions.length,
      failures: result.failures,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
