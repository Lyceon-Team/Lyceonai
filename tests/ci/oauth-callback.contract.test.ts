import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @spec [contracts/auth-login-e2e.contract.md AL-4 (OAuth path) / AL-3 / AL-7 |
 *   Doc-01_V8 §9 Login and signup flows / §37.1 Under-13 gating]
 * @implemented [2026-06-18]
 *
 * Models the production OAuth/email-confirmation callback routing that the Playwright spec cannot
 * reach (real Google can't complete headlessly). This is the COPPA-load-bearing seam: an
 * OAuth-created INCOMPLETE profile must be DOB-gated to /profile/complete. The handler is exercised
 * with mocked Supabase session establishment + a mocked profile bootstrap, so the gating logic —
 * not just the button — is proven. Would FAIL if OAuth DOB-gating regressed (closes AUDIT-AL4-PROOF-001).
 */

const exchangeCodeForSessionMock = vi.hoisted(() => vi.fn());
const verifyOtpMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const ensureProfileMock = vi.hoisted(() => vi.fn());
const captureLegalMock = vi.hoisted(() => vi.fn());

vi.mock("../../server/lib/supabase-ssr.js", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
      verifyOtp: verifyOtpMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock("../../server/middleware/supabase-auth.js", () => ({
  getSupabaseAdmin: () => ({}),
}));

// Keep AccountEmailConflictError real (the handler's catch uses `instanceof`); override only the
// bootstrap. No resetModules, so the statically-imported class === the class the handler checks.
vi.mock("../../server/lib/profile-bootstrap.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/lib/profile-bootstrap.js")
    >();
  return {
    ...actual,
    ensureProfileForAuthUser: ensureProfileMock,
  };
});

// captureLegalAcceptances is mocked so we can drive durable:true (single-store failure absorbed →
// session survives) vs durable:false (both stores down → fail closed) at the finalize seam.
vi.mock("../../server/lib/legal-acceptance.js", () => ({
  captureLegalAcceptances: captureLegalMock,
}));

import oauthRouter from "../../server/routes/oauth-callback-routes";
import { AccountEmailConflictError } from "../../server/lib/profile-bootstrap.js";

const SESSION = { access_token: "a".repeat(20), refresh_token: "r".repeat(20) };
const USER = { id: "user-oauth", email: "oauth@example.com" };

type ProfileShape = {
  profile_completed_at: string | null;
  is_under_13: boolean;
  guardian_consent: boolean;
  role: "student" | "guardian";
};

const baselineSiteUrl = process.env.PUBLIC_SITE_URL;

function makeApp() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "test-oauth-callback";
    next();
  });
  app.use("/auth", oauthRouter);
  return app;
}

function okExchange(): void {
  exchangeCodeForSessionMock.mockResolvedValueOnce({
    data: { session: SESSION, user: USER },
    error: null,
  });
}

describe("OAuth callback routing (AL-4 OAuth path, AL-3, AL-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_SITE_URL = "https://lyceon.ai";
    // Default: consent durably captured. Tests that exercise the both-store-down path override this.
    captureLegalMock.mockResolvedValue({ durable: true });
  });

  afterEach(() => {
    if (baselineSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = baselineSiteUrl;
  });

  // AL-4 — the COPPA-load-bearing OAuth DOB gate. THE assertion the Playwright spec could not make.
  it("DOB-gates an OAuth-created incomplete profile to /profile/complete", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("valid-code");
  });

  it("DOB-gates an under-13 profile awaiting guardian consent to /profile/complete (even when completed_at is set)", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: true,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
  });

  it("routes a completed student to /dashboard", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
  });

  it("routes a completed guardian to /guardian", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "guardian",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/guardian");
  });

  // AS-1 (decoupling) — when consent is durably captured (even via the outbox after a direct-write
  // failure), the session is kept and the user lands normally. No signOut, no error.
  it("keeps the session and lands normally when consent is durably captured (AS-1)", async () => {
    okExchange();
    captureLegalMock.mockResolvedValueOnce({ durable: true });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&consentSource=google_continue_click",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
    expect(res.headers.location).not.toContain("error=");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  // AS1-OUTBOX-DROP-001 — when consent cannot be durably captured ANYWHERE (both stores down), do NOT
  // silently proceed: fail closed (signOut) with a recoverable error rather than dropping compliance.
  it("fails closed when consent cannot be durably captured (AS1-OUTBOX-DROP-001)", async () => {
    okExchange();
    captureLegalMock.mockResolvedValueOnce({ durable: false });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&consentSource=google_continue_click",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=consent_capture_failed",
    );
    expect(signOutMock).toHaveBeenCalled();
  });

  // AS-5 — password recovery: token_hash+type=recovery establishes a session via verifyOtp, then
  // routes to the set-new-password page (NOT /dashboard) so the user can complete the reset.
  it("recovery (token_hash + next) establishes a session and routes to /update-password", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: SESSION, user: USER },
      error: null,
    });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=rec123&type=recovery&next=%2Fupdate-password",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/update-password");
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: "rec123",
      type: "recovery",
    });
  });

  // AS-5 — open-redirect guard: a `next` not on the allowlist is ignored; default landing is used.
  it("ignores an unsafe next and uses the default landing (open-redirect guard)", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=https://evil.example.com",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
  });

  // AL-3 — native email-confirmation handoff completes via verifyOtp, same DOB gate, no code path.
  it("completes the email-confirmation handoff via verifyOtp and DOB-gates incomplete profiles", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: SESSION, user: USER },
      error: null,
    });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      guardian_consent: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=abc123&type=signup",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: "abc123",
      type: "signup",
    });
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  // AL-7 — profile-per-human conflict from the callback path is a deliberate redirect, never a 500.
  it("redirects a profile-per-human conflict to /login?error=account_exists and signs out", async () => {
    okExchange();
    ensureProfileMock.mockRejectedValueOnce(
      new AccountEmailConflictError("already exists"),
    );

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=account_exists",
    );
    expect(signOutMock).toHaveBeenCalled();
  });

  it("redirects a failed session establishment to /login?error=supabase_exchange", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "bad code" },
    });

    const res = await request(makeApp()).get("/auth/callback?code=bad-code");

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=supabase_exchange",
    );
  });

  it("rejects a callback with neither code nor token to /login?error=google_oauth_failed", async () => {
    const res = await request(makeApp()).get("/auth/callback");

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=google_oauth_failed",
    );
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});
