import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { setupSecurityMocks } from "../utils/securityTestUtils";

const { handleRagQueryMock, processWebhookMock } = vi.hoisted(() => ({
  handleRagQueryMock: vi.fn(),
  processWebhookMock: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/rag-service", () => ({
  getRagService: () => ({
    handleRagQuery: handleRagQueryMock,
  }),
}));

vi.mock("../../server/lib/webhookHandlers", () => ({
  WebhookHandlers: {
    processWebhook: processWebhookMock,
  },
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
    handleRagQueryMock.mockResolvedValue({
      context: {
        primaryQuestion: null,
        supportingQuestions: [],
        competencyContext: {
          studentWeakAreas: [],
          studentStrongAreas: [],
          competencyLabels: [],
        },
        studentProfile: null,
      },
      metadata: {
        canonicalIdsUsed: [],
        mode: "concept",
        processingTimeMs: 1,
      },
    });
    processWebhookMock.mockResolvedValue({
      received: true,
      eventId: "evt_test",
      status: "processed",
    });
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("oversize JSON request to a representative JSON route returns parser rejection", async () => {
    const res = await request(app).post("/api/rag/v2").send({
      userId: "ignored",
      message: "x".repeat(1_050_000),
      mode: "concept",
    });

    expect(res.status).toBe(413);
  });

  it("under-limit normal request still succeeds", async () => {
    const res = await request(app).post("/api/rag/v2").send({
      userId: "ignored",
      message: "Help me with this SAT concept",
      mode: "concept",
    });

    expect(res.status).toBe(200);
    expect(handleRagQueryMock).toHaveBeenCalledTimes(1);
  });

  it("oversize JSON to /api/rag/v2 is rejected before route logic executes", async () => {
    const res = await request(app).post("/api/rag/v2").send({
      userId: "ignored",
      message: "y".repeat(1_050_000),
      mode: "concept",
    });

    expect(res.status).toBe(413);
    expect(handleRagQueryMock).not.toHaveBeenCalled();
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
