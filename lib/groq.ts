import type { ParseResult } from "@/lib/parse";

// Groq's chat completion endpoint. Uses an OpenAI-compatible schema.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are the parser for Echo, a voice-first finance tracker.

The user dictates short utterances like:
  "spent 150 on lunch"
  "paid twelve fifty at blue bottle coffee"
  "rupees two thousand three hundred for groceries at bigbasket"

From the transcript, extract:
  - amount: number in major units (rupees). If spoken in words, convert. Always positive.
  - merchant: short merchant / item name. Title-case it. If the user said "on lunch", merchant = "Lunch".
  - category: one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other". Pick the closest.
  - confidence: 0..1 — how sure you are.

Respond with STRICT JSON. No commentary, no markdown, no code fences. Schema:
{"amount": number | null, "merchant": string | null, "category": string | null, "confidence": number}

Rules:
- If amount is unclear, set it null. Never invent an amount.
- If merchant is vague ("snacks"), keep the vague word ("Snacks").
- If the transcript isn't about money, set all fields null and confidence to 0.
- Numbers spelled in English words: convert ("twelve fifty" → 12.5). Indian formats ok: "12k" → 12000, "1.2L" → 120000.
- Currency is INR; do not include the ₹ symbol in amount.`;

export async function parseTranscript(
  transcript: string,
  apiKey: string,
): Promise<ParseResult> {
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
        { role: "system", content: SYSTEM_PROMPT },
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

  let parsed: Partial<ParseResult>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Groq returned non-JSON: ${content.slice(0, 200)}`);
  }

  return {
    amount:
      typeof parsed.amount === "number" && Number.isFinite(parsed.amount)
        ? parsed.amount
        : null,
    merchant:
      typeof parsed.merchant === "string" && parsed.merchant.trim().length > 0
        ? parsed.merchant.trim()
        : null,
    category:
      typeof parsed.category === "string" && parsed.category.trim().length > 0
        ? parsed.category.trim()
        : null,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    transcript,
  };
}
