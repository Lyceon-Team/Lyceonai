import { test, expect } from "@playwright/test";

// @spec [n/a — e2e test-harness smoke check, no governing docs/Spec section] | @implemented [2026-06-17]
// plain English: proves the Playwright harness runs end-to-end before any real e2e is built — loads
// the app root and asserts the document title matches /Lyceon/i (real title:
// "Lyceon – Digital SAT prep with tutor guidance"). Green here = the durable e2e harness works.
test("app loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Lyceon/i);
});
