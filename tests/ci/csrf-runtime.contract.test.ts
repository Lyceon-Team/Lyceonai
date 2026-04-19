import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request, { type SuperAgentTest } from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

async function getCsrfToken(agent: SuperAgentTest, path = "/api/csrf-token"): Promise<string> {
  const res = await agent.get(path);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("csrfToken");
  return res.body.csrfToken as string;
}

describe("CSRF runtime contract - app routes", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterEach(() => {
    delete process.env.VITEST;
  });

  it("allows localhost origin in test config for protected auth mutation", async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/api/auth/signout")
      .set("x-csrf-token", token)
      .set("Origin", "http://localhost:5000");

    expect(res.status).not.toBe(403);
  });

  it("blocks disallowed origin for protected auth mutation", async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/api/auth/signout")
      .set("x-csrf-token", token)
      .set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error.code", "csrf_blocked");
  });

  it("keeps Stripe webhook CSRF-exempt and signature-protected", async () => {
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_test" }));

    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty("error.code", "csrf_blocked");
  });
});

describe("CSRF runtime contract - production origin rules", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    vi.resetModules();
    process.env = { ...envSnapshot };
  });

  async function buildProductionCsrfApp() {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.CSRF_SECRET = "prod-test-csrf-secret";
    process.env.CORS_ORIGINS = "https://lyceon.ai,https://www.lyceon.ai";
    process.env.CSRF_ALLOWED_ORIGINS = "https://lyceon.ai,https://www.lyceon.ai";
    process.env.CSRF_COOKIE_SECURE = "false";

    const { doubleCsrfProtection, generateToken } = await import("../../server/middleware/csrf-double-submit");
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.requestId = "req-csrf-runtime-contract";
      next();
    });

    app.get("/api/csrf-token", (req, res) => {
      const token = generateToken(req, res);
      res.json({ csrfToken: token });
    });

    app.post("/api/protected", doubleCsrfProtection, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    return app;
  }

  it("blocks missing Origin for protected browser mutation in production", async () => {
    const app = await buildProductionCsrfApp();
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);

    const res = await agent.post("/api/protected").set("x-csrf-token", token).send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error.code", "csrf_blocked");
    expect(res.body).toHaveProperty("reason", "missing_origin");
  });

  it("allows canonical production origin for protected mutation", async () => {
    const app = await buildProductionCsrfApp();
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/api/protected")
      .set("x-csrf-token", token)
      .set("Origin", "https://lyceon.ai")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("blocks disallowed origin for protected mutation in production", async () => {
    const app = await buildProductionCsrfApp();
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/api/protected")
      .set("x-csrf-token", token)
      .set("Origin", "https://evil.example")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error.code", "csrf_blocked");
    expect(res.body).toHaveProperty("reason", "disallowed_origin");
  });
});
