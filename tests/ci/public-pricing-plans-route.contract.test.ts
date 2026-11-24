/**
 * `GET /api/public/pricing/plans`: unauthenticated, three price tags, memoised, no ids.
 *
 * @spec [Doc 09 §1.4, §5.1; owner brief 2026-11-22 (/parent prices from the API, all three
 *        plans); owner ruling 2026-09-03 (the monthly route stays three fields, no plan list)]
 *        | @implemented [2026-11-22]
 *
 * plain English: proves the plan list answers a stranger with each configured plan's amount,
 * currency, interval and interval count and nothing else; leaves out a plan whose Stripe price
 * has the wrong interval rather than labelling it wrongly; reads Stripe once per memo window;
 * and answers 404/502 with no amount when there is nothing true to say. It also re-proves the
 * monthly route is untouched by the sibling: still exactly three fields.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const retrieveMock = vi.fn();

const PRICE_IDS: Record<string, string | undefined> = {};

vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => ({ prices: { retrieve: retrieveMock } }),
  getConfiguredPriceId: (period: string) => PRICE_IDS[period] ?? null,
}));

vi.mock("../../server/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const STRIPE_PRICES: Record<string, unknown> = {
  price_m: {
    id: "price_m",
    product: "prod_x",
    unit_amount: 5717,
    currency: "USD",
    recurring: { interval: "month", interval_count: 1 },
  },
  price_q: {
    id: "price_q",
    product: "prod_x",
    unit_amount: 14321,
    currency: "USD",
    recurring: { interval: "month", interval_count: 3 },
  },
  price_y: {
    id: "price_y",
    product: "prod_x",
    unit_amount: 47003,
    currency: "USD",
    recurring: { interval: "year", interval_count: 1 },
  },
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
  PRICE_IDS.monthly = "price_m";
  PRICE_IDS.quarterly = "price_q";
  PRICE_IDS.yearly = "price_y";
  retrieveMock.mockImplementation(async (id: string) => STRIPE_PRICES[id]);
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of Object.keys(PRICE_IDS)) delete PRICE_IDS[k];
});

describe("GET /api/public/pricing/plans", () => {
  it("answers a caller with no session with all three plans' price tags", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing/plans");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=900");
    expect(res.body).toEqual({
      data: {
        plans: [
          {
            plan: "monthly",
            amountCents: 5717,
            currency: "usd",
            interval: "month",
            intervalCount: 1,
          },
          {
            plan: "quarterly",
            amountCents: 14321,
            currency: "usd",
            interval: "month",
            intervalCount: 3,
          },
          {
            plan: "yearly",
            amountCents: 47003,
            currency: "usd",
            interval: "year",
            intervalCount: 1,
          },
        ],
      },
    });
  });

  it("carries no price id and no product", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing/plans");
    const body = JSON.stringify(res.body);
    expect(res.body.data.plans).toHaveLength(3);
    expect(body).not.toContain("price_");
    expect(body).not.toContain("prod_");
  });

  it("leaves out a plan whose configured price has the wrong interval", async () => {
    PRICE_IDS.yearly = "price_m"; // a monthly id in the yearly variable
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing/plans");
    expect(res.status).toBe(200);
    expect(res.body.data.plans.map((p: { plan: string }) => p.plan)).toEqual([
      "monthly",
      "quarterly",
    ]);
  });

  it("reads Stripe once per plan across many requests inside the memo window", async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i += 1) {
      await request(app).get("/api/public/pricing/plans");
    }
    expect(retrieveMock).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await request(app).get("/api/public/pricing/plans");
    expect(retrieveMock).toHaveBeenCalledTimes(6);
  });

  it("reports no configured plan as 404 with no amount", async () => {
    for (const k of Object.keys(PRICE_IDS)) delete PRICE_IDS[k];
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing/plans");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRICE_NOT_CONFIGURED");
    expect(JSON.stringify(res.body)).not.toMatch(/amountCents|\d{3,}/);
  });

  it("reports an unreachable Stripe as 502 with no fallback amount", async () => {
    retrieveMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing/plans");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PRICE_UNAVAILABLE");
    expect(res.body).not.toHaveProperty("data");
  });

  it("leaves the monthly route at exactly three fields (ruling 2026-09-03)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/public/pricing");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual([
      "amountCents",
      "currency",
      "interval",
    ]);
  });
});
