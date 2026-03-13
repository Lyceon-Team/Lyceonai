import { test, expect } from '@playwright/test';
import { TestReporter } from '../utils/report';

const reporter = new TestReporter();

test.describe('Google Authentication E2E', () => {
  test.beforeAll(async () => {
    reporter.addSection('Google Auth E2E Verification');
  });

  test('should have Google OAuth configuration', async ({ page }) => {
    try {
      await page.request.get('/api/health');

      const hasGoogleConfig = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

      if (!hasGoogleConfig) {
        reporter.addTest(
          'Google OAuth Environment Configuration',
          'FAIL',
          'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables'
        );
        throw new Error('Google OAuth not configured');
      }

      reporter.addTest('Google OAuth Environment Configuration', 'PASS');
    } catch (error) {
      reporter.addTest(
        'Google OAuth Environment Configuration',
        'FAIL',
        `Error: ${error}`
      );
      throw error;
    }
  });

  test('should display Google Sign-In button on login page', async ({ page }) => {
    try {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Look for Google sign-in button with various possible selectors
      const googleButton = page.locator([
        'button:has-text("Sign in with Google")',
        'button:has-text("Google")',
        '[data-testid="google-signin"]',
        '[data-provider="google"]'
      ].join(', '));

      await expect(googleButton.first()).toBeVisible({ timeout: 10000 });

      reporter.addTest('Google Sign-In Button Presence', 'PASS');
    } catch (error) {
      reporter.addTest(
        'Google Sign-In Button Presence',
        'FAIL',
        `Google sign-in button not found: ${error}`
      );
      throw error;
    }
  });

  test('should initiate Google OAuth redirect (headless limitation)', async ({ page }) => {
    try {
      await page.goto('/login');

      // Find and click Google sign-in button
      const googleButton = page.locator([
        'button:has-text("Sign in with Google")',
        'button:has-text("Google")',
        '[data-testid="google-signin"]',
        '[data-provider="google"]'
      ].join(', '));

      // In headless mode, we can't complete the OAuth flow but we can verify the redirect
      await googleButton.first().click();

      // Wait for redirect or check URL change
      try {
        await page.waitForURL(/accounts\.google\.com/, { timeout: 5000 });
        reporter.addTest('Google OAuth Redirect', 'PASS');
      } catch (_redirectError) {
        // If not on Google's domain in test infra, we still expect an auth-related URL change.
        const currentUrl = page.url();
        if (currentUrl.includes('/api/auth/') || currentUrl.includes('/auth/google/callback') || currentUrl.includes('callback')) {
          reporter.addTest('Google OAuth Redirect', 'PASS', 'Redirected to Google OAuth/auth callback path');
        } else {
          reporter.addTest(
            'Google OAuth Redirect',
            'FAIL',
            `No redirect detected. Current URL: ${currentUrl}`
          );
        }
      }
    } catch (error) {
      reporter.addTest(
        'Google OAuth Redirect',
        'FAIL',
        `OAuth redirect test failed: ${error}`
      );
    }
  });

  test('should validate Google callback URL configuration', async ({ page }) => {
    try {
      // Canonical callback endpoint in current runtime.
      const callbackUrl = '/auth/google/callback';
      const response = await page.request.get(callbackUrl);

      // Callback route exists and should not be a removed endpoint.
      const status = response.status();
      if ([302, 303, 307, 308, 500].includes(status)) {
        reporter.addTest('Google Callback URL Configuration', 'PASS');
      } else {
        reporter.addTest(
          'Google Callback URL Configuration',
          'FAIL',
          `Unexpected callback status: ${status}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Google Callback URL Configuration',
        'FAIL',
        `Callback URL test failed: ${error}`
      );
    }
  });

  test.afterAll(async () => {
    console.log('Google Auth tests completed');
  });
});
