import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/transactions/route';

// Mock the server-side modules
vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'default-account-id' } }),
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('@/lib/server/transactions', () => ({
  createTransaction: vi.fn(),
  listTransactions: vi.fn(),
}));

vi.mock('@/lib/server/categories', () => ({
  listSystemCategories: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/server/user', () => ({
  getDeviceUserId: vi.fn(() => Promise.resolve('test-user-id')),
}));

vi.mock('@/lib/transaction-shape', () => ({
  toUiTransaction: vi.fn((row) => ({ ...row, ui: true })),
  indexCategories: vi.fn(() => ({})),
}));

describe('POST /api/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 503 if supabase is not configured', async () => {
    const { isSupabaseConfigured } = await import('@/lib/server/supabase');
    (isSupabaseConfigured as any).mockReturnValueOnce(false);

    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ amount_minor: 100, merchant_raw: 'Coffee' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe('Backend not configured.');
  });

  it('should return 400 if amount is <= 0', async () => {
    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ amount_minor: 0, merchant_raw: 'Coffee' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Amount must be > 0');
  });

  it('should return 400 if merchant is missing', async () => {
    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ amount_minor: 100, merchant_raw: '' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Merchant is required');
  });

  it('should create a transaction with a provided account_id', async () => {
    const { createTransaction } = await import('@/lib/server/transactions');
    (createTransaction as any).mockResolvedValue({ id: 'tx-123', amount_minor: 100 });

    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount_minor: 100,
        merchant_raw: 'Coffee',
        account_id: 'custom-account-id'
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'custom-account-id',
      amount_minor: 100,
      merchant_raw: 'Coffee',
    }));
    expect(data.transaction).toBeDefined();
  });

  it('should correctly format currency and direction', async () => {
    const { createTransaction } = await import('@/lib/server/transactions');
    (createTransaction as any).mockResolvedValue({ id: 'tx-123', amount_minor: 100 });

    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount_minor: 100,
        merchant_raw: 'Coffee',
        currency: 'usd',
        direction: 'income',
      }),
    });

    await POST(req);

    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'USD',
      direction: 'income',
    }));
  });

  it('should resolve to default account if no account_id is provided', async () => {
    const { createTransaction } = await import('@/lib/server/transactions');
    (createTransaction as any).mockResolvedValue({ id: 'tx-123', amount_minor: 100 });

    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount_minor: 100,
        merchant_raw: 'Coffee',
      }),
    });

    const res = await POST(req);
    await res.json();

    expect(res.status).toBe(200);
    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'default-account-id',
    }));
  });

  it('should return 400 if no device identity is found', async () => {
    const { getDeviceUserId } = await import('@/lib/server/user');
    (getDeviceUserId as any).mockResolvedValueOnce(null);

    const req = new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount_minor: 100,
        merchant_raw: 'Coffee',
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('No device identity.');
  });
});
