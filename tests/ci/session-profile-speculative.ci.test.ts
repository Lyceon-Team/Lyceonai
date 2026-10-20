/**
 * The profile read starts alongside the session check, and only the verified id's read is used.
 *
 * @spec [owner ruling (Karl) 2026-10-19 on #1257, ruling 1 (relayed 2026-10-20): "start the profile
 *        read IN PARALLEL with the Supabase session check (getUser), keyed on the token's
 *        (unverified) user id, and DISCARD it if the ids don't match ... never let the speculative
 *        read's result reach any decision or response unless the verified id matches; never log
 *        the unverified id; a malformed/absent token must behave exactly as today"; Coding
 *        Standards §6.1, §12.1] | @implemented [2026-10-20]
 *
 * plain English: the REAL `supabaseAuthMiddleware` and the REAL `ensureProfileForAuthUser`, with two
 * IO seams replaced: the SSR client's `getUser()` (it takes time, and is told which id it verifies)
 * and the service-role client the profile read goes through (it takes time, records which id each
 * read asked for and when it started, and returns the row for that id). The session cookie is a
 * real `@supabase/ssr`-shaped cookie whose access token CLAIMS an id. Asserted:
 *   - claim = verified id: ONE profile read, started before getUser() ended; `req.user` is that row;
 *     the `auth_profile` pre-step opens beside `auth_session`;
 *   - claim ≠ verified id: the claimed read is DISCARDED, the verified id is read again and is the
 *     only row that reaches the response; the claimed id is in no log line;
 *   - no cookie, a malformed token, a payload that is not JSON, a `sub` that is not a UUID: no read
 *     before getUser() ends — today's order;
 *   - signed out (getUser() refuses) with a valid-looking claim: 401, exactly as without the claim,
 *     and the claimed id is in no log line;
 *   - the matched read FAILS: the same 500 as today; the mismatched read fails: discarded, 200;
 *   - an unrecognised role in the matched read: the same 403 ROLE_UNRECOGNIZED as today.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import request from "supertest";

const VERIFIED = "6b6b6b6b-0000-4000-8000-000000000001";
const OTHER = "6b6b6b6b-0000-4000-8000-000000000002";

const logs = vi.hoisted(() => ({
  calls: [] as unknown[][],
}));
vi.mock("../../server/logger", () => {
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      logs.calls.push([level, ...args]);
    };
  return {
    logger: {
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
      apiRequest: record("apiRequest"),
    },
  };
});

const io = vi.hoisted(() => ({
  verifiedId: "" as string | null,
  authMs: 30,
  profileMs: 10,
  authStartedAt: 0,
  authEndedAt: 0,
  /** One entry per profile read: the id it asked for and when it started. */
  profileReads: [] as Array<{ id: string; startedAt: number }>,
  failReadFor: null as string | null,
  roleFor: {} as Record<string, string>,
}));

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("../../server/lib/supabase-ssr", () => ({
  createSupabaseServerClient: (_req: unknown, _res: Response) => ({
    auth: {
      getUser: async () => {
        io.authStartedAt = performance.now();
        await pause(io.authMs);
        io.authEndedAt = performance.now();
        return io.verifiedId
          ? {
              data: {
                user: {
                  id: io.verifiedId,
                  email: `${io.verifiedId}@example.test`,
                },
              },
              error: null,
            }
          : { data: { user: null }, error: null };
      },
    },
  }),
}));

// The service-role client the middleware builds (`createClient`): only `profiles` by id is read.
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const original = await importOriginal<object>();
  const fakeAdmin = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        neq: () => chain,
        maybeSingle: async () => {
          const id = String(filters.id ?? "");
          if (table !== "profiles") return { data: null, error: null };
          io.profileReads.push({ id, startedAt: performance.now() });
          await pause(io.profileMs);
          if (io.failReadFor === id)
            return {
              data: null,
              error: { message: "read failed", code: "XX000" },
            };
          return {
            data: {
              id,
              email: `${id}@example.test`,
              display_name: `Name ${id.slice(-1)}`,
              role: io.roleFor[id] ?? "student",
              is_under_13: false,
              guardian_email: null,
              student_link_code: null,
              profile_completed_at: "2026-09-01T00:00:00.000Z",
              actor_id: `${id.slice(0, -1)}9`,
              deleted_at: null,
            },
            error: null,
          };
        },
      };
      return chain;
    },
  };
  return { ...original, createClient: () => fakeAdmin };
});

const { requestIdMiddleware } =
  await import("../../server/middleware/request-id");
const { supabaseAuthMiddleware, requireSupabaseAuth } =
  await import("../../server/middleware/supabase-auth");
const { timedRoute } = await import("../../server/lib/step-timer");

function app(): express.Express {
  const a = express();
  a.use(requestIdMiddleware);
  // codeql[js/missing-token-validation]: false positive — read-only GET routes in a test app.
  a.use(cookieParser());
  a.use(rateLimit({ windowMs: 60_000, max: 1000 }));
  a.use(supabaseAuthMiddleware);
  a.get(
    "/api/me",
    requireSupabaseAuth,
    timedRoute("calendar.read", async (req: Request, res: Response) => {
      res.json({ id: req.user?.id, name: req.user?.display_name });
    }),
  );
  return a;
}

function b64url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}
/** A JWT-shaped token whose payload is `payload` (header and signature are not checked here). */
function token(payload: string): string {
  return `${b64url('{"alg":"ES256","typ":"JWT"}')}.${payload}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
}
/** The `@supabase/ssr` session cookie carrying `accessToken`. */
function ssrCookie(accessToken: string): string {
  const blob = JSON.stringify({
    access_token: accessToken,
    token_type: "bearer",
  });
  return `sb-testref-auth-token=base64-${Buffer.from(blob).toString("base64")}`;
}
const claiming = (sub: string): string =>
  ssrCookie(token(b64url(JSON.stringify({ sub, role: "authenticated" }))));

type PreStep = { step: string; ms: number | null; at_ms: number };
function preSteps(): PreStep[] {
  const line = logs.calls.find(
    (c) => c[1] === "PERF" && c[2] === "route_timing",
  );
  return ((line?.[4] as { pre_steps?: PreStep[] } | undefined)?.pre_steps ??
    []) as PreStep[];
}
const logged = (): string => JSON.stringify(logs.calls);

beforeEach(() => {
  logs.calls.length = 0;
  io.verifiedId = VERIFIED;
  io.profileReads = [];
  io.failReadFor = null;
  io.roleFor = {};
});

describe("session check ∥ profile read (ruling 1)", () => {
  it("claim = verified id: one read, started before getUser() ended, and it is the user", async () => {
    const res = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(VERIFIED));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: VERIFIED, name: "Name 1" });
    expect(io.profileReads.map((r) => r.id)).toEqual([VERIFIED]);
    // The overlap: the read began while the session check was still running.
    expect(io.profileReads[0]!.startedAt).toBeLessThan(io.authEndedAt);
    const steps = preSteps();
    expect(steps.map((s) => s.step)).toEqual(["auth_session", "auth_profile"]);
    const [session, profile] = steps as [PreStep, PreStep];
    expect(profile.at_ms).toBeLessThan(session.at_ms + session.ms!);
  });

  it("claim ≠ verified id: the claimed read is discarded; only the verified row reaches the response", async () => {
    const res = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(OTHER));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: VERIFIED, name: "Name 1" });
    expect(io.profileReads.map((r) => r.id)).toEqual([OTHER, VERIFIED]);
    // The verified read is made only once the session check has answered.
    expect(io.profileReads[1]!.startedAt).toBeGreaterThanOrEqual(
      io.authEndedAt,
    );
    expect(logged()).toContain(VERIFIED); // presence: lines were captured
    expect(logged()).not.toContain(OTHER);
  });

  it("claim ≠ verified id and the claimed read FAILS: still discarded, 200", async () => {
    io.failReadFor = OTHER;
    const res = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(OTHER));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(VERIFIED);
    expect(logged()).not.toContain(OTHER);
    expect(logged()).not.toContain("profile_load_failed");
  });

  it.each([
    ["no session cookie", null],
    [
      "a token that is not a JWT",
      ssrCookie("not-a-jwt-but-long-enough-to-pass"),
    ],
    ["a payload that is not JSON", ssrCookie(token(b64url("{not json")))],
    ["a sub that is not a UUID", ssrCookie(token(b64url('{"sub":"admin"}')))],
    ["no sub at all", ssrCookie(token(b64url('{"role":"authenticated"}')))],
  ])(
    "%s: no read before getUser() ends (today's order)",
    async (_label, cookie) => {
      const r = request(app()).get("/api/me");
      const res = await (cookie === null ? r : r.set("Cookie", cookie));
      expect(res.status).toBe(200);
      expect(io.profileReads.map((x) => x.id)).toEqual([VERIFIED]);
      expect(io.profileReads[0]!.startedAt).toBeGreaterThanOrEqual(
        io.authEndedAt,
      );
    },
  );

  it("signed out (getUser() refuses) with a valid-looking claim: 401 as today, claim never logged", async () => {
    io.verifiedId = null;
    const withClaim = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(OTHER));
    const without = await request(app()).get("/api/me");
    expect(withClaim.status).toBe(401);
    expect({ ...withClaim.body, requestId: null }).toEqual({
      ...without.body,
      requestId: null,
    });
    expect(logs.calls.length).toBeGreaterThan(0); // presence
    expect(logged()).not.toContain(OTHER);
  });

  it("the matched read fails: the same 500 as today", async () => {
    io.failReadFor = VERIFIED;
    const speculative = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(VERIFIED));
    const today = await request(app()).get("/api/me");
    expect(speculative.status).toBe(500);
    expect(speculative.body).toEqual(today.body);
    expect(speculative.body).toEqual({ error: "Failed to load user profile" });
  });

  it("an unrecognised role in the matched read: the same 403 ROLE_UNRECOGNIZED as today", async () => {
    io.roleFor[VERIFIED] = "tutor";
    const speculative = await request(app())
      .get("/api/me")
      .set("Cookie", claiming(VERIFIED));
    const today = await request(app()).get("/api/me");
    expect(speculative.status).toBe(403);
    expect(speculative.body).toMatchObject({ code: "ROLE_UNRECOGNIZED" });
    expect({ ...speculative.body, requestId: null }).toEqual({
      ...today.body,
      requestId: null,
    });
  });
});
