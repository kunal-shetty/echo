import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";
import { money } from "@/lib/fmt";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { listSystemCategories } from "@/lib/server/categories";

export const runtime = "nodejs";

export async function POST() {
  const userId = await getDeviceUserId();
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

    const insights: any[] = [];

    // --- Pattern 1: The Biggest Spend (Anomaly) ---
    const biggest = txs.reduce((prev, curr) =>
      (curr.amount_minor > prev.amount_minor) ? curr : prev
    , txs[0]);

    insights.push({
      kind: 'anomaly',
      payload: {
        title: "Biggest Memory",
        text: `Your biggest spend was ${money(biggest.amount_minor)} on ${biggest.merchant_raw}.`,
        hero_metric: money(biggest.amount_minor),
        cta: "View details"
      }
    });

    // --- Pattern 2: The Top Category (Habit) ---
    const catSpend: Record<string, number> = {};
    txs.forEach(t => {
      const catId = t.category_id || "Other";
      catSpend[catId] = (catSpend[catId] || 0) + t.amount_minor;
    });

    const topCatId = Object.entries(catSpend).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topCatId) {
      const cats = await listSystemCategories().catch(() => []);
      const catMatch = cats.find(c => c.id === topCatId) || { name: "Other" };

      insights.push({
        kind: 'spend_pattern',
        payload: {
          title: "Spending Habit",
          text: `You've spent the most on ${catMatch.name} this period.`,
          hero_metric: money(catSpend[topCatId]),
          cta: "Analyze la"
        }
      });
    }

    // --- Pattern 3: The Loyal Customer (Loyalty) ---
    const merchantCounts: Record<string, number> = {};
    txs.forEach(t => {
      const m = t.merchant_canonical || t.merchant_raw;
      merchantCounts[m] = (merchantCounts[m] || 0) + 1;
    });

    const topMerchant = Object.entries(merchantCounts).sort((a, b) => b[1] - a[1])[0];
    if (topMerchant && topMerchant[1] > 1) {
      insights.push({
        kind: 'trend',
        payload: {
          title: "Loyal Customer",
          text: `You've visited ${topMerchant[0]} ${topMerchant[1]} times!`,
          hero_metric: `${topMerchant[1]}x`,
          cta: "See all"
        }
      });
    }

    // 2. Persist insights to the database.
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
      message: `Generated ${insights.length} insights.`,
      insights
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Insight generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
