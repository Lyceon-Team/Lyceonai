/**
 * Internal routes never run the user-session middleware; user routes still do.
 *
 * @spec [Doc-03C_V3 §9.3 (internal routes authenticate by OIDC: audience, issuer, service account);
 *       Coding Standards §12.1 (structured logs, no noise that hides incidents); owner brief
 *       2026-10-05 "Silence the session warning on internal routes"] | @implemented [2026-10-05]
 *
 * plain English: production logged WARNING "Invalid or expired Supabase session"
 * (`jwt_validation`, AuthSessionMissingError) on every Cloud Scheduler call to
 * POST /api/internal/retention/sweep, before the OIDC check admitted it. The global user-session
 * middleware ran on internal routes, which never carry a user session. This drives the REAL app
 * (server/index) with the REAL session middleware and the REAL OIDC guard: an RS256 token signed
 * here by a local key, verified by google-auth-library with only its certificate download replaced.
 *
 * MOCK BOUNDARY. Substituted: the Auth server (`createSupabaseServerClient().auth.getUser()` answers
 * "no session", exactly as it does for a request with no cookie) and Google's certificate fetch.
 * Everything else — the session middleware, its mount, the deletion lock, every router — is real.
 *
 * Proven: (1) internal routes with a valid token log no `jwt_validation`; (2) a user route with an
 * invalid session still logs it and still answers 401; (3) no internal route opened: without its
 * token the OIDC route answers 401 and a cron route answers 404, as before; (4) the skip is exactly
 * the internal prefix — `/api/internalx` still runs the session middleware.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import type { Express } from "express";
import "../utils/securityTestUtils";

const { getUserCalls } = vi.hoisted(() => ({ getUserCalls: { count: 0 } }));

// The Auth server: every request here carries no session, so getUser answers as it does in
// production for a cookie-less scheduler call.
vi.mock("../../server/lib/supabase-ssr", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/supabase-ssr")>();
  return {
    ...actual,
    createSupabaseServerClient: () => ({
      auth: {
        getUser: async () => {
          getUserCalls.count += 1;
          return { data: { user: null }, error: new AuthSessionMissingError() };
        },
      },
    }),
  };
});

// The 365d tier answers without touching the database; the stand-in is only here so nothing
// reaches a network.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));

process.env.NODE_ENV = "test";

const SWEEP_URL = "https://lyceon.ai/api/internal/retention/sweep";
const SERVICE_ACCOUNT = "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";
const KID = "internal-no-session-key";
const BODY = {
  retention_tier: "365d",
  dry_run: true,
  request_id: "6f1c2a7e-0d3b-4f5a-9b8c-1d2e3f4a5b6c",
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function token(aud: string): string {
  return jwt.sign(
    {
      iss: "https://accounts.google.com",
      aud,
      sub: "112233445566778899000",
      email: SERVICE_ACCOUNT,
      email_verified: true,
    },
    privateKey,
    { algorithm: "RS256", keyid: KID, expiresIn: 300 },
  );
}

type CertsResponse = Awaited<
  ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>
>;

const ENV_KEYS = [
  "RETENTION_SWEEP_OIDC_AUDIENCE",
  "CLOUD_TASKS_SERVICE_ACCOUNT",
  "CRON_SECRET",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

let app: Express;
let warn: ReturnType<typeof vi.spyOn>;

/** Every `jwt_validation` event the real logger was asked to write. */
function jwtValidationEvents(): unknown[][] {
  return warn.mock.calls.filter((c: unknown[]) => c[1] === "jwt_validation");
}

describe("internal routes skip the user-session middleware", () => {
  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = SWEEP_URL;
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT = SERVICE_ACCOUNT;
    process.env.CRON_SECRET = "internal-no-session-cron-secret";
    vi.spyOn(
      OAuth2Client.prototype,
      "getFederatedSignonCertsAsync",
    ).mockImplementation(
      async (): Promise<CertsResponse> => ({
        certs: { [KID]: publicKey },
        format: "PEM" as CertsResponse["format"],
      }),
    );
    ({ default: app } = await import("../../server/index"));
    const { logger } = await import("../../server/logger");
    warn = vi.spyOn(logger, "warn");
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    warn.mockClear();
    getUserCalls.count = 0;
  });

  it("presence: a user route with no session logs jwt_validation and answers 401", async () => {
    const res = await request(app).get("/api/profile");
    expect(res.status).toBe(401);
    expect(getUserCalls.count).toBe(1);
    expect(jwtValidationEvents()).toHaveLength(1);
    expect(jwtValidationEvents()[0]?.[2]).toBe(
      "Invalid or expired Supabase session",
    );
  });

  it("the retention sweep with a valid OIDC token: 200, the session middleware never ran", async () => {
    const res = await request(app)
      .post("/api/internal/retention/sweep")
      .set("Authorization", `Bearer ${token(SWEEP_URL)}`)
      .send(BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tier: "365d" });
    expect(getUserCalls.count).toBe(0);
    expect(jwtValidationEvents()).toEqual([]);
  });

  it("a cron-secret internal route with its secret: no session lookup", async () => {
    await request(app)
      .get("/api/internal/qotd-schedule")
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`);
    expect(getUserCalls.count).toBe(0);
    expect(jwtValidationEvents()).toEqual([]);
  });

  it("Express matches routes case-insensitively, so the skip does too", async () => {
    const res = await request(app)
      .post("/API/Internal/retention/sweep")
      .set("Authorization", `Bearer ${token(SWEEP_URL)}`)
      .send(BODY);
    expect(res.status).toBe(200);
    expect(getUserCalls.count).toBe(0);
  });

  it("no internal route opened: the OIDC route without a token is 401", async () => {
    const res = await request(app)
      .post("/api/internal/retention/sweep")
      .send(BODY);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "oidc_auth_failed" } });
  });

  it("no internal route opened: a cron route without its secret is 404", async () => {
    const res = await request(app).get("/api/internal/qotd-schedule");
    expect(res.status).toBe(404);
  });

  it("the skip is the internal prefix only: /api/internalx still runs the session middleware", async () => {
    await request(app).get("/api/internalx/anything");
    expect(getUserCalls.count).toBe(1);
    expect(jwtValidationEvents()).toHaveLength(1);
  });
});
