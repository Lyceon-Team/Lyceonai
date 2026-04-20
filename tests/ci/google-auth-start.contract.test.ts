import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};

async function loadGoogleAuthApp() {
  vi.resetModules();
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.PUBLIC_SITE_URL = "https://lyceon.ai";
  process.env.GOOGLE_CLIENT_ID = "123456-abc.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "secret-value";

  const { default: googleOAuthRoutes } = await import("../../server/routes/google-oauth-routes");
  const app = express();
  app.use(cookieParser());
  app.use("/api/auth/google", googleOAuthRoutes);
  return app;
}

describe("Google Auth Start Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = baselineEnv.NODE_ENV;
    process.env.VITEST = baselineEnv.VITEST;
    process.env.PUBLIC_SITE_URL = baselineEnv.PUBLIC_SITE_URL;
    process.env.GOOGLE_CLIENT_ID = baselineEnv.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = baselineEnv.GOOGLE_CLIENT_SECRET;
  });

  it("blocks start without explicit legal consent proof", async () => {
    const app = await loadGoogleAuthApp();

    const res = await request(app).get("/api/auth/google/start");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://lyceon.ai/login?error=consent_required");
  });

  it("allows start with explicit pre-oauth legal consent and sets proof cookies", async () => {
    const app = await loadGoogleAuthApp();

    const res = await request(app)
      .get("/api/auth/google/start?termsAccepted=true&privacyAccepted=true&consentSource=google_continue_pre_oauth");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(res.headers["set-cookie"]).toBeTruthy();

    const cookies = res.headers["set-cookie"] ?? [];
    expect(cookies.some((cookie: string) => cookie.startsWith("google_oauth_state="))).toBe(true);
    expect(cookies.some((cookie: string) => cookie.startsWith("google_oauth_consent="))).toBe(true);
  });
});
