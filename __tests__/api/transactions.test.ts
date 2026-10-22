import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAT = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/server/transactions', () => ({
  createTransaction: vi.fn(async (_userId, row) => ({ id: 'tx-1', ...row })),
  listTransactions: vi.fn(async () => []),
}));

vi.mock('@/lib/server/categories', () => ({
  listCategoriesForUser: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/server/user', () => ({
  requireUserId: vi.fn(() => Promise.resolve('test-user-id')),
  getCurrentUserId: vi.fn(() => Promise.resolve('test-user-id')),
}));

vi.mock('@/lib/server/transaction-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/transaction-input')>()),
  loadTxContext: vi.fn(async () => ({
    accountId: 'own-default-account',
    homeCurrency: 'INR',
    categoryIds: new Set([CAT]),
    categoryIdByName: new Map([['food', CAT]]),
  })),
}));

vi.mock('@/lib/transaction-shape', () => ({
  toUiTransaction: vi.fn((row) => ({ ...row, ui: true })),
  indexCategories: vi.fn(() => ({})),
}));

const { GET, POST } = await import('@/app/api/transactions/route');
const { isSupabaseConfigured } = await import('@/lib/server/supabase');
const { createTransaction, listTransactions } = await import('@/lib/server/transactions');
const { getCurrentUserId, requireUserId } = await import('@/lib/server/user');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 503 if supabase is not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    const res = await post({ amount_minor: 100, merchant_raw: 'Coffee' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Backend not configured.');
  });

  it('should return 400 if amount is <= 0', async () => {
    const res = await post({ amount_minor: 0, merchant_raw: 'Coffee' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Amount must be > 0');
  });

  it('should return 400 if merchant is missing', async () => {
    const res = await post({ amount_minor: 100 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Merchant is required');
  });

  it("ignores a client-supplied account_id and uses the user's own default", async () => {
    const res = await post({
      amount_minor: 100,
      merchant_raw: 'Coffee',
      account_id: 'someone-elses-account',
    });
    expect(res.status).toBe(200);
    expect(createTransaction).toHaveBeenCalledWith(
      'test-user-id',
      expect.objectContaining({ account_id: 'own-default-account' }),
    );
  });

  it('rejects a category the user does not own', async () => {
    const res = await post({ amount_minor: 100, merchant_raw: 'Coffee', category_id: 'foreign' });
    expect(res.status).toBe(400);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('should normalize currency, direction and source', async () => {
    await post({
      amount_minor: 500,
      merchant_raw: 'Salary',
      currency: 'usd',
      direction: 'income',
      source: 'recurring',
      category_id: CAT,
    });
    expect(createTransaction).toHaveBeenCalledWith(
      'test-user-id',
      expect.objectContaining({
        currency: 'USD',
        direction: 'income',
        source: 'manual',
        category_id: CAT,
      }),
    );
  });

  it('creates a guest identity on first write', async () => {
    await post({ amount_minor: 100, merchant_raw: 'Coffee' });
    expect(requireUserId).toHaveBeenCalled();
  });
});

describe('GET /api/transactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty list without a session and never creates one', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValueOnce(null);
    const res = await GET();
    expect(await res.json()).toEqual({ transactions: [], configured: true });
    expect(listTransactions).not.toHaveBeenCalled();
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("lists only the session user's transactions", async () => {
    await GET();
    expect(listTransactions).toHaveBeenCalledWith('test-user-id', 500);
  });
});
