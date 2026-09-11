/**
 * `GET /api/public/pricing` — unauthenticated, monthly only, and memoised.
 *
 * @spec [Doc 09 §1.4, §5.1; Coding Standards §8.2 response shape;
 *        owner ruling 2026-09-03] | @implemented [2026-09-03]
 *
 * plain English: proves the route answers a stranger, answers with three
 * fields and nothing else, and does not call Stripe once per visitor. Expected
 * outcome: a marketing page can quote a price without a gate being weakened or
 * Stripe being hammered.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const retrieveMock = vi.fn();

vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => ({ prices: { retrieve: retrieveMock } }),
  getConfiguredPriceId: (period: string) =>
    period === "monthly" ? process.env.STRIPE_PRICE_PARENT_MONTHLY || null : null,
}));

vi.mock("../../server/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const MONTHLY_PRICE = {
  unit_amount: 9999,
  currency: "USD",
  recurring: { interval: "month", interval_count: 1 },
};

async function buildApp() {
  const routes = await import("../../server/routes/public-pricing-routes");
  routes.__resetPublicPricingMemoForTests();
  const app = express();
  app.use("/api/public", routes.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  process.env.STRIPE_PRICE_PARENT_MONTHLY = "price_test_monthly";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.STRIPE_PRICE_PARENT_MONTHLY;
});

describe("GET /api/public/pricing", () => {
  it("answers a caller with no session at all", async () => {
    retrieveMock.mockResolvedValue(MONTHLY_PRICE);
    const app = await buildApp();

    const res = await request(app).get("/api/public/pricing");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { amountCents: 9999, currency: "usd", interval: "month" },
    });
  });

  /**
   * THE EGRESS ASSERTION. The response is served unauthenticated, so anything
   * it carries is public. Checked as an exact key set rather than field by
   * field: a field added to the serialized object later is the way a leak
   * arrives, and a per-field check passes right through it.
   */
  it("carries exactly three fields — no price id, no product, no plan list", async () => {
    retrieveMock.mockResolvedValue({ ...MONTHLY_PRICE, id: "price_test_monthly" });
    const app = await buildApp();

    const res = await request(app).get("/api/public/pricing");

    expect(Object.keys(res.body.data).sort()).toEqual([
      "amountCents",
      "currency",
      "interval",
    ]);
    expect(JSON.stringify(res.body)).not.toContain("price_");
    expect(JSON.stringify(res.body)).not.toContain("prod_");
  });

  it("hits Stripe once across many requests inside the memo window", async () => {
    retrieveMock.mockResolvedValue(MONTHLY_PRICE);
    const app = await buildApp();

    for (let i = 0; i < 5; i += 1) {
      await request(app).get("/api/public/pricing");
    }

    expect(retrieveMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads Stripe after the 15-minute window", async () => {
    retrieveMock.mockResolvedValue(MONTHLY_PRICE);
    const app = await buildApp();

    await request(app).get("/api/public/pricing");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await request(app).get("/api/public/pricing");

    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });

  /**
   * The two failure modes are DISTINGUISHABLE to a monitor and IDENTICAL to the
   * client — no number in either case. Collapsing them to one status would make
   * a misconfiguration and a Stripe outage look the same to whatever is
   * watching this route, and those wake different people.
   */
  it("reports an unconfigured price id as 404 with no amount", async () => {
    delete process.env.STRIPE_PRICE_PARENT_MONTHLY;
    const app = await buildApp();

    const res = await request(app).get("/api/public/pricing");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRICE_NOT_CONFIGURED");
    expect(res.body.data).toBeUndefined();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable Stripe as 502 with no amount and no fallback", async () => {
    retrieveMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const app = await buildApp();

    const res = await request(app).get("/api/public/pricing");

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PRICE_UNAVAILABLE");
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/\d{3,}/);
  });

  /**
   * A failure is memoised too — for 60 seconds, not 15 minutes. Caching only
   * successes would send every public request straight through to Stripe during
   * an outage, which is the traffic the memo exists to bound arriving exactly
   * when Stripe can least take it.
   */
  it("does not re-hit Stripe on every request while it is down", async () => {
    retrieveMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const app = await buildApp();

    for (let i = 0; i < 5; i += 1) {
      await request(app).get("/api/public/pricing");
    }
    expect(retrieveMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60 * 1000 + 1);
    await request(app).get("/api/public/pricing");
    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });

  /**
   * A yearly price id in the monthly variable. Publishing "$0.99 /month" beside
   * a yearly amount is worse than publishing nothing, and this is not
   * hypothetical: the live yearly price is `unit_amount: 99`, so a copy-paste
   * between the two env vars quotes ninety-nine cents a month.
   */
  it("refuses a configured price that is not a fixed monthly amount", async () => {
    retrieveMock.mockResolvedValue({
      unit_amount: 99,
      currency: "usd",
      recurring: { interval: "year", interval_count: 1 },
    });
    const app = await buildApp();

    const res = await request(app).get("/api/public/pricing");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRICE_NOT_CONFIGURED");
  });
});
