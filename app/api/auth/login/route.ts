/**
 * @file login/route.ts
 * @description Simple email-based login.
 * Finds or creates a user record, creates a session, and sets the session cookie.
 */

import { NextResponse } from "next/server.js";
import { cookies } from "next/headers";
import { loginWithEmail } from "@/lib/server/user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  try {
    const { userId, sessionId } = await loginWithEmail(email);

    const store = await cookies();
    store.set("echo_session", sessionId, {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    return NextResponse.json({
      authenticated: true,
      userId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
