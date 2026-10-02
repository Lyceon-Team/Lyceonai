/**
 * F-46: a recovery password update signs out every other session, and reset requests are
 * throttled per account on the RateLimitLedger. Real routes, real Postgres, real supabase-js.
 *
 * @spec [Doc 01 §12.1 steps 2 and 6; Doc 01A §39–§47; Brief 12 ruling 1 (owner, 2026-10-02);
 *        register F-46; AS3-AS5-RESET-ENUM-001] | @implemented [2026-10-02]
 *
 * plain English: drives the REAL `POST /api/auth/reset-password` and `POST /api/auth/update-password`
 * with the REAL `@supabase/supabase-js` clients, the REAL `password-credentials` and
 * `session-revoke` modules, and the REAL ledger RPC and `password_reset_subject` on a throwaway
 * Postgres with every migration applied. Substituted: the transport to GoTrue (a stand-in for the
 * five endpoints these calls reach), the auth gate (which puts the signed-in user on the request),
 * CSRF, and the SSR cookie client (a real client holding the recovery session instead).
 *
 * What it proves:
 *   - after a recovery update, the account's other sessions are revoked, the recovery session
 *     survives, and another account's session is untouched;
 *   - a failed revoke still answers 200 with the password set, and logs one ERROR line carrying
 *     the request id only;
 *   - the limit is per account across separate requests, whatever case, spacing or client IP
 *     the address arrives with;
 *   - an unknown address, a throttled one and an allowed one get byte-identical responses.
 */
import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import request from "supertest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "password_reset_sessions_ci";
const GOTRUE = "https://gotrue.test";
const STUDENT = "6b000000-0000-4000-8000-000000000001";
const STUDENT_EMAIL = "reset-student@example.test";
const OTHER = "6b000000-0000-4000-8000-000000000002";
// Stored as the student typed it at signup: the lookup must fold the STORED side too.
const MIXED = "6b000000-0000-4000-8000-000000000003";
const MIXED_STORED_EMAIL = "Mixed.Case@Example.Test";
const NEW_PASSWORD = "BrandNewPassword123";
const REQUEST_ID = "req-f46";

/** An unsigned JWT: supabase-js only decodes it (for `exp`); GoTrue is the stand-in below. */
function jwt(sub: string, tag: string): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub,
    tag,
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
  })}.sig`;
}
const RECOVERY_TOKEN = jwt(STUDENT, "recovery");
const OTHER_DEVICE_TOKEN = jwt(STUDENT, "other-device");
const OTHER_USER_TOKEN = jwt(OTHER, "other-user");

let pg: Client;
const seams = vi.hoisted(() => ({
  sessionClient: null as unknown,
  admin: null as unknown,
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => seams.admin,
    requireSupabaseAuth: (
      req: Request,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      (req as Request & { user?: unknown }).user = {
        id: STUDENT,
        email: STUDENT_EMAIL,
        role: "student",
      };
      next();
    },
  };
});
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (
    _q: Request,
    _s: ExpressResponse,
    next: NextFunction,
  ) => next(),
}));
vi.mock("../../server/lib/supabase-ssr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createSupabaseServerClient: () => seams.sessionClient,
  };
});

// ── The GoTrue stand-in ──────────────────────────────────────────────────────────────────────
type Gotrue = {
  sessions: Map<string, { user: string; revoked: boolean }>;
  password: string;
  updatedWithToken: string | null;
  recoverEmails: string[];
  calls: string[];
  failLogout: boolean;
};
const gotrue: Gotrue = {
  sessions: new Map(),
  password: "OldPassword123",
  updatedWithToken: null,
  recoverEmails: [],
  calls: [],
  failLogout: false,
};

function userJson(id: string) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: id === STUDENT ? STUDENT_EMAIL : "other@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [
      {
        id: `${id}-email`,
        identity_id: `${id}-email`,
        user_id: id,
        provider: "email",
        identity_data: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function goTrueFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.toString());
  if (url.origin !== GOTRUE) throw new Error(`unexpected host ${url.origin}`);
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  const bearer = new Headers(init?.headers)
    .get("authorization")
    ?.replace(/^Bearer /i, "");
  gotrue.calls.push(`${method} ${path}${url.search}`);
  const live = (t: string | undefined) =>
    t !== undefined && gotrue.sessions.get(t)?.revoked === false;

  if (method === "POST" && path === "/recover") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
    gotrue.recoverEmails.push(body.email ?? "");
    return json(200, {});
  }
  if (method === "GET" && path === "/user") {
    if (!live(bearer)) return json(401, { code: "bad_jwt", msg: "invalid" });
    return json(200, userJson(gotrue.sessions.get(bearer!)!.user));
  }
  if (method === "PUT" && path === "/user") {
    if (!live(bearer)) return json(401, { code: "bad_jwt", msg: "invalid" });
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      password?: string;
    };
    if (body.password) {
      gotrue.password = body.password;
      gotrue.updatedWithToken = bearer!;
    }
    return json(200, userJson(gotrue.sessions.get(bearer!)!.user));
  }
  if (method === "POST" && path === "/logout") {
    if (gotrue.failLogout)
      return json(500, { code: "unexpected_failure", msg: "boom" });
    const caller = bearer ? gotrue.sessions.get(bearer) : undefined;
    if (!caller) return json(401, { code: "bad_jwt", msg: "invalid" });
    const scope = url.searchParams.get("scope");
    for (const [token, row] of gotrue.sessions) {
      if (row.user !== caller.user) continue;
      const isCaller = token === bearer;
      if (
        scope === "global" ||
        (scope === "others" && !isCaller) ||
        (scope === "local" && isCaller)
      ) {
        row.revoked = true;
      }
    }
    return json(204, null);
  }
  if (method === "GET" && path.startsWith("/admin/users/")) {
    return json(200, userJson(path.slice("/admin/users/".length)));
  }
  return json(404, { code: "not_found", msg: `${method} ${path}` });
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
};

async function loadApp(): Promise<express.Express> {
  vi.resetModules();
  // Past `runningAgainstPlaceholder()`, as tests/ci/auth-signup.contract.test.ts does, so the
  // real send and update paths run. The transport is the stand-in, so nothing leaves the process.
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.SUPABASE_URL = GOTRUE;
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.PUBLIC_SITE_URL = "https://app.lyceon.test";
  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: Request, _res: ExpressResponse, next: NextFunction) => {
    req.requestId = REQUEST_ID;
    next();
  });
  app.use("/api/auth", authRoutes);
  return app;
}

async function signInRecoverySession(): Promise<SupabaseClient> {
  const client = createClient(GOTRUE, "anon-key", clientOptions);
  const { error } = await client.auth.setSession({
    access_token: RECOVERY_TOKEN,
    refresh_token: "refresh-recovery",
  });
  if (error) throw error;
  return client;
}

async function ledgerUsed(): Promise<number | null> {
  const r = await pg.query(
    `SELECT used_count FROM public.rate_limit_ledger WHERE profile_id = $1 AND bucket_key = 'password_reset_requests_hourly'`,
    [STUDENT],
  );
  return r.rows[0]?.used_count ?? null;
}

describe.skipIf(!PG_AVAILABLE)(
  "F-46: recovery revokes other sessions; reset is throttled per account (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, email] of [
        [STUDENT, STUDENT_EMAIL],
        [OTHER, "other@example.test"],
        [MIXED, MIXED_STORED_EMAIL],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          email,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1, $2, 'student', 'S')`,
          [id, email],
        );
      }
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      vi.stubGlobal("fetch", goTrueFetch);
      gotrue.sessions = new Map([
        [RECOVERY_TOKEN, { user: STUDENT, revoked: false }],
        [OTHER_DEVICE_TOKEN, { user: STUDENT, revoked: false }],
        [OTHER_USER_TOKEN, { user: OTHER, revoked: false }],
      ]);
      gotrue.password = "OldPassword123";
      gotrue.updatedWithToken = null;
      gotrue.recoverEmails = [];
      gotrue.calls = [];
      gotrue.failLogout = false;
      seams.admin = createClient(GOTRUE, "service-key", clientOptions);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(`SELECT public.grant_password_recovery($1, 900)`, [
        STUDENT,
      ]);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      Object.assign(process.env, baselineEnv);
      for (const [k, v] of Object.entries(baselineEnv)) {
        if (v === undefined) delete process.env[k];
      }
    });

    // ── Doc 01 §12.1 step 6 ───────────────────────────────────────────────────────────────────
    it("a recovery update revokes the account's other sessions and keeps the recovery session", async () => {
      seams.sessionClient = await signInRecoverySession();
      const app = await loadApp();
      // Presence first: all three sessions are live before the update.
      expect([...gotrue.sessions.values()].map((s) => s.revoked)).toEqual([
        false,
        false,
        false,
      ]);

      const res = await request(app)
        .post("/api/auth/update-password")
        .send({ password: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect(gotrue.password).toBe(NEW_PASSWORD);
      expect(gotrue.updatedWithToken).toBe(RECOVERY_TOKEN);
      expect(gotrue.calls).toContain("POST /logout?scope=others");
      expect(gotrue.sessions.get(RECOVERY_TOKEN)?.revoked).toBe(false);
      expect(gotrue.sessions.get(OTHER_DEVICE_TOKEN)?.revoked).toBe(true);
      expect(gotrue.sessions.get(OTHER_USER_TOKEN)?.revoked).toBe(false);
      // The grant was spent, after the update.
      const live = await pg.query(
        `SELECT public.password_recovery_live($1) AS v`,
        [STUDENT],
      );
      expect(live.rows[0].v).toBe(false);
    });

    it("a failed revoke still answers 200 with the password set, and logs one ERROR with the request id only", async () => {
      gotrue.failLogout = true;
      seams.sessionClient = await signInRecoverySession();
      const app = await loadApp();
      const { logger } = await import("../../server/logger");
      const errors = vi.spyOn(logger, "error");

      const res = await request(app)
        .post("/api/auth/update-password")
        .send({ password: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(gotrue.password).toBe(NEW_PASSWORD);
      expect(gotrue.calls).toContain("POST /logout?scope=others");
      const lines = errors.mock.calls.filter(
        (c) => c[1] === "password_reset_revoke_failed",
      );
      expect(lines).toHaveLength(1);
      const [component, , , err, data] = lines[0]!;
      expect(component).toBe("AUTH");
      expect(err).toBeUndefined();
      expect(data).toEqual({ requestId: REQUEST_ID });
      expect(JSON.stringify(lines[0])).not.toContain(RECOVERY_TOKEN);
      expect(JSON.stringify(lines[0])).not.toContain(STUDENT);
    });

    // ── Doc 01 §12.1 step 2 ───────────────────────────────────────────────────────────────────
    it("the limit is 3 per account per hour across separate requests, whatever case, spacing or IP", async () => {
      const app = await loadApp();
      const variants = [
        STUDENT_EMAIL,
        STUDENT_EMAIL.toUpperCase(),
        `  ${STUDENT_EMAIL}  `,
        "Reset-Student@Example.Test",
      ];
      const responses = [];
      for (const [i, email] of variants.entries()) {
        responses.push(
          await request(app)
            .post("/api/auth/reset-password")
            .set("X-Forwarded-For", `203.0.113.${i + 1}`)
            .send({ email }),
        );
      }

      // Three emails sent, the fourth suppressed, and one ledger row holding all three.
      expect(gotrue.recoverEmails).toHaveLength(3);
      expect(await ledgerUsed()).toBe(3);
      // The caller cannot tell the suppressed request from the others.
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual(responses[0]!.body);
      }
    });

    it("an address stored in mixed case is matched and counted when requested in lower case", async () => {
      const app = await loadApp();
      for (let i = 0; i < 4; i += 1) {
        await request(app)
          .post("/api/auth/reset-password")
          .send({ email: "mixed.case@example.test" });
      }
      const r = await pg.query(
        `SELECT used_count FROM public.rate_limit_ledger WHERE profile_id = $1 AND bucket_key = 'password_reset_requests_hourly'`,
        [MIXED],
      );
      expect(r.rows[0]?.used_count).toBe(3);
      expect(gotrue.recoverEmails).toHaveLength(3);
    });

    it("an unknown address gets the same response as a known one, allowed or throttled", async () => {
      const app = await loadApp();
      const known = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: STUDENT_EMAIL });
      const unknown = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: "nobody-here@example.test" });
      await pg.query(
        `UPDATE public.rate_limit_ledger SET used_count = limit_count WHERE profile_id = $1`,
        [STUDENT],
      );
      const throttled = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: STUDENT_EMAIL });

      expect(known.body.success).toBe(true);
      for (const res of [unknown, throttled]) {
        expect(res.status).toBe(known.status);
        expect(res.body).toEqual(known.body);
        expect(res.headers["retry-after"]).toBeUndefined();
      }
      // The unknown address is not counted: no account, so no ledger row exists for it.
      const rows = await pg.query(
        `SELECT count(*)::int AS n FROM public.rate_limit_ledger`,
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("an unreadable ledger sends nothing and answers the same (fail closed)", async () => {
      const app = await loadApp();
      const allowed = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: STUDENT_EMAIL });
      await pg.query(
        `UPDATE public.rate_limit_runtime_config SET value = value - 'password_reset_requests_hourly' WHERE key = 'bucket_definitions'`,
      );
      try {
        const res = await request(app)
          .post("/api/auth/reset-password")
          .send({ email: STUDENT_EMAIL });
        expect(res.status).toBe(200);
        expect(res.body).toEqual(allowed.body);
        expect(gotrue.recoverEmails).toHaveLength(1);
      } finally {
        await pg.query(
          `UPDATE public.rate_limit_runtime_config SET value = value || '{"password_reset_requests_hourly":{"limit":3,"window_seconds":3600}}'::jsonb WHERE key = 'bucket_definitions'`,
        );
      }
    });

    it("anon and authenticated cannot ask password_reset_subject whether an address has an account", async () => {
      for (const role of ["anon", "authenticated"]) {
        const r = await pg.query(
          `SELECT has_function_privilege($1, 'public.password_reset_subject(text)', 'EXECUTE') AS ok`,
          [role],
        );
        expect(r.rows[0].ok).toBe(false);
      }
    });
  },
);
