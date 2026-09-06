/**
 * @file route.ts
 * @description Voice query orchestrator.
 * Handles the pipeline from user transcript → intent parsing → database query →
 * conversational response generation using Groq.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { parseTranscript, generateReasonedResponse } from "@/lib/groq";
import { runQuery, type QueryFilters } from "@/lib/server/queries";
import type { ParseResult, QueryKind, QueryRange } from "@/lib/parse";
import { defaultKindForQuery, defaultDirectionForQuery } from "@/lib/parse";

export const runtime = "nodejs";

interface AskBody {
  transcript?: string;
  sessionId?: string;
  parseOnly?: boolean;
  respondOnly?: boolean;
  result?: any; // for respondOnly
}

interface AskResponse {
  result: ParseResult;
  query: {
    kind: QueryKind;
    range: QueryRange;
    headline: string;
    spoken: string;
    total: number | null;
    rows: import("@/lib/schema").Transaction[];
    filters: { categoryName: string | null; merchant: string | null };
  };
  /** Soft warning the UI can show alongside the answer. */
  warning?: string;
}

/**
 * POST /api/ask
 * The main entry point for user questions about their finances.
 * Uses Groq to parse the intent and a reasoning engine to generate
 * a conversational answer based on real transaction data.
 */
export async function POST(req: Request) {
  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GROQ_API_KEY is not set. Add it to your .env to enable voice queries.",
      },
      { status: 503 },
    );
  }

  if (body.respondOnly) {
    const transcript = body.transcript?.trim();
    if (!transcript || !body.result) {
      return NextResponse.json({ error: "Missing transcript or result" }, { status: 400 });
    }
    try {
      const reasonedSpoken = await generateReasonedResponse(
        transcript,
        body.result,
        [],
        apiKey,
      );
      return NextResponse.json({ spoken: reasonedSpoken });
    } catch (e) {
      return NextResponse.json({ error: "Response generation failed" }, { status: 500 });
    }
  }

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  const { getCurrentUserId } = await import("@/lib/server/user");
  const userId = await getCurrentUserId();

  // Parse.
  let parsed: ParseResult;
  try {
    parsed = await parseTranscript(transcript, apiKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (body.parseOnly) {
    return NextResponse.json({ result: parsed });
  }

  // If the parser said something else (e.g. "create"), still try to answer
  // by overriding action → query.
  const kind: QueryKind =
    parsed.action === "query" && parsed.queryKind
      ? parsed.queryKind
      : defaultKindForQuery(transcript);

  const filters: QueryFilters = {
    kind,
    range: parsed.queryRange,
    categoryName: parsed.queryCategory,
    merchant: parsed.queryMerchant,
    limit: parsed.queryLimit,
    direction:
      parsed.queryDirection ?? defaultDirectionForQuery(transcript),
    nlqSpec: parsed.nlqSpec,
  };

  try {
    const result = await runQuery(filters);

    // Fetch conversation history for this session to provide context to Groq.
    let history: any[] = [];
    if (body.sessionId) {
      const { getSupabaseAdmin } = await import("@/lib/server/supabase");
      const supabase = getSupabaseAdmin();
      const { data: sessions } = await supabase
        .from("voice_sessions")
        .select("transcript, parsed_intent")
        .eq("user_id", userId)
        .eq("device", body.sessionId)
        .order("started_at", { ascending: true })
        .limit(5);
      if (sessions) history = sessions;
    }

    const reasonedSpoken = await generateReasonedResponse(
      transcript,
      result,
      history,
      apiKey,
    ).catch(() => result.spoken);

    const response: AskResponse = {
      result: { ...parsed, action: "query", queryKind: kind },
      query: {
        kind: result.kind,
        range: result.range,
        headline: result.headline,
        spoken: reasonedSpoken,
        total: result.total,
        rows: result.rows,
        filters: result.filters,
      },
    };

    if (body.sessionId) {
      const { getSupabaseAdmin } = await import("@/lib/server/supabase");
      const supabase = getSupabaseAdmin();
      await supabase.from("voice_sessions").insert({
        user_id: userId,
        started_at: new Date().toISOString(),
        transcript,
        parsed_intent: parsed,
        outcome: "created",
        device: body.sessionId,
      });
    }

    if (parsed.action !== "query") {
      response.warning =
        "I heard that as a question, but I wasn't sure. Here's my best answer.";
    }
    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
