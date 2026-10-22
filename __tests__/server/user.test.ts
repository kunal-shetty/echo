import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeCookies, fakeSupabase } from "../helpers/fake-supabase";

const SESSION = "11111111-1111-4111-8111-111111111111";
const VICTIM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

let cookieJar = fakeCookies();
let db = fakeSupabase();
const setSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    ...cookieJar.store,
    set: (...args: Parameters<typeof cookieJar.store.set>) => {
      setSpy(...args);
      cookieJar.store.set(...args);
    },
  })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

vi.mock("@/lib/server/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => db.client,
}));

const {
  getCurrentUserId,
  getSessionUser,
  requireUserId,
  startSession,
} = await import("@/lib/server/user");
const { resetRateLimits } = await import("@/lib/server/rate-limit");

describe("session identity", () => {
  beforeEach(() => {
    cookieJar = fakeCookies();
    db = fakeSupabase();
    setSpy.mockClear();
    resetRateLimits();
  });

  it("returns no user when there is no session cookie", async () => {
    expect(await getCurrentUserId()).toBeNull();
    expect(db.queries).toHaveLength(0);
  });

  it("never trusts a client-supplied echo_guest_id cookie", async () => {
    cookieJar = fakeCookies({ echo_guest_id: VICTIM });
    expect(await getCurrentUserId()).toBeNull();
    expect(db.queries).toHaveLength(0);
  });

  it("rejects a malformed session cookie without querying the database", async () => {
    cookieJar = fakeCookies({ echo_session: "x' or 1=1 --" });
    expect(await getSessionUser()).toBeNull();
    expect(db.queries).toHaveLength(0);
  });

  it("only accepts unexpired sessions", async () => {
    cookieJar = fakeCookies({ echo_session: SESSION });
    db = fakeSupabase({ sessions: [{ data: null }] });
    expect(await getSessionUser()).toBeNull();
    const [q] = db.on("sessions");
    expect(q.ops.some(([m, a]) => m === "gt" && a[0] === "expires_at")).toBe(true);
  });

  it("resolves the user behind a valid session", async () => {
    cookieJar = fakeCookies({ echo_session: SESSION });
    db = fakeSupabase({
      sessions: [
        { data: { user_id: USER, users: { email_verified_at: "2026-01-01T00:00:00Z" } } },
      ],
    });
    expect(await getSessionUser()).toEqual({
      userId: USER,
      sessionId: SESSION,
      verified: true,
    });
  });

  it("creates a guest account and session on first write", async () => {
    const userId = await requireUserId();
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.called("users", "insert", { id: userId })).toBe(true);
    expect(db.rpcCalls).toContainEqual(["ensure_default_account", { uid: userId }]);
    expect(db.on("sessions").some((q) => q.ops.some(([m]) => m === "insert"))).toBe(true);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const [name, , opts] = setSpy.mock.calls[0];
    expect(name).toBe("echo_session");
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("limits how many guests one IP can create", async () => {
    for (let i = 0; i < 20; i++) {
      cookieJar = fakeCookies();
      await requireUserId();
    }
    cookieJar = fakeCookies();
    await expect(requireUserId()).rejects.toMatchObject({ status: 429 });
  });

  it("rotates the session id when starting a new session", async () => {
    cookieJar = fakeCookies({ echo_session: SESSION });
    await startSession(USER, true);
    expect(db.called("sessions", "delete")).toBe(true);
    expect(db.called("sessions", "eq", "id", SESSION)).toBe(true);
    expect(cookieJar.jar.echo_session).not.toBe(SESSION);
  });
});
