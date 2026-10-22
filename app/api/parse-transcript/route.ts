import { NextResponse } from "next/server.js";
import { parseTranscript } from "@/lib/groq";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 30, 60 * 1000);
  if (limited) return limited;

  let body: { transcript?: unknown };
  try {
    body = (await req.json()) as { transcript?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript =
    typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
      { status: 400 },
    );
  }
  if (transcript.length > 1000) {
    return NextResponse.json({ error: "Transcript too long" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Voice parsing isn't configured on this deployment.",
      },
      { status: 503 },
    );
  }

  try {
    const parsed = await parseTranscript(transcript, apiKey);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[parse-transcript] failed", e);
    return NextResponse.json(
      { error: "Couldn't understand that. Please try again." },
      { status: 502 },
    );
  }
}
