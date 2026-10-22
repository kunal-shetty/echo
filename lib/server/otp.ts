/**
 * @file otp.ts
 * @description Implements the 6-digit One-Time Password (OTP) flow for email verification.
 * Handles generation, hashing (with server-side pepper), storage, and verification.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

/** Duration before an OTP expires. */
const CODE_TTL_MS = 10 * 60 * 1000;
/** Maximum verification attempts per OTP before it is locked. */
const MAX_ATTEMPTS = 5;
/** Maximum codes that may be sent to one email address per hour. */
const MAX_SENDS_PER_HOUR = 5;

/**
 * Secret pepper used for hashing OTPs so a leaked table can't be
 * brute-forced offline. Required in production; a fixed value is only
 * tolerated in development and tests.
 */
function pepper(): string {
  const p = process.env.OTP_PEPPER;
  if (p) return p;
  if (process.env.NODE_ENV === "production") {
    throw new Error("OTP_PEPPER must be set in production.");
  }
  return "echo-dev-pepper";
}

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
  return createHash("sha256").update(`${pepper()}:${code}`).digest("hex");
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
 * Counts codes sent to `email` in the last hour, for send throttling.
 */
export async function countRecentOtps(email: string): Promise<number> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("email_otps")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

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
 * Marks an OTP as consumed so it can't be reused. Only the first caller
 * wins: concurrent verifications of the same code can't both succeed.
 * @param id The unique identifier of the OTP record.
 * @returns True if this call consumed the code.
 */
export async function consumeOtp(id: string): Promise<boolean> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("email_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Atomically increments the attempt counter for an OTP. Call this BEFORE
 * checking the code, so concurrent guesses are all counted.
 * @param id The unique identifier of the OTP record.
 * @returns The attempt count after this attempt.
 */
export async function bumpOtpAttempts(id: string): Promise<number> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("increment_otp_attempts", {
    otp_id: id,
  });
  if (error) throw error;
  // Fail closed: if the RPC returned nothing usable (e.g. null when the row
  // is gone), treat the code as exhausted.
  return typeof data === "number" && Number.isFinite(data)
    ? data
    : Number.POSITIVE_INFINITY;
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

export { CODE_TTL_MS, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR };
