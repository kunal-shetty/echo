import { NextResponse } from "next/server.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/server/supabase";
import { getCurrentUserId } from "@/lib/server/user";
import { generateSmartInsights } from "@/lib/groq";
import { serverError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Most recent rows sent to the LLM; keeps prompt size (and cost) bounded. */
const MAX_TXS_FOR_INSIGHTS = 300;

export async function POST(req: Request) {
  const limited = rateLimit(req, "insights", 5, 10 * 60 * 1000);
  if (limited) return limited;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Backend not configured." }, { status: 503 });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Insights aren't configured on this deployment." },
      { status: 503 },
    );
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ message: "No transactions found to analyze." });
    }
    const supabase = getSupabaseAdmin();

    // 1. Fetch the user's most recent non-deleted transactions.
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("transacted_at", { ascending: false })
      .limit(MAX_TXS_FOR_INSIGHTS);

    if (txErr) throw txErr;
    if (!txs || txs.length === 0) {
      return NextResponse.json({
        message: "No transactions found to analyze.",
      });
    }

    // 2. Generate Reasoned Insights using Groq.
    const insights = await generateSmartInsights(txs, apiKey);

    // 3. Persist insights to the database.
    // First, clear old insights for the user to keep it fresh.
    await supabase.from("insights").delete().eq("user_id", userId);

    const now = new Date();
    const { error: insErr } = await supabase.from("insights").insert(
      insights.map((i) => ({
        user_id: userId,
        kind: i.kind,
        period_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        period_end: now.toISOString(),
        payload: i.payload,
        generated_at: now.toISOString(),
      })),
    );

    if (insErr) throw insErr;

    return NextResponse.json({
      message: `Generated ${insights.length} smart insights.`,
      insights,
    });
  } catch (e) {
    return serverError(e, "insights/generate");
  }
}
