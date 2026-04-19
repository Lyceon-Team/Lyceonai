import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

const { default: app } = await import("../server/index");

describe("Tutor Runtime Security", () => {
  it("rejects unauthenticated append-turn requests", async () => {
    const res = await request(app).post("/api/tutor/messages").send({
      conversation_id: "11111111-1111-4111-8111-111111111111",
      message: "hi",
      content_kind: "message",
      client_turn_id: "22222222-2222-4222-8222-222222222222",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects bearer-only auth for tutor endpoints", async () => {
    const res = await request(app)
      .post("/api/tutor/messages")
      .set("Authorization", "Bearer fake-token")
      .send({
        conversation_id: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        content_kind: "message",
        client_turn_id: "33333333-3333-4333-8333-333333333333",
      });

    expect([401, 403]).toContain(res.status);
    expect(res.body).not.toHaveProperty("data.response.answer");
  });
});
