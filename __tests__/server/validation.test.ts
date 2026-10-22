import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
  isSupabaseConfigured: () => true,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const { validateTransactionInput, parseAmount } = await import(
  "@/lib/server/transaction-input"
);
const { sanitizeFilterText } = await import("@/lib/server/queries");
const { takeToken, resetRateLimits } = await import("@/lib/server/rate-limit");

const CAT = "44444444-4444-4444-8444-444444444444";
const ctx = {
  accountId: "acct-own",
  homeCurrency: "INR",
  categoryIds: new Set([CAT]),
  categoryIdByName: new Map([["food", CAT]]),
};
const opts = { allowedSources: ["manual", "voice"] as const, defaultSource: "manual" as const };

describe("validateTransactionInput", () => {
  it("always uses the server-resolved account, ignoring the client's", () => {
    const r = validateTransactionInput(
      { amount_minor: 100, merchant_raw: "Cafe", account_id: "someone-elses" },
      ctx,
      opts,
    );
    expect(r.ok && r.row.account_id).toBe("acct-own");
  });

  it("rejects categories the user can't see", () => {
    const r = validateTransactionInput(
      { amount_minor: 100, merchant_raw: "Cafe", category_id: "not-mine" },
      ctx,
      opts,
    );
    expect(r).toEqual({ ok: false, error: "Unknown category" });
  });

  it("resolves a category by name", () => {
    const r = validateTransactionInput(
      { amount_minor: 100, merchant_raw: "Cafe", category_name: " Food " },
      ctx,
      opts,
    );
    expect(r.ok && r.row.category_id).toBe(CAT);
  });

  it("coerces disallowed sources and drops voice-only fields from manual rows", () => {
    const r = validateTransactionInput(
      {
        amount_minor: 100,
        merchant_raw: "Cafe",
        source: "recurring",
        confidence: 0.9,
        raw_transcript: "x",
      },
      ctx,
      opts,
    );
    expect(r.ok && r.row).toMatchObject({
      source: "manual",
      confidence: null,
      raw_transcript: null,
    });
  });

  it("normalizes currency, direction, and length limits", () => {
    const r = validateTransactionInput(
      {
        amount_minor: 100,
        merchant_raw: "M".repeat(500),
        currency: "usd",
        direction: "sideways",
        note: "n".repeat(900),
      },
      ctx,
      opts,
    );
    expect(r.ok && r.row).toMatchObject({ currency: "USD", direction: "expense" });
    expect(r.ok && r.row.merchant_raw.length).toBe(200);
    expect(r.ok && r.row.note?.length).toBe(500);
  });

  it("rejects bad amounts and missing merchants", () => {
    expect(validateTransactionInput({ amount_minor: 0, merchant_raw: "x" }, ctx, opts).ok).toBe(false);
    expect(validateTransactionInput({ amount_minor: "100", merchant_raw: "x" }, ctx, opts).ok).toBe(false);
    expect(validateTransactionInput({ amount_minor: 10, merchant_raw: "  " }, ctx, opts).ok).toBe(false);
  });
});

describe("parseAmount", () => {
  it("accepts positive finite amounts and rounds to whole units", () => {
    expect(parseAmount(12.5)).toBe(13);
    expect(parseAmount(150)).toBe(150);
    expect(parseAmount(-1)).toBeNull();
    expect(parseAmount(Infinity)).toBeNull();
    expect(parseAmount(0.2)).toBeNull();
    expect(parseAmount(1e15)).toBeNull();
  });
});

describe("sanitizeFilterText", () => {
  it("removes characters that could break out of a quoted PostgREST value", () => {
    const out = sanitizeFilterText('x",user_id.neq.0,"%_*\\');
    expect(out).not.toMatch(/["\\%_*]/);
  });

  it("keeps ordinary merchant names intact", () => {
    expect(sanitizeFilterText("Amazon.in")).toBe("Amazon.in");
    expect(sanitizeFilterText("  Tim  Hortons ")).toBe("Tim Hortons");
  });
});

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit within a window, then blocks", () => {
    for (let i = 0; i < 3; i++) expect(takeToken("k", 3, 60_000)).toBe(true);
    expect(takeToken("k", 3, 60_000)).toBe(false);
    expect(takeToken("other", 3, 60_000)).toBe(true);
  });
});
