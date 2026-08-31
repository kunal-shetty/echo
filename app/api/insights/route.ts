import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getDeviceUserId();
  if (!userId) {
    return NextResponse.json({ error: "No device identity." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from("insights")
      .select("*")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ insights: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
