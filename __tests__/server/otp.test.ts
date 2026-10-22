import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeSupabase } from "../helpers/fake-supabase";

let db = fakeSupabase();

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseAdmin: () => db.client,
}));

const { bumpOtpAttempts, consumeOtp, hashCode, verifyCodeHash } = await import(
  "@/lib/server/otp"
);

describe("OTP helpers", () => {
  beforeEach(() => {
    db = fakeSupabase();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("increments attempts atomically via RPC and returns the new count", async () => {
    db = fakeSupabase({}, { increment_otp_attempts: [{ data: 3 }] });
    expect(await bumpOtpAttempts("otp-1")).toBe(3);
    expect(db.rpcCalls).toEqual([["increment_otp_attempts", { otp_id: "otp-1" }]]);
    // No racy read-modify-write fallback.
    expect(db.queries).toHaveLength(0);
  });

  it("throws if the attempt counter can't be incremented", async () => {
    db = fakeSupabase({}, { increment_otp_attempts: [{ error: { message: "boom" } }] });
    await expect(bumpOtpAttempts("otp-1")).rejects.toBeTruthy();
  });

  it("fails closed when the RPC returns no count", async () => {
    db = fakeSupabase({}, { increment_otp_attempts: [{ data: null }] });
    expect(await bumpOtpAttempts("otp-1")).toBe(Number.POSITIVE_INFINITY);
  });

  it("lets only one caller consume a code", async () => {
    db = fakeSupabase({ email_otps: [{ data: [{ id: "otp-1" }] }, { data: [] }] });
    expect(await consumeOtp("otp-1")).toBe(true);
    expect(await consumeOtp("otp-1")).toBe(false);
    expect(db.called("email_otps", "is", "consumed_at", null)).toBe(true);
  });

  it("verifies codes against their hash", () => {
    const hash = hashCode("123456");
    expect(verifyCodeHash("123456", hash)).toBe(true);
    expect(verifyCodeHash("654321", hash)).toBe(false);
  });

  it("refuses to hash without OTP_PEPPER in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "");
    expect(() => hashCode("123456")).toThrow(/OTP_PEPPER/);
  });
});
