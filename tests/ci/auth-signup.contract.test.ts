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

vi.mock("../../server/lib/email.js", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: vi.fn(),
      refreshSession: vi.fn(),
      getUser: vi.fn(),
    },
  })),
}));

// AUTH-001: signup now persists the session via @supabase/ssr createServerClient.setSession, which
// writes the native session cookie through the cookie adapter's setAll. Mock it to exercise that path.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, options: SsrCookieAdapterOptions) => ({
      auth: {
        setSession: vi.fn(async () => {
          // Emulate the SSR client writing the native session cookie through the adapter.
          options.cookies.setAll([
            {
              name: "sb-lyceon-prod-auth-token",
              value: "base64-" + Buffer.from("{}").toString("base64"),
              options: {},
            },
          ]);
          return { data: { session: null, user: null }, error: null };
        }),
        signOut: vi.fn(async () => ({ error: null })),
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
  const agent = request.agent(app);
  const tokenRes = await agent.get("/api/csrf-token");
  const csrfToken = tokenRes.body.csrfToken as string;
  return agent
    .post("/api/auth/signup")
    .set("x-csrf-token", csrfToken)
    .send(body);
}

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
  });
});

afterEach(() => {
  process.env.NODE_ENV = baselineEnv.NODE_ENV;
  process.env.VITEST = baselineEnv.VITEST;
  process.env.SUPABASE_URL = baselineEnv.SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = baselineEnv.SUPABASE_ANON_KEY;
  process.env.PUBLIC_SITE_URL = baselineEnv.PUBLIC_SITE_URL;
});
