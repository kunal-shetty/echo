/**
 * @file route.ts
 * @description Audio transcription API.
 * Acts as a proxy between the client and the Groq Whisper API, converting
 * raw audio blobs into text transcripts.
 */

import { NextResponse } from "next/server.js";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

// Groq's audio transcription endpoint. OpenAI-compatible schema.
const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL =
  process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo";
/** Voice notes are short; anything bigger is not a voice note. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/transcribe
 * Receives a multipart/form-data request containing an audio file.
 * Forwards the file to Groq's Whisper API and returns the transcription.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 30, 60 * 1000);
  if (limited) return limited;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }

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

  if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }
  if (file.type && !file.type.startsWith("audio/") && file.type !== "video/webm") {
    return NextResponse.json({ error: "Expected an audio file" }, { status: 415 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Transcription isn't configured on this deployment.",
      },
      { status: 503 },
    );
  }

  // Forward to Groq. Whisper accepts webm/opus, mp4, wav, m4a, etc.
  // Language hint improves accuracy for en-IN users on short utterances.
  const requested = (form.get("language") ?? "en").toString();
  const language = /^[a-z]{2}$/.test(requested) ? requested : "en";
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
    console.error("[transcribe] upstream fetch failed", e);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[transcribe] Groq ${res.status}: ${detail.slice(0, 500)}`);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }

  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  return NextResponse.json({ text });
}
