import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/insights/generate/route';

// Create a mock client object that we can easily control
const mockSupabaseClient = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn(),
  delete: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock('@/lib/server/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabaseClient),
}));

vi.mock('@/lib/server/user', () => ({
  getDeviceUserId: vi.fn(() => Promise.resolve('user-123')),
  getCurrentUserId: vi.fn(() => Promise.resolve('user-123')),
}));

vi.mock('@/lib/server/categories', () => ({
  listSystemCategories: vi.fn(() => Promise.resolve([
    { id: 'cat-1', name: 'Food' },
    { id: 'cat-2', name: 'Housing' },
  ])),
}));

vi.mock('@/lib/fmt', () => ({
  money: vi.fn((val) => `$${(val / 100).toFixed(2)}`),
}));

vi.mock('@/lib/groq', () => ({
  generateSmartInsights: vi.fn(),
}));

describe('POST /api/insights/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });


  it('should return 400 if no device identity', async () => {
    const { getCurrentUserId } = await import('@/lib/server/user');
    (getCurrentUserId as any).mockResolvedValueOnce(null);


    const res = await POST(new Request('http://localhost/api/insights/generate', { method: 'POST' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('No device identity.');
  });

  it('should generate anomaly, habit, and loyalty insights', async () => {
    const { generateSmartInsights } = await import('@/lib/groq');
    (generateSmartInsights as any).mockResolvedValue([
      { kind: 'anomaly', payload: { title: 'Biggest Memory', hero_metric: '$50.00' } },
      { kind: 'spend_pattern', payload: { text: 'Your spending on Housing is high', hero_metric: '$50.00' } },
      { kind: 'trend', payload: { text: 'You visited Coffee Shop 2 times', hero_metric: '2x' } },
    ]);

    const mockTxs = [
      { amount_minor: 1000, merchant_raw: 'Coffee', category_id: 'cat-1', merchant_canonical: 'Coffee Shop' },
      { amount_minor: 5000, merchant_raw: 'Rent', category_id: 'cat-2', merchant_canonical: 'Landlord' },
      { amount_minor: 1000, merchant_raw: 'Lunch', category_id: 'cat-1', merchant_canonical: 'Coffee Shop' },
    ];


    mockSupabaseClient.is.mockResolvedValue({ data: mockTxs, error: null });

    const res = await POST(new Request('http://localhost/api/insights/generate', { method: 'POST' }));
    const data = await res.json();

    if (res.status !== 200) {
      console.error('Error Response:', data);
    }
    expect(res.status).toBe(200);
    expect(data.insights).toBeDefined();
    expect(data.insights).toHaveLength(3);

    // Anomaly: Biggest spend
    const anomaly = data.insights.find((i: any) => i.kind === 'anomaly');
    expect(anomaly.payload.title).toBe('Biggest Memory');
    expect(anomaly.payload.hero_metric).toBe('$50.00');

    // Habit: Top category (cat-2 has 5000 total)
    const habit = data.insights.find((i: any) => i.kind === 'spend_pattern');
    expect(habit.payload.text).toContain('Housing');
    expect(habit.payload.hero_metric).toBe('$50.00');

    // Loyalty: Most visited merchant (Coffee Shop has 2)
    const loyalty = data.insights.find((i: any) => i.kind === 'trend');
    expect(loyalty.payload.text).toContain('Coffee Shop 2 times');
    expect(loyalty.payload.hero_metric).toBe('2x');

    // Verify DB cleanup and insert
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('insights');
    expect(mockSupabaseClient.delete).toHaveBeenCalled();
    expect(mockSupabaseClient.insert).toHaveBeenCalled();
  });

  it('should return message if no transactions are found', async () => {
    mockSupabaseClient.is.mockResolvedValue({ data: [], error: null });

    const res = await POST(new Request('http://localhost/api/insights/generate', { method: 'POST' }));
    const data = await res.json();

    if (res.status !== 200) {
      console.error('Error Response:', data);
    }
    expect(res.status).toBe(200);
    expect(data.message).toBe('No transactions found to analyze.');
  });
});
