/**
 * @file start/route.ts
 * @description Entry point for the OTP (One-Time Password) authentication flow.
 * Validates the email address, generates a unique numeric code, stores it in the
 * database, and sends it to the user via the Resend email service.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import { serverError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  countRecentOtps,
  generateCode,
  isResendConfigured,
  MAX_SENDS_PER_HOUR,
  sendOtpEmail,
  storeOtp,
} from "@/lib/server/otp";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handles the initial request to send an OTP.
 * Flow: Rate limit → Validate Email → Check Config → Throttle per email → Generate → Store → Send.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "auth-start", 10, 10 * 60 * 1000);
  if (limited) return limited;

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured() || !isResendConfigured()) {
    return NextResponse.json(
      {
        error: "Email sync isn't configured on this deployment.",
        code: "resend_not_configured",
      },
      { status: 503 },
    );
  }

  try {
    if ((await countRecentOtps(email)) >= MAX_SENDS_PER_HOUR) {
      return NextResponse.json(
        { error: "Too many codes requested. Try again in an hour." },
        { status: 429 },
      );
    }

    const code = generateCode();
    await storeOtp(email, code);
    await sendOtpEmail(email, code);
  } catch (e) {
    return serverError(e, "auth/start");
  }

  return NextResponse.json({ sent: true });
}
