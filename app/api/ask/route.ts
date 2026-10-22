/**
 * @file route.ts
 * @description Voice query orchestrator.
 * Handles the pipeline from user transcript → intent parsing → database query →
 * conversational response generation using Groq.
 */

import { NextResponse } from "next/server.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/server/supabase";
import { parseTranscript, generateReasonedResponse } from "@/lib/groq";
import { runQuery, type QueryFilters } from "@/lib/server/queries";
import { requireUserId } from "@/lib/server/user";
import { serverError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import type { ParseResult, QueryKind, QueryRange } from "@/lib/parse";
import { defaultKindForQuery, defaultDirectionForQuery } from "@/lib/parse";

export const runtime = "nodejs";

/** Longest transcript we will send to the LLM. */
const MAX_TRANSCRIPT = 1000;

interface AskBody {
  transcript?: unknown;
  /** Client-generated id grouping one voice conversation. */
  sessionId?: unknown;
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
  const limited = rateLimit(req, "llm", 30, 60 * 1000);
  if (limited) return limited;

  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice queries aren't configured on this deployment." },
      { status: 503 },
    );
  }

  const transcript =
    typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
      { status: 400 },
    );
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return NextResponse.json({ error: "Transcript too long" }, { status: 400 });
  }
  const voiceSessionId =
    typeof body.sessionId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(body.sessionId)
      ? body.sessionId
      : null;

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  // Parse.
  let parsed: ParseResult;
  try {
    parsed = await parseTranscript(transcript, apiKey);
  } catch (e) {
    console.error("[ask] parse failed", e);
    return NextResponse.json(
      { error: "Couldn't understand that. Please try again." },
      { status: 502 },
    );
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
    direction: parsed.queryDirection ?? defaultDirectionForQuery(transcript),
    nlqSpec: parsed.nlqSpec,
  };

  try {
    const userId = await requireUserId();
    const result = await runQuery(userId, filters);
    const supabase = getSupabaseAdmin();

    // Fetch conversation history for this voice session to give Groq context.
    let history: unknown[] = [];
    if (voiceSessionId) {
      const { data: sessions } = await supabase
        .from("voice_sessions")
        .select("transcript, parsed_intent")
        .eq("user_id", userId)
        .eq("device", voiceSessionId)
        .order("started_at", { ascending: false })
        .limit(5);
      if (sessions) history = sessions.reverse();
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

    if (voiceSessionId) {
      await supabase.from("voice_sessions").insert({
        user_id: userId,
        started_at: new Date().toISOString(),
        transcript,
        parsed_intent: parsed,
        outcome: "created",
        device: voiceSessionId,
      });
    }

    if (parsed.action !== "query") {
      response.warning =
        "I heard that as a question, but I wasn't sure. Here's my best answer.";
    }
    return NextResponse.json(response);
  } catch (e) {
    return serverError(e, "ask");
  }
}
