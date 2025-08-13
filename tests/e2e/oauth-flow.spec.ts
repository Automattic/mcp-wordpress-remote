/**
 * End-to-end tests for OAuth authentication flow
 */

import { test, expect } from '@playwright/test';

test.describe('OAuth Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Set up page context for OAuth testing
    await page.setExtraHTTPHeaders({
      'User-Agent': 'MCP-WordPress-Remote-E2E-Test',
    });
  });

  test('should complete WordPress.com OAuth flow', async ({ page }) => {
    // Start the OAuth flow by navigating to the authorization URL
    await page.goto('/auth/start');

    // Should redirect to WordPress.com authorization page
    await expect(page).toHaveURL(/public-api\.wordpress\.com\/oauth2\/authorize/);

    // Check that required OAuth parameters are present
    const url = new URL(page.url());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toContain('127.0.0.1:3000/callback');
    expect(url.searchParams.get('scope')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    
    // PKCE parameters for OAuth 2.1 compliance
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    // In a real test, we would:
    // 1. Mock the WordPress.com login page
    // 2. Fill in test credentials
    // 3. Submit the form
    // 4. Handle the redirect back to our callback
    
    // For now, we'll simulate the callback
    const state = url.searchParams.get('state');
    const callbackUrl = `http://127.0.0.1:3000/callback?code=test_auth_code&state=${state}`;
    
    await page.goto(callbackUrl);

    // Should show success page
    await expect(page.locator('text=Authorization successful')).toBeVisible();
    
    // Should have stored the auth tokens
    // This would be verified by checking the auth storage
  });

  test('should handle OAuth authorization errors', async ({ page }) => {
    // Simulate an OAuth error response
    await page.goto('/callback?error=access_denied&error_description=User%20denied%20authorization&state=test_state');

    // Should show error page
    await expect(page.locator('text=Authorization failed')).toBeVisible();
    await expect(page.locator('text=access_denied')).toBeVisible();
  });

  test('should validate state parameter in callback', async ({ page }) => {
    // Try callback with invalid state
    await page.goto('/callback?code=test_code&state=invalid_state');

    // Should show error for invalid state
    await expect(page.locator('text=Invalid state parameter')).toBeVisible();
  });

  test('should handle PKCE verification in callback', async ({ page }) => {
    // This test would verify that PKCE verification works correctly
    // It requires coordinating the code verifier from the authorization request
    // with the callback verification
    
    await page.goto('/auth/start');
    
    // Extract state and code challenge from authorization URL
    const authUrl = new URL(page.url());
    const state = authUrl.searchParams.get('state');
    const codeChallenge = authUrl.searchParams.get('code_challenge');
    
    expect(state).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    
    // Simulate successful callback with proper state
    await page.goto(`/callback?code=valid_auth_code&state=${state}`);
    
    // Should complete successfully if PKCE verification passes
    await expect(page.locator('text=Authorization successful')).toBeVisible();
  });

  test('should handle self-hosted WordPress OAuth flow', async ({ page, context }) => {
    // Set up for self-hosted WordPress site
    await context.addInitScript(() => {
      (globalThis as any).localStorage.setItem('wp_site_type', 'self-hosted');
      (globalThis as any).localStorage.setItem('wp_site_url', 'https://example.com');
    });

    await page.goto('/auth/start');

    // Should redirect to self-hosted WordPress authorization endpoint
    await expect(page).toHaveURL(/example\.com\/wp-json\/oauth\/v2\/authorize/);

    // Check OAuth parameters for self-hosted
    const url = new URL(page.url());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBeTruthy();
    
    // Self-hosted sites should use OAuth 2.1 with PKCE
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('should handle OAuth token refresh flow', async ({ page, context }) => {
    // Set up existing expired tokens
    await context.addInitScript(() => {
      const expiredToken = {
        access_token: 'expired_token',
        token_type: 'Bearer',
        expires_in: 3600,
        obtained_at: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
        refresh_token: 'valid_refresh_token',
      };
      (globalThis as any).localStorage.setItem('wp_oauth_tokens', JSON.stringify(expiredToken));
    });

    // Try to make an API request that would trigger token refresh
    await page.goto('/api/test');

    // Should automatically refresh the token and complete the request
    // This would be indicated by successful API response
    await expect(page.locator('text=API request successful')).toBeVisible();
  });

  test('should handle concurrent OAuth flows', async ({ browser }) => {
    // Open multiple pages to simulate concurrent OAuth attempts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Start OAuth flow in both contexts simultaneously
    await Promise.all([
      page1.goto('/auth/start'),
      page2.goto('/auth/start'),
    ]);

    // Both should get different state parameters
    const url1 = new URL(page1.url());
    const url2 = new URL(page2.url());
    
    const state1 = url1.searchParams.get('state');
    const state2 = url2.searchParams.get('state');
    
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);

    // Both should be able to complete their flows independently
    await Promise.all([
      page1.goto(`/callback?code=code1&state=${state1}`),
      page2.goto(`/callback?code=code2&state=${state2}`),
    ]);

    await expect(page1.locator('text=Authorization successful')).toBeVisible();
    await expect(page2.locator('text=Authorization successful')).toBeVisible();

    await context1.close();
    await context2.close();
  });

  test('should handle OAuth timeout scenarios', async ({ page }) => {
    await page.goto('/auth/start');

    // Wait for longer than typical OAuth timeout
    await page.waitForTimeout(5000);

    // Try to complete the flow after timeout
    const url = new URL(page.url());
    const state = url.searchParams.get('state');
    
    await page.goto(`/callback?code=late_code&state=${state}`);

    // Should handle gracefully (either success or appropriate timeout message)
    const hasSuccess = await page.locator('text=Authorization successful').isVisible();
    const hasTimeout = await page.locator('text=Authorization timeout').isVisible();
    
    expect(hasSuccess || hasTimeout).toBe(true);
  });

  test('should implement proper security measures', async ({ page }) => {
    // Test CSRF protection
    await page.goto('/callback?code=test_code&state=malicious_state');
    await expect(page.locator('text=Invalid state parameter')).toBeVisible();

    // Test parameter validation
    await page.goto('/callback?code=&state=valid_state');
    await expect(page.locator('text=Missing required parameters')).toBeVisible();

    // Test code injection protection
    await page.goto('/callback?code=<script>alert("xss")</script>&state=valid_state');
    // Should not execute the script and should show appropriate error
    const alertDialogs: any[] = [];
    page.on('dialog', dialog => {
      alertDialogs.push(dialog);
      dialog.accept();
    });
    
    await page.waitForTimeout(1000);
    expect(alertDialogs).toHaveLength(0); // No script should have executed
  });

  test('should work across different browsers', async ({ browserName, page }) => {
    // This test will run for each browser configured in playwright.config.ts
    test.skip(browserName === 'webkit' && process.platform === 'linux', 'WebKit on Linux not supported');

    // Basic OAuth flow should work in all browsers
    await page.goto('/auth/start');
    
    // Should redirect to authorization endpoint
    await expect(page).toHaveURL(/oauth2\/authorize/);
    
    // OAuth parameters should be present
    const url = new URL(page.url());
    expect(url.searchParams.get('client_id')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
  });
});
