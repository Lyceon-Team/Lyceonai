import { test, expect } from '@playwright/test';
import { TestReporter } from '../utils/report';

const reporter = new TestReporter();

test.describe('Questions List & Practice Flow', () => {
  test.beforeAll(async () => {
    reporter.addSection('Questions & Practice Flow Validation');
  });

  test('should display questions list page', async ({ page }) => {
    try {
      // Login first
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });

      // Navigate to questions page
      await page.goto('/questions');
      await page.waitForLoadState('networkidle');

      // Look for questions list indicators
      const questionIndicators = [
        page.locator('[data-testid="questions-list"]'),
        page.locator('[data-testid="question-item"]'),
        page.locator('.question-list'),
        page.locator('.question-item'),
        page.locator('h1:has-text("Questions")'),
        page.locator('h2:has-text("Questions")'),
      ];

      let foundQuestions = false;
      for (const indicator of questionIndicators) {
        try {
          await expect(indicator.first()).toBeVisible({ timeout: 3000 });
          foundQuestions = true;
          break;
        } catch {}
      }

      if (foundQuestions) {
        reporter.addTest('Questions List Page Display', 'PASS');
      } else {
        reporter.addTest(
          'Questions List Page Display',
          'FAIL',
          'Questions list page not found or no questions displayed'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Questions List Page Display',
        'FAIL',
        `Questions list test failed: ${error}`
      );
    }
  });

  test('should navigate to practice mode', async ({ page }) => {
    try {
      // Login first
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });

      // Try to navigate to practice page
      await page.goto('/practice');
      await page.waitForLoadState('networkidle');

      // Look for practice mode indicators
      const practiceIndicators = [
        page.locator('[data-testid="practice-start"]'),
        page.locator('[data-testid="start-practice"]'),
        page.locator('button:has-text("Start Practice")'),
        page.locator('button:has-text("Begin")'),
        page.locator('h1:has-text("Practice")'),
        page.locator('.practice-mode'),
      ];

      let foundPractice = false;
      for (const indicator of practiceIndicators) {
        try {
          await expect(indicator.first()).toBeVisible({ timeout: 3000 });
          foundPractice = true;
          break;
        } catch {}
      }

      if (foundPractice) {
        reporter.addTest('Practice Mode Navigation', 'PASS');
      } else {
        reporter.addTest(
          'Practice Mode Navigation',
          'FAIL',
          'Practice mode page not accessible or missing practice UI'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Practice Mode Navigation',
        'FAIL',
        `Practice mode navigation failed: ${error}`
      );
    }
  });

  test('should start practice session and display questions', async ({ page }) => {
    try {
      // Login first
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });

      // Navigate to practice and start session
      await page.goto('/practice');
      await page.waitForLoadState('networkidle');

      // Try to start practice
      const startButtons = [
        page.locator('[data-testid="practice-start"]'),
        page.locator('[data-testid="start-practice"]'),
        page.locator('button:has-text("Start Practice")'),
        page.locator('button:has-text("Begin")'),
      ];

      let practiceStarted = false;
      for (const button of startButtons) {
        try {
          await button.first().click({ timeout: 2000 });
          practiceStarted = true;
          break;
        } catch {}
      }

      if (practiceStarted) {
        // Wait for question to appear
        await page.waitForTimeout(2000);

        // Look for question content
        const questionElements = [
          page.locator('[data-testid="question-stem"]'),
          page.locator('[data-testid="question-text"]'),
          page.locator('.question-content'),
          page.locator('.question-stem'),
        ];

        let foundQuestion = false;
        for (const element of questionElements) {
          try {
            await expect(element.first()).toBeVisible({ timeout: 3000 });
            foundQuestion = true;
            break;
          } catch {}
        }

        if (foundQuestion) {
          reporter.addTest('Practice Session Start and Question Display', 'PASS');
        } else {
          reporter.addTest(
            'Practice Session Start and Question Display',
            'FAIL',
            'Practice started but no questions displayed'
          );
        }
      } else {
        reporter.addTest(
          'Practice Session Start and Question Display',
          'FAIL',
          'Unable to start practice session'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Practice Session Start and Question Display',
        'FAIL',
        `Practice session test failed: ${error}`
      );
    }
  });

  test('should allow answer selection and submission', async ({ page }) => {
    try {
      // Login and start practice session
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });

      await page.goto('/practice');
      await page.waitForLoadState('networkidle');

      // Start practice
      const startButtons = [
        page.locator('[data-testid="practice-start"]'),
        page.locator('[data-testid="start-practice"]'),
        page.locator('button:has-text("Start Practice")'),
        page.locator('button:has-text("Begin")'),
      ];

      for (const button of startButtons) {
        try {
          await button.first().click({ timeout: 2000 });
          break;
        } catch {}
      }

      await page.waitForTimeout(2000);

      // Try to select an answer
      const answerOptions = [
        page.locator('[data-testid="option-a"], [data-testid="option-0"]'),
        page.locator('input[type="radio"]'),
        page.locator('.answer-option'),
        page.locator('.option-button'),
      ];

      let answerSelected = false;
      for (const option of answerOptions) {
        try {
          await option.first().click({ timeout: 3000 });
          answerSelected = true;
          break;
        } catch {}
      }

      if (answerSelected) {
        // Try to submit answer
        const submitButtons = [
          page.locator('[data-testid="submit-answer"]'),
          page.locator('button:has-text("Submit")'),
          page.locator('button:has-text("Next")'),
          page.locator('.submit-button'),
        ];

        let submitted = false;
        for (const button of submitButtons) {
          try {
            await button.first().click({ timeout: 2000 });
            submitted = true;
            break;
          } catch {}
        }

        if (submitted) {
          reporter.addTest('Answer Selection and Submission', 'PASS');
        } else {
          reporter.addTest(
            'Answer Selection and Submission',
            'FAIL',
            'Answer selected but submission failed'
          );
        }
      } else {
        reporter.addTest(
          'Answer Selection and Submission',
          'FAIL',
          'Unable to select answer options'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Answer Selection and Submission',
        'FAIL',
        `Answer selection test failed: ${error}`
      );
    }
  });

  test('should display practice results and scoring', async ({ page }) => {
    try {
      // This test assumes a short practice session can be completed
      // Login and complete a practice session
      await page.goto('/login');
      await page.fill('[data-testid="input-email"], input[type="email"], #email', 'tester+e2e@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"], #password', 'Test1234!');
      await page.click('[data-testid="button-submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });

      await page.goto('/practice');
      
      // Try to find results from a previous session or look for results UI
      const resultIndicators = [
        page.locator('[data-testid="practice-results"]'),
        page.locator('[data-testid="score"]'),
        page.locator('.practice-score'),
        page.locator('.results-summary'),
        page.locator('text=/Score:|Results:/'),
      ];

      let foundResults = false;
      for (const indicator of resultIndicators) {
        try {
          await expect(indicator.first()).toBeVisible({ timeout: 3000 });
          foundResults = true;
          break;
        } catch {}
      }

      if (foundResults) {
        reporter.addTest('Practice Results and Scoring Display', 'PASS');
      } else {
        // If no results found, check if practice session can be completed
        reporter.addTest(
          'Practice Results and Scoring Display',
          'FAIL',
          'No practice results or scoring interface found'
        );
      }
    } catch (error) {
      reporter.addTest(
        'Practice Results and Scoring Display',
        'FAIL',
        `Practice results test failed: ${error}`
      );
    }
  });

  test.afterAll(async () => {
    console.log('Questions & Practice Flow tests completed');
  });
});