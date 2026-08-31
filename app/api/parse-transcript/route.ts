import { NextResponse } from "next/server";
import { parseTranscript } from "@/lib/groq";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { transcript?: string };
  try {
    body = (await req.json()) as { transcript?: string };
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
          "GROQ_API_KEY is not set. Add it to your .env to enable transcription.",
      },
      { status: 503 },
    );
  }

  try {
    const parsed = await parseTranscript(transcript, apiKey);
    return NextResponse.json(parsed);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Groq call failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
