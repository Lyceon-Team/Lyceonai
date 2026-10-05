/**
 * F8 — `GET /api/csrf-token` says whether a session cookie came with the request.
 *
 * @spec [SEO plan F8; Coding Standards §7.1, §14] | @implemented [2026-10-05]
 *
 * plain English: drives the REAL app's CSRF bootstrap route and parses each answer with the
 * shared response schema, so the field the browser reads is the field the server sends. The
 * hint is `true` only for the `@supabase/ssr` session cookie (`sb-<ref>-auth-token`, chunked or
 * not); the PKCE verifier cookie, which shares the prefix, is not a session.
 *
 * edge cases: presence only. A cookie with a garbage value still reads `true`; the profile read
 * then answers 401 and the browser signs out, which is the behaviour before this hint existed.
 */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { csrfTokenResponseSchema } from "../../packages/shared/src/csrf-token-schema";

describe("F8 CSRF bootstrap session hint", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  }, 30_000);

  afterAll(() => {
    delete process.env.VITEST;
  });

  async function hint(cookie?: string): Promise<boolean> {
    const req = request(app).get("/api/csrf-token");
    const res = await (cookie ? req.set("Cookie", cookie) : req);
    expect(res.status).toBe(200);
    const body = csrfTokenResponseSchema.parse(res.body);
    expect(body.csrfToken.length).toBeGreaterThan(0);
    return body.sessionCookiePresent;
  }

  it("is false with no cookies", async () => {
    expect(await hint()).toBe(false);
  });

  it("is true with the session cookie", async () => {
    expect(await hint("sb-abcdef-auth-token=base64-e30")).toBe(true);
  });

  it("is true with a chunked session cookie", async () => {
    expect(
      await hint("sb-abcdef-auth-token.0=base64-e3; sb-abcdef-auth-token.1=0"),
    ).toBe(true);
  });

  it("is false with only the PKCE verifier cookie", async () => {
    expect(await hint("sb-abcdef-auth-token-code-verifier=xyz")).toBe(false);
  });

  it("is false with unrelated cookies", async () => {
    expect(await hint("lyceon-theme=dark; other=1")).toBe(false);
  });
});
