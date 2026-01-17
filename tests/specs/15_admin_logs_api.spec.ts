import { test, expect } from '@playwright/test';
import { TestReporter } from '../utils/report';

const reporter = new TestReporter();
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

test.describe('Admin Logs API', () => {
  let authCookie: string | undefined;

  test.beforeAll(async () => {
    reporter.addSection('Admin Logs API Validation');
  });

  test('should authenticate as admin user', async ({ page }) => {
    try {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Fill login form with admin credentials from environment
      const adminEmail = process.env.ADMIN_EMAIL || 'tester+e2e@example.com';
      const adminPassword = process.env.ADMIN_PASSWORD || 'Test1234!';
      
      await page.fill('[data-testid="input-email"], input[type="email"], #email', adminEmail);
      await page.fill('[data-testid="input-password"], input[type="password"], #password', adminPassword);
      
      // Submit login form
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      
      // Wait for redirect after successful login
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
      
      // Store auth cookies for API calls
      const cookies = await page.context().cookies();
      authCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      
      if (authCookie) {
        reporter.addTest('Admin Authentication for API', 'PASS');
      } else {
        reporter.addTest('Admin Authentication for API', 'FAIL', 'No auth cookie obtained');
      }
    } catch (error) {
      reporter.addTest('Admin Authentication for API', 'FAIL', `Auth failed: ${error}`);
    }
  });

  test('should fetch admin logs summary endpoint', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs/summary`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Verify response structure
        const hasSummary = data.summary !== undefined;
        const hasTimestamp = data.timestamp !== undefined;
        
        if (hasSummary && hasTimestamp) {
          reporter.addTest('Admin Logs Summary Endpoint', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs Summary Endpoint',
            'FAIL',
            `Invalid response structure: ${JSON.stringify(data).substring(0, 200)}`
          );
        }
      } else if (response.status() === 401 || response.status() === 403) {
        reporter.addTest(
          'Admin Logs Summary Endpoint',
          'FAIL',
          'Authentication/Authorization failed - user may not have admin privileges'
        );
      } else {
        reporter.addTest(
          'Admin Logs Summary Endpoint',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Summary Endpoint',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should fetch comprehensive admin logs (all types)', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs?type=all&limit=10`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Verify response structure
        const hasData = data.data !== undefined;
        const hasType = data.type !== undefined;
        
        if (hasData && hasType) {
          reporter.addTest('Admin Logs Comprehensive Endpoint (type=all)', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs Comprehensive Endpoint (type=all)',
            'FAIL',
            `Invalid response structure: ${JSON.stringify(data).substring(0, 200)}`
          );
        }
      } else if (response.status() === 401 || response.status() === 403) {
        reporter.addTest(
          'Admin Logs Comprehensive Endpoint (type=all)',
          'FAIL',
          'Authentication/Authorization failed'
        );
      } else {
        reporter.addTest(
          'Admin Logs Comprehensive Endpoint (type=all)',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Comprehensive Endpoint (type=all)',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should fetch ingestion logs', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs?type=ingestion&limit=5`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Verify ingestion-specific structure
        const hasIngestionData = data.data?.ingestion !== undefined;
        
        if (hasIngestionData) {
          reporter.addTest('Admin Logs Ingestion Type Filter', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs Ingestion Type Filter',
            'FAIL',
            `Missing ingestion data in response`
          );
        }
      } else {
        reporter.addTest(
          'Admin Logs Ingestion Type Filter',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Ingestion Type Filter',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should fetch practice session logs', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs?type=practice&limit=5`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Verify practice-specific structure
        const hasPracticeData = data.data?.practice !== undefined;
        
        if (hasPracticeData) {
          reporter.addTest('Admin Logs Practice Type Filter', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs Practice Type Filter',
            'FAIL',
            `Missing practice data in response`
          );
        }
      } else {
        reporter.addTest(
          'Admin Logs Practice Type Filter',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Practice Type Filter',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should fetch system event logs', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs?type=system&limit=5`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Verify system-specific structure
        const hasSystemData = data.data?.system !== undefined;
        
        if (hasSystemData) {
          reporter.addTest('Admin Logs System Type Filter', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs System Type Filter',
            'FAIL',
            `Missing system data in response`
          );
        }
      } else {
        reporter.addTest(
          'Admin Logs System Type Filter',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs System Type Filter',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should respect limit parameter', async ({ request }) => {
    try {
      const response = await request.get(`${BASE_URL}/api/admin/logs?type=all&limit=3`, {
        headers: {
          Cookie: authCookie || '',
        },
      });

      if (response.status() === 200) {
        const data = await response.json();
        
        // Check that limit is respected
        const limitMatches = data.limit === 3;
        
        if (limitMatches) {
          reporter.addTest('Admin Logs Limit Parameter', 'PASS');
        } else {
          reporter.addTest(
            'Admin Logs Limit Parameter',
            'FAIL',
            `Limit not respected: expected 3, got ${data.limit}`
          );
        }
      } else {
        reporter.addTest(
          'Admin Logs Limit Parameter',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Limit Parameter',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test('should reject non-admin access to logs endpoint', async ({ page }) => {
    try {
      // Create a new context without admin privileges
      await page.goto('/');
      
      // Try to access admin logs API directly
      const response = await page.request.get(`${BASE_URL}/api/admin/logs/summary`);
      
      // Should return 401 or 403
      if (response.status() === 401 || response.status() === 403) {
        reporter.addTest('Admin Logs Authorization Check', 'PASS');
      } else if (response.status() === 200) {
        reporter.addTest(
          'Admin Logs Authorization Check',
          'FAIL',
          'Endpoint accessible without admin authentication - security issue!'
        );
      } else {
        reporter.addTest(
          'Admin Logs Authorization Check',
          'FAIL',
          `Unexpected status code: ${response.status()}`
        );
      }
    } catch (error) {
      reporter.addTest(
        'Admin Logs Authorization Check',
        'FAIL',
        `Request failed: ${error}`
      );
    }
  });

  test.afterAll(async () => {
    console.log('Admin Logs API tests completed');
  });
});
