/**
 * @file groq.ts
 * @description Integration layer for Groq LLM.
 * Handles intent parsing of voice transcripts and the generation of
 * conversational financial insights (Reasoned Responses).
 */

import type { ParseResult, RecentTransactionContext } from "@/lib/parse";
import type { QueryResult } from "@/lib/server/queries";

// Groq's chat completion endpoint. Uses an OpenAI-compatible schema.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

/** Format an ISO timestamp as "Wed, 19 Aug 2026, 7:42 PM" (en-IN style). */
function formatHumanDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildSystemPrompt(now: Date): string {
  const todayIso = now.toISOString();
  const yesterdayIso = new Date(now.getTime() - 86_400_000).toISOString();
  const today = formatHumanDate(todayIso);
  const yesterday = formatHumanDate(yesterdayIso);

  return `You are the parser for Echo, a voice-first finance tracker for INR.

## Time context
- Today is: ${today}
- Yesterday was: ${yesterday}
- All "transacted_at" timestamps you emit must be ISO 8601 in UTC.
  * "today" → start of today in user's timezone, or "now" if the user didn't specify a time.
  * "yesterday" → start of yesterday in user's timezone.
  * "the day before yesterday" → 2 days back.
  * If no time hint, default to the current wall-clock time on the inferred day.
  * If the user says a clock time ("at 7pm"), use that.

## What the user might say
The user dictates short utterances like:
  "spent 150 on lunch"
  "paid twelve fifty at blue bottle coffee"
  "rupees two thousand three hundred for groceries at bigbasket"
  "spent 2000 on dinner"  // ambiguous currency — assume INR
  "spent $30 on coffee yesterday"
  "received 50,000 salary"
  "got my freelance payment of 12,000 from client X"
  "credited 800 refund from Amazon"
  "earned 2,000 cashback"
  "update my yesterday dinner date with Ayushi, it was 1800 not 2000"
  "delete the blinkit order I added just now"
  "change the groceries entry from yesterday to 950"
  "how much did I spend this month"
  "how much on food this week"
  "what did I spend yesterday"
  "show me my last 5 expenses"
  "what was my biggest expense this month"
  "how much have I spent on Ayushi"
  "how much did I earn this month"
  "how much income did I get this week"

## Intent classification
Every utterance is one of four actions. Pick exactly one:

- "create" — the user is recording a NEW expense or income. Cues: starts with "spent", "paid", "bought", "received", "got", "earned", "credited", "salary of", or describes a past money movement with an amount and source.
  * Required: amount, merchant.
  * Optional: category, transacted_at (default = today, current time).
  * Set direction to "income" when the verb is credit-shaped (received / got / earned / credited / salary / freelance payment / refund / cashback), otherwise "expense".
- "update" — the user is correcting or amending an EXISTING memory. Cues: starts with "update", "change", "fix", "correct", "it was X not Y".
  * Required: match (one entry from the recent list below, identified by its 'id'), and at least one of newAmount / newMerchant / newTransactedAt.
  * If the user wants to flip a memory from expense → income or back, also set direction.
- "delete" — the user is removing an existing memory. Cues: "delete", "remove", "cancel".
  * Required: match.id.
- "query" — the user is asking a question about their money. Cues: starts with "how much", "what did I", "show me", "what was my biggest", "total", "list", or any question word. NEVER has an amount-to-record.
  * Required: queryKind.
  * Optional: queryRange, queryCategory, queryMerchant, queryLimit, queryDirection.

### Direction
- "expense" — money leaving (default for "spent/paid/bought").
- "income" — money arriving. Cues: "received", "got", "earned", "salary", "credited", "freelance payment", "refund", "cashback", "deposit".
- If unclear, default to "expense".

### Query kinds
- "sum" — totals. Cues: "how much", "total", "sum".
- "list" — show a list of memories. Cues: "show me", "what did I", "list my".
- "biggest" — single largest memory. Cues: "biggest", "largest", "most expensive".

### Query ranges (default: "all")
- "today" — same calendar day as today in user's timezone.
- "yesterday" — same calendar day as yesterday in user's timezone.
- "this_week" — Monday to today (or Sunday to today if that's what the user means; the standard week start is Monday in en-IN).
- "this_month" — 1st of this month to today.
- "last_month" — entire previous calendar month.
- "all" — no time filter. Default if the user didn't specify a range.

### Query filters
- queryCategory: one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other". Set when the user says "on food", "for transport", etc.
- queryMerchant: the merchant name they asked about. Examples: "on Zomato", "with Ayushi" (treat "with Ayushi" as a person/merchant), "at BigBasket".
- queryLimit: number of items to list (default 5 for list queries; ignore for sum/biggest).
- queryDirection:
  * "expense" — when the user says "spent", "paid", "cost me", "how much on food". Default for spend-shaped queries.
  * "income" — when the user says "earned", "received", "got paid", "salary", "income", "made".
  * null — when the user explicitly asks for both, or the cue is ambiguous.

## Output schema
Respond with STRICT JSON only. No commentary, no markdown, no code fences.

{
  "action": "create" | "update" | "delete" | "query",
  "amount": number | null,                    // create only
  "merchant": string | null,                  // create only
  "direction": "expense" | "income" | null,   // create + update
  "category": string | null,                  // create + update
  "transacted_at": string | null,             // create + update
  "match": { "id": string } | null,           // update + delete only
  "newAmount": number | null,                 // update only
  "newMerchant": string | null,               // update only
  "newTransactedAt": string | null,           // update only
  "queryKind": "sum" | "list" | "biggest" | null,         // query only
  "queryRange": "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | null,
  "queryCategory": string | null,             // query only
  "queryMerchant": string | null,             // query only
  "queryLimit": number | null,                // query (list) only
  "queryDirection": "expense" | "income" | null,           // query only
  "confidence": number                        // 0..1, how sure you are
}

## Rules
- Currency is INR by default. "$", "dollars", "USD" → treat as rupees. Do NOT refuse the parse.
- amount / newAmount: numeric, positive, in major units (no ₹, no Rs). Convert words ("twelve fifty" → 12.5). Indian formats ("12k" → 12000, "1.2L" → 120000).
- merchant / newMerchant: short title-case ("lunch" → "Lunch", "blue bottle coffee" → "Blue Bottle Coffee", "salary" → "Salary", "freelance payment" → "Freelance Payment"). Strip filler words like "on", "at", "for" from the start.
- category (when set): one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other". Pick the closest. For salary / freelance, "Other" is fine if nothing else fits.
- match.id: when the recent transactions list below contains the user's intended target, use its id. If nothing in the list matches with reasonable confidence, set match to null and confidence below 0.5.
- "how much have I spent on Ayushi" is a sum query filtered by merchant "Ayushi" (the model treats a person mentioned in spending context as a merchant).
- "biggest" always implies list=1 (limit not needed).
- Confidence guidance:
  * 0.0–0.3 → very low. UI shows manual entry form.
  * 0.3–0.7 → uncertain. UI shows a confirm card.
  * 0.7–1.0 → confident. UI auto-saves.`;
}

/**
 * Turns a raw query result into a conversational, intelligent response.
 * Uses Groq to add a 'nugget' of financial reasoning or coaching based on the data.
 * @param transcript The original user utterance.
 * @param result The raw data result from runQuery.
 * @param history Conversation history for context.
 * @param apiKey The Groq API key.
 * @returns A short, natural, reasoned response for TTS output.
 */
export async function generateReasonedResponse(
  transcript: string,
  result: QueryResult,
  history: any[] = [],
  apiKey: string,
): Promise<string> {
  const system = `You are Echo, a concise and encouraging finance coach.
Your goal is to answer the user's query using the provided data, but add a "nugget" of intelligence or a helpful observation.

Rules:
- Be extremely concise (max 2 sentences) because this will be spoken via TTS.
- Be natural and conversational.
- Use the provided data accurately.
- Add a small insight: a comparison, a warning, or a compliment about their spending.
- If the result is empty, be encouraging but honest.

Example:
User: "How much did I spend on coffee?"
Data: { total: 1200, range: "this_month", rows: [...] }
Response: "You've spent ₹1,200 on coffee this month. That's a bit more than usual—maybe try a few more home-brews?"`;

  const dataContext = JSON.stringify({
    transcript,
    result,
    history,
  });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `User said: "${transcript}"\nData: ${dataContext}\n\nWhat is the natural, reasoned response?`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq response failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "I'm not sure how to answer that right now.";
}

interface GroqParseResponse {
  action?: string;
  amount?: number | null;
  merchant?: string | null;
  direction?: string | null;
  category?: string | null;
  transacted_at?: string | null;
  match?: { id?: string } | null;
  newAmount?: number | null;
  newMerchant?: string | null;
  newTransactedAt?: string | null;
  queryKind?: string | null;
  queryRange?: string | null;
  queryCategory?: string | null;
  queryMerchant?: string | null;
  queryLimit?: number | null;
  queryDirection?: string | null;
  confidence?: number;
}

export interface ParseOptions {
  /** Recent transactions (last 5, newest first) for context. */
  recent?: RecentTransactionContext[];
}

/**
 * Analyzes a voice transcript to extract a structured financial intent.
 * Uses a comprehensive system prompt to classify the action (create, update, delete, query)
 * and extract relevant entities like amount, merchant, and date.
 * @param transcript The user's spoken utterance.
 * @param apiKey The Groq API key.
 * @param options Optional context, such as recent transactions for resolving update targets.
 * @returns A structured ParseResult.
 * @throws Error if the LLM response is invalid or the API call fails.
 */
export async function parseTranscript(
  transcript: string,
  apiKey: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const now = new Date();
  const system = buildSystemPrompt(now);

  const recentBlock =
    options.recent && options.recent.length > 0
      ? `\n\n## Recent transactions (newest first)\nUse these to identify update/delete targets:\n` +
        options.recent
          .map(
            (r, i) =>
              `${i + 1}. id="${r.id}" · ${formatHumanDate(r.transactedAt)} · ${r.merchantRaw} · ${r.amount}`,
          )
          .join("\n")
      : "\n\n(No recent transactions — the user has no edit/delete targets available.)";

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + recentBlock },
        {
          role: "user",
          content: `Transcript: "${transcript}"\n\nReturn JSON only.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 240)}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";

  let parsed: GroqParseResponse;
  try {
    parsed = JSON.parse(content) as GroqParseResponse;
  } catch {
    throw new Error(`Groq returned non-JSON: ${content.slice(0, 200)}`);
  }

  const action = normalizeAction(parsed.action);
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

  return {
    action,
    amount: numberOrNull(parsed.amount),
    merchant: stringOrNull(parsed.merchant),
    direction: normalizeDirection(parsed.direction),
    category: stringOrNull(parsed.category),
    transactedAt: stringOrNull(parsed.transacted_at),
    matchId: stringOrNull(parsed.match?.id ?? null),
    newAmount: numberOrNull(parsed.newAmount),
    newMerchant: stringOrNull(parsed.newMerchant),
    newTransactedAt: stringOrNull(parsed.newTransactedAt),
    queryKind: normalizeQueryKind(parsed.queryKind),
    queryRange: normalizeQueryRange(parsed.queryRange),
    queryCategory: stringOrNull(parsed.queryCategory),
    queryMerchant: stringOrNull(parsed.queryMerchant),
    queryLimit: normalizeQueryLimit(parsed.queryLimit),
    queryDirection: normalizeDirection(parsed.queryDirection),
    confidence,
    transcript,
  };
}

function normalizeAction(value: unknown): ParseResult["action"] {
  if (
    value === "update" ||
    value === "delete" ||
    value === "create" ||
    value === "query"
  ) {
    return value;
  }
  return "create";
}

function normalizeDirection(value: unknown): ParseResult["direction"] {
  if (value === "expense" || value === "income") return value;
  return null;
}

function normalizeQueryKind(v: unknown): ParseResult["queryKind"] {
  if (v === "sum" || v === "list" || v === "biggest") return v;
  return null;
}

function normalizeQueryRange(v: unknown): ParseResult["queryRange"] {
  if (
    v === "today" ||
    v === "yesterday" ||
    v === "this_week" ||
    v === "this_month" ||
    v === "last_month" ||
    v === "all"
  ) {
    return v;
  }
  return null;
}

function normalizeQueryLimit(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 50) {
    return Math.round(v);
  }
  return null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
