/**
 * @file verify/route.ts
 * @description Verifies an email OTP and signs the caller in.
 *
 * Outcomes, given a valid code for `email`:
 *  - An account already owns the email → sign in to that account. If the
 *    caller is currently a guest, the guest's own data is merged into it
 *    first (the caller proves ownership of both: a live guest session and
 *    the email code). Data never flows the other way.
 *  - No account owns the email and the caller is a guest → the guest
 *    account claims the email.
 *  - Otherwise → a fresh verified account is created.
 * The session id is always rotated on success.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/server/supabase";
import {
  ensureDefaultAccount,
  getSessionUser,
  startSession,
  toPublicUser,
  type UserRow,
} from "@/lib/server/user";
import {
  bumpOtpAttempts,
  consumeOtp,
  findActiveOtp,
  MAX_ATTEMPTS,
  verifyCodeHash,
} from "@/lib/server/otp";
import { serverError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = rateLimit(req, "auth-verify", 30, 10 * 60 * 1000);
  if (limited) return limited;

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured.", code: "supabase_not_configured" },
      { status: 503 },
    );
  }
  let body: { email?: unknown; code?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !code) {
    return NextResponse.json(
      { error: "Email and code are required." },
      { status: 400 },
    );
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Wrong code." }, { status: 400 });
  }

  try {
    const otp = await findActiveOtp(email);
    if (!otp) {
      return NextResponse.json(
        { error: "Code expired. Tap 'Resend code' to try again." },
        { status: 400 },
      );
    }
    // Count the attempt before checking it, so parallel guesses can't
    // exceed the limit.
    const attempts = await bumpOtpAttempts(otp.id);
    if (attempts > MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Tap 'Resend code' to try again." },
        { status: 429 },
      );
    }
    if (!verifyCodeHash(code, otp.code_hash)) {
      return NextResponse.json({ error: "Wrong code." }, { status: 400 });
    }
    if (!(await consumeOtp(otp.id))) {
      return NextResponse.json(
        { error: "Code expired. Tap 'Resend code' to try again." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const current = await getSessionUser();
    const nowIso = new Date().toISOString();

    const { data: owner, error: ownerErr } = await supabase
      .from("users")
      .select("id, email_verified_at")
      .eq("email", email)
      .maybeSingle();
    if (ownerErr) throw ownerErr;

    let userId: string;
    let migrated = false;
    if (owner) {
      userId = owner.id as string;
      if (current && !current.verified && current.userId !== userId) {
        const { error } = await supabase.rpc("merge_user_data", {
          from_uid: current.userId,
          to_uid: userId,
        });
        if (error) throw error;
        migrated = true;
      }
      if (!owner.email_verified_at) {
        const { error } = await supabase
          .from("users")
          .update({ email_verified_at: nowIso })
          .eq("id", userId);
        if (error) throw error;
      }
    } else if (current && !current.verified) {
      userId = current.userId;
      const { error } = await supabase
        .from("users")
        .update({ email, email_verified_at: nowIso })
        .eq("id", userId);
      if (error) throw error;
    } else {
      userId = randomUUID();
      const { error } = await supabase
        .from("users")
        .insert({ id: userId, email, email_verified_at: nowIso });
      if (error) throw error;
      await ensureDefaultAccount(userId);
    }

    await startSession(userId, true);

    const { data: row, error: rowErr } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();
    if (rowErr) throw rowErr;

    return NextResponse.json({
      verified: true,
      migrated,
      user: toPublicUser(row as UserRow),
    });
  } catch (e) {
    return serverError(e, "auth/verify");
  }
}
