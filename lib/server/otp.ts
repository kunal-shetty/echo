/**
 * @file otp.ts
 * @description Implements the 6-digit One-Time Password (OTP) flow for email verification.
 * Handles generation, hashing (with server-side pepper), storage, and verification.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

/** Duration before an OTP expires. */
const CODE_TTL_MS = 10 * 60 * 1000;
/** Maximum allowed failed attempts per OTP before expiration. */
const MAX_ATTEMPTS = 5;
/** Secret pepper used for hashing OTPs to prevent DB-leak brute-forcing. */
const PEPPER = process.env.OTP_PEPPER ?? "echo-default-pepper-change-me";

/** Checks if Resend API keys are configured in environment. */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/** Generates a random 6-digit zero-padded numeric code. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Hashes a raw code using SHA-256 and the server pepper. */
export function hashCode(code: string): string {
  return createHash("sha256").update(`${PEPPER}:${code}`).digest("hex");
}

/** Verifies a raw code against a stored hash using timing-safe comparison. */
export function verifyCodeHash(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashCode(code));
  const expected = Buffer.from(hash);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Database representation of an OTP record. */
export type OtpRow = {
  id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
  created_at: string;
};

/**
 * Stores a new OTP record in the database.
 * @param email User's email address.
 * @param code Raw numeric code.
 * @returns The created OTP record.
 */
export async function storeOtp(
  email: string,
  code: string,
): Promise<OtpRow> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("email_otps")
    .insert({
      email,
      code_hash: hashCode(code),
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as OtpRow;
}

/**
 * Finds the most recent active, non-expired OTP for a given email.
 * @param email User's email address.
 * @returns The active OTP record or null.
 */
export async function findActiveOtp(email: string): Promise<OtpRow | null> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as OtpRow | null;
}

/**
 * Marks an OTP as consumed to prevent reuse.
 * @param id The unique identifier of the OTP record.
 */
export async function consumeOtp(id: string): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  await supabase
    .from("email_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Increments the attempt counter for a specific OTP.
 * @param id The unique identifier of the OTP record.
 */
export async function bumpOtpAttempts(id: string): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  // Attempt to use a Postgres RPC for atomic increment.
  await supabase.rpc("increment_otp_attempts", { otp_id: id }).catch(() => {});

  // Fallback: Manual read-modify-write.
  const { data } = await supabase
    .from("email_otps")
    .select("attempts")
    .eq("id", id)
    .single();
  if (data) {
    await supabase
      .from("email_otps")
      .update({ attempts: (data as { attempts: number }).attempts + 1 })
      .eq("id", id);
  }
}

/**
 * Sends the OTP code to the user via the Resend email service.
 * @param email User's email address.
 * @param code Raw numeric code.
 * @returns The Resend message ID, or null if not configured.
 */
export async function sendOtpEmail(
  email: string,
  code: string,
): Promise<{ id: string } | null> {
  if (!isResendConfigured()) return null;
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const from = process.env.RESEND_FROM!;
  const result = await resend.emails.send({
    from,
    to: email,
    subject: "Your Echo verification code",
    text: `Your Echo code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Echo verification code is <strong style="font-size:20px;letter-spacing:4px">${code}</strong>.</p><p>It expires in 10 minutes. If you didn't request this, you can ignore the email.</p>`,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return { id: result.data?.id ?? "unknown" };
}

export { CODE_TTL_MS, MAX_ATTEMPTS };
