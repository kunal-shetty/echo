import { NextResponse } from "next/server.js";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/server/supabase";

export async function GET() {
  const store = await cookies();
  const sessionId = store.get("echo_session")?.value;

  if (!sessionId) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const supabase = getSupabaseAdmin();
  const { data: session } = await supabase
    .from("sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.user_id,
  });
}
