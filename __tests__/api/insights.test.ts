import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSupabase } from '../helpers/fake-supabase';

let db = fakeSupabase();

vi.mock('@/lib/server/supabase', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdmin: vi.fn(() => db.client),
}));

vi.mock('@/lib/server/user', () => ({
  getCurrentUserId: vi.fn(() => Promise.resolve('user-123')),
}));

vi.mock('@/lib/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/groq')>()),
  generateSmartInsights: vi.fn(),
}));

const { POST } = await import('@/app/api/insights/generate/route');
const groq = await import('@/lib/groq');
const { getCurrentUserId } = await import('@/lib/server/user');
const { resetRateLimits } = await import('@/lib/server/rate-limit');

const generate = () =>
  POST(new Request('http://localhost/api/insights/generate', { method: 'POST' }));

describe('POST /api/insights/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    db = fakeSupabase();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns a friendly message (not an error) without a session', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValueOnce(null);
    const res = await generate();
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe('No transactions found to analyze.');
    expect(groq.generateSmartInsights).not.toHaveBeenCalled();
  });

  it("generates and stores insights from the user's transactions", async () => {
    const insights = [
      { kind: 'anomaly', payload: { title: 'Biggest Memory', hero_metric: '₹50' } },
      { kind: 'trend', payload: { text: 'You visited Coffee Shop 2 times', hero_metric: '2x' } },
    ];
    vi.mocked(groq.generateSmartInsights).mockResolvedValue(insights);
    db = fakeSupabase({
      transactions: [{ data: [{ amount_minor: 1000, merchant_raw: 'Coffee' }] }],
    });

    const res = await generate();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.insights).toEqual(insights);
    expect(db.called('transactions', 'eq', 'user_id', 'user-123')).toBe(true);
    expect(db.called('transactions', 'limit')).toBe(true);
    expect(db.called('insights', 'delete')).toBe(true);
    expect(db.called('insights', 'insert')).toBe(true);
  });

  it('should return message if no transactions are found', async () => {
    db = fakeSupabase({ transactions: [{ data: [] }] });
    const res = await generate();
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe('No transactions found to analyze.');
  });

  it('is rate limited', async () => {
    db = fakeSupabase({ transactions: Array(10).fill({ data: [] }) });
    for (let i = 0; i < 5; i++) expect((await generate()).status).toBe(200);
    expect((await generate()).status).toBe(429);
  });
});

const { generateSmartInsights } =
  await vi.importActual<typeof import('@/lib/groq')>('@/lib/groq');

describe('generateSmartInsights', () => {
  afterEach(() => vi.unstubAllGlobals());

  function groqReplies(content: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 'cmpl-1', choices: [{ message: { content } }] })),
      ),
    );
  }

  it('reads insights from the model message, not the HTTP envelope', async () => {
    groqReplies(
      JSON.stringify({
        insights: [{ kind: 'anomaly', title: 'Spike', text: 'Food doubled', hero_metric: '₹2,000' }],
      }),
    );
    const out = await generateSmartInsights([], 'key');
    expect(out).toEqual([
      {
        kind: 'anomaly',
        payload: { title: 'Spike', text: 'Food doubled', hero_metric: '₹2,000', cta: 'View details' },
      },
    ]);
  });

  it('maps unknown kinds onto a valid enum value', async () => {
    groqReplies(JSON.stringify([{ kind: 'loyalty', title: 'x' }]));
    const [first] = await generateSmartInsights([], 'key');
    expect(first.kind).toBe('trend');
  });

  it('returns nothing for unparseable model output', async () => {
    groqReplies('not json at all');
    expect(await generateSmartInsights([], 'key')).toEqual([]);
  });
});
