import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { listSystemCategories } from "@/lib/server/categories";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ categories: [], configured: false });
  }
  try {
    const cats = await listSystemCategories();
    return NextResponse.json({ categories: cats, configured: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}