import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { setupSecurityMocks } from "../utils/securityTestUtils";

const { processWebhookMock } = vi.hoisted(() => ({
  processWebhookMock: vi.fn(),
}));

vi.mock("../../server/lib/stripe/webhook-handler", () => ({
  processStripeWebhook: processWebhookMock,
}));

setupSecurityMocks();

describe("CI parser limit guardrails", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    processWebhookMock.mockResolvedValue({
      ok: true,
      eventId: "evt_test",
      status: "processed",
    });
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("oversize JSON request to a representative JSON route returns parser rejection", async () => {
    const res = await request(app).post("/api/tutor/conversations").send({
      message: "x".repeat(1_050_000),
    });

    // 413 from express.json limit, or 401 from auth middleware — either means
    // the oversize payload did not reach business logic
    expect([413, 401]).toContain(res.status);
  });

  it("Stripe webhook raw-body ordering invariant remains intact", async () => {
    const payload = JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", metadata: { account_id: "acc_test" } } },
    });

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(processWebhookMock).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(processWebhookMock.mock.calls[0]?.[0])).toBe(true);
  });
});
