import { test, expect } from '@playwright/test';

// These checks run against the real server and need no database: every
// request below must be rejected (or answered empty) before any query runs.

test.describe('Identity hardening', () => {
  for (const path of ['/api/auth/login', '/api/admin/setup-schema', '/api/auth/callback']) {
    test(`removed endpoint ${path} is gone`, async ({ request }) => {
      const res = await request.post(path, { data: { email: 'victim@example.com' } });
      expect(res.status()).toBe(404);
    });
  }

  test('a spoofed echo_guest_id cookie grants no identity', async ({ request }) => {
    const victim = '22222222-2222-4222-8222-222222222222';
    const headers = { cookie: `echo_guest_id=${victim}` };

    const me = await request.get('/api/me', { headers });
    expect(await me.json()).toMatchObject({ authenticated: false, user: null });

    const txs = await request.get('/api/transactions', { headers });
    expect((await txs.json()).transactions).toEqual([]);
  });

  test('a forged session cookie grants no identity', async ({ request }) => {
    const me = await request.get('/api/me', {
      headers: { cookie: 'echo_session=not-a-real-session' },
    });
    expect(await me.json()).toMatchObject({ authenticated: false, user: null });
  });

  test('logout without a session is harmless', async ({ request }) => {
    const res = await request.post('/api/auth/logout');
    expect(res.status()).toBe(200);
  });
});
