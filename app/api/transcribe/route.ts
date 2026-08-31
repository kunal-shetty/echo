/**
 * @file route.ts
 * @description Audio transcription API.
 * Acts as a proxy between the client and the Groq Whisper API, converting
 * raw audio blobs into text transcripts.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Groq's audio transcription endpoint. OpenAI-compatible schema.
const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL =
  process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo";

/**
 * POST /api/transcribe
 * Receives a multipart/form-data request containing an audio file.
 * Forwards the file to Groq's Whisper API and returns the transcription.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with an audio file" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field in form data" },
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

  // Forward to Groq. Whisper accepts webm/opus, mp4, wav, m4a, etc.
  // Language hint improves accuracy for en-IN users on short utterances.
  const language = (form.get("language") ?? "en").toString();
  const upstream = new FormData();
  upstream.append("file", file, file.name || "audio.webm");
  upstream.append("model", WHISPER_MODEL);
  upstream.append("language", language);
  upstream.append("response_format", "json");
  upstream.append("temperature", "0");

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upstream fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Groq ${res.status}: ${detail.slice(0, 240)}` },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  return NextResponse.json({ text });
}
