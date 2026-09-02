import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/auth/start/route';

vi.mock('@/lib/server/user', () => ({
  getOrCreateUserRow: vi.fn(),
}));

vi.mock('@/lib/server/otp', () => ({
  generateCode: vi.fn(() => '123456'),
  isResendConfigured: vi.fn(),
  sendOtpEmail: vi.fn(),
  storeOtp: vi.fn(),
}));

describe('POST /api/auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if email is missing or invalid', async () => {
    const invalidEmails = ['', 'not-an-email', 'test@test'];

    for (const email of invalidEmails) {
      const req = new Request('http://localhost/api/auth/start', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Please enter a valid email address.');
    }
  });

  it('should return 503 if resend is not configured', async () => {
    const { isResendConfigured } = await import('@/lib/server/otp');
    (isResendConfigured as any).mockReturnValue(false);

    const req = new Request('http://localhost/api/auth/start', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe('resend_not_configured');
  });

  it('should send OTP and return 200 if everything is configured', async () => {
    const { isResendConfigured, sendOtpEmail, storeOtp } = await import('@/lib/server/otp');
    const { getOrCreateUserRow } = await import('@/lib/server/user');

    (isResendConfigured as any).mockReturnValue(true);
    (getOrCreateUserRow as any).mockResolvedValue({ id: 'user-123' });
    (sendOtpEmail as any).mockResolvedValue(undefined);
    (storeOtp as any).mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/auth/start', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sent).toBe(true);
    expect(data.userId).toBe('user-123');
    expect(storeOtp).toHaveBeenCalledWith('test@example.com', '123456');
    expect(sendOtpEmail).toHaveBeenCalledWith('test@example.com', '123456');
  });

  it('should return 502 if email sending fails', async () => {
    const { isResendConfigured, sendOtpEmail } = await import('@/lib/server/otp');
    (isResendConfigured as any).mockReturnValue(true);
    (sendOtpEmail as any).mockRejectedValue(new Error('API Error'));

    const req = new Request('http://localhost/api/auth/start', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toContain('Could not send email: API Error');
  });
});
