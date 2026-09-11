import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal shape of the @supabase/ssr cookie adapter options our mock exercises: signup
// persists the native session by writing cookies through `options.cookies.setAll`.
type SsrCookieAdapterOptions = {
  cookies: {
    setAll: (
      items: Array<{
        name: string;
        value: string;
        options: Record<string, unknown>;
      }>,
    ) => void;
  };
};

const signUpMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const profileEqMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const profileUpdateMock = vi.hoisted(() =>
  vi.fn(() => ({ eq: profileEqMock })),
);
// Stage-2 delta mocks (sign-in / reset / update-password) — folded here to reuse this harness's
// already-suppressed cookieParser sink (CodeQL js/missing-token-validation) rather than fork a 2nd app.
const resetPasswordForEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: null })),
);
const ssrSignInMock = vi.hoisted(() => vi.fn());
const ssrUpdateUserMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: { id: "u" } }, error: null })),
);
const ssrSignOutMock = vi.hoisted(() => vi.fn());
const ssrSetSessionMock = vi.hoisted(() => vi.fn());
const profileFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        update: profileUpdateMock,
      };
    }

    if (table === "legal_acceptances") {
      return {
        upsert: upsertMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
);

// CSRF is NOT mocked out: this test rides the REAL doubleCsrfProtection and supplies a valid
// double-submit token per request (the safe pattern — a test must not disable the security
// control it exercises). CSRF enforcement itself is proven in csrf-runtime.contract.test.ts.

vi.mock("../../server/middleware/supabase-auth.js", () => ({
  getSupabaseAdmin: () => ({
    from: profileFromMock,
  }),
  requireSupabaseAuth: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
  resolveTokenFromRequest: vi.fn(() => ({
    token: null,
    tokenSource: null,
    tokenLength: null,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: [],
  })),
  resolveUserIdFromToken: vi.fn(async () => null),
}));


vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: resetPasswordForEmailMock,
      refreshSession: vi.fn(),
      getUser: vi.fn(),
    },
  })),
}));

// signup/sign-in mint the session on the @supabase/ssr createServerClient (signUp / signInWithPassword);
// the cookie adapter's setAll writes the native cookie. signOut clears it (fail-closed). Mocked below.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: SsrCookieAdapterOptions) => ({
      auth: {
        setSession: vi.fn(async (...args: unknown[]) => {
          // Tracked so tests can assert signup/sign-in mint NATIVELY (no manual persistSession).
          ssrSetSessionMock(...args);
          options.cookies.setAll([
            {
              name: "sb-lyceon-prod-auth-token",
              value: "base64-" + Buffer.from("{}").toString("base64"),
              options: {},
            },
          ]);
          return { data: { session: null, user: null }, error: null };
        }),
        // G7/G8: signup mints on the SSR client too — signUp writes the native cookie via setAll when
        // autoconfirm returns a session (driven by signUpMock for each outcome). No manual persist.
        signUp: vi.fn(async (args: unknown) => {
          const result = (await signUpMock(args)) as {
            data?: { session?: unknown };
          };
          if (result?.data?.session) {
            options.cookies.setAll([
              {
                name: "sb-lyceon-prod-auth-token",
                value: "base64-" + Buffer.from("{}").toString("base64"),
                options: {},
              },
            ]);
          }
          return result;
        }),
        // G7: sign-in mints the session on the SSR client, which writes the native cookie via setAll.
        signInWithPassword: vi.fn(async (creds: unknown) => {
          const result = (await ssrSignInMock(creds)) as {
            data?: { session?: unknown };
          };
          if (result?.data?.session) {
            options.cookies.setAll([
              {
                name: "sb-lyceon-prod-auth-token",
                value: "base64-" + Buffer.from("{}").toString("base64"),
                options: {},
              },
            ]);
          }
          return result;
        }),
        // G6/G9: update-password runs updateUser on the cookie-held session.
        updateUser: ssrUpdateUserMock,
        // signOut clears the native cookie via the adapter (mirrors real fail-closed clearing).
        signOut: vi.fn(async () => {
          ssrSignOutMock();
          options.cookies.setAll([
            { name: "sb-lyceon-prod-auth-token", value: "", options: {} },
          ]);
          return { error: null };
        }),
      },
    }),
  ),
}));

const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
};

async function loadAuthApp() {
  vi.resetModules();
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.SUPABASE_URL = "https://lyceon-prod.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.PUBLIC_SITE_URL = "https://app.lyceon.ai";
  process.env.CSRF_SECRET = "auth-signup-contract-csrf-secret";

  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  // Real CSRF: /signup applies doubleCsrfProtection per-route; expose a token endpoint so the
  // test can complete the double-submit handshake instead of disabling the control.
  const { generateToken } =
    await import("../../server/middleware/csrf-double-submit");
  const app = express();
  // codeql[js/missing-token-validation]: NOT missing — CSRF is enforced per-route inside the
  // imported supabase-auth router via doubleCsrfProtection (server/routes/supabase-auth-routes.ts
  // applies it on /signup, /signin, /signout, etc.). CodeQL's default model recognizes only
  // app-level `csurf`; it neither follows into a dynamically-imported Router nor models the
  // csrf-csrf double-submit pattern, so it reads cookieParser-without-app-level-CSRF as a gap.
  // The "blocks signup with no CSRF token" test below proves enforcement is live (403, handler
  // never reached). Default-setup CodeQL does not honor this comment — dismiss the alert in the
  // GitHub Security UI as a false positive.
  app.use(cookieParser());
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-auth-signup-contract";
    next();
  });
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    req.cookies ??= {};
    res.json({ csrfToken: generateToken(req, res) });
  });
  app.use("/api/auth", authRoutes);
  return app;
}

// Safe pattern (mirrors csrf-runtime.contract.test.ts): fetch a real CSRF token on a persistent
// agent, then POST signup with the matching x-csrf-token header. No security control is mocked away.
async function signupWithCsrf(
  app: express.Express,
  body: Record<string, unknown>,
) {
  return postWithCsrf(app, "/api/auth/signup", body);
}

// Generic CSRF double-submit POST (reused by the Stage-2 delta tests for signin/reset/update-password).
async function postWithCsrf(
  app: express.Express,
  path: string,
  body: Record<string, unknown>,
) {
  const agent = request.agent(app);
  const tokenRes = await agent.get("/api/csrf-token");
  const csrfToken = tokenRes.body.csrfToken as string;
  return agent.post(path).set("x-csrf-token", csrfToken).send(body);
}

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1, AS1-OUTBOX-DROP-001 |
 *   contracts/auth-login-e2e.contract.md AL-2/AL-3 | Coding Standards §14]
 * Proves signup SSR session minting (G7/G8), the fail-closed consent gate (AS1-OUTBOX-DROP-001 — the
 * eager cookie is cleared, no session survives a consent failure), the toggle-robust 201/202 branches,
 * and that no manual persistSession (setSession) hand-off survives.
 */
describe("Auth Signup Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks signup with no CSRF token (proves the control is live, not mocked away)", async () => {
    const app = await loadAuthApp();

    // No double-submit handshake: POST directly without an x-csrf-token header. The real
    // doubleCsrfProtection rejects with csrf-csrf's invalidCsrfTokenError (HTTP 403) before the
    // handler runs — so signUp is never reached. (Origin-rejections carry the structured
    // `csrf_blocked` body; a missing token surfaces as the library's 403.)
    const res = await request(app).post("/api/auth/signup").send({
      email: "csrf-missing@example.com",
      password: "Password123!",
    });

    expect(res.status).toBe(403);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects signup payloads that omit canonical legal consent", async () => {
    const app = await loadAuthApp();

    const res = await signupWithCsrf(app, {
      email: "student@example.com",
      password: "Password123!",
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("AL-3: invokes native signUp with emailRedirectTo pointing at /auth/callback", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: { id: "user-confirm", email: "confirm@example.com" },
        session: null,
      },
      error: null,
    });

    const app = await loadAuthApp();

    const res = await signupWithCsrf(app, {
      email: "confirm@example.com",
      password: "Password123!",
      displayName: "Confirm User",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(202);
    expect(signUpMock).toHaveBeenCalledTimes(1);
    const signUpArg = signUpMock.mock.calls[0]?.[0] as {
      options?: { emailRedirectTo?: string };
    };
    // The native email-confirmation handoff must land on our SSR callback — no custom token flow.
    expect(signUpArg.options?.emailRedirectTo).toBe(
      "https://app.lyceon.ai/auth/callback",
    );
  });

  it("returns verification_required when Supabase signup has no session", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-verification",
          email: "verify@example.com",
        },
        session: null,
      },
      error: null,
    });

    const app = await loadAuthApp();

    const res = await signupWithCsrf(app, {
      email: "verify@example.com",
      password: "Password123!",
      displayName: "Verify User",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      outcome: "verification_required",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);

    const upsertRows = upsertMock.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(upsertRows)).toBe(true);
    expect(upsertRows).toHaveLength(2);
    expect(
      upsertRows.every((row) => row.consent_source === "email_signup_form"),
    ).toBe(true);
  });

  it("returns authenticated outcome and canonical cookies when session is present", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-authenticated",
          email: "auth@example.com",
        },
        session: {
          access_token: "a".repeat(48),
          refresh_token: "r".repeat(48),
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "user-authenticated",
            email: "auth@example.com",
          },
        },
      },
      error: null,
    });

    const app = await loadAuthApp();

    const res = await signupWithCsrf(app, {
      email: "auth@example.com",
      password: "Password123!",
      displayName: "Auth User",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      outcome: "authenticated",
      nextPath: "/profile/complete",
    });

    // AUTH-001: native @supabase/ssr session cookie (sb-<ref>-auth-token), not the legacy pair.
    const setCookies = res.headers["set-cookie"] ?? [];
    expect(
      setCookies.some((cookie: string) => /^sb-.*-auth-token=/.test(cookie)),
    ).toBe(true);
    // G7/G8: minted NATIVELY on the SSR client's signUp — no manual persistSession (setSession) hand-off.
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(ssrSetSessionMock).not.toHaveBeenCalled();
  });

  it("AS1-OUTBOX-DROP-001: fails closed (503, no session cookie) when consent can't be durably captured", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: { id: "user-503", email: "fail@example.com" },
        session: {
          access_token: "a".repeat(48),
          refresh_token: "r".repeat(48),
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "user-503", email: "fail@example.com" },
        },
      },
      error: null,
    });
    // Direct legal_acceptances write fails AND the outbox table is unmapped in this harness
    // (profileFromMock throws for it) → captureLegalAcceptances returns {durable:false} → the signup
    // must fail closed BEFORE persisting a session (consent is a precondition, never silently dropped).
    upsertMock.mockResolvedValueOnce({
      error: { message: "legal_acceptances unavailable" },
    });

    const app = await loadAuthApp();

    const res = await signupWithCsrf(app, {
      email: "fail@example.com",
      password: "Password123!",
      displayName: "Fail Closed",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(503);
    // signUp wrote the session cookie EAGERLY; the fail-closed branch must sign out to clear it, so no
    // session survives a consent-capture failure (AS1-OUTBOX-DROP-001).
    expect(ssrSignOutMock).toHaveBeenCalled();
    const setCookies = res.headers["set-cookie"] ?? [];
    const authCookies = setCookies.filter((cookie: string) =>
      /^sb-[^=]*-auth-token=/.test(cookie),
    );
    expect(authCookies.length).toBeGreaterThan(0); // the eager cookie WAS written ...
    expect(authCookies[authCookies.length - 1]).toMatch(
      /^sb-[^=]*-auth-token=;/,
    ); // ... and then cleared (empty value) — no live session left
  });
});

afterEach(() => {
  process.env.NODE_ENV = baselineEnv.NODE_ENV;
  process.env.VITEST = baselineEnv.VITEST;
  process.env.SUPABASE_URL = baselineEnv.SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = baselineEnv.SUPABASE_ANON_KEY;
  process.env.PUBLIC_SITE_URL = baselineEnv.PUBLIC_SITE_URL;
});

/**
 * @spec [auth-login-e2e AL-2 | auth-standard-flow AS-5/AS-6 | gap-analysis G1/G5/G6/G7/G9]
 * Stage-2 DELTA proofs — surgical (prove the changes, not the whole surface). Folded into this file so
 * they share the harness's already-suppressed cookieParser sink instead of forking a second test app.
 */
describe("Auth routes — Stage 2 deltas (signin / reset / update-password)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G7/AL-2: sign-in mints the session on the SSR server client and writes the native cookie", async () => {
    ssrSignInMock.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "a".repeat(40),
          refresh_token: "r".repeat(40),
        },
        user: { id: "u1", email: "in@example.com" },
      },
      error: null,
    });
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/signin", {
      email: "in@example.com",
      password: "Password123!",
    });

    expect(res.status).toBe(200);
    expect(ssrSignInMock).toHaveBeenCalledTimes(1);
    const setCookies = res.headers["set-cookie"] ?? [];
    expect(
      setCookies.some((cookie: string) => /^sb-.*-auth-token=/.test(cookie)),
    ).toBe(true);
  });

  it("G7: invalid sign-in stays generic (Invalid email or password)", async () => {
    ssrSignInMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/signin", {
      email: "in@example.com",
      password: "wrong",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("G1: signup does NOT write profiles (phantom update removed — the trigger owns creation)", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: { id: "u2", email: "new@example.com" },
        session: {
          access_token: "a".repeat(48),
          refresh_token: "r".repeat(48),
          expires_in: 3600,
        },
      },
      error: null,
    });
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/signup", {
      email: "new@example.com",
      password: "Password123!",
      displayName: "New User",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(201);
    // The handle_new_user trigger is the single creator — no profiles.update here.
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  it("G5: signup error is generic and non-enumerable (never reveals 'already registered')", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/signup", {
      email: "dupe@example.com",
      password: "Password123!",
      legalConsent: {
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "email_signup_form",
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/registered|exists/i);
  });

  it("G6/AS-5: reset calls native resetPasswordForEmail (callback redirect) with a generic 200", async () => {
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/reset-password", {
      email: "reset@example.com",
    });

    expect(res.status).toBe(200);
    expect(resetPasswordForEmailMock).toHaveBeenCalledTimes(1);
    const [emailArg, opts] = resetPasswordForEmailMock.mock.calls[0] as [
      string,
      { redirectTo?: string },
    ];
    expect(emailArg).toBe("reset@example.com");
    expect(opts.redirectTo).toContain("/auth/callback");
    expect(decodeURIComponent(opts.redirectTo ?? "")).toContain(
      "/update-password",
    );
  });

  it("G6/G9/AS-6: update-password uses the SSR client's updateUser (no admin.updateUserById)", async () => {
    const app = await loadAuthApp();

    const res = await postWithCsrf(app, "/api/auth/update-password", {
      password: "BrandNewPassword123!",
    });

    expect(res.status).toBe(200);
    expect(ssrUpdateUserMock).toHaveBeenCalledTimes(1);
    expect(ssrUpdateUserMock).toHaveBeenCalledWith({
      password: "BrandNewPassword123!",
    });
  });
});
