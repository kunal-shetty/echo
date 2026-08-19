import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { parseTranscript } from "@/lib/groq";
import { runQuery, type QueryFilters } from "@/lib/server/queries";
import type { ParseResult, QueryKind, QueryRange } from "@/lib/parse";

export const runtime = "nodejs";

interface AskBody {
  transcript?: string;
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
function defaultDirectionForQuery(transcript: string): "expense" | "income" {
  const t = transcript.toLowerCase();
  if (/(earn|earned|income|salary|received|got paid|credit|cashback|refund|deposit)/.test(t)) {
    return "income";
  }
  return "expense";
}

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
    const response: AskResponse = {
      result: { ...parsed, action: "query", queryKind: kind },
      query: {
        kind: result.kind,
        range: result.range,
        headline: result.headline,
        spoken: result.spoken,
        total: result.total,
        rows: result.rows,
        filters: result.filters,
      },
    };
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
