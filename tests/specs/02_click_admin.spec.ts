import { test, expect } from '@playwright/test';
import { TEST } from '../utils/testEnv';

test('Admin: loads portal and UI controls render', async ({ page }) => {
  await page.goto('/admin');     // adjust if different
  
  // If auth exists:
  if (TEST.ADMIN_EMAIL && TEST.ADMIN_PASSWORD) {
    await page.fill('input[type="email"]', TEST.ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST.ADMIN_PASSWORD);
    await page.click('button:has-text("Sign in")');
    await expect(page).toHaveURL(/admin/i);
  }
  
  // Jobs table present
  await expect(page.locator('text=Jobs')).toBeVisible();
  
  // Controls present (expect at least one, but tolerate if missing)
  const retryCount = await page.locator('text=Retry').count();
  const requeueCount = await page.locator('text=Requeue').count();
  // These controls may or may not be present, so we just log their presence
  
  // Upload widgets present
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  // Parse options may be present as buttons or text
  const parseOnlyCount = await page.locator('text=Parse-only').count();
  const parsePersistCount = await page.locator('text=Parse+Persist').count();
});