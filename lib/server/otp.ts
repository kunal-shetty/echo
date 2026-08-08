import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

// 6-digit OTP flow.
//   - /api/auth/start  → generate code, store hash, send via Resend
//   - /api/auth/verify → check code, mark user.email_verified_at, migrate
//
// We hash the code with a server-side pepper before storing so a DB
// leak alone isn't enough to brute-force codes.

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PEPPER = process.env.OTP_PEPPER ?? "echo-default-pepper-change-me";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export function generateCode(): string {
  // 6-digit zero-padded code
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(`${PEPPER}:${code}`).digest("hex");
}

export function verifyCodeHash(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashCode(code));
  const expected = Buffer.from(hash);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export type OtpRow = {
  id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
  created_at: string;
};

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

export async function consumeOtp(id: string): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  await supabase
    .from("email_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);
}

export async function bumpOtpAttempts(id: string): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/server/supabase");
  const supabase = getSupabaseAdmin();
  await supabase.rpc("increment_otp_attempts", { otp_id: id }).then(() => {
    // RPC may not exist; fall back to read-modify-write
  });
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
