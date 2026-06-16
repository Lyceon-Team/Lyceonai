import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AUTH-001 / OAUTH-001: the custom hand-rolled Google OAuth flow
 * (server/routes/google-oauth-routes.ts with /api/auth/google/start + a server-held client secret)
 * was removed in favor of native Supabase OAuth. The browser now starts the flow with
 * supabase.auth.signInWithOAuth(...) and Supabase owns the OAuth callback at
 * <ref>.supabase.co/auth/v1/callback. The app only exposes a native PKCE landing route at
 * /auth/callback that exchanges the code for a session. This contract pins that landing route's
 * defensive behavior (no app-held secret, no Google token-endpoint call).
 */
const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
};

async function loadNativeOAuthApp() {
  vi.resetModules();
  process.env.NODE_ENV = "development";
  process.env.VITEST = "true";
  process.env.PUBLIC_SITE_URL = "https://lyceon.ai";

  const { default: oauthCallbackRoutes } =
    await import("../../server/routes/oauth-callback-routes");
  const app = express();
  app.use(cookieParser());
  app.use("/auth", oauthCallbackRoutes);
  return app;
}

describe("Native OAuth Callback Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = baselineEnv.NODE_ENV;
    process.env.VITEST = baselineEnv.VITEST;
    process.env.PUBLIC_SITE_URL = baselineEnv.PUBLIC_SITE_URL;
  });

  it("redirects to login when no authorization code is present", async () => {
    const app = await loadNativeOAuthApp();

    const res = await request(app).get("/auth/callback");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=google_oauth_failed",
    );
  });

  it("redirects to login when the provider returns an error", async () => {
    const app = await loadNativeOAuthApp();

    const res = await request(app).get("/auth/callback?error=access_denied");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=google_oauth_failed",
    );
  });
});
