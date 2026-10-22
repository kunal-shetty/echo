import { NextResponse } from "next/server.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/server/supabase";
import { serverError } from "@/lib/server/http";
import { getCurrentUserId } from "@/lib/server/user";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ insights: [] });
  }
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ insights: [] });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("insights")
      .select("*")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ insights: data ?? [] });
  } catch (e) {
    return serverError(e, "insights/GET");
  }
}
