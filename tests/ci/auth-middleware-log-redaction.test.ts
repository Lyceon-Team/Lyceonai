import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

/**
 * @spec [Coding Standards §12.1 "never log sensitive content"; Doc 01A §14 PII redaction;
 *   register F-10, OQ-14 ruling 2026-09-29] | @implemented [2026-09-29] |
 * plain English: `supabaseAuthMiddleware` runs on every signed-in request and logs
 * `user_authenticated`. That event must carry no email and no display name. The real middleware
 * runs here; only its two IO seams (the SSR client's getUser and the profile bootstrap) are
 * stubbed, with a profile shaped like the one `ensureProfileForAuthUser` returns.
 */

const PROFILE_EMAIL = "middleware-log@example.com";
const PROFILE_NAME = "Middleware Student";

vi.mock("../../server/lib/supabase-ssr", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "auth-user-1", email: PROFILE_EMAIL } },
        error: null,
      }),
    },
  }),
}));

vi.mock("../../server/lib/profile-bootstrap", () => ({
  AccountEmailConflictError: class AccountEmailConflictError extends Error {},
  ensureProfileForAuthUser: async () => ({
    id: "profile-1",
    email: PROFILE_EMAIL,
    display_name: PROFILE_NAME,
    role: "student",
    is_under_13: false,
    guardian_consent: false,
    profile_completed_at: null,
    student_link_code: null,
    actor_id: "actor-1",
  }),
}));

describe("supabaseAuthMiddleware — no personal data reaches the logger (F-10)", () => {
  it("user_authenticated logs no email and no display name", async () => {
    const { logger } = await import("../../server/logger");
    const { supabaseAuthMiddleware } =
      await import("../../server/middleware/supabase-auth");
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    // `path` is always set by Express; the middleware reads it (internal routes skip the lookup).
    const req = {
      requestId: "req-mw-log",
      path: "/api/profile",
      cookies: {},
      headers: {},
    };
    const res = {};
    const next = vi.fn();

    await supabaseAuthMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as unknown as NextFunction,
    );

    // Presence first: the user was attached and the event was emitted.
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as { user?: { email?: string } }).user?.email).toBe(
      PROFILE_EMAIL,
    );
    const operations = [info, warn, error].flatMap((spy) =>
      spy.mock.calls.map((call) => call[1]),
    );
    expect(operations).toContain("user_authenticated");

    const serialized = JSON.stringify(
      [info, warn, error].flatMap((spy) => spy.mock.calls),
    );
    expect(serialized).not.toContain(PROFILE_EMAIL);
    expect(serialized).not.toContain(PROFILE_NAME);
  });
});
