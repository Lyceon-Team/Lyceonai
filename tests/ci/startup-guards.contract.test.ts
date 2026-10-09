/**
 * Preview deployments must boot. Two startup guards asked the wrong question.
 *
 * @spec [Doc-06B §3 "Secrets at Runtime"; SCL-023 / Doc-03_V3 §21.2 crisis
 *        Layer 2 failure semantics; Coding Standards §2, §3.5]
 * @implemented [2026-09-11]
 *
 * plain English: proves the process starts without `GCP_SERVICE_ACCOUNT_JSON`,
 * that `PUBLIC_SITE_URL` is still required where it is genuinely required, and
 * that a missing credential fails at the point of use without inventing a
 * classifier result. Expected outcome: a Vercel preview serves every route
 * that does not need GCP.
 *
 * WHY THESE ASSERTIONS AND NOT A BOOTED SERVER. Booting `server/index.ts` in a
 * test would need the real Supabase, Stripe and CSRF secrets and would bind a
 * port. The decisions that killed the preview are pure functions now, so they
 * are tested directly — and the "routes respond" claim is proved by mounting
 * the real routers with the credential absent, which is the property that
 * actually failed.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GCP_VAR = "GCP_SERVICE_ACCOUNT_JSON";

const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info: (...a: unknown[]) => loggerInfo(...a),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ── The boot guard ───────────────────────────────────────────────────

describe("GCP credential absence does not stop the process", () => {
  it("starts and warns instead of exiting, under NODE_ENV=production", async () => {
    delete process.env[GCP_VAR];
    process.env.NODE_ENV = "production";

    const guards = await import("../../server/lib/startup-guards");
    guards.__resetGcpStartupReportForTests();

    // The assertion is the absence of a throw AND the absence of an exit.
    // `process.exit` is stubbed so that a reintroduced exit is caught here
    // rather than tearing down the test runner.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    expect(() => guards.reportGcpCredentialStatusAtStartup()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const [component, event, message] = loggerWarn.mock.calls[0] as string[];
    expect(component).toBe("GCP");
    expect(event).toBe("credentials_absent");
    // Names the variable, and names what will not work.
    expect(message).toContain(GCP_VAR);
    expect(message).toMatch(/crisis classifier/i);
    expect(message).toMatch(/retention archive/i);
  });

  /**
   * A boot banner that repeats is a boot banner ignored. Asserted across
   * several calls rather than two, so a counter that resets would still fail.
   */
  it("fires exactly once no matter how often it is called", async () => {
    delete process.env[GCP_VAR];
    const guards = await import("../../server/lib/startup-guards");
    guards.__resetGcpStartupReportForTests();

    for (let i = 0; i < 5; i += 1) guards.reportGcpCredentialStatusAtStartup();

    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  /**
   * THE PROPERTY THAT ACTUALLY FAILED IN PREVIEW: routes answering at all.
   * Both routers are imported and mounted with the credential absent — if
   * either reached GCP on the module graph, this would throw at import.
   */
  it("serves the public pricing route with the credential absent", async () => {
    delete process.env[GCP_VAR];
    process.env.NODE_ENV = "production";
    delete process.env.STRIPE_PRICE_PARENT_MONTHLY;

    const routes = await import("../../server/routes/public-pricing-routes");
    routes.__resetPublicPricingMemoForTests();
    const app = express();
    app.use("/api/public", routes.default);

    const res = await request(app).get("/api/public/pricing");

    // 404 PRICE_NOT_CONFIGURED is a RESPONSE. The defect was no response at
    // all — the process died before the route was mounted.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRICE_NOT_CONFIGURED");
  });
});

// ── PUBLIC_SITE_URL: scoped, not deleted ─────────────────────────────

describe("PUBLIC_SITE_URL is required of the deployment target, not the build mode", () => {
  it("warns rather than dying on a Vercel preview", async () => {
    const { evaluateSiteUrl, isProductionDeployment } = await import(
      "../../server/lib/startup-guards"
    );
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";

    expect(isProductionDeployment()).toBe(false);
    const verdict = evaluateSiteUrl({
      publicSiteUrl: undefined,
      isProductionDeployment: isProductionDeployment(),
    });
    expect(verdict.kind).toBe("proceed");
  });

  /**
   * THE REQUIREMENT IS PRESERVED, NOT DELETED. This is the assertion that
   * stops the fix from becoming "remove the guard".
   */
  it("still refuses to start in the production deployment", async () => {
    const { evaluateSiteUrl, isProductionDeployment } = await import(
      "../../server/lib/startup-guards"
    );
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";

    expect(isProductionDeployment()).toBe(true);
    const verdict = evaluateSiteUrl({
      publicSiteUrl: undefined,
      isProductionDeployment: isProductionDeployment(),
    });
    expect(verdict.kind).toBe("fatal");
    if (verdict.kind === "fatal") expect(verdict.reason).toBe("missing");
  });

  /**
   * Off Vercel entirely, absence of `VERCEL_ENV` must not read as "not
   * production" — that would silently drop the requirement on any other host.
   */
  it("still refuses on a non-Vercel production host", async () => {
    const { isProductionDeployment } = await import(
      "../../server/lib/startup-guards"
    );
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "production";

    expect(isProductionDeployment()).toBe(true);
  });

  it("still refuses a non-HTTPS site URL in the production deployment", async () => {
    const { evaluateSiteUrl } = await import(
      "../../server/lib/startup-guards"
    );
    const verdict = evaluateSiteUrl({
      publicSiteUrl: "http://lyceon.ai",
      isProductionDeployment: true,
    });
    expect(verdict.kind).toBe("fatal");
    if (verdict.kind === "fatal") expect(verdict.reason).toBe("not_https");
  });

  it("proceeds, and says so, on a well-formed production URL", async () => {
    const { evaluateSiteUrl } = await import(
      "../../server/lib/startup-guards"
    );
    const verdict = evaluateSiteUrl({
      publicSiteUrl: "https://lyceon.ai",
      isProductionDeployment: true,
    });
    expect(verdict.kind).toBe("proceed");
    expect(verdict.lines.join(" ")).toContain(
      "https://lyceon.ai/auth/callback",
    );
  });
});
