/**
 * Stripe webhook mount-path contract — Phase C.
 *
 * @spec [SCL-049; docs/plans/Stripe_Phase_C_Preflight.md §5]
 *
 * Why this exists: both previously-registered Stripe endpoints targeted
 * `/api/stripe/webhook` while the application mounted `/api/billing/webhook`.
 * They never matched, and `stripe_webhook_events` held zero rows as a result.
 *
 * No test can read the Stripe Dashboard, so this asserts the half that lives in
 * the repo: the Express mount reads the shared constant rather than a literal,
 * so there is exactly one path to keep in step with the Dashboard and it is
 * greppable. A hardcoded literal at the mount fails this suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STRIPE_WEBHOOK_PATH } from "../../server/lib/stripe/webhook-path";

const INDEX = readFileSync(
  path.resolve(__dirname, "..", "..", "server", "index.ts"),
  "utf8",
);

describe("Stripe webhook mount path", () => {
  it("exports a single absolute path constant", () => {
    expect(STRIPE_WEBHOOK_PATH).toBe("/api/billing/webhook");
  });

  it("mounts the webhook using the shared constant, never a string literal", () => {
    expect(INDEX).toContain("app.post(\n  STRIPE_WEBHOOK_PATH,");
    // The old literal must not reappear anywhere in the server entrypoint.
    expect(INDEX).not.toContain('"/api/billing/webhook"');
    expect(INDEX).not.toContain('"/api/stripe/webhook"');
  });

  it("registers the webhook before the JSON body parser", () => {
    const mountIndex = INDEX.indexOf("app.post(\n  STRIPE_WEBHOOK_PATH,");
    const jsonIndex = INDEX.indexOf("app.use(express.json(");
    expect(mountIndex).toBeGreaterThan(-1);
    expect(jsonIndex).toBeGreaterThan(-1);
    // Signature verification needs the raw body; a JSON parser registered first
    // consumes it and every signature check fails.
    expect(mountIndex).toBeLessThan(jsonIndex);
  });
});
