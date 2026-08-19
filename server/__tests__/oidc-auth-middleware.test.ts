/**
 * @spec [Doc-03C_V3 §9.3]
 * @implemented 2026-08-15
 *
 * plain English: Tests for the OIDC token verification middleware used on
 * Cloud Tasks delivery routes. Exercises all §9.3 verification steps:
 *   (a) Valid OIDC token from correct SA with correct audience → 200
 *   (b) Missing Authorization header → 401
 *   (c) Wrong audience in token → 401
 *   (d) Wrong service account email → 401
 *   (e) Expired / invalid token → 401
 *   (f) Email not verified → 401
 *   (g) Static assertion: internal-memory-routes.ts uses oidcAuthMiddleware,
 *       not internalAuthMiddleware
 *
 * Uses mock of google-auth-library's OAuth2Client.verifyIdToken to avoid
 * hitting Google's key endpoints. The mock returns controlled TokenPayload
 * objects to exercise each failure mode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";

// ── Mock google-auth-library ────────────────────────────────────────

const { mockVerifyIdToken } = vi.hoisted(() => {
  const mockVerifyIdToken = vi.fn();
  return { mockVerifyIdToken };
});

vi.mock("google-auth-library", () => {
  class MockOAuth2Client {
    verifyIdToken = mockVerifyIdToken;
  }
  return {
    OAuth2Client: MockOAuth2Client,
  };
});

// ── Mock logger ─────────────────────────────────────────────────────

vi.mock("../../server/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────────

import { oidcAuthMiddleware } from "../../packages/shared/internal-auth/verify-oidc-middleware";

// ── Test helpers ────────────────────────────────────────────────────

const EXPECTED_AUDIENCE =
  "https://lyceon.ai/api/internal/memory/compact-writeback";
const EXPECTED_SA = "lisa-cloud-tasks@my-project.iam.gserviceaccount.com";

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

/**
 * Build a mock LoginTicket that returns the given payload.
 * Matches google-auth-library's LoginTicket.getPayload() interface.
 */
function mockTicket(payload: Record<string, unknown>) {
  return {
    getPayload: () => payload,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("oidcAuthMiddleware (Doc 03C §9.3)", () => {
  let middleware: ReturnType<typeof oidcAuthMiddleware>;
  let nextFn: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = oidcAuthMiddleware({
      expectedAudience: EXPECTED_AUDIENCE,
      expectedServiceAccount: EXPECTED_SA,
    });
    nextFn = vi.fn();
  });

  // ── (a) Valid token ─────────────────────────────────────────────

  it("passes through when OIDC token is valid (correct SA, audience, issuer)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "https://accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        email: EXPECTED_SA,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: "1234567890",
      }),
    );

    const req = createMockReq(`Bearer valid-oidc-token-here`);
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(0); // status() never called
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: "valid-oidc-token-here",
      audience: EXPECTED_AUDIENCE,
    });
  });

  // ── (b) Missing Authorization header ────────────────────────────

  it("rejects with 401 when Authorization header is missing", async () => {
    const req = createMockReq(); // no auth header
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body).toEqual({
      error: {
        code: "oidc_auth_failed",
        message: "OIDC authentication failed",
      },
    });
  });

  it("rejects with 401 when Authorization header is empty string", async () => {
    const req = createMockReq("");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("rejects with 401 when Authorization header has no Bearer prefix", async () => {
    const req = createMockReq("Basic some-credentials");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── (c) Wrong audience ──────────────────────────────────────────

  it("rejects with 401 when token audience does not match", async () => {
    // google-auth-library throws when audience doesn't match
    mockVerifyIdToken.mockRejectedValueOnce(
      new Error(
        "Token audience mismatch. Expected https://lyceon.ai/api/internal/memory/compact-writeback",
      ),
    );

    const req = createMockReq("Bearer wrong-audience-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body).toEqual({
      error: {
        code: "oidc_auth_failed",
        message: "OIDC authentication failed",
      },
    });
  });

  // ── (d) Wrong service account ───────────────────────────────────

  it("rejects with 401 when service account email does not match", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "https://accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        email: "wrong-sa@other-project.iam.gserviceaccount.com",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: "1234567890",
      }),
    );

    const req = createMockReq("Bearer valid-sig-wrong-sa");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── (e) Expired / invalid token ─────────────────────────────────

  it("rejects with 401 when token is expired", async () => {
    // google-auth-library throws on expired tokens
    mockVerifyIdToken.mockRejectedValueOnce(new Error("Token used too late"));

    const req = createMockReq("Bearer expired-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("rejects with 401 when token signature is invalid", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      new Error("Invalid token signature"),
    );

    const req = createMockReq("Bearer bad-signature-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── (f) Email not verified ──────────────────────────────────────

  it("rejects with 401 when service account email_verified is false", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "https://accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        email: EXPECTED_SA,
        email_verified: false, // not verified
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: "1234567890",
      }),
    );

    const req = createMockReq("Bearer unverified-email-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── Wrong issuer ────────────────────────────────────────────────

  it("rejects with 401 when issuer is not accounts.google.com", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "https://evil-issuer.example.com",
        aud: EXPECTED_AUDIENCE,
        email: EXPECTED_SA,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: "1234567890",
      }),
    );

    const req = createMockReq("Bearer wrong-issuer-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── Empty payload ───────────────────────────────────────────────

  it("rejects with 401 when token payload is null", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => null,
    });

    const req = createMockReq("Bearer null-payload-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  // ── Accepts accounts.google.com without https:// ────────────────

  it("accepts issuer 'accounts.google.com' (without https://)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        email: EXPECTED_SA,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: "1234567890",
      }),
    );

    const req = createMockReq("Bearer alt-issuer-format-token");
    const res = createMockRes();

    await middleware(req, res, nextFn);

    expect(nextFn).toHaveBeenCalledTimes(1);
  });

  // ── All failures return identical response (§67 convention) ─────

  it("all failure modes return the same §67-style response body", async () => {
    const expectedBody = {
      error: {
        code: "oidc_auth_failed",
        message: "OIDC authentication failed",
      },
    };

    // Failure mode 1: missing header
    const res1 = createMockRes();
    await middleware(createMockReq(), res1, vi.fn());
    expect(res1._body).toEqual(expectedBody);

    // Failure mode 2: bad signature
    mockVerifyIdToken.mockRejectedValueOnce(new Error("Invalid signature"));
    const res2 = createMockRes();
    await middleware(createMockReq("Bearer bad"), res2, vi.fn());
    expect(res2._body).toEqual(expectedBody);

    // Failure mode 3: wrong SA
    mockVerifyIdToken.mockResolvedValueOnce(
      mockTicket({
        iss: "https://accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        email: "wrong@project.iam.gserviceaccount.com",
        email_verified: true,
      }),
    );
    const res3 = createMockRes();
    await middleware(createMockReq("Bearer wrong-sa"), res3, vi.fn());
    expect(res3._body).toEqual(expectedBody);

    // All return 401
    expect(res1._status).toBe(401);
    expect(res2._status).toBe(401);
    expect(res3._status).toBe(401);
  });
});

// ── Static assertion: route uses OIDC, not HMAC ─────────────────────

describe("internal-memory-routes.ts auth mechanism (static)", () => {
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, "../routes/internal-memory-routes.ts"),
    "utf-8",
  );

  it("(g) uses oidcAuthMiddleware, not internalAuthMiddleware", () => {
    expect(routeSource).toContain("oidcAuthMiddleware");
    expect(routeSource).not.toContain("internalAuthMiddleware");
  });

  it("imports from verify-oidc-middleware, not verify-middleware", () => {
    expect(routeSource).toContain("verify-oidc-middleware");
    expect(routeSource).not.toContain(
      'from "../../packages/shared/internal-auth/verify-middleware"',
    );
  });
});

// ── Static assertion: cloud-tasks-enqueue uses OIDC token config ────

describe("cloud-tasks-enqueue.ts OIDC configuration (static)", () => {
  const enqueueSource = fs.readFileSync(
    path.resolve(__dirname, "../services/cloud-tasks-enqueue.ts"),
    "utf-8",
  );

  it("configures oidcToken in task body (not HMAC headers)", () => {
    expect(enqueueSource).toContain("oidcToken");
    expect(enqueueSource).toContain("serviceAccountEmail");
    expect(enqueueSource).toContain("audience");
  });

  it("does not import or use signInternalRequest", () => {
    expect(enqueueSource).not.toContain("signInternalRequest");
    expect(enqueueSource).not.toContain("hmacHeaders");
  });

  it("does not reference HMAC signing", () => {
    // Ensure no HMAC signing code remains
    expect(enqueueSource).not.toContain("sign-request");
    expect(enqueueSource).not.toContain("x-lyceon-signature");
    expect(enqueueSource).not.toContain("x-lyceon-timestamp");
    expect(enqueueSource).not.toContain("x-lyceon-service-id");
  });
});
