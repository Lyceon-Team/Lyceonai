/**
 * @spec [Doc-03C_V3 §9.3; Doc-01A §3] | @implemented 2026-09-01
 *
 * plain English: `oidcAuthMiddlewareWithConfigGuard` replaces the module-scope
 * throw that took production down on 2026-08-27. These tests pin the property
 * that made the replacement safe: an unconfigured internal route REFUSES, it
 * does not fall through. Doc 01A §3's intent — never serve with auth silently
 * disabled — has to survive the move from import time to request time, and a
 * guard that 500s but still calls `next()` would be strictly worse than the
 * crash it replaces.
 *
 * expected outcome:
 *   (a) missing audience          → 500, next() NOT called
 *   (b) missing service account   → 500, next() NOT called
 *   (c) both missing              → 500, both names logged, no values logged
 *   (d) empty string (not just undefined) counts as missing
 *   (e) fully configured          → delegates to real OIDC verification
 *   (f) config read PER REQUEST — a var set after boot is picked up
 *   (g) config that disappears between requests stops being honoured
 *
 * trade-offs:
 *  - google-auth-library is mocked (same approach as oidc-auth-middleware.test.ts)
 *    so (e) proves delegation without reaching Google's key endpoint.
 *  - The reader is injected rather than read from `process.env` inside the
 *    middleware, so these tests never mutate real process state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { mockVerifyIdToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
}));

vi.mock("google-auth-library", () => {
  class MockOAuth2Client {
    verifyIdToken = mockVerifyIdToken;
  }
  return { OAuth2Client: MockOAuth2Client };
});

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/logger", () => ({ logger: mockLogger }));

import {
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
} from "../../packages/shared/internal-auth/verify-oidc-middleware";

const AUDIENCE = "https://lyceon.ai/api/internal/memory/compact-writeback";
const SERVICE_ACCOUNT = "lisa-cloud-tasks@my-project.iam.gserviceaccount.com";

function createMockReq(authHeader?: string): Request {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    path: "/memory/compact-writeback",
    method: "POST",
  } as unknown as Request;
}

function createMockRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

function reader(
  expectedAudience: string | undefined,
  expectedServiceAccount: string | undefined,
): OidcConfigReader {
  return () => ({ expectedAudience, expectedServiceAccount });
}

describe("oidcAuthMiddlewareWithConfigGuard — refuses instead of crashing", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn() as unknown as NextFunction;
  });

  it("(a) missing audience → 500 and next() is never called", async () => {
    const mw = oidcAuthMiddlewareWithConfigGuard(
      reader(undefined, SERVICE_ACCOUNT),
    );
    const res = createMockRes();

    await mw(createMockReq("Bearer tok"), res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("(b) missing service account → 500 and next() is never called", async () => {
    const mw = oidcAuthMiddlewareWithConfigGuard(reader(AUDIENCE, undefined));
    const res = createMockRes();

    await mw(createMockReq("Bearer tok"), res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("(c) logs which variables are missing, and never their values", async () => {
    const mw = oidcAuthMiddlewareWithConfigGuard(reader(undefined, undefined));

    await mw(createMockReq(), createMockRes(), next);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const call = mockLogger.error.mock.calls[0];
    const serialised = JSON.stringify(call);

    expect(serialised).toContain("CLOUD_TASKS_OIDC_AUDIENCE");
    expect(serialised).toContain("CLOUD_TASKS_SERVICE_ACCOUNT");
    // The token is a credential; it must never reach the log.
    expect(serialised).not.toContain("Bearer");
  });

  it("(d) an empty string counts as missing, not as configured", async () => {
    const mw = oidcAuthMiddlewareWithConfigGuard(reader("", ""));
    const res = createMockRes();

    await mw(createMockReq("Bearer tok"), res, next);

    expect(res._status).toBe(500);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("(e) fully configured → delegates to OIDC verification and calls next()", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        aud: AUDIENCE,
        iss: "https://accounts.google.com",
        email: SERVICE_ACCOUNT,
        email_verified: true,
      }),
    });

    const mw = oidcAuthMiddlewareWithConfigGuard(
      reader(AUDIENCE, SERVICE_ACCOUNT),
    );
    const res = createMockRes();

    await mw(createMockReq("Bearer tok"), res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(0);
  });

  it("(f) reads config per request — a var set after boot is honoured", async () => {
    let audience: string | undefined = undefined;
    const mw = oidcAuthMiddlewareWithConfigGuard(() => ({
      expectedAudience: audience,
      expectedServiceAccount: SERVICE_ACCOUNT,
    }));

    const first = createMockRes();
    await mw(createMockReq("Bearer tok"), first, next);
    expect(first._status).toBe(500);

    // Import-time capture would make this unreachable; per-request read does not.
    audience = AUDIENCE;
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        aud: AUDIENCE,
        iss: "https://accounts.google.com",
        email: SERVICE_ACCOUNT,
        email_verified: true,
      }),
    });

    const second = createMockRes();
    await mw(createMockReq("Bearer tok"), second, next);

    expect(second._status).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("(g) config that disappears is not served from the cached middleware", async () => {
    let serviceAccount: string | undefined = SERVICE_ACCOUNT;
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        aud: AUDIENCE,
        iss: "https://accounts.google.com",
        email: SERVICE_ACCOUNT,
        email_verified: true,
      }),
    });

    const mw = oidcAuthMiddlewareWithConfigGuard(() => ({
      expectedAudience: AUDIENCE,
      expectedServiceAccount: serviceAccount,
    }));

    await mw(createMockReq("Bearer tok"), createMockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    serviceAccount = undefined;
    const after = createMockRes();
    await mw(createMockReq("Bearer tok"), after, next);

    expect(after._status).toBe(500);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
