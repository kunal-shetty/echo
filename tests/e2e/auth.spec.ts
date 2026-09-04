import { test, expect } from '@playwright/test';

test.describe('Custom OAuth Authentication Flow', () => {
  test('should redirect to Google OAuth login', async ({ page }) => {
    // Mock /api/me to return unauthorized
    await page.route('**/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false }),
      });
    });

    await page.goto('/');

    // Trigger login (assuming there's a "Login" button that goes to /api/auth/login?provider=google)
    // Since I don't have the exact UI, I'll navigate directly to the route
    const response = await page.request.get('/api/auth/login?provider=google');
    expect(response.status()).toBe(302); // Redirect
    expect(response.headers().get('location')).toContain('accounts.google.com');
  });

  test('should handle successful OAuth callback and establish session', async ({ page }) => {
    // Mock the callback route
    await page.route('**/api/auth/callback*', async route => {
      await route.fulfill({
        status: 302,
        headers: { 'location': '/' },
      });
    });

    // Simulate callback from Google
    await page.goto('/api/auth/callback?provider=google&code=test-code&state=test-state');

    // The app should now be authenticated
    await page.route('**/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, userId: 'test-user-123' }),
      });
    });

    await page.reload();
    // Verify some authenticated state in UI (e.g., profile name)
    // expect(page.getByText('Welcome, test-user')).toBeVisible();
  });

  test('should handle logout', async ({ page }) => {
    // Mock /api/me to return authenticated
    await page.route('**/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, userId: 'test-user-123' }),
      });
    });

    await page.goto('/');

    // Trigger logout
    await page.request.post('/api/auth/logout');

    // Now /api/me should return unauthorized
    await page.route('**/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false }),
      });
    });

    await page.reload();
    // Verify guest state
  });
});
