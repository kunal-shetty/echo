/**
 * @file verify/route.ts
 * @description Handles OTP verification and user identity migration.
 * Validates the provided code against the stored hash and, if successful,
 * associates the user's email with their current device identity.
 *
 * If the email is already associated with a different device, the route
 * performs a "migration" by updating all owned records to the new device ID.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";
import {
  bumpOtpAttempts,
  consumeOtp,
  findActiveOtp,
  MAX_ATTEMPTS,
  verifyCodeHash,
} from "@/lib/server/otp";

export const runtime = "nodejs";

/**
 * Tables that contain a `user_id` column and must be migrated
 * when a user claims their identity on a new device.
 */
const TABLES_OWNED_BY_USER = [
  "accounts",
  "merchant_aliases",
  "transactions",
  "attachments",
  "recurring_rules",
  "budgets",
  "voice_sessions",
  "insights",
];

/**
 * Verifies the OTP and claims the identity.
 * Flow: Validate Code $\to$ Check Attempts $\to$ Resolve Identity $\to$ Migrate Data $\to$ Update User.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured.", code: "supabase_not_configured" },
      { status: 503 },
    );
  }
  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as { email?: string; code?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();
  if (!email || !code) {
    return NextResponse.json(
      { error: "Email and code are required." },
      { status: 400 },
    );
  }

  const deviceId = await getDeviceUserId();
  if (!deviceId) {
    return NextResponse.json(
      { error: "No device identity found. Reload the page and try again." },
      { status: 400 },
    );
  }

  const otp = await findActiveOtp(email);
  if (!otp) {
    return NextResponse.json(
      { error: "Code expired. Tap 'Resend code' to try again." },
      { status: 400 },
    );
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts. Tap 'Resend code' to try again." },
      { status: 429 },
    );
  }
  if (!verifyCodeHash(code, otp.code_hash)) {
    await bumpOtpAttempts(otp.id);
    return NextResponse.json({ error: "Wrong code." }, { status: 400 });
  }

  // Valid code; remove it so it cannot be reused.
  await consumeOtp(otp.id);

  const supabase = getSupabaseAdmin();

  // Check if this email is already linked to a different device identity.
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .neq("id", deviceId)
    .maybeSingle();

  let migrated = false;
  if (existing) {
    const fromId = existing.id as string;
    // Perform data migration: repoint all user-owned records to the current device ID.
    for (const table of TABLES_OWNED_BY_USER) {
      await supabase
        .from(table)
        .update({ user_id: deviceId })
        .eq("user_id", fromId);
    }
    // Delete the orphaned user record from the previous device.
    await supabase.from("users").delete().eq("id", fromId);
    migrated = true;
  }

  // Finalize identity by updating the current device's user row with the verified email.
  const { data: row, error } = await supabase
    .from("users")
    .upsert(
      {
        id: deviceId,
        email,
        email_verified_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Could not save: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    verified: true,
    migrated,
    user: row,
  });
}
