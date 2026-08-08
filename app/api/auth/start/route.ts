import { NextResponse } from "next/server";
import { getOrCreateUserRow } from "@/lib/server/user";
import {
  generateCode,
  isResendConfigured,
  sendOtpEmail,
  storeOtp,
} from "@/lib/server/otp";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  // Make sure the current device has a user row even if they've never
  // explicitly logged in — otherwise verify can't find anything to update.
  const user = await getOrCreateUserRow();

  if (!isResendConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email sync isn't configured on this deployment. Set RESEND_API_KEY and RESEND_FROM.",
        code: "resend_not_configured",
      },
      { status: 503 },
    );
  }

  const code = generateCode();
  await storeOtp(email, code);

  try {
    await sendOtpEmail(email, code);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send email";
    return NextResponse.json(
      { error: `Could not send email: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sent: true,
    userId: user?.id ?? null,
  });
}
