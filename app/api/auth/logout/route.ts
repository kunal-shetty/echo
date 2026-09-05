import { NextResponse } from "next/server.js";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/server/supabase";

export async function POST() {
  const store = await cookies();
  const sessionId = store.get("echo_session")?.value;

  if (sessionId) {
    const supabase = getSupabaseAdmin();
    await supabase.from("sessions").delete().eq("id", sessionId);
    store.delete("echo_session");
  }

  return NextResponse.json({ success: true });
}
