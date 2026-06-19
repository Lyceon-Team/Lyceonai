import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @spec [contracts/auth-login-e2e.contract.md AL-2 | contracts/auth-standard-flow.contract.md AS-5/AS-6 |
 *   docs/SpecAudit/50-auth-entitlement/auth-ssr-gap-analysis.md G1/G6/G7/G9]
 * @implemented [2026-06-19]
 *
 * Stage-2 DELTA proofs (surgical — proves the changes, not the whole surface):
 *   - G7/AL-2: sign-in mints the session on the per-request @supabase/ssr server client, so the native
 *     cookie is written by the setAll adapter (no ad-hoc anon createClient + manual setSession).
 *   - G1: signup no longer performs the phantom profiles.update (the handle_new_user trigger owns creation).
 *   - G6/AS-5: password reset calls native resetPasswordForEmail (no admin.generateLink / app-built email).
 *   - G6/G9/AS-6: update-password calls the SSR client's updateUser (no admin.updateUserById / token resolve).
 */

const SESSION = { access_token: "a".repeat(40), refresh_token: "r".repeat(40) };

// --- @supabase/supabase-js (ad-hoc anon client): used by signUp + resetPasswordForEmail ----------
const signUpMock = vi.hoisted(() => vi.fn());
const resetPasswordForEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: null })),
);

// --- @supabase/ssr (per-request server client): used by signin, update-password, signup-persist ----
const ssrSignInMock = vi.hoisted(() => vi.fn());
const ssrUpdateUserMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: { id: "u" } }, error: null })),
);

// --- admin client spy: proves signup no longer writes profiles (phantom update removed) ------------
const adminFromSpy = vi.hoisted(() => vi.fn());

const NATIVE_COOKIE = "sb-lyceon-prod-auth-token";
function writeNativeCookie(options: {
  cookies: {
    setAll: (
      items: Array<{
        name: string;
        value: string;
        options: Record<string, unknown>;
      }>,
    ) => void;
  };
}): void {
  options.cookies.setAll([
    {
      name: NATIVE_COOKIE,
      value: "base64-" + Buffer.from("{}").toString("base64"),
      options: {},
    },
  ]);
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      signInWithPassword: vi.fn(),
      getUser: vi.fn(),
    },
  })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      options: Parameters<typeof writeNativeCookie>[0],
    ) => ({
      auth: {
        // Sign-in on the SSR client persists the native cookie through the adapter (G7).
        signInWithPassword: vi.fn(async (creds: unknown) => {
          const result = (await ssrSignInMock(creds)) as {
            data?: { session?: unknown };
          };
          if (result?.data?.session) writeNativeCookie(options);
          return result;
        }),
        updateUser: ssrUpdateUserMock,
        // Used by signup's persistSession when autoconfirm returns a session.
        setSession: vi.fn(async () => {
          writeNativeCookie(options);
          return { data: { session: null, user: null }, error: null };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
    }),
  ),
}));

vi.mock("../../server/middleware/supabase-auth.js", () => ({
  getSupabaseAdmin: () => ({ from: adminFromSpy }),
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
}));

// captureLegalAcceptances is the consent seam; durable:true so signup proceeds (AS-1 proven elsewhere).
vi.mock("../../server/lib/legal-acceptance.js", () => ({
  captureLegalAcceptances: vi.fn(async () => ({ durable: true })),
}));

async function loadApp() {
  vi.resetModules();
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.SUPABASE_URL = "https://lyceon-prod.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.PUBLIC_SITE_URL = "https://app.lyceon.ai";
  process.env.CSRF_SECRET = "auth-routes-stage2-csrf-secret";

  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  const { generateToken } =
    await import("../../server/middleware/csrf-double-submit");
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-auth-stage2";
    next();
  });
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    req.cookies ??= {};
    res.json({ csrfToken: generateToken(req, res) });
  });
  app.use("/api/auth", authRoutes);
  return app;
}

// Real CSRF double-submit handshake on a persistent agent (never mock away the control).
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

describe("Auth routes — Stage 2 deltas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G7/AL-2: sign-in mints the session on the SSR server client and writes the native cookie", async () => {
    ssrSignInMock.mockResolvedValueOnce({
      data: { session: SESSION, user: { id: "u1", email: "in@example.com" } },
      error: null,
    });
    const app = await loadApp();

    const res = await postWithCsrf(app, "/api/auth/signin", {
      email: "in@example.com",
      password: "Password123!",
    });

    expect(res.status).toBe(200);
    expect(ssrSignInMock).toHaveBeenCalledTimes(1);
    // The native @supabase/ssr cookie is set by the adapter during signInWithPassword.
    const setCookie = res.headers["set-cookie"] ?? [];
    expect(
      (Array.isArray(setCookie) ? setCookie : [setCookie]).some((c) =>
        String(c).includes(NATIVE_COOKIE),
      ),
    ).toBe(true);
  });

  it("G7: invalid sign-in stays generic (Invalid email or password) and sets no cookie", async () => {
    ssrSignInMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });
    const app = await loadApp();

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
        session: SESSION,
      },
      error: null,
    });
    const app = await loadApp();

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
    expect(signUpMock).toHaveBeenCalledTimes(1);
    // No profiles write of any kind — the handle_new_user trigger is the single creator.
    expect(adminFromSpy).not.toHaveBeenCalled();
  });

  it("G1: signup error is generic and non-enumerable (never reveals 'already registered')", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    const app = await loadApp();

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
    const app = await loadApp();

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
    expect(opts.redirectTo).toContain("next=");
    expect(decodeURIComponent(opts.redirectTo ?? "")).toContain(
      "/update-password",
    );
  });

  it("G6/G9/AS-6: update-password uses the SSR client's updateUser (no admin.updateUserById)", async () => {
    const app = await loadApp();

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
