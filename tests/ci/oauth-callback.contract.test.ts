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
const hasActiveGuardianLinkMock = vi.hoisted(() => vi.fn(async () => false));
// Brief 8 ruling 4: the callback records a completed recovery link as a server-held grant.
const grantPasswordRecoveryMock = vi.hoisted(() =>
  vi.fn(async (_profileId: string): Promise<void> => undefined),
);

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
// G2-04: the callback reads the link live for a completed under-13 student.
vi.mock("../../server/lib/guardian-link-state.js", () => ({
  hasActiveGuardianLink: hasActiveGuardianLinkMock,
}));
vi.mock("../../server/lib/password-credentials.js", () => ({
  grantPasswordRecovery: grantPasswordRecoveryMock,
}));
vi.mock("../../server/lib/legal-acceptance.js", () => ({
  captureLegalAcceptances: captureLegalMock,
}));

import oauthRouter from "../../server/routes/oauth-callback-routes";
import { logger } from "../../server/logger.js";
import { AccountEmailConflictError } from "../../server/lib/profile-bootstrap.js";

const SESSION = { access_token: "a".repeat(20), refresh_token: "r".repeat(20) };
const USER = { id: "user-oauth", email: "oauth@example.com" };

type ProfileShape = {
  profile_completed_at: string | null;
  is_under_13: boolean;
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

// SCL-222: acceptance is recorded only by the callback that CREATED the account. A brand-new
// account's auth `created_at` is seconds old; a returning user's is fixed at their first sign-up.
const NEW_USER = () => ({
  id: "user-new",
  email: "new@example.com",
  created_at: new Date(Date.now() - 5_000).toISOString(),
});
const RETURNING_USER = {
  id: "user-returning",
  email: "returning@example.com",
  created_at: "2026-03-01T12:00:00.000Z",
};

function okExchangeAs(user: {
  id: string;
  email: string;
  created_at: string;
}): void {
  exchangeCodeForSessionMock.mockResolvedValueOnce({
    data: { session: SESSION, user },
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
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("valid-code");
  });

  it("G2-04: a completed under-13 student with no active guardian link lands on /guardian-required", async () => {
    okExchange();
    hasActiveGuardianLinkMock.mockResolvedValueOnce(false);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: true,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/guardian-required");
    expect(hasActiveGuardianLinkMock).toHaveBeenCalledTimes(1);
  });

  it("G2-04: a completed under-13 student WITH an active guardian link goes to /dashboard", async () => {
    okExchange();
    hasActiveGuardianLinkMock.mockResolvedValueOnce(true);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: true,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
  });

  it("routes a completed student to /dashboard", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
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
      role: "guardian",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/guardian");
  });

  // AS-1 (decoupling) — when consent is durably captured (even via the outbox after a direct-write
  // failure), the session is kept and the user lands normally. No signOut, no error.
  it("keeps the session and lands normally when consent is durably captured (AS-1)", async () => {
    okExchangeAs(NEW_USER());
    captureLegalMock.mockResolvedValueOnce({ durable: true });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&consentSource=google_continue_click",
    );

    expect(captureLegalMock).toHaveBeenCalledTimes(1);
    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(res.headers.location).not.toContain("error=");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  // AS1-OUTBOX-DROP-001 — when consent cannot be durably captured ANYWHERE (both stores down), do NOT
  // silently proceed: fail closed (signOut) with a recoverable error rather than dropping compliance.
  it("fails closed when consent cannot be durably captured (AS1-OUTBOX-DROP-001)", async () => {
    okExchangeAs(NEW_USER());
    captureLegalMock.mockResolvedValueOnce({ durable: false });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
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
    // Brief 8 ruling 4: the completed recovery link is recorded for THIS user, exactly once.
    expect(grantPasswordRecoveryMock).toHaveBeenCalledTimes(1);
    expect(grantPasswordRecoveryMock).toHaveBeenCalledWith(USER.id);
  });

  // Brief 8 ruling 4: no grant, no recovery handoff. The student is told the link failed (and can
  // request another) rather than being sent to a form that would refuse them.
  it("recovery fails closed when the grant cannot be recorded", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: SESSION, user: USER },
      error: null,
    });
    grantPasswordRecoveryMock.mockRejectedValueOnce(new Error("db down"));

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=rec124&type=recovery&next=%2Fupdate-password",
    );

    expect(grantPasswordRecoveryMock).toHaveBeenCalledWith(USER.id);
    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=recovery_link_invalid",
    );
    expect(ensureProfileMock).not.toHaveBeenCalled();
  });

  // AS-5 — open-redirect guard: a `next` not on the allowlist is ignored; default landing is used.
  it("ignores an unsafe next and uses the default landing (open-redirect guard)", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=https://evil.example.com",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
  });

  // Owner brief 2026-09-15 Part B — the return path is honoured on the OAuth path too, through the
  // ONE shared sanitiser (packages/shared/src/return-path.ts): path AND query survive.
  it("honours an allowlisted next with its query for a completed guardian (return path, OAuth path)", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      role: "guardian",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fguardian%3Fcode%3DABC234",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/guardian?code=ABC234");
  });

  // WAS: expected plain /profile/complete — the gate won AND dropped `next`. Register UI-03
  // (2026-09-29): the gate still wins, and carries the allowlisted `next` through onboarding.
  it("the onboarding gate still wins over an allowlisted next, and carries it along", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "guardian",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fguardian%3Fcode%3DABC234",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/profile/complete?next=%2Fguardian%3Fcode%3DABC234",
    );
  });

  it("UI-03 a first-time student from /calendar → /profile/complete?next=%2Fcalendar", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fcalendar",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/profile/complete?next=%2Fcalendar",
    );
  });

  // UI-03 merged with G2-04 (from `main`): a completed under-13 student with no active guardian
  // link goes to /guardian-required even when a return path is present — the server refuses
  // every learning request until a guardian connects, so `next` would only bounce.
  it("UI-03 + G2-04: a completed under-13 student with no active link and next=/tests/<id> lands on /guardian-required", async () => {
    okExchange();
    hasActiveGuardianLinkMock.mockResolvedValueOnce(false);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: true,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Ftests%2Fs-1",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/guardian-required");
  });

  it("UI-03 + G2-04: a completed under-13 student WITH an active link keeps next=/tests/<id>", async () => {
    okExchange();
    hasActiveGuardianLinkMock.mockResolvedValueOnce(true);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: true,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Ftests%2Fs-1",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/tests/s-1");
  });

  it("UI-03 a disallowed next is still dropped at the onboarding gate", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2F%2Fevil.example.com%2Fcalendar",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
  });

  it("UI-03 a completed student lands on next=/calendar; a completed guardian does not", async () => {
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);
    const student = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fcalendar",
    );
    expect(student.headers.location).toBe("https://lyceon.ai/calendar");

    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-06-17T00:00:00Z",
      is_under_13: false,
      role: "guardian",
    } satisfies ProfileShape);
    const guardian = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fcalendar",
    );
    expect(guardian.headers.location).toBe("https://lyceon.ai/guardian");
  });

  it("logs the landing pathname only — never a return path's query (Coding Standards §12.1)", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    okExchange();
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "guardian",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&next=%2Fguardian%3Fcode%3DABC234",
    );
    // Presence first: the redirect really did carry the code in its query.
    expect(res.headers.location).toContain("ABC234");

    const success = infoSpy.mock.calls.find((call) => call[1] === "success");
    expect(success).toBeDefined();
    expect(JSON.stringify(success)).toContain("/profile/complete");
    expect(JSON.stringify(success)).not.toContain("ABC234");
    infoSpy.mockRestore();
  });

  it.each([
    ["protocol-relative", "%2F%2Fevil.example.com%2Fguardian"],
    [
      "absolute with allowlisted path",
      "https%3A%2F%2Fevil.example.com%2Fguardian",
    ],
    ["backslash trick", "%2F%5Cevil.example.com"],
    ["un-allowlisted route", "%2Fadmin"],
    ["login itself", "%2Flogin"],
  ])(
    "discards an off-origin or un-allowlisted next (%s) and uses the role default",
    async (_label, encodedNext) => {
      okExchange();
      ensureProfileMock.mockResolvedValueOnce({
        profile_completed_at: "2026-06-17T00:00:00Z",
        is_under_13: false,
        role: "guardian",
      } satisfies ProfileShape);

      const res = await request(makeApp()).get(
        `/auth/callback?code=valid-code&next=${encodedNext}`,
      );

      expect(res.headers.location).toBe("https://lyceon.ai/guardian");
    },
  );

  // AL-3 — native email-confirmation handoff completes via verifyOtp, same DOB gate, no code path.
  it("completes the email-confirmation handoff via verifyOtp and DOB-gates incomplete profiles", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: SESSION, user: USER },
      error: null,
    });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
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
    // Only a RECOVERY link grants a password change without the current password.
    expect(grantPasswordRecoveryMock).not.toHaveBeenCalled();
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

  // 259-removal (the heart of Stage 2): a GENERIC finalize error (non-conflict — e.g. a transient
  // profile read or the handle_new_user trigger anomaly) must NEVER tear down the LEGITIMATE session.
  // That coupling was the original outage. The session is preserved (no signOut); we surface a
  // recoverable error. Distinct from the AL-7 duplicate refusal above, which DOES sign out the refused
  // identity. Together these three prove the discipline: (a) duplicate refused → signOut; (b) this:
  // generic failure → session survives; (c) durable-consent kept → session survives.
  it("preserves the session on a generic finalize error (no signOut), surfacing a recoverable error", async () => {
    okExchange();
    ensureProfileMock.mockRejectedValueOnce(
      new Error("transient profile read failure"),
    );

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=post_auth_finalize",
    );
    expect(signOutMock).not.toHaveBeenCalled();
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

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 (human, recoverable copy), AS-5 (recovery);
 *   auth-login-e2e.contract.md AL-3] | @implemented [2026-09-15]
 *
 * plain English: each failure cause on the callback lands on ITS OWN error code, so an expired or
 * malformed password-reset link never reads "couldn't sign in with Google". One test per branch,
 * each reached by its own cause, each asserting the exact code — and each asserting the allowlist
 * guard is unchanged (verifyOtp is never called with an un-narrowed type). Would FAIL if any branch
 * collapsed back to google_oauth_failed, or if a new code leaked into the wrong branch.
 */
describe("Callback failure codes are distinct per cause (AS-3 / AS-5 / AL-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_SITE_URL = "https://lyceon.ai";
    captureLegalMock.mockResolvedValue({ durable: true });
  });

  afterEach(() => {
    if (baselineSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = baselineSiteUrl;
  });

  // Branch: verifyOtp refuses a well-formed recovery token (expired / already used).
  it("recovery token refused by verifyOtp → recovery_link_expired", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=stale&type=recovery&next=%2Fupdate-password",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=recovery_link_expired",
    );
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: "stale",
      type: "recovery",
    });
  });

  // Branch: verifyOtp refuses a NON-recovery email token (signup confirmation) → email copy, not reset copy.
  it("signup-confirmation token refused by verifyOtp → email_link_expired", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=stale&type=signup",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=email_link_expired",
    );
  });

  // Branch: recovery type present but token_hash missing (malformed / truncated link). The allowlist
  // guard rejects; only the copy changes. verifyOtp is never reached.
  it("type=recovery with no token_hash → recovery_link_invalid, verifyOtp never called", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?type=recovery&next=%2Fupdate-password",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=recovery_link_invalid",
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  // Branch: token_hash present but `type` is NOT on the allowlist (e.g. a mangled `type=recover`).
  // The guard still rejects (verifyOtp must not see an un-narrowed type); with no recovery signal
  // the copy is the generic email-link one.
  it("token_hash with an un-allowlisted type → email_link_invalid, verifyOtp never called", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=abc&type=recover",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=email_link_invalid",
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  // Branch: GoTrue's hosted /verify redirect for a stale link (`error=access_denied&error_code=otp_expired`)
  // on the recovery redirect (allowlisted next=/update-password) → reset copy.
  it("GoTrue otp_expired redirect on the recovery next → recovery_link_expired", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?error=access_denied&error_code=otp_expired&next=%2Fupdate-password",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=recovery_link_expired",
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  // Branch: the same GoTrue redirect with NO recovery signal → email copy.
  it("GoTrue otp_expired redirect without recovery next → email_link_expired", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?error=access_denied&error_code=otp_expired",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=email_link_expired",
    );
  });

  // Branch: a real Google provider error is UNCHANGED — still google_oauth_failed.
  it("a Google provider error stays google_oauth_failed", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?error=access_denied&error_description=User+denied+access",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=google_oauth_failed",
    );
  });

  // Branch: a failed PKCE code exchange is UNCHANGED — still supabase_exchange, never a link code.
  it("a failed code exchange stays supabase_exchange", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "bad code" },
    });

    const res = await request(makeApp()).get("/auth/callback?code=bad-code");

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=supabase_exchange",
    );
  });

  // Open-redirect guard interplay: an un-allowlisted `next` gives NO recovery signal (it is dropped
  // by parseSafeNext), so a bare failure stays generic. Proves the classifier reads the allowlisted
  // value, not the raw query.
  it("an un-allowlisted next contributes no recovery signal to the copy", async () => {
    const res = await request(makeApp()).get(
      "/auth/callback?error=access_denied&next=https://evil.example.com/update-password",
    );

    expect(res.headers.location).toBe(
      "https://lyceon.ai/login?error=google_oauth_failed",
    );
  });
});

/**
 * @spec [SCL-222 (owner ruling 2026-10-09)] | @implemented [2026-10-09]
 *
 * plain English: the sign-in notice replaced the Terms checkbox, so acceptance is recorded when the
 * account is created and NEVER by a returning user's sign-in — updated documents reach a returning
 * user only through the re-acceptance prompt. The returning-user case carries the browser's
 * `consentSource` (as every real Google click does) to prove the parameter alone records nothing.
 * Planted defect: dropping the creation check (`isNewlyCreatedAccount(...)` → `true`) turns the
 * returning-user test red (scripts/ci/signin-notice.mutations.sh).
 */
describe("SCL-222 — Google sign-in records acceptance only when it creates the account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_SITE_URL = "https://lyceon.ai";
    captureLegalMock.mockResolvedValue({ durable: true });
  });

  afterEach(() => {
    if (baselineSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = baselineSiteUrl;
  });

  it("a new account records Student Terms and the Privacy Policy, stamped google_continue_click", async () => {
    okExchangeAs(NEW_USER());
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get("/auth/callback?code=valid-code");

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(captureLegalMock).toHaveBeenCalledTimes(1);
    const arg = captureLegalMock.mock.calls[0]?.[1] as {
      userId: string;
      consentSource: string;
      acceptances: Array<{ docKey: string; actorType: string }>;
    };
    expect(arg.userId).toBe("user-new");
    expect(arg.consentSource).toBe("google_continue_click");
    expect(arg.acceptances.map((a) => a.docKey).sort()).toEqual([
      "privacy_policy",
      "student_terms",
    ]);
  });

  it("a returning user's sign-in records nothing, even with the browser's consentSource", async () => {
    okExchangeAs(RETURNING_USER);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: "2026-03-01T12:05:00Z",
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&consentSource=google_continue_click",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/dashboard");
    expect(captureLegalMock).not.toHaveBeenCalled();
  });

  it("a returning user who never finished onboarding still records nothing", async () => {
    okExchangeAs(RETURNING_USER);
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?code=valid-code&consentSource=google_continue_click",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(captureLegalMock).not.toHaveBeenCalled();
  });

  it("an email-confirmation handoff records nothing: the email signup already did", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: SESSION, user: NEW_USER() },
      error: null,
    });
    ensureProfileMock.mockResolvedValueOnce({
      profile_completed_at: null,
      is_under_13: false,
      role: "student",
    } satisfies ProfileShape);

    const res = await request(makeApp()).get(
      "/auth/callback?token_hash=fresh&type=signup",
    );

    expect(res.headers.location).toBe("https://lyceon.ai/profile/complete");
    expect(captureLegalMock).not.toHaveBeenCalled();
  });
});
