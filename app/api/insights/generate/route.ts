import { NextResponse } from "next/server.js";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getCurrentUserId } from "@/lib/server/user";
import { generateSmartInsights } from "@/lib/groq";

export const runtime = "nodejs";

export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "No device identity." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    // 1. Fetch all non-deleted transactions for the user.
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (txErr) throw txErr;
    if (!txs || txs.length === 0) {
      return NextResponse.json({ message: "No transactions found to analyze." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GROQ_API_KEY not set." }, { status: 500 });
    }

    // 2. Generate Reasoned Insights using Groq.
    const insights = await generateSmartInsights(txs, apiKey);

    // 3. Persist insights to the database.
    // First, clear old insights for the user to keep it fresh.
    await supabase.from("insights").delete().eq("user_id", userId);

    const { error: insErr } = await supabase.from("insights").insert(
      insights.map(i => ({
        user_id: userId,
        kind: i.kind,
        period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        period_end: new Date().toISOString(),
        payload: i.payload,
        generated_at: new Date().toISOString(),
      }))
    );

    if (insErr) throw insErr;

    return NextResponse.json({
      message: `Generated ${insights.length} smart insights.`,
      insights
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Insight generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
