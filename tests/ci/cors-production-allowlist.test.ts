import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  resolveOriginEnvironment,
} from "../../server/middleware/origin-utils";
import { corsMiddleware } from "../../apps/api/src/middleware/cors";

/**
 * @spec [owner ruling F-28, 2026-09-30; Coding Standards §7.3; register F-28] |
 *   @implemented [2026-09-30] |
 * plain English: in production the CORS allowlist is exactly `https://lyceon.ai` and
 * `https://www.lyceon.ai`, even when CORS_ORIGINS / CSRF_ALLOWED_ORIGINS carry development
 * origins (they did in production: localhost and a Replit workspace, Wave 0 boot log). A request
 * from `http://localhost:5173` gets no CORS allow header. Development still gets its local
 * origins. NODE_ENV is parsed with the shared env schema; anything else fails closed.
 */

const PROD_ORIGINS = ["https://lyceon.ai", "https://www.lyceon.ai"];
const DEV_CSV =
  "http://localhost:5000,http://localhost:3000,http://localhost:5173,https://abc-123.kirk.replit.dev";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  CSRF_ALLOWED_ORIGINS: process.env.CSRF_ALLOWED_ORIGINS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("CORS allowlist in production (F-28)", () => {
  it("is exactly the two production origins, whatever the env lists say", () => {
    const { raw } = buildAllowedOrigins({
      nodeEnv: "production",
      corsOriginsCsv: DEV_CSV,
      csrfOriginsCsv: DEV_CSV,
    });
    expect(raw).toEqual(PROD_ORIGINS);
  });

  it("treats a missing or unknown NODE_ENV as production (fails closed)", () => {
    expect(resolveOriginEnvironment(undefined)).toBe("production");
    expect(resolveOriginEnvironment("")).toBe("production");
    expect(resolveOriginEnvironment("prod")).toBe("production");
    expect(resolveOriginEnvironment("development")).toBe("development");
    expect(resolveOriginEnvironment("test")).toBe("test");
  });

  it("development keeps its local origins and the env lists", () => {
    const { raw } = buildAllowedOrigins({
      nodeEnv: "development",
      corsOriginsCsv: "https://abc-123.kirk.replit.dev",
    });
    expect(raw).toEqual(
      expect.arrayContaining([
        ...PROD_ORIGINS,
        "http://localhost:5173",
        "https://abc-123.kirk.replit.dev",
      ]),
    );
  });

  it("over HTTP with NODE_ENV=production: localhost gets no allow header, lyceon.ai does", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = DEV_CSV;
    process.env.CSRF_ALLOWED_ORIGINS = DEV_CSV;
    const app = express();
    app.use(corsMiddleware());
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));

    const allowed = await request(app)
      .options("/api/ping")
      .set("Origin", "https://lyceon.ai")
      .set("Access-Control-Request-Method", "GET");
    // Presence first: the middleware does answer an allowed origin.
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://lyceon.ai",
    );

    const preflight = await request(app)
      .options("/api/ping")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();

    const simple = await request(app)
      .get("/api/ping")
      .set("Origin", "http://localhost:5173");
    expect(simple.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
