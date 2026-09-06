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
const MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b";

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
You support English, Hindi, and Hinglish (a mix of Hindi and English).

## Language Support
- The user may speak in English, Hindi, or Hinglish.
- You must map meanings from any of these languages to the structured output.
- Examples: "Spent 100 on tea" = "100 chai pe kharch kiya" = "Tea ke liye 100 diye".

## Time context
- Today is: ${today}
- Yesterday was: ${yesterday}
- All "transacted_at" timestamps you emit must be ISO 8601 in UTC.
  * "today" / "aaj" → start of today in user's timezone, or "now" if the user didn't specify a time.
  * "yesterday" / "kal" → start of yesterday in user's timezone.
  * "the day before yesterday" / "parso" → 2 days back.
  * If no time hint, default to the current wall-clock time on the inferred day.
  * If the user says a clock time ("at 7pm" / "7 baje"), use that.

## What the user might say
The user dictates short utterances like:
  - English: "spent 150 on lunch", "paid twelve fifty at blue bottle coffee", "received 50,000 salary"
  - Hindi/Hinglish: "150 lunch pe kharch kiya", "blue bottle coffee ko barah sau pachas diye", "50,000 salary mili", "kal 200 petrol pe kharch huye"
  - Queries: "how much did I spend this month", "is mahine kitna kharch kiya", "kal kya kharch kiya", "show me my last 5 expenses", "mere aakhri 5 kharche dikhao"

## Intent classification
Every utterance is one of four actions. Pick exactly one:

- "create" — the user is recording a NEW expense or income.
  * Cues (EN): "spent", "paid", "bought", "received", "got", "earned", "credited", "salary of".
  * Cues (HI/Hinglish): "kharch kiya", "diye", "pay kiya", "bhara", "mila", "aaye", "credit hua", "salary aayi".
  * Required: amount, merchant.
  * Optional: category, transacted_at (default = today, current time).
  * Set direction to "income" when the verb is credit-shaped (received / mila / got / aaye / earned / credit hua / salary / refund / cashback), otherwise "expense".
- "update" — the user is correcting or amending an EXISTING memory.
  * Cues (EN): "update", "change", "fix", "correct", "it was X not Y".
  * Cues (HI/Hinglish): "update karo", "change karo", "galat hai", "X nahi Y tha".
  * Required: match (one entry from the recent list below, identified by its 'id'), and at least one of newAmount / newMerchant / newTransactedAt.
  * If the user wants to flip a memory from expense → income or back, also set direction.
- "delete" — the user is removing an existing memory.
  * Cues (EN): "delete", "remove", "cancel".
  * Cues (HI/Hinglish): "delete karo", "hata do", "cancel karo".
  * Required: match.id.
- "query" — the user is asking a question about their money.
  * Cues (EN): "how much", "what did I", "show me", "what was my biggest", "total", "list".
  * Cues (HI/Hinglish): "kitna", "kitne paise", "dikhao", "total kitna", "sabse bada kharcha".
  * NEVER has an amount-to-record.
  * Required: queryKind.
  * Optional: queryRange, queryCategory, queryMerchant, queryLimit, queryDirection.
  * For complex queries (e.g. "more than X", "between dates", "compared to"), provide an \`nlqSpec\`.

  ### NLQ Specification (\`nlqSpec\`)
  Use this for queries that exceed the basic filters.
  - aggregate: "sum" | "count" | "max" | "min" | "avg"
  - field: "amount_minor" | "id"
  - filters: array of { field, operator, value }
    * fields: "category_id", "merchant_canonical", "merchant_raw", "direction", "transacted_at"
    * operators: "eq" (equals), "ilike" (fuzzy match), "gte" (>=), "lt" (<), "in" (list)
  - range: same as queryRange
  - limit: number

### Direction
- "expense" — money leaving (default for "spent/paid/bought" / "kharch/diye").
- "income" — money arriving. Cues: "received", "got", "earned", "salary", "credited" / "mila", "aaye", "credit hua".
- If unclear, default to "expense".

### Query kinds
- "sum" — totals. Cues: "how much", "total", "sum" / "kitna", "total kitna".
- "list" — show a list of memories. Cues: "show me", "what did I", "list my" / "dikhao", "list karo".
- "biggest" — single largest memory. Cues: "biggest", "largest", "most expensive" / "sabse bada".

### Query ranges (default: "all")
- "today" — same calendar day as today / "aaj".
- "yesterday" — same calendar day as yesterday / "kal".
- "this_week" — Monday to today / "is hafte".
- "this_month" — 1st of this month to today / "is mahine".
- "last_month" — entire previous calendar month / "pichle mahine".
- "all" — no time filter. Default if the user didn't specify a range.

### Query filters
- queryCategory: one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other".
- queryMerchant: the merchant name they asked about. Examples: "on Zomato", "with Ayushi", "at BigBasket".
- queryLimit: number of items to list (default 5 for list queries; ignore for sum/biggest).
- queryDirection:
  * "expense" — when the user says "spent", "paid", "cost me", "how much on food" / "kharch", "diye".
  * "income" — when the user says "earned", "received", "got paid", "salary", "income", "made" / "mila", "aaye".
  * null — when the user explicitly asks for both, or the cue is ambiguous.

## Output schema
Respond with STRICT JSON only. No commentary, no markdown, no code fences.

{
  "action": "create" | "update" | "delete" | "query",
  "amount": number | null,
  "merchant": string | null,
  "direction": "expense" | "income" | null,
  "category": string | null,
  "transacted_at": string | null,
  "match": { "id": string } | null,
  "newAmount": number | null,
  "newMerchant": string | null,
  "newTransactedAt": string | null,
  "queryKind": "sum" | "list" | "biggest" | null,
  "queryRange": "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | null,
  "queryCategory": string | null,
  "queryMerchant": string | null,
  "queryLimit": number | null,
  "queryDirection": "expense" | "income" | null,
  "nlqSpec": {
    "aggregate": "sum" | "count" | "max" | "min" | "avg",
    "field": "amount_minor" | "id",
    "filters": Array<{ "field": string, "operator": string, "value": any }>,
    "range": "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | null,
    "limit": number | null
  } | null,
  "confidence": number
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
  * 0.7–1.0 → confident. UI auto-saves.
- Field Requirements:
  * If action is "create": amount and merchant are REQUIRED.
  * If action is "update": match.id and (newAmount or newMerchant or newTransactedAt) are REQUIRED.
  * If action is "delete": match.id is REQUIRED.
  * If action is "query": queryKind is REQUIRED.
  * All other fields should be null if not applicable.
`;
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
  const now = new Date();
  const today = formatHumanDate(now);

  const system = `You are Echo, a concise and encouraging finance coach.
Today is ${today}.
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

/**
 * Generates a set of "Smart Insights" based on transaction data.
 * Uses Groq to analyze patterns and provide reasoned financial coaching.
 */
export async function generateSmartInsights(
  transactions: any[],
  apiKey: string,
): Promise<Array<{ kind: string; payload: any }>> {
  const system = `You are Echo's Insight Engine. You analyze financial transactions and provide 3-5 high-impact, reasoned insights.

  Rules:
  - Focus on patterns: anomalies, habits, or trends.
  - Be concise but insightful.
  - Format each insight as a JSON object with:
    - title: A catchy title (e.g., "Spending Spike", "Loyalty Alert").
    - text: The reasoned insight (e.g., "You spent ₹2,000 more on Food than last month").
    - hero_metric: The key number (e.g., "₹2,000").
    - cta: A call to action (e.g., "Review Food expenses").
    - kind: One of "anomaly", "spend_pattern", "trend".
  - Respond with a JSON array of these objects. No markdown.`;

  const dataContext = JSON.stringify(transactions.map(t => ({
    merchant: t.merchant_raw,
    amount: t.amount_minor,
    category: t.category_id,
    date: t.transacted_at
  })));

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Transactions: ${dataContext}\n\nGenerate 3 smart insights.`,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Groq insights failed: ${res.status}`);

  const json = await res.json();
  // Groq might return { insights: [...] } or just the array
  const insights = json.insights || (Array.isArray(json) ? json : Object.values(json)[0]);

  return (Array.isArray(insights) ? insights : []).map(i => ({
    kind: i.kind || 'trend',
    payload: {
      title: i.title || "Insight",
      text: i.text || "",
      hero_metric: i.hero_metric || "",
      cta: i.cta || "View details"
    }
  }));
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
