/**
 * @file route.ts
 * @description Voice query orchestrator.
 * Handles the pipeline from user transcript → intent parsing → database query →
 * conversational response generation using Groq.
 */

import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { parseTranscript, generateReasonedResponse } from "@/lib/groq";
import { runQuery, type QueryFilters } from "@/lib/server/queries";
import type { ParseResult, QueryKind, QueryRange } from "@/lib/parse";
import { defaultKindForQuery, defaultDirectionForQuery } from "@/lib/parse";

export const runtime = "nodejs";

interface AskBody {
  transcript?: string;
  sessionId?: string;
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
 * Determines the default query kind based on keywords in the transcript.
 * Fallback for when the LLM doesn't explicitly specify a kind.
 * @param transcript The raw user utterance.
 * @returns The inferred QueryKind.
 */
function defaultKindForQuery(transcript: string): QueryKind {
  const t = transcript.toLowerCase();
  if (/(biggest|largest|most expensive)/.test(t)) return "biggest";
  if (/(list|show me|what did i|recent)/.test(t)) return "list";
  return "sum";
}

/** Best-guess direction when the parser didn't return one. We mirror the
 *  model cue list so spend-shaped queries get `expense` and
 *  income-shaped ones get `income` even if the parser mis-classified
 *  the action. */
/**
 * Guesses whether a query is about income or expenses based on keywords.
 * Fallback for when the LLM doesn't explicitly specify a direction.
 * @param transcript The raw user utterance.
 * @returns The inferred direction.
 */
function defaultDirectionForQuery(transcript: string): "expense" | "income" {
  const t = transcript.toLowerCase();
  if (/(earn|earned|income|salary|received|got paid|credit|cashback|refund|deposit)/.test(t)) {
    return "income";
  }
  return "expense";
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

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
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

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  // Parse. We don't need recent transactions for queries (no edit/delete).
  let parsed: ParseResult;
  try {
    parsed = await parseTranscript(transcript, apiKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // If the parser said something else (e.g. "create"), still try to answer
  // by overriding action → query. The user clearly asked a question even if
  // the parser was confused.
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
  };

  try {
    const result = await runQuery(filters);

    // Fetch conversation history for this session to provide context to Groq.
    let history = [];
    if (body.sessionId) {
      const supabase = (await import("@/lib/server/supabase")).getSupabaseAdmin();
      const { data: sessions } = await supabase
        .from("voice_sessions")
        .select("transcript, parsed_intent")
        .eq("user_id", userId) // assuming userId is available in scope
        .eq("device", body.sessionId) // using device as session id for now
        .order("started_at", { ascending: true })
        .limit(5);
      if (sessions) history = sessions;
    }

    // Generate a reasoned, conversational response using Groq instead of templates.
    const reasonedSpoken = await generateReasonedResponse(
      transcript,
      result,
      history,
      apiKey,
    ).catch(() => result.spoken); // Fallback to template if Groq fails

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

    // Save this turn to voice_sessions for future context.
    if (body.sessionId) {
      const supabase = (await import("@/lib/server/supabase")).getSupabaseAdmin();
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
