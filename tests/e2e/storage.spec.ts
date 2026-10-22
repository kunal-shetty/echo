import { test, expect } from '@playwright/test';

const LEGACY_KEY = 'echo-tx-local-v1';

test.describe('Legacy local-storage migration', () => {
  test('uploads transactions left by older versions, then clears them', async ({ page }) => {
    const legacy = [
      {
        id: 'local-1',
        userId: 'guest',
        amountMinor: 120,
        currency: 'INR',
        direction: 'expense',
        merchantRaw: 'Chai Point',
        transactedAt: '2026-09-01T08:00:00.000Z',
        source: 'voice',
      },
    ];

    await page.addInitScript(
      ([key, rows]) => {
        // Only seed on the first navigation so we can observe the clear.
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('echo-onboarded-v1', 'true');
          localStorage.setItem(key as string, JSON.stringify(rows));
        }
      },
      [LEGACY_KEY, legacy],
    );

    let migrated: unknown = null;
    await page.route('**/api/transactions/migrate', async (route) => {
      migrated = route.request().postDataJSON();
      await route.fulfill({ json: { success: true, inserted: 1, failures: [] } });
    });
    await page.route('**/api/transactions', (route) =>
      route.fulfill({ json: { transactions: [], configured: true } }),
    );

    await page.goto('/');

    await expect.poll(() => migrated).toEqual({ transactions: legacy });
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY))
      .toBeNull();
  });

  test('keeps local data if the upload fails, so it can retry', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem('echo-onboarded-v1', 'true');
      localStorage.setItem(key, JSON.stringify([{ id: 'local-1', amountMinor: 1, merchantRaw: 'x' }]));
    }, LEGACY_KEY);

    let attempted = false;
    await page.route('**/api/transactions/migrate', (route) => {
      attempted = true;
      return route.fulfill({ status: 500, json: { error: 'down' } });
    });
    await page.route('**/api/transactions', (route) =>
      route.fulfill({ json: { transactions: [], configured: true } }),
    );

    await page.goto('/');
    await expect.poll(() => attempted).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).not.toBeNull();
  });
});
