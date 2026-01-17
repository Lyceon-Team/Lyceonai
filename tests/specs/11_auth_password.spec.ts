import { test, expect } from '@playwright/test';
import { TestReporter } from '../utils/report';

const reporter = new TestReporter();

test.describe('Email/Password Authentication', () => {
  test.beforeAll(async () => {
    reporter.addSection('Email/Password Auth Verification');
  });

  test('should successfully login with test credentials', async ({ page }) => {
    try {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Fill login form with test credentials
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      
      // Submit login form
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      
      // Wait for redirect after successful login
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
      
      // Check for logged-in indicators
      const loggedInIndicators = [
        page.locator('[data-testid="user-avatar"]'),
        page.locator('[data-testid="logout-button"]'),
        page.locator('button:has-text("Sign out")'),
        page.locator('button:has-text("Logout")'),
        page.locator('.user-name'),
      ];

      let foundIndicator = false;
      for (const indicator of loggedInIndicators) {
        try {
          await expect(indicator.first()).toBeVisible({ timeout: 2000 });
          foundIndicator = true;
          break;
        } catch {}
      }

      if (foundIndicator) {
        reporter.addTest('Email/Password Login Success', 'PASS');
      } else {
        reporter.addTest(
          'Email/Password Login Success',
          'FAIL',
          'No logged-in indicators found after login'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Email/Password Login Success',
        'FAIL',
        `Login failed: ${error}`
      );
    }
  });

  test('should persist session across page refresh', async ({ page }) => {
    try {
      // Login first
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      
      // Wait for successful login
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
      
      // Refresh the page
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Check if still logged in (should not redirect to login page)
      const currentUrl = page.url();
      if (!currentUrl.includes('/login')) {
        reporter.addTest('Session Persistence Across Refresh', 'PASS');
      } else {
        reporter.addTest(
          'Session Persistence Across Refresh',
          'FAIL',
          'Session lost after page refresh'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Session Persistence Across Refresh',
        'FAIL',
        `Session persistence test failed: ${error}`
      );
    }
  });

  test('should successfully logout and clear session', async ({ page }) => {
    try {
      // Login first
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      
      // Wait for successful login
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
      
      // Find and click logout button
      const logoutButtons = [
        page.locator('[data-testid="logout-button"]'),
        page.locator('button:has-text("Sign out")'),
        page.locator('button:has-text("Logout")'),
        page.locator('a:has-text("Logout")'),
      ];

      let loggedOut = false;
      for (const button of logoutButtons) {
        try {
          await button.first().click({ timeout: 2000 });
          loggedOut = true;
          break;
        } catch {}
      }

      if (loggedOut) {
        // Wait for redirect to login page
        await page.waitForURL(/\/login/, { timeout: 10000 });
        reporter.addTest('Logout and Session Clear', 'PASS');
      } else {
        reporter.addTest(
          'Logout and Session Clear',
          'FAIL',
          'No logout button found or logout failed'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Logout and Session Clear',
        'FAIL',
        `Logout test failed: ${error}`
      );
    }
  });

  test('should validate admin user credentials', async ({ page }) => {
    try {
      // Test admin login
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      
      // Wait for successful login
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
      
      // Try to access admin route
      await page.goto('/admin');
      const currentUrl = page.url();
      
      if (currentUrl.includes('/admin') && !currentUrl.includes('/login')) {
        reporter.addTest('Admin Access Validation', 'PASS');
      } else {
        reporter.addTest(
          'Admin Access Validation',
          'FAIL',
          'Admin user unable to access admin routes'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Access Validation',
        'FAIL',
        `Admin access test failed: ${error}`
      );
    }
  });

  test.afterAll(async () => {
    console.log('Email/Password Auth tests completed');
  });
});