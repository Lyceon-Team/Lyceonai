/**
 * The retention sweep's OIDC audience, with real RS256-signed tokens.
 *
 * @spec [Doc-03C_V3 §9.3 (token audience matches the handler URL; issuer; service account);
 *       Doc-01A §3 (fail-fast: never serve with auth silently disabled); owner ruling 2026-10-05
 *       RS-01 (remove the CLOUD_TASKS_OIDC_AUDIENCE fallback; a missing
 *       RETENTION_SWEEP_OIDC_AUDIENCE answers 500 and logs at ERROR; exact-match checking stays)]
 *       | @implemented [2026-10-05]
 *
 * plain English: POST /api/internal/retention/sweep is mounted for real and called with JWTs signed
 * here by a locally generated RSA key. google-auth-library verifies them for real — signature,
 * expiry, audience, issuer — and only its certificate download is replaced, so it trusts this
 * test's key instead of fetching Google's. Nothing about the comparison is mocked: the audience
 * check under test is the library's own `aud === requiredAudience`.
 *
 * Why: production's Cloud Scheduler jobs were refused with 401 "Wrong recipient" at every
 * attempt. The route read RETENTION_SWEEP_OIDC_AUDIENCE and, when it was unset, fell back to
 * CLOUD_TASKS_OIDC_AUDIENCE — the compact-writeback URL. A token minted for the sweep URL can never
 * match that, so the fallback turned "not configured" into "every request rejected as forged".
 *
 * edge cases pinned: the near-miss audiences (preview host, www., trailing slash, wrong path, the
 * compact-writeback URL) each answer 401 — no normalisation creeps in.
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
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../server/logger", () => ({ logger: mockLogger }));

// The 365d tier never touches the client; nothing else is reached in this file.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {},
}));

const SWEEP_URL = "https://lyceon.ai/api/internal/retention/sweep";
const COMPACT_URL = "https://lyceon.ai/api/internal/memory/compact-writeback";
const SERVICE_ACCOUNT = "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";
const KID = "rs01-test-key";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type CertsResponse = Awaited<
  ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>
>;

/** A Cloud Scheduler-shaped Google ID token for `aud`, signed RS256 by the test key. */
function token(aud: string, email = SERVICE_ACCOUNT): string {
  return jwt.sign(
    {
      iss: "https://accounts.google.com",
      aud,
      sub: "112233445566778899000",
      email,
      email_verified: true,
    },
    privateKey,
    { algorithm: "RS256", keyid: KID, expiresIn: 300 },
  );
}

const BODY = {
  retention_tier: "365d",
  dry_run: true,
  request_id: "6f1c2a7e-0d3b-4f5a-9b8c-1d2e3f4a5b6c",
};

const ENV_KEYS = [
  "RETENTION_SWEEP_OIDC_AUDIENCE",
  "CLOUD_TASKS_OIDC_AUDIENCE",
  "CLOUD_TASKS_SERVICE_ACCOUNT",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

let app: express.Express;

function events(level: "error" | "warn"): string[] {
  return mockLogger[level].mock.calls.map((c: unknown[]) => String(c[1]));
}

describe("RS-01: retention sweep audience — real RS256 tokens", () => {
  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    vi.spyOn(
      OAuth2Client.prototype,
      "getFederatedSignonCertsAsync",
    ).mockImplementation(
      async (): Promise<CertsResponse> => ({
        certs: { [KID]: publicKey },
        format: "PEM" as CertsResponse["format"],
      }),
    );
    const { default: router } =
      await import("../../server/routes/internal-retention-routes");
    app = express();
    app.use(express.json());
    app.use("/api/internal", router);
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
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT = SERVICE_ACCOUNT;
    process.env.CLOUD_TASKS_OIDC_AUDIENCE = COMPACT_URL;
    delete process.env.RETENTION_SWEEP_OIDC_AUDIENCE;
  });

  const post = (bearer: string | null) => {
    const r = request(app).post("/api/internal/retention/sweep");
    return (
      bearer === null ? r : r.set("Authorization", `Bearer ${bearer}`)
    ).send(BODY);
  };

  it("production's state — sweep audience unset, compact-writeback set — refuses with 500 and logs the missing name at ERROR, never falls back", async () => {
    const res = await post(token(SWEEP_URL));
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: { code: "internal_auth_not_configured" },
    });
    expect(events("error")).toContain("oidc_config_missing");
    const logged = JSON.stringify(mockLogger.error.mock.calls);
    expect(logged).toContain("RETENTION_SWEEP_OIDC_AUDIENCE");
    // Names only, never values.
    expect(logged).not.toContain(COMPACT_URL);
    // The token was never checked against the compact-writeback audience.
    expect(events("warn")).not.toContain("oidc_auth_rejected");
    expect(events("error")).not.toContain("oidc_auth_rejected");
  });

  it("a token minted for the compact-writeback URL does not get in through the old fallback", async () => {
    const res = await post(token(COMPACT_URL));
    expect(res.status).toBe(500);
  });

  it("an empty RETENTION_SWEEP_OIDC_AUDIENCE counts as missing", async () => {
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = "";
    const res = await post(token(SWEEP_URL));
    expect(res.status).toBe(500);
    expect(events("error")).toContain("oidc_config_missing");
  });

  it("the correct audience is admitted: 200, the handler ran", async () => {
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = SWEEP_URL;
    const res = await post(token(SWEEP_URL));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      reason: "365d_tables_not_provisioned",
      tier: "365d",
    });
  });

  it.each([
    [
      "preview host",
      "https://lyceonai-git-guardian-lyceon.vercel.app/api/internal/retention/sweep",
    ],
    ["www.", "https://www.lyceon.ai/api/internal/retention/sweep"],
    ["trailing slash", `${SWEEP_URL}/`],
    ["wrong path", "https://lyceon.ai/api/internal/retention/sweeps"],
    ["compact-writeback URL", COMPACT_URL],
  ])("near miss — %s — is 401 oidc_auth_rejected", async (_label, aud) => {
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = SWEEP_URL;
    const res = await post(token(aud));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "oidc_auth_failed",
        message: "OIDC authentication failed",
      },
    });
    expect([...events("warn"), ...events("error")]).toContain(
      "oidc_auth_rejected",
    );
  });

  it("the right audience from the wrong service account is 401", async () => {
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = SWEEP_URL;
    const res = await post(
      token(SWEEP_URL, "someone-else@replit-cop.iam.gserviceaccount.com"),
    );
    expect(res.status).toBe(401);
  });

  it("no token is 401", async () => {
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE = SWEEP_URL;
    const res = await post(null);
    expect(res.status).toBe(401);
  });
});
