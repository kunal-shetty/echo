import { NextResponse } from "next/server.js";
import { getSupabaseAdmin } from "@/lib/server/supabase";

export async function POST() {
  const supabase = getSupabaseAdmin();

  const queries = [
    // 1. Add OAuth columns to users table
    `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;`,
    `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS oauth_id TEXT;`,

    // 2. Create sessions table
    `CREATE TABLE IF NOT EXISTS public.sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );`,

    // 3. Add index for session lookup
    `CREATE INDEX IF NOT EXISTS idx_sessions_id ON public.sessions(id);`
  ];

  try {
    for (const query of queries) {
      const { error } = await supabase.rpc('exec_sql', { sql: query });
      if (error) throw error;
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
