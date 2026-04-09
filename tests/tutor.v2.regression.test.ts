import request from "supertest";
import app from "../server/index";
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

describe("Tutor Route Regression", () => {
  it("hard-cutover removes /api/tutor/v2 mount", async () => {
    const res = await request(app)
      .post("/api/tutor/v2")
      .set("Origin", "http://localhost:5000")
      .send({ message: "Help me" });

    expect([401, 404]).toContain(res.status);
  });

  it("canonical append endpoint exists and remains auth-first", async () => {
    const res = await request(app)
      .post("/api/tutor/messages")
      .set("Origin", "http://localhost:5000")
      .send({
        conversation_id: "11111111-1111-4111-8111-111111111111",
        message: "Help me",
        content_kind: "message",
        client_turn_id: "22222222-2222-4222-8222-222222222222",
      });

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty("answer");
    expect(res.body).not.toHaveProperty("explanation");
  });
});
