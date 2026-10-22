import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/server/otp', () => ({
  countRecentOtps: vi.fn(async () => 0),
  generateCode: vi.fn(() => '123456'),
  isResendConfigured: vi.fn(() => true),
  sendOtpEmail: vi.fn(),
  storeOtp: vi.fn(),
  MAX_SENDS_PER_HOUR: 5,
}));

const { POST } = await import('@/app/api/auth/start/route');
const otp = await import('@/lib/server/otp');
const { resetRateLimits } = await import('@/lib/server/rate-limit');

function start(email: unknown, ip = '198.51.100.1') {
  return POST(
    new Request('http://localhost/api/auth/start', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
      body: JSON.stringify({ email }),
    }),
  );
}

describe('POST /api/auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    vi.mocked(otp.isResendConfigured).mockReturnValue(true);
    vi.mocked(otp.countRecentOtps).mockResolvedValue(0);
  });

  it('should return 400 if email is missing or invalid', async () => {
    for (const email of ['', 'not-an-email', 'test@test', 42]) {
      const res = await start(email);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Please enter a valid email address.');
    }
  });

  it('should return 503 if resend is not configured', async () => {
    vi.mocked(otp.isResendConfigured).mockReturnValue(false);
    const res = await start('test@example.com');
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('resend_not_configured');
  });

  it('should send OTP and return 200 without exposing any user id', async () => {
    const res = await start('Test@Example.com ');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ sent: true });
    expect(otp.storeOtp).toHaveBeenCalledWith('test@example.com', '123456');
    expect(otp.sendOtpEmail).toHaveBeenCalledWith('test@example.com', '123456');
  });

  it('throttles codes per email address', async () => {
    vi.mocked(otp.countRecentOtps).mockResolvedValue(5);
    const res = await start('test@example.com');
    expect(res.status).toBe(429);
    expect(otp.storeOtp).not.toHaveBeenCalled();
    expect(otp.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('rate limits requests per IP', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await start(`user${i}@example.com`)).status).toBe(200);
    }
    expect((await start('another@example.com')).status).toBe(429);
    expect((await start('another@example.com', '198.51.100.2')).status).toBe(200);
  });

  it('should return a generic 500 if email sending fails', async () => {
    vi.mocked(otp.sendOtpEmail).mockRejectedValueOnce(new Error('Resend API key invalid: re_123'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await start('test@example.com');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('re_123');
  });
});
