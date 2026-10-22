import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSupabase } from '../helpers/fake-supabase';

const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let db = fakeSupabase();

vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdmin: vi.fn(() => db.client),
}));

vi.mock('@/lib/server/user', () => ({
  getSessionUser: vi.fn(),
  startSession: vi.fn(),
  ensureDefaultAccount: vi.fn(),
  toPublicUser: vi.fn((row) => ({ id: row.id, email: row.email })),
}));

vi.mock('@/lib/server/otp', () => ({
  findActiveOtp: vi.fn(),
  verifyCodeHash: vi.fn(),
  consumeOtp: vi.fn(),
  bumpOtpAttempts: vi.fn(),
  MAX_ATTEMPTS: 5,
}));

const { POST } = await import('@/app/api/auth/verify/route');
const otp = await import('@/lib/server/otp');
const user = await import('@/lib/server/user');
const { resetRateLimits } = await import('@/lib/server/rate-limit');

function verify(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

/** Arranges a valid, unconsumed code on its first attempt. */
function validCode() {
  vi.mocked(otp.findActiveOtp).mockResolvedValue({ id: 'otp-1', code_hash: 'h' } as never);
  vi.mocked(otp.bumpOtpAttempts).mockResolvedValue(1);
  vi.mocked(otp.verifyCodeHash).mockReturnValue(true);
  vi.mocked(otp.consumeOtp).mockResolvedValue(true);
}

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    db = fakeSupabase();
  });

  it('returns 400 if email or code is missing', async () => {
    const res = await verify({ email: 'test@example.com' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Email and code are required.');
  });

  it('rejects malformed codes without touching the OTP record', async () => {
    const res = await verify({ email: 'test@example.com', code: 'abc' });
    expect(res.status).toBe(400);
    expect(otp.findActiveOtp).not.toHaveBeenCalled();
  });

  it('returns 400 if no active OTP is found', async () => {
    vi.mocked(otp.findActiveOtp).mockResolvedValue(null);
    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Code expired');
  });

  it('counts the attempt before checking the code', async () => {
    vi.mocked(otp.findActiveOtp).mockResolvedValue({ id: 'otp-1', code_hash: 'h' } as never);
    vi.mocked(otp.bumpOtpAttempts).mockResolvedValue(1);
    vi.mocked(otp.verifyCodeHash).mockReturnValue(false);

    const res = await verify({ email: 'test@example.com', code: '000000' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Wrong code.');
    expect(otp.bumpOtpAttempts).toHaveBeenCalledWith('otp-1');
    expect(user.startSession).not.toHaveBeenCalled();
  });

  it('locks the code after too many attempts, even with the right code', async () => {
    vi.mocked(otp.findActiveOtp).mockResolvedValue({ id: 'otp-1', code_hash: 'h' } as never);
    vi.mocked(otp.bumpOtpAttempts).mockResolvedValue(6);
    vi.mocked(otp.verifyCodeHash).mockReturnValue(true);

    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(429);
    expect(otp.verifyCodeHash).not.toHaveBeenCalled();
    expect(user.startSession).not.toHaveBeenCalled();
  });

  it('refuses a code that was consumed concurrently', async () => {
    validCode();
    vi.mocked(otp.consumeOtp).mockResolvedValue(false);
    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(400);
    expect(user.startSession).not.toHaveBeenCalled();
  });

  it('lets a guest claim an unused email and signs them in', async () => {
    validCode();
    vi.mocked(user.getSessionUser).mockResolvedValue({ userId: GUEST, sessionId: 's', verified: false });
    db = fakeSupabase({
      users: [
        { data: null }, // no owner for this email
        { data: null, error: null }, // update guest row
        { data: { id: GUEST, email: 'test@example.com' } }, // final read
      ],
    });

    const res = await verify({ email: 'test@example.com', code: '123456' });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ verified: true, migrated: false });
    expect(db.rpcCalls).toEqual([]);
    expect(user.startSession).toHaveBeenCalledWith(GUEST, true);
  });

  it("merges a guest's own data into the account that owns the email", async () => {
    validCode();
    vi.mocked(user.getSessionUser).mockResolvedValue({ userId: GUEST, sessionId: 's', verified: false });
    db = fakeSupabase({
      users: [
        { data: { id: OWNER, email_verified_at: '2026-01-01T00:00:00Z' } },
        { data: { id: OWNER, email: 'test@example.com' } },
      ],
    });

    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(200);
    expect((await res.json()).migrated).toBe(true);
    // Data flows guest → owner, never the other way.
    expect(db.rpcCalls).toEqual([['merge_user_data', { from_uid: GUEST, to_uid: OWNER }]]);
    expect(user.startSession).toHaveBeenCalledWith(OWNER, true);
    // The owner's account is never deleted or repointed.
    expect(db.called('users', 'delete')).toBe(false);
  });

  it('does not merge one verified account into another', async () => {
    validCode();
    vi.mocked(user.getSessionUser).mockResolvedValue({ userId: OTHER, sessionId: 's', verified: true });
    db = fakeSupabase({
      users: [
        { data: { id: OWNER, email_verified_at: '2026-01-01T00:00:00Z' } },
        { data: { id: OWNER, email: 'test@example.com' } },
      ],
    });

    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(200);
    expect((await res.json()).migrated).toBe(false);
    expect(db.rpcCalls).toEqual([]);
    expect(user.startSession).toHaveBeenCalledWith(OWNER, true);
  });

  it('creates a fresh account when there is no session and no owner', async () => {
    validCode();
    vi.mocked(user.getSessionUser).mockResolvedValue(null);
    db = fakeSupabase({
      users: [{ data: null }, { data: null, error: null }, { data: { id: 'new', email: 'test@example.com' } }],
    });

    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(200);
    expect(user.ensureDefaultAccount).toHaveBeenCalled();
    const newId = vi.mocked(user.startSession).mock.calls[0][0];
    expect(newId).not.toBe(GUEST);
    expect(db.called('users', 'insert')).toBe(true);
  });

  it('does not leak database errors', async () => {
    validCode();
    vi.mocked(user.getSessionUser).mockResolvedValue(null);
    db = fakeSupabase({ users: [{ error: { message: 'relation "users" secret detail' } }] });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await verify({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});
