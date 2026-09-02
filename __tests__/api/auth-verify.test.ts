import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/auth/verify/route';

vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
      update: vi.fn().mockResolvedValue({}),
      eq: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockReturnValue({
        select: () => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'device-123', email: 'test@example.com' }, error: null }),
        }),
      }),
    }),
  })),
}));

vi.mock('@/lib/server/user', () => ({
  getDeviceUserId: vi.fn(() => Promise.resolve('device-123')),
}));

vi.mock('@/lib/server/otp', () => ({
  findActiveOtp: vi.fn(),
  verifyCodeHash: vi.fn(),
  consumeOtp: vi.fn(),
  bumpOtpAttempts: vi.fn(),
  MAX_ATTEMPTS: 5,
}));

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if email or code is missing', async () => {
    const req = new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }), // missing code
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Email and code are required.');
  });

  it('should return 400 if no active OTP is found', async () => {
    const { findActiveOtp } = await import('@/lib/server/otp');
    (findActiveOtp as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: '123456' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Code expired');
  });

  it('should return 400 if the code is wrong', async () => {
    const { findActiveOtp, verifyCodeHash, bumpOtpAttempts } = await import('@/lib/server/otp');
    (findActiveOtp as any).mockResolvedValue({ id: 'otp-123', attempts: 0, code_hash: 'hash' });
    (verifyCodeHash as any).mockReturnValue(false);

    const req = new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: 'wrong' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Wrong code.');
    expect(bumpOtpAttempts).toHaveBeenCalledWith('otp-123');
  });

  it('should verify successfully and return verified: true', async () => {
    const { findActiveOtp, verifyCodeHash, consumeOtp } = await import('@/lib/server/otp');
    (findActiveOtp as any).mockResolvedValue({ id: 'otp-123', attempts: 0, code_hash: 'hash' });
    (verifyCodeHash as any).mockReturnValue(true);
    (consumeOtp as any).mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: '123456' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.verified).toBe(true);
    expect(consumeOtp).toHaveBeenCalledWith('otp-123');
  });

  it('should migrate data if the email is linked to a different device', async () => {
    const { findActiveOtp, verifyCodeHash, consumeOtp } = await import('@/lib/server/otp');
    (findActiveOtp as any).mockResolvedValue({ id: 'otp-123', attempts: 0, code_hash: 'hash' });
    (verifyCodeHash as any).mockReturnValue(true);
    (consumeOtp as any).mockResolvedValue(undefined);

    // Mock Supabase to find an existing user on another device
    const { getSupabaseAdmin } = await import('@/lib/server/supabase');
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockImplementation(function(col, val) {
        if (col === 'id') {
          return {
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'old-device-id' } }),
          };
        }
        return this;
      }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnValue({
        select: () => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'device-123', email: 'test@example.com' }, error: null }),
        }),
      }),
    };
    (getSupabaseAdmin as any).mockReturnValue(mockSupabase);

    const req = new Request('http://localhost/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: '123456' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.migrated).toBe(true);

    // Verify migration of tables
    const tablesToMigrate = [
      "accounts", "merchant_aliases", "transactions", "attachments",
      "recurring_rules", "budgets", "voice_sessions", "insights"
    ];
    tablesToMigrate.forEach(table => {
      expect(mockSupabase.from).toHaveBeenCalledWith(table);
      expect(mockSupabase.update).toHaveBeenCalledWith({ user_id: 'device-123' });
    });

    // Verify orphaned user record is deleted
    expect(mockSupabase.from).toHaveBeenCalledWith("users");
    expect(mockSupabase.delete).toHaveBeenCalled();
  });
});
