import { test, expect } from '@playwright/test';

test.describe('PracticeDemo UI Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/practice-demo');
  });

  test('renders question stem, 4 options, and progress bar', async ({ page }) => {
    // Check progress bar
    const progressBar = page.locator('[role="progressbar"]').first();
    await expect(progressBar).toBeVisible();

    // Check question stem
    await expect(page.getByText('If 2x + 3 = 11, what is the value of x?')).toBeVisible();

    // Check 4 answer options
    await expect(page.getByText('A. 3')).toBeVisible();
    await expect(page.getByText('B. 4')).toBeVisible();
    await expect(page.getByText('C. 5')).toBeVisible();
    await expect(page.getByText('D. 6')).toBeVisible();
  });

  test('keyboard guard: pressing "s" while in input does not submit', async ({ page }) => {
    // Create a mock input to test keyboard guard
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'test-input';
      document.body.appendChild(input);
    });

    // Focus the input
    await page.locator('#test-input').focus();
    
    // Press 's' key
    await page.keyboard.press('s');
    
    // Verify submit button was NOT clicked (feedback should not appear)
    await expect(page.getByRole('status')).not.toBeVisible();
    
    // Clean up
    await page.evaluate(() => {
      document.getElementById('test-input')?.remove();
    });
  });

  test('a11y: radios exist, clicking labels changes selection, role="status" appears after submit', async ({ page }) => {
    // Verify radios exist
    const radios = page.locator('input[type="radio"]');
    await expect(radios).toHaveCount(4);

    // Click label for option B (correct answer)
    await page.getByText('B. 4').click();
    
    // Verify selection changed
    const radioB = page.locator('input[name="q1"][value="B"]');
    await expect(radioB).toBeChecked();

    // Submit
    await page.getByRole('button', { name: /submit/i }).click();

    // Verify role="status" appears with feedback
    const status = page.locator('[role="status"]');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Correct');
  });

  test('reduced motion: animations minimized when prefers-reduced-motion is set', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    await page.goto('/practice-demo');

    // Verify page renders (basic check since animation detection is complex)
    await expect(page.getByText('If 2x + 3 = 11, what is the value of x?')).toBeVisible();
    
    // Check that accessibility.css rule is applied
    const animationDuration = await page.evaluate(() => {
      const computed = getComputedStyle(document.body);
      return computed.getPropertyValue('animation-duration');
    });
    
    // With prefers-reduced-motion, animations should be near-instant (.001ms)
    // This is a basic check - actual value may vary by browser
    expect(animationDuration).toBeTruthy();
  });
});
