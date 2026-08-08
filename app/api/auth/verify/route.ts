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

  await consumeOtp(otp.id);

  const supabase = getSupabaseAdmin();

  // Find out if the email already owns a different device's data.
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .neq("id", deviceId)
    .maybeSingle();

  let migrated = false;
  if (existing) {
    const fromId = existing.id as string;
    // 1. Repoint every owned table to the claiming device.
    for (const table of TABLES_OWNED_BY_USER) {
      await supabase
        .from(table)
        .update({ user_id: deviceId })
        .eq("user_id", fromId);
    }
    // 2. Repoint attachments (lives behind transactions.user_id, but
    //    its own row has no user_id, so we have to look via tx. The
    //    transaction UPDATE above already moved the tx rows; the
    //    attachments follow via FK. Nothing to do for the table itself.)
    // 3. Delete the now-orphaned old user row.
    await supabase.from("users").delete().eq("id", fromId);
    migrated = true;
  }

  // Upsert our device user with the verified email.
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
