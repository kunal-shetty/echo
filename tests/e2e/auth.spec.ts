import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should allow a user to sync their account', async ({ page }) => {
    await page.goto('/');

    // Open Sync Sheet (assuming there's a way to open it, e.g., via Profile)
    // This depends on the UI. Let's assume we can trigger it.
    // For the sake of this test, I'll assume we can find a "Sync" button.

    // Since I don't have the full UI flow, I'll write a generic flow
    // that tests the SyncSheet components' behavior if it's open.

    // Mocking the API for E2E tests usually requires a test server or mock service worker (MSW).
    // In Playwright, we can use page.route().

    await page.route('**/api/auth/start', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true, userId: 'test-user' }),
      });
    });

    await page.route('**/api/auth/verify', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ verified: true, migrated: false, user: { email: 'test@example.com' } }),
      });
    });

    // Trigger sync sheet (hypothetically)
    // await page.click('text=Sync account');

    // Enter email
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('text=Send code');

    // Enter code
    await page.fill('input[inputmode="numeric"]', '123456');
    await page.click('text=Verify');

    // Check for success
    await expect(page.getByText('Synced')).toBeVisible();
  });
});
